use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const CASES: [&str; 7] = [
    "READ_ADDRESS",
    "READ_DATA",
    "STREAM",
    "ERROR_RESPONSE",
    "WRITE_PERIOD",
    "SECURITY_FIXTURE",
    "ALL",
];
pub const PATH: &str = "meter";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "dlt645-2007-tcp")]
    Dlt645Tcp,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
pub enum Security {
    Reject {},
    Fixture {
        request_di: String,
        response_di: String,
        operator: String,
        request_hex: String,
        response_hex: String,
    },
}
impl Security {
    pub fn is_fixture(&self) -> bool {
        matches!(self, Self::Fixture { .. })
    }
    fn validate(&self) -> Result<()> {
        if let Self::Fixture {
            request_di,
            response_di,
            operator,
            request_hex,
            response_hex,
        } = self
        {
            for (name, value, size) in [
                ("request_di", request_di, 8),
                ("response_di", response_di, 8),
                ("operator", operator, 8),
                ("request_hex", request_hex, 16),
                ("response_hex", response_hex, 24),
            ] {
                if value.len() != size || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                    bail!("config.security.{name}: expected exactly {size} hexadecimal characters");
                }
            }
            if !["07000001", "07000002", "07000003"].contains(&request_di.as_str())
                || !response_di.eq_ignore_ascii_case("070000FF")
            {
                bail!("config.security: request DI must be07000001/02/03 and response DI070000FF");
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Dlt645Config {
    pub wire_profile: WireProfile,
    pub bind_ip: String,
    pub port: u16,
    pub meter_address: String,
    pub energy_hundredths: u32,
    pub period_minutes: u8,
    pub programming_key_enabled: bool,
    pub max_connections: u16,
    pub security: Security,
}
impl Default for Dlt645Config {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::Dlt645Tcp,
            bind_ip: "0.0.0.0".into(),
            port: 20645,
            meter_address: "000000000001".into(),
            energy_hundredths: 12345678,
            period_minutes: 30,
            programming_key_enabled: false,
            max_connections: 16,
            security: Security::Reject {},
        }
    }
}
impl Dlt645Config {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .map_err(|_| anyhow::anyhow!("config.bind_ip: expected IPv4"))?;
        if ip.is_multicast() || ip.is_broadcast() {
            bail!("config.bind_ip: expected unicast/wildcard");
        }
        if self.port == 0 {
            bail!("config.port: must be1..65535");
        }
        if self.meter_address.len() != 12
            || !self.meter_address.bytes().all(|b| b.is_ascii_digit())
            || self.meter_address == "999999999999"
        {
            bail!(
                "config.meter_address: exactly12 ASCII decimal digits, excluding broadcast999999999999"
            );
        }
        if self.energy_hundredths > 99999999 {
            bail!("config.energy_hundredths: must be0..99999999");
        }
        if !(1..=99).contains(&self.period_minutes) {
            bail!("config.period_minutes: must be1..99");
        }
        if !(1..=128).contains(&self.max_connections) {
            bail!("config.max_connections: must be1..128 concurrent connections");
        }
        self.security.validate()
    }
    pub fn cases(&self) -> Vec<&'static str> {
        CASES
            .into_iter()
            .filter(|m| {
                (*m != "WRITE_PERIOD" || self.programming_key_enabled)
                    && (*m != "SECURITY_FIXTURE" || self.security.is_fixture())
            })
            .collect()
    }
}
pub fn schema() -> Value {
    json!({"protocol_id":"dlt645","type":"object","additionalProperties":false,"default":Dlt645Config::default(),"required":["wire_profile","bind_ip","port","meter_address","energy_hundredths","period_minutes","programming_key_enabled","max_connections","security"],"properties":{"wire_profile":{"type":"string","enum":["dlt645-2007-tcp"]},"bind_ip":{"type":"string","format":"ipv4"},"port":{"type":"integer","minimum":1,"maximum":65535},"meter_address":{"type":"string","pattern":"^[0-9]{12}$","not":{"const":"999999999999"}},"energy_hundredths":{"type":"integer","minimum":0,"maximum":99999999},"period_minutes":{"type":"integer","minimum":1,"maximum":99},"programming_key_enabled":{"type":"boolean"},"max_connections":{"type":"integer","minimum":1,"maximum":128},"security":{"oneOf":[{"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"reject"}}},{"type":"object","additionalProperties":false,"required":["mode","request_di","response_di","operator","request_hex","response_hex"],"properties":{"mode":{"const":"fixture"},"request_di":{"enum":["07000001","07000002","07000003"]},"response_di":{"type":"string","pattern":"^070000[fF][fF]$"},"operator":{"type":"string","pattern":"^[0-9a-fA-F]{8}$"},"request_hex":{"type":"string","pattern":"^[0-9a-fA-F]{16}$"},"response_hex":{"type":"string","pattern":"^[0-9a-fA-F]{24}$"}}}]}},"notes":["Finite software DL/T645-2007 meter over TCP; no physical RS485/ESAM/1997 claim","Configuration contains startup values; legitimate wire writes change runtime values across connections","ALL is readonly core; optional period write restores observed current value; security fixture never verifies cryptography","Programming key is a simulated per-function condition, not a global readonly switch; fixed public software test credentials are zero"]})
}

fn request(address: &[u8; 6], control: u8, data: &[u8]) -> Vec<u8> {
    let mut raw = vec![0x68];
    raw.extend_from_slice(address);
    raw.extend_from_slice(&[0x68, control, data.len() as u8]);
    raw.extend(data.iter().map(|v| v.wrapping_add(0x33)));
    let cs = raw.iter().fold(0u8, |s, b| s.wrapping_add(*b));
    raw.extend_from_slice(&[cs, 0x16]);
    raw
}
fn valid_bcd(data: &[u8]) -> bool {
    data.iter().all(|b| b >> 4 <= 9 && b & 15 <= 9)
}
fn decode(raw: &[u8]) -> Result<([u8; 6], u8, Vec<u8>)> {
    if raw.len() < 12
        || raw[0] != 0x68
        || raw[7] != 0x68
        || raw.len() != 12 + raw[9] as usize
        || raw[raw.len() - 1] != 0x16
        || raw[..raw.len() - 2]
            .iter()
            .fold(0u8, |s, b| s.wrapping_add(*b))
            != raw[raw.len() - 2]
    {
        bail!("DL/T645 reply has invalid length, header, checksum or terminator");
    }
    let address: [u8; 6] = raw[1..7].try_into()?;
    if !valid_bcd(&address) || address == [0x99; 6] {
        bail!("DL/T645 reply has invalid meter address");
    }
    Ok((
        address,
        raw[8],
        raw[10..raw.len() - 2]
            .iter()
            .map(|b| b.wrapping_sub(0x33))
            .collect(),
    ))
}
async fn frame(stream: &mut tokio::net::TcpStream) -> Result<Vec<u8>> {
    let mut first = [0u8; 1];
    let mut count = 0;
    loop {
        stream.read_exact(&mut first).await?;
        if first[0] == 0x68 {
            break;
        }
        count += 1;
        if first[0] != 0xfe || count > 4096 {
            bail!("DL/T645 reply has unexpected prefix");
        }
    }
    let mut raw = vec![0; 10];
    raw[0] = 0x68;
    stream.read_exact(&mut raw[1..]).await?;
    let size = 12 + raw[9] as usize;
    raw.resize(size, 0);
    stream.read_exact(&mut raw[10..]).await?;
    Ok(raw)
}
pub async fn probe(c: &Dlt645Config) -> Result<()> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    tokio::time::timeout_at(deadline, probe_inner(c))
        .await
        .map_err(|_| anyhow::anyhow!("DL/T645 readiness exceeded absolute3-second deadline"))??;
    if tokio::time::Instant::now() >= deadline {
        bail!("DL/T645 readiness exceeded absolute3-second deadline");
    }
    Ok(())
}
async fn probe_inner(c: &Dlt645Config) -> Result<()> {
    let host = if c.bind_ip == "0.0.0.0" {
        "127.0.0.1"
    } else {
        &c.bind_ip
    };
    let mut stream = tokio::net::TcpStream::connect((host, c.port)).await?;
    stream.write_all(&request(&[0xaa; 6], 0x13, &[])).await?;
    let (addr, control, data) = decode(&frame(&mut stream).await?)?;
    if control != 0x93 || data.as_slice() != addr {
        bail!("DL/T645 READ_ADDRESS did not return matching actual current address");
    }
    let di = 0x00010000u32.to_le_bytes();
    stream.write_all(&request(&addr, 0x11, &di)).await?;
    let (reply_addr, control, data) = decode(&frame(&mut stream).await?)?;
    if reply_addr != addr
        || control != 0x91
        || data.len() != 8
        || data[..4] != di
        || !valid_bcd(&data[4..])
    {
        bail!("DL/T645 READ_DATA did not return current-address energy DI/BCD payload");
    }
    stream.shutdown().await?;
    let mut trailing = [0u8; 1];
    if stream.read(&mut trailing).await? != 0 {
        bail!("DL/T645 sent unexpected data after readiness requests");
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_configuration_and_case_gates_preserve_software_profile() {
        let c: crate::model::ProtocolConfig = Dlt645Config::default().into();
        let encoded = serde_json::to_string(&c).unwrap();
        assert_eq!(
            serde_json::from_str::<crate::model::ProtocolConfig>(&encoded)
                .unwrap()
                .protocol_id(),
            "dlt645"
        );
        for patch in [
            json!({"meter_address":"999999999999"}),
            json!({"meter_address":"123"}),
            json!({"energy_hundredths":100000000}),
            json!({"period_minutes":0}),
            json!({"period_minutes":100}),
            json!({"max_connections":129}),
            json!({"programming_key_enabled":1}),
            json!({"security":{"mode":"reject","extra":1}}),
            json!({"security":null}),
            json!({"wire_profile":"1997"}),
        ] {
            assert!(c.patch(patch.clone()).is_err(), "{patch}");
        }
        let d = Dlt645Config::default();
        assert_eq!(
            d.cases(),
            vec![
                "READ_ADDRESS",
                "READ_DATA",
                "STREAM",
                "ERROR_RESPONSE",
                "ALL"
            ]
        );
        let write = c.patch(json!({"programming_key_enabled":true})).unwrap();
        let crate::model::ProtocolConfig::Dlt645(write) = write else {
            panic!()
        };
        assert!(write.cases().contains(&"WRITE_PERIOD"));
        assert!(!write.cases().contains(&"SECURITY_FIXTURE"));
        let mut full = serde_json::to_value(d).unwrap();
        for key in ["wire_profile", "meter_address", "security"] {
            let v = full.as_object_mut().unwrap().remove(key).unwrap();
            assert!(serde_json::from_value::<Dlt645Config>(full.clone()).is_err());
            full[key] = v;
        }
    }
    #[test]
    fn fixture_has_exact_fields_and_limited_di_without_crypto_defaults() {
        let c: crate::model::ProtocolConfig = Dlt645Config::default().into();
        let sec = json!({"mode":"fixture","request_di":"07000002","response_di":"070000ff","operator":"00000000","request_hex":"0011223344556677","response_hex":"00112233445566778899aabb"});
        let f = c.patch(json!({"security":sec})).unwrap();
        let crate::model::ProtocolConfig::Dlt645(f) = f else {
            panic!()
        };
        assert!(f.cases().contains(&"SECURITY_FIXTURE"));
        assert!(!f.cases().contains(&"WRITE_PERIOD"));
        for (key, value) in [
            ("request_di", json!("07000004")),
            ("response_di", json!("070000FE")),
            ("operator", json!("0")),
            ("request_hex", json!("GG11223344556677")),
            ("extra", json!(true)),
        ] {
            let mut bad = sec.clone();
            bad[key] = value;
            assert!(c.patch(json!({"security":bad})).is_err());
        }
        let mut missing = sec.clone();
        missing.as_object_mut().unwrap().remove("operator");
        assert!(c.patch(json!({"security":missing})).is_err());
    }
    #[test]
    fn fixed_reference_frames_validate_real_checksum_and_modulo() {
        let bytes = |s: &str| {
            (0..s.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            request(&[0xaa; 6], 0x13, &[]),
            bytes("68aaaaaaaaaaaa681300df16")
        );
        assert_eq!(
            request(&[1, 0, 0, 0, 0, 0], 0x11, &0x00010000u32.to_le_bytes()),
            bytes("6801000000000068110433333433b316")
        );
        let mut raw = bytes("6801000000000068910833333433ab8967451716");
        let (a, c, d) = decode(&raw).unwrap();
        assert_eq!(a, [1, 0, 0, 0, 0, 0]);
        assert_eq!(c, 0x91);
        assert_eq!(d, [0, 0, 1, 0, 0x78, 0x56, 0x34, 0x12]);
        raw[18] ^= 1;
        assert!(decode(&raw).is_err());
        let wrapped = request(&[1, 0, 0, 0, 0, 0], 0x91, &[0xe3, 0xff]);
        assert_eq!(decode(&wrapped).unwrap().2, [0xe3, 0xff]);
        assert_eq!(wrapped[10], 0x16);
    }
}
