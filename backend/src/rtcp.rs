use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const CASES: [&str; 5] = ["SR_SDES", "REPORT_BLOCKS", "SDES_ITEMS", "PADDING", "ALL"];
pub const PATH: &str = "session";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum PacketProfile {
    #[serde(rename = "sr-sdes")]
    SrSdes,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RtcpConfig {
    pub bind_ip: String,
    pub port: u16,
    pub max_packet_size: u32,
    pub packet_profile: PacketProfile,
}
impl Default for RtcpConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 5005,
            max_packet_size: 2048,
            packet_profile: PacketProfile::SrSdes,
        }
    }
}
impl RtcpConfig {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .map_err(|_| anyhow::anyhow!("config.bind_ip: expected an IPv4 address"))?;
        if ip.is_multicast() || ip.is_broadcast() {
            bail!("config.bind_ip: expected unicast or wildcard address");
        }
        if self.port == 0 {
            bail!("config.port: must be between 1 and 65535");
        }
        if !(64..=65507).contains(&self.max_packet_size) {
            bail!("config.max_packet_size: must be between 64 and 65507 complete UDP bytes");
        }
        Ok(())
    }
}
pub fn schema() -> Value {
    json!({"protocol_id":"rtcp","type":"object","additionalProperties":false,"default":RtcpConfig::default(),"required":["bind_ip","port","max_packet_size","packet_profile"],"properties":{"bind_ip":{"type":"string","format":"ipv4"},"port":{"type":"integer","minimum":1,"maximum":65535},"max_packet_size":{"type":"integer","minimum":64,"maximum":65507},"packet_profile":{"type":"string","enum":["sr-sdes"]}},"notes":["Independent SR+SDES CNAME compound receiver; unsupported RTCP types rejected as profile limits; no RR/ACK","Capacity counts complete UDP bytes; RTCP alignment makes maximum legal compound 65504 bytes","Sender-declared counters are not actual receiver traffic statistics; NTP64 is exact hexadecimal"]})
}
pub async fn probe(c: &RtcpConfig, host: &str) -> Result<()> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    tokio::time::timeout_at(deadline, probe_inner(c, host))
        .await
        .map_err(|_| anyhow::anyhow!("RTCP readiness exceeded its absolute 3-second deadline"))??;
    if tokio::time::Instant::now() >= deadline {
        bail!("RTCP readiness exceeded its absolute 3-second deadline");
    }
    Ok(())
}
async fn probe_inner(c: &RtcpConfig, host: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(2))
        .build()?;
    let status = crate::receiver::observer_get(&client, host, "/v1/status").await?;
    let boot = status["boot_id"]
        .as_str()
        .filter(|s| s.len() == 32)
        .ok_or_else(|| anyhow::anyhow!("RTCP observer boot identity missing"))?;
    let after = status["counter"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("RTCP observer counter missing"))?;
    if status["schema_version"] != 1
        || status["implementation"] != "stdlib-rfc3550-rtcp-v2"
        || status["packet_profile"] != "sr-sdes"
        || status["max_packet_size"] != c.max_packet_size
        || status["udp_bound"] != json!(["0.0.0.0", 5005])
    {
        bail!("RTCP observer schema/configuration mismatch");
    }
    let nonce = uuid::Uuid::new_v4();
    let b = nonce.as_bytes();
    let word = |i| u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
    let ssrc = word(0);
    let ntp_msw = word(4);
    let ntp_lsw = word(8);
    let stamp = word(12);
    let packets = word(8);
    let octets = word(0);
    let cname = format!("plab-{}", &nonce.simple().to_string()[..16]);
    let mut raw = vec![0x80, 200, 0, 6];
    for v in [ssrc, ntp_msw, ntp_lsw, stamp, packets, octets] {
        raw.extend_from_slice(&v.to_be_bytes());
    }
    let mut sdes = Vec::from(ssrc.to_be_bytes());
    sdes.extend_from_slice(&[1, cname.len() as u8]);
    sdes.extend_from_slice(cname.as_bytes());
    sdes.push(0);
    while sdes.len() % 4 != 0 {
        sdes.push(0);
    }
    raw.extend_from_slice(&[0x81, 202]);
    raw.extend_from_slice(&((sdes.len() / 4) as u16).to_be_bytes());
    raw.extend_from_slice(&sdes);
    let sha = format!("{:x}", Sha256::digest(&raw));
    let cname_sha = format!("{:x}", Sha256::digest(cname.as_bytes()));
    let target = if c.bind_ip == "0.0.0.0" {
        "127.0.0.1"
    } else {
        &c.bind_ip
    };
    let udp = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
    udp.send_to(&raw, (target, c.port)).await?;
    loop {
        let observed = crate::receiver::observer_get(
            &client,
            host,
            &format!("/v1/observations?after={after}&raw_sha256={sha}"),
        )
        .await?;
        if observed["schema_version"] != 1 || observed["boot_id"] != boot {
            bail!("RTCP observer identity changed during readiness");
        }
        if observed["events"].as_array().is_some_and(|events| {
            events.iter().any(|e| {
                let r = &e["rtcp"];
                let sr = &r["primary_sr"];
                e["boot_id"] == boot
                    && e["event_id"].as_u64().is_some_and(|v| v > after)
                    && e["accepted"] == true
                    && e["raw"]["sha256"] == sha
                    && e["raw"]["length"] == raw.len()
                    && r["packet_profile"] == "sr-sdes"
                    && r["cname"] == cname
                    && r["cname_data"]["sha256"] == cname_sha
                    && sr["ssrc"] == ssrc
                    && sr["ntp_msw"] == ntp_msw
                    && sr["ntp_lsw"] == ntp_lsw
                    && sr["ntp64_hex"] == format!("{ntp_msw:08x}{ntp_lsw:08x}")
                    && sr["rtp_timestamp"] == stamp
                    && sr["sender_packet_count"] == packets
                    && sr["sender_octet_count"] == octets
                    && sr["report_count"] == 0
                    && sr["report_blocks"]["length"] == 0
                    && sr["report_blocks"]["sha256"] == format!("{:x}", Sha256::digest([]))
                    && sr["profile_extension"]["length"] == 0
            })
        }) {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn required_profile_disambiguates_rtp_without_changing_old_bytes() {
        let raw = r#"{"bind_ip":"0.0.0.0","port":5004,"max_packet_size":2048}"#;
        let r: crate::model::ProtocolConfig = serde_json::from_str(raw).unwrap();
        assert_eq!(r.protocol_id(), "rtp");
        assert_eq!(serde_json::to_string(&r).unwrap(), raw);
        assert!(serde_json::from_str::<RtcpConfig>(raw).is_err());
        let c: crate::model::ProtocolConfig = RtcpConfig::default().into();
        let text = serde_json::to_string(&c).unwrap();
        let decoded: crate::model::ProtocolConfig = serde_json::from_str(&text).unwrap();
        assert_eq!(decoded.protocol_id(), "rtcp");
        assert_eq!(decoded.fingerprint(), c.fingerprint());
        for v in [
            json!({"packet_profile":"rr"}),
            json!({"packet_profile":null}),
            json!({"max_packet_size":63}),
            json!({"max_packet_size":65508}),
            json!({"max_packet_size":true}),
            json!({"port":0}),
            json!({"observer_host":"127.0.0.1"}),
        ] {
            assert!(c.patch(v.clone()).is_err(), "{v}");
        }
        assert!(c.patch(json!({"max_packet_size":64})).is_ok());
        assert!(c.patch(json!({"max_packet_size":65507})).is_ok());
        assert!(r.patch(json!({"packet_profile":"sr-sdes"})).is_err());
    }
}
