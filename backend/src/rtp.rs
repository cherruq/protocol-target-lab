use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const CASES: [&str; 5] = ["BASIC", "CSRC_EXTENSION", "PADDING", "SEQUENCE", "ALL"];
pub const PATH: &str = "stream";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RtpConfig {
    pub bind_ip: String,
    pub port: u16,
    pub max_packet_size: u32,
}
impl Default for RtpConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 5004,
            max_packet_size: 2048,
        }
    }
}
impl RtpConfig {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .map_err(|_| anyhow::anyhow!("config.bind_ip: expected an IPv4 address"))?;
        if ip.is_multicast() || ip.is_broadcast() {
            bail!("config.bind_ip: expected a unicast or wildcard address");
        }
        if self.port == 0 {
            bail!("config.port: must be between 1 and 65535");
        }
        if !(64..=65507).contains(&self.max_packet_size) {
            bail!(
                "config.max_packet_size: must be between 64 and 65507 bytes (complete UDP payload)"
            );
        }
        Ok(())
    }
}
pub fn schema() -> Value {
    json!({"protocol_id":"rtp","type":"object","additionalProperties":false,"required":["bind_ip","port","max_packet_size"],"properties":{"bind_ip":{"type":"string","format":"ipv4"},"port":{"type":"integer","minimum":1,"maximum":65535},"max_packet_size":{"type":"integer","minimum":64,"maximum":65507}},"default":RtpConfig::default(),"notes":["RTPv2 structural receiver with opaque payload; no RTP response or media decoding","max_packet_size limits the complete UDP payload, not a minimum RTP header size","Client success requires fresh received evidence from a private, read-only receiver observer"]})
}
pub async fn probe(config: &RtpConfig, observer: &str) -> Result<()> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    tokio::time::timeout_at(deadline, probe_inner(config, observer))
        .await
        .map_err(|_| anyhow::anyhow!("RTP readiness exceeded its absolute 3-second deadline"))??;
    if tokio::time::Instant::now() >= deadline {
        bail!("RTP readiness exceeded its absolute 3-second deadline");
    }
    Ok(())
}
async fn probe_inner(config: &RtpConfig, observer: &str) -> Result<()> {
    use sha2::{Digest, Sha256};
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(2))
        .build()?;
    let status = crate::receiver::observer_get(&client, observer, "/v1/status").await?;
    let boot = status["boot_id"]
        .as_str()
        .filter(|s| s.len() == 32)
        .ok_or_else(|| anyhow::anyhow!("RTP observer missing boot identity"))?;
    let after = status["counter"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("RTP observer missing counter"))?;
    if status["schema_version"] != 1
        || status["implementation"] != "stdlib-rfc3550-v2"
        || status["max_packet_size"] != config.max_packet_size
        || status["udp_bound"] != json!(["0.0.0.0", 5004])
    {
        bail!("RTP observer configuration/schema mismatch");
    }
    let nonce = uuid::Uuid::new_v4();
    let b = nonce.as_bytes();
    let mut packet = vec![0x80, 96];
    packet.extend_from_slice(&b[..10]);
    packet.extend_from_slice(b);
    let raw = format!("{:x}", Sha256::digest(&packet));
    let payload = format!("{:x}", Sha256::digest(b));
    let target = if config.bind_ip == "0.0.0.0" {
        "127.0.0.1"
    } else {
        &config.bind_ip
    };
    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
    socket.send_to(&packet, (target, config.port)).await?;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let seen = crate::receiver::observer_get(
            &client,
            observer,
            &format!("/v1/observations?after={after}&raw_sha256={raw}"),
        )
        .await?;
        if seen["schema_version"] != 1 || seen["boot_id"] != boot {
            bail!("RTP observer identity changed during readiness");
        }
        if seen["events"].as_array().is_some_and(|events| {
            events.iter().any(|e| {
                let r = &e["rtp"];
                e["boot_id"] == boot
                    && e["event_id"].as_u64().is_some_and(|n| n > after)
                    && e["accepted"] == true
                    && e["raw"]["sha256"] == raw
                    && e["raw"]["length"] == packet.len()
                    && r["version"] == 2
                    && r["payload_type"] == 96
                    && r["sequence"] == u16::from_be_bytes([b[0], b[1]])
                    && r["timestamp"] == u32::from_be_bytes([b[2], b[3], b[4], b[5]])
                    && r["ssrc"] == u32::from_be_bytes([b[6], b[7], b[8], b[9]])
                    && r["payload"]["length"] == 16
                    && r["payload"]["sha256"] == payload
            })
        }) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            bail!("RTP readiness: no fresh matching UDP receive observation");
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observer_is_derived_only_from_exact_owned_private_target() {
        let c: crate::model::ProtocolConfig = RtpConfig::default().into();
        let v = json!({"Id":"abc","State":{"Running":true},"Config":{"Labels":{crate::docker::OWNER:"deploy",crate::docker::INSTANCE:"rtp-demo","io.protocol-target-lab.managed":"true",crate::docker::HASH:c.fingerprint(),"io.protocol-target-lab.rtp-response-schema":"1","io.protocol-target-lab.rtp-observer-schema":"1"}},"HostConfig":{"NetworkMode":"bridge","PortBindings":{"5004/udp":[{"HostIp":"0.0.0.0","HostPort":"5004"}]}},"NetworkSettings":{"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}});
        assert_eq!(
            crate::receiver::observer_host(&v, "deploy", "rtp-demo", &c).unwrap(),
            "172.17.0.2"
        );
        for (pointer, value) in [
            (
                "/Config/Labels/io.protocol-target-lab.deployment",
                json!("other"),
            ),
            ("/State/Running", json!(false)),
            ("/HostConfig/NetworkMode", json!("host")),
            (
                "/NetworkSettings/Networks/bridge/IPAddress",
                json!("127.0.0.1"),
            ),
        ] {
            let mut bad = v.clone();
            *bad.pointer_mut(pointer).unwrap() = value;
            assert!(crate::receiver::observer_host(&bad, "deploy", "rtp-demo", &c).is_err());
        }
        let mut bad = v.clone();
        bad["HostConfig"]["PortBindings"]["18081/tcp"] =
            json!([{"HostIp":"0.0.0.0","HostPort":"18081"}]);
        assert!(crate::receiver::observer_host(&bad, "deploy", "rtp-demo", &c).is_err());
    }
    #[test]
    fn full_and_partial_config_bounds_are_strict() {
        let c: crate::model::ProtocolConfig = RtpConfig::default().into();
        for v in [64, 65507] {
            assert!(c.patch(json!({"max_packet_size":v})).is_ok());
        }
        for v in [
            json!({}),
            json!({"max_packet_size":63}),
            json!({"max_packet_size":65508}),
            json!({"max_packet_size":true}),
            json!({"port":0}),
            json!({"bind_ip":"239.1.1.1"}),
            json!({"observer_host":"127.0.0.1"}),
            json!({"port":null}),
        ] {
            assert!(c.patch(v.clone()).is_err(), "{v}");
        }
        let c2 = c.patch(json!({"port":15004})).unwrap();
        assert_eq!(c2.ip_endpoint().unwrap().port, 15004);
        assert_eq!(serde_json::to_value(c2).unwrap()["max_packet_size"], 2048);
    }
}
