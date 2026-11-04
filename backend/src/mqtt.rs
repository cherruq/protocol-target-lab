use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const CASES: [&str; 7] = [
    "MQTT311_QOS0",
    "MQTT311_QOS1",
    "MQTT311_QOS2",
    "MQTT5_QOS0",
    "MQTT5_QOS1",
    "MQTT5_QOS2",
    "ALL",
];
pub const TEST_TOPIC: &str = "plab/test";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MqttConfig {
    pub bind_ip: String,
    pub port: u16,
    pub max_connections: u16,
    pub max_packet_size: u32,
}
impl Default for MqttConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 18883,
            max_connections: 32,
            max_packet_size: 1048576,
        }
    }
}
impl MqttConfig {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .context("config.bind_ip: expected IPv4 address")?;
        if ip.is_multicast() || ip.is_broadcast() || self.port == 0 {
            bail!("config.bind_ip/config.port: expected unicast/wildcard IPv4 and port 1..65535");
        }
        if !(1..=128).contains(&self.max_connections) {
            bail!("config.max_connections: expected 1..128");
        }
        if !(128..=1048576).contains(&self.max_packet_size) {
            bail!("config.max_packet_size: expected 128..1048576 bytes");
        }
        Ok(())
    }
}
async fn packet(socket: &mut tokio::net::TcpStream) -> Result<(u8, Vec<u8>)> {
    let kind = socket.read_u8().await?;
    let (mut length, mut multiplier) = (0usize, 1usize);
    for _ in 0..4 {
        let byte = socket.read_u8().await?;
        length += (byte as usize & 127) * multiplier;
        if length > 4096 {
            bail!("MQTT readiness response exceeds 4096 bytes");
        }
        if byte & 128 == 0 {
            let mut body = vec![0; length];
            socket.read_exact(&mut body).await?;
            return Ok((kind, body));
        }
        multiplier *= 128;
    }
    bail!("MQTT invalid remaining length")
}
pub async fn probe(config: &MqttConfig) -> Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        let host = if config.bind_ip == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &config.bind_ip
        };
        let mut socket = tokio::net::TcpStream::connect((host, config.port)).await?;
        let id = format!(
            "plab-h-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..12]
        );
        let mut connect = vec![0, 4, b'M', b'Q', b'T', b'T', 4, 2, 0, 10];
        connect.extend_from_slice(&(id.len() as u16).to_be_bytes());
        connect.extend_from_slice(id.as_bytes());
        let mut wire = vec![0x10, connect.len() as u8];
        wire.extend(connect);
        socket.write_all(&wire).await?;
        let (kind, body) = packet(&mut socket).await?;
        if kind != 0x20 || body != [0, 0] {
            bail!("MQTT CONNECT did not receive a successful clean-session CONNACK");
        }
        socket.write_all(&[0xc0, 0]).await?;
        let (kind, body) = packet(&mut socket).await?;
        if kind != 0xd0 || !body.is_empty() {
            bail!("MQTT PING did not receive PINGRESP");
        }
        socket.write_all(&[0xe0, 0]).await?;
        let mut end = [0];
        if socket.read(&mut end).await? != 0 {
            bail!("MQTT unexpected data after DISCONNECT");
        }
        Ok::<_, anyhow::Error>(())
    })
    .await
    .context("MQTT readiness timed out")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mqtt_limits_and_types_are_strict() {
        let base = MqttConfig::default();
        assert!(base.validate().is_ok());
        for value in [0, 129] {
            assert!(
                MqttConfig {
                    max_connections: value,
                    ..base.clone()
                }
                .validate()
                .is_err()
            );
        }
        for value in [0, 127, 1048577] {
            assert!(
                MqttConfig {
                    max_packet_size: value,
                    ..base.clone()
                }
                .validate()
                .is_err()
            );
        }
        assert!(
            MqttConfig {
                max_connections: 1,
                max_packet_size: 128,
                ..base.clone()
            }
            .validate()
            .is_ok()
        );
        for patch in [
            serde_json::json!({"port":null}),
            serde_json::json!({"records":[]}),
            serde_json::json!({"max_connections":1.5}),
        ] {
            let mut value = serde_json::to_value(&base).unwrap();
            for (key, val) in patch.as_object().unwrap() {
                value[key] = val.clone();
            }
            assert!(serde_json::from_value::<MqttConfig>(value).is_err());
        }
    }
}
