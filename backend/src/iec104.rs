use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const CASES: [&str; 5] = ["CONNECT", "GI", "READ", "COMMAND", "ALL"];
pub const PATH: &str = "station";

pub fn schema() -> serde_json::Value {
    use serde_json::json;
    let mut single = json!({"type":"object","additionalProperties":false,"properties":{"ca":{"type":"integer","minimum":1,"maximum":65534},"ioa":{"type":"integer","minimum":1,"maximum":16777215},"value":{"type":"boolean"}},"required":["ca","ioa","value"]});
    let mut measured = single.clone();
    measured["properties"]["value"] =
        json!({"type":"number","minimum":-(f32::MAX as f64),"maximum":f32::MAX as f64});
    single["description"] = json!("M_SP_NA_1, initial simulated boolean");
    measured["description"] =
        json!("M_ME_NC_1, initial simulated value rounded to IEEE754 float32");
    let command = json!({"type":"object","additionalProperties":false,"properties":{"ca":{"type":"integer","minimum":1,"maximum":65534},"ioa":{"type":"integer","minimum":1,"maximum":16777215}},"required":["ca","ioa"],"description":"C_SC_NA_1 DIRECT; updates the configured single point in memory"});
    json!({"protocol_id":"iec104","type":"object","additionalProperties":false,"implementation":"c104 2.2.1 + incremental TCP framing fix","default":Iec104Config::default(),"supported_features":["STARTDT","STOPDT","TESTFR","GI","READ","C_SC_NA_1 DIRECT"],"properties":{"bind_ip":{"type":"string","format":"ipv4","default":"0.0.0.0"},"port":{"type":"integer","minimum":1,"maximum":65535,"default":2404},"max_connections":{"type":"integer","minimum":1,"maximum":64,"default":16},"points":{"type":"object","additionalProperties":false,"properties":{"single":single,"measured":measured,"command":command},"required":["single","measured","command"]}},"required":["bind_ip","port","max_connections","points"],"notes":["Each (CA,IOA) pair must be unique; allowed stations come from the three points","Values are startup settings, not live telemetry","Direct commands update only the simulated single point; no physical action","COMMAND tests change and restore the current single point value; no invented command ACT_TERM","Plain TCP only; no TLS, authentication or reset service"]})
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SinglePoint {
    pub ca: u16,
    pub ioa: u32,
    pub value: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MeasuredPoint {
    pub ca: u16,
    pub ioa: u32,
    pub value: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CommandPoint {
    pub ca: u16,
    pub ioa: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Points {
    pub single: SinglePoint,
    pub measured: MeasuredPoint,
    pub command: CommandPoint,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Iec104Config {
    pub bind_ip: String,
    pub port: u16,
    pub max_connections: u16,
    pub points: Points,
}
impl Default for Iec104Config {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 2404,
            max_connections: 16,
            points: Points {
                single: SinglePoint {
                    ca: 1,
                    ioa: 1,
                    value: false,
                },
                measured: MeasuredPoint {
                    ca: 1,
                    ioa: 100,
                    value: 12.5,
                },
                command: CommandPoint { ca: 2, ioa: 1 },
            },
        }
    }
}
impl Iec104Config {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .context("config.bind_ip: expected IPv4 address")?;
        if ip.is_multicast() || ip.is_broadcast() || self.port == 0 {
            bail!("config.bind_ip/config.port: expected unicast/wildcard IPv4 and port1..65535");
        }
        if !(1..=64).contains(&self.max_connections) {
            bail!("config.max_connections: expected 1..64");
        }
        let p = &self.points;
        let addresses = [
            (p.single.ca, p.single.ioa),
            (p.measured.ca, p.measured.ioa),
            (p.command.ca, p.command.ioa),
        ];
        for (ca, ioa) in addresses {
            if !(1..=65534).contains(&ca) || !(1..=16777215).contains(&ioa) {
                bail!("config.points: expected CA1..65534 and IOA1..16777215");
            }
        }
        if addresses
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != 3
        {
            bail!("config.points: each (ca,ioa) address must be unique");
        }
        if !p.measured.value.is_finite() || p.measured.value.abs() > f32::MAX as f64 {
            bail!("config.points.measured.value: expected finite float32 range");
        }
        Ok(())
    }
}

enum Frame {
    Information(Vec<u8>),
    Supervisory,
    Unnumbered(u8),
}
struct Link {
    socket: tokio::net::TcpStream,
    sent: u16,
    received: u16,
    frames: usize,
    bytes: usize,
}
impl Link {
    async fn u(&mut self, command: u8) -> Result<()> {
        self.socket.write_all(&[0x68, 4, command, 0, 0, 0]).await?;
        Ok(())
    }
    async fn frame(&mut self) -> Result<Frame> {
        self.frames += 1;
        if self.frames > 32 {
            bail!("IEC104 readiness exceeded frame budget");
        }
        let mut header = [0; 2];
        self.socket.read_exact(&mut header).await?;
        if header[0] != 0x68 || !(4..=253).contains(&header[1]) {
            bail!("IEC104 invalid APDU header");
        }
        self.bytes += usize::from(header[1]) + 2;
        if self.bytes > 8192 {
            bail!("IEC104 readiness exceeded wire budget");
        }
        let mut data = vec![0; usize::from(header[1])];
        self.socket.read_exact(&mut data).await?;
        if data[0] & 1 == 0 {
            if data.len() < 10 || data[2] & 1 != 0 {
                bail!("IEC104 invalid information frame");
            }
            let ns = u16::from_le_bytes([data[0], data[1]]) >> 1;
            let nr = u16::from_le_bytes([data[2], data[3]]) >> 1;
            if ns != self.received || nr > self.sent {
                bail!("IEC104 unexpected sequence or acknowledgement");
            }
            self.received = (self.received + 1) & 0x7fff;
            let ack = (self.received << 1).to_le_bytes();
            self.socket
                .write_all(&[0x68, 4, 1, 0, ack[0], ack[1]])
                .await?;
            Ok(Frame::Information(data.split_off(4)))
        } else if data[0] == 1 {
            if data.len() != 4
                || data[1] != 0
                || data[2] & 1 != 0
                || (u16::from_le_bytes([data[2], data[3]]) >> 1) > self.sent
            {
                bail!("IEC104 invalid supervisory acknowledgement");
            }
            Ok(Frame::Supervisory)
        } else {
            if data.len() != 4
                || data[1..] != [0, 0, 0]
                || ![7, 11, 19, 35, 67, 131].contains(&data[0])
            {
                bail!("IEC104 invalid U frame");
            }
            Ok(Frame::Unnumbered(data[0]))
        }
    }
    async fn expect_u(&mut self, command: u8) -> Result<()> {
        loop {
            match self.frame().await? {
                Frame::Unnumbered(v) if v == command => return Ok(()),
                Frame::Unnumbered(67) => self.u(131).await?,
                Frame::Unnumbered(_) => bail!("IEC104 unexpected U response"),
                Frame::Information(_) | Frame::Supervisory => {}
            }
        }
    }
    async fn read_single(&mut self, point: &SinglePoint) -> Result<()> {
        let ca = point.ca.to_le_bytes();
        let ioa = point.ioa.to_le_bytes();
        let tx = (self.sent << 1).to_le_bytes();
        let rx = (self.received << 1).to_le_bytes();
        self.socket
            .write_all(&[
                0x68, 13, tx[0], tx[1], rx[0], rx[1], 102, 1, 5, 0, ca[0], ca[1], ioa[0], ioa[1],
                ioa[2],
            ])
            .await?;
        self.sent += 1;
        loop {
            match self.frame().await? {
                Frame::Information(asdu) => {
                    if asdu.len() == 10
                        && asdu[0] == 1
                        && asdu[1] & 127 == 1
                        && asdu[2] == 5
                        && asdu[3] == 0
                        && asdu[4..6] == ca
                        && asdu[6..9] == ioa[..3]
                        && asdu[9] & 0xfe == 0
                    {
                        return Ok(());
                    }
                    if asdu.len() >= 6 && asdu[4..6] == ca && asdu[2] & 0x3f >= 44 {
                        bail!("IEC104 read was rejected");
                    }
                }
                Frame::Supervisory => {}
                Frame::Unnumbered(67) => self.u(131).await?,
                Frame::Unnumbered(_) => bail!("IEC104 unexpected U response during read"),
            }
        }
    }
}
pub async fn probe(config: &Iec104Config) -> Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(4), async {
        let host = if config.bind_ip == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &config.bind_ip
        };
        let mut link = Link {
            socket: tokio::net::TcpStream::connect((host, config.port)).await?,
            sent: 0,
            received: 0,
            frames: 0,
            bytes: 0,
        };
        link.u(7).await?;
        link.expect_u(11).await?;
        // Values are mutable runtime state. Verify actual typed ASDU/address, not the startup value.
        link.read_single(&config.points.single).await?;
        link.u(19).await?;
        link.expect_u(35).await?;
        link.socket.shutdown().await?;
        let mut closing = vec![];
        link.socket.take(257).read_to_end(&mut closing).await?;
        if closing.len() > 256 {
            bail!("IEC104 unexpected data after readiness close");
        }
        Ok::<_, anyhow::Error>(())
    })
    .await
    .context("IEC104 readiness timed out")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn float32_json_extremes_roundtrip_through_full_and_partial_configuration() {
        for value in [f32::MAX as f64, -(f32::MAX as f64), 0.1, 1e-50] {
            let mut config = Iec104Config::default();
            config.points.measured.value = value;
            let raw = serde_json::to_string(&config).unwrap();
            let decoded: Iec104Config = serde_json::from_str(&raw).unwrap();
            assert_eq!(
                decoded.points.measured.value, value,
                "JSON must preserve the binary64 startup setting"
            );
            decoded.validate().unwrap();
            let patch: serde_json::Value = serde_json::from_str(&format!(
                "{{\"points\":{}}}",
                serde_json::to_string(&config.points).unwrap()
            ))
            .unwrap();
            let base: crate::model::ProtocolConfig = Iec104Config::default().into();
            let result = base.patch(patch).unwrap();
            assert_eq!(result, crate::model::ProtocolConfig::Iec104(config));
        }
        let mut config = Iec104Config::default();
        config.points.measured.value = f64::from_bits((f32::MAX as f64).to_bits() + 1);
        let decoded: Iec104Config =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert!(
            decoded.validate().is_err(),
            "one binary64 ULP above float32MAX is outside the configuration range"
        );
    }
    #[test]
    fn addresses_float32_and_strict_point_shapes() {
        let mut c = Iec104Config::default();
        assert!(c.validate().is_ok());
        c.points.single.ca = 65534;
        c.points.single.ioa = 16777215;
        assert!(c.validate().is_ok());
        c.points.single.ca = 65535;
        assert!(c.validate().is_err());
        c = Iec104Config::default();
        c.points.command.ca = 1;
        assert!(c.validate().is_err());
        c = Iec104Config::default();
        c.points.measured.value = f32::MAX as f64;
        assert!(c.validate().is_ok());
        c.points.measured.value = (f32::MAX as f64) * 2.;
        assert!(c.validate().is_err());
        let original = serde_json::to_value(Iec104Config::default()).unwrap();
        for (role, key, value) in [
            ("single", "value", serde_json::json!(1)),
            ("command", "value", serde_json::json!(false)),
            ("measured", "ioa", serde_json::Value::Null),
        ] {
            let mut v = original.clone();
            v["points"][role][key] = value;
            assert!(serde_json::from_value::<Iec104Config>(v).is_err());
        }
    }
}
