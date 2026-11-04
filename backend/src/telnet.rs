use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const CASES: [&str; 5] = ["CONNECT", "ECHO", "OPTIONS", "UNKNOWN_OPTION", "ALL"];
pub const PATH: &str = "session";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TelnetConfig {
    pub bind_ip: String,
    pub port: u16,
    pub banner: String,
    pub max_connections: u16,
    pub max_line_bytes: u32,
}
impl Default for TelnetConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 2323,
            banner: "Protocol Target Lab Telnet".into(),
            max_connections: 16,
            max_line_bytes: 4096,
        }
    }
}
impl TelnetConfig {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .context("config.bind_ip: expected IPv4 address")?;
        if ip.is_multicast() || ip.is_broadcast() || self.port == 0 {
            bail!("config.bind_ip/config.port: expected unicast/wildcard IPv4 and port1..65535");
        }
        if self.banner.is_empty()
            || self.banner.len() > 256
            || self.banner.chars().any(|c| c.is_ascii_control())
        {
            bail!("config.banner: expected 1..256 UTF-8 bytes without ASCII control characters");
        }
        if !(1..=128).contains(&self.max_connections) {
            bail!("config.max_connections: expected 1..128");
        }
        if !(64..=65536).contains(&self.max_line_bytes) {
            bail!(
                "config.max_line_bytes: expected 64..65536 application-line bytes excluding CRLF"
            );
        }
        Ok(())
    }
}
/// A minimal read-only Telnet client for readiness. Refuse optional features;
/// the disposable client separately exercises native option callbacks.
struct Reader {
    total: usize,
}
impl Reader {
    async fn byte(&mut self, socket: &mut tokio::net::TcpStream) -> Result<u8> {
        self.total += 1;
        if self.total > 8192 {
            bail!("Telnet readiness exceeded the wire byte budget");
        }
        Ok(socket.read_u8().await?)
    }
    async fn line(&mut self, socket: &mut tokio::net::TcpStream) -> Result<Vec<u8>> {
        let mut data = vec![];
        loop {
            let byte = self.byte(socket).await?;
            if byte == 255 {
                let command = self.byte(socket).await?;
                match command {
                    255 => data.push(255),
                    251..=254 => {
                        let option = self.byte(socket).await?;
                        if command == 251 {
                            socket.write_all(&[255, 254, option]).await?;
                        }
                        if command == 253 {
                            socket.write_all(&[255, 252, option]).await?;
                        }
                    }
                    250 => loop {
                        if self.byte(socket).await? == 255 {
                            let next = self.byte(socket).await?;
                            if next == 240 {
                                break;
                            }
                            if next != 255 {
                                bail!("Telnet malformed subnegotiation");
                            }
                        }
                    },
                    240 => bail!("Telnet unexpected subnegotiation terminator"),
                    _ => {}
                }
            } else {
                data.push(byte);
            }
            if data.len() > 1024 {
                bail!("Telnet readiness line exceeded 1024 bytes");
            }
            if data.ends_with(b"\r\n") {
                data.truncate(data.len() - 2);
                return Ok(data);
            }
        }
    }
}
pub async fn probe(config: &TelnetConfig) -> Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(4), async {
        let host = if config.bind_ip == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &config.bind_ip
        };
        let mut socket = tokio::net::TcpStream::connect((host, config.port)).await?;
        let mut reader = Reader { total: 0 };
        let welcome = reader.line(&mut socket).await?;
        if welcome != format!("PLAB TELNET {}", config.banner).as_bytes() {
            bail!("Telnet welcome does not match applied banner");
        }
        let token = format!(
            "plab-h-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..12]
        );
        socket
            .write_all(format!("ECHO {token}\r\n").as_bytes())
            .await?;
        if reader.line(&mut socket).await? != token.as_bytes() {
            bail!("Telnet experiment ECHO did not return the requested data");
        }
        socket.write_all(b"CLOSE\r\n").await?;
        socket.shutdown().await?;
        let mut closing = vec![];
        socket.take(257).read_to_end(&mut closing).await?;
        if closing.len() > 256 {
            bail!("Telnet unexpected data while closing readiness connection");
        }
        Ok::<_, anyhow::Error>(())
    })
    .await
    .context("Telnet readiness timed out")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn banner_utf8_and_input_line_bounds_are_strict() {
        let config = TelnetConfig::default();
        assert!(config.validate().is_ok());
        for banner in [
            "".into(),
            "a\r\nb".into(),
            "a\0b".into(),
            "a\u{7f}b".into(),
            "é".repeat(129),
        ] {
            assert!(
                TelnetConfig {
                    banner,
                    ..config.clone()
                }
                .validate()
                .is_err()
            );
        }
        assert!(
            TelnetConfig {
                banner: "é".repeat(128),
                max_connections: 1,
                max_line_bytes: 64,
                ..config.clone()
            }
            .validate()
            .is_ok()
        );
        for n in [0, 63, 65537] {
            assert!(
                TelnetConfig {
                    max_line_bytes: n,
                    ..config.clone()
                }
                .validate()
                .is_err()
            );
        }
    }
}
