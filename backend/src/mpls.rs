//! Finite single-label MPLS/IPv4 ICMP Echo software target configuration.
pub use crate::arp_client::Link;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::net::Ipv4Addr;
pub const OBSERVER_PORT: u16 = 18089;
pub const PATH: &str = "echo";
pub const CASES: [&str; 5] = ["ECHO", "TC_TTL", "PADDING", "INVALID_REQUEST", "ALL"];
pub const RUNTIME_LABEL: &str = "io.protocol-target-lab.mpls-runtime-id";
pub const NETWORK_KIND: &str = "mpls-l2";
pub const FILTER: [[u32; 4]; 4] = [
    [40, 0, 0, 12],
    [21, 0, 1, 0x8847],
    [6, 0, 0, 4294967295],
    [6, 0, 0, 0],
];
pub const FILTER_HASH: &str = "2664965342338e0a1e0ef77583475f3467f8d5047cbe258cf3c8e0b5e5c157c2";
pub fn image_schemas_match(v: &Value) -> bool {
    ["request", "response", "client", "control", "observer"]
        .iter()
        .all(|s| v[format!("io.protocol-target-lab.mpls-{s}-schema")] == "1")
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "mpls-single-label-ipv4-icmp-echo")]
    SingleLabelIpv4IcmpEcho,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Scenario {
    Normal {},
    Silent {},
    WrongEthSrc {},
    WrongEthDst {},
    WrongIpSrc {},
    WrongIpDst {},
    WrongId {},
    WrongSeq {},
    WrongPayload {},
    BadIpChecksum {},
    BadIcmpChecksum {},
    ShortEthernet {},
    ShortIpv4 {},
    ShortIcmp {},
}
impl Scenario {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::Normal {} => "normal",
            Self::Silent {} => "silent",
            Self::WrongEthSrc {} => "wrong-eth-src",
            Self::WrongEthDst {} => "wrong-eth-dst",
            Self::WrongIpSrc {} => "wrong-ip-src",
            Self::WrongIpDst {} => "wrong-ip-dst",
            Self::WrongId {} => "wrong-id",
            Self::WrongSeq {} => "wrong-seq",
            Self::WrongPayload {} => "wrong-payload",
            Self::BadIpChecksum {} => "bad-ip-checksum",
            Self::BadIcmpChecksum {} => "bad-icmp-checksum",
            Self::ShortEthernet {} => "short-ethernet",
            Self::ShortIpv4 {} => "short-ipv4",
            Self::ShortIcmp {} => "short-icmp",
        }
    }
}
fn mac(s: &str) -> Result<String> {
    let p = s.split(':').collect::<Vec<_>>();
    if p.len() != 6
        || p.iter()
            .any(|v| v.len() != 2 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        bail!("config.mac: six two-hex octets required")
    };
    let b = p
        .iter()
        .map(|v| u8::from_str_radix(v, 16))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if b[0] & 1 != 0 || b.iter().all(|v| *v == 0) {
        bail!("config.mac: nonzero unicast required")
    };
    Ok(s.to_ascii_lowercase())
}
fn deserialize_mac<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<String, D::Error> {
    mac(&String::deserialize(d)?).map_err(serde::de::Error::custom)
}
fn ip(s: &str) -> Result<Ipv4Addr> {
    let a: Ipv4Addr = s
        .parse()
        .context("config.ipv4: canonical dotted IPv4 required")?;
    if a.to_string() != s || a.octets()[0] == 0 || a.is_multicast() || a.is_broadcast() {
        bail!("config.ipv4: canonical nonzero unicast required")
    };
    Ok(a)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MplsConfig {
    pub wire_profile: WireProfile,
    pub link: Link,
    #[serde(deserialize_with = "deserialize_mac")]
    pub source_mac: String,
    pub source_ip: String,
    #[serde(deserialize_with = "deserialize_mac")]
    pub client_mac: String,
    pub client_ip: String,
    pub label: u32,
    pub reply_ttl: u8,
    pub scenario: Scenario,
}
impl Default for MplsConfig {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::SingleLabelIpv4IcmpEcho,
            link: Link::DockerBridge {},
            source_mac: "02:00:00:00:58:20".into(),
            source_ip: "198.18.58.20".into(),
            client_mac: "02:00:00:00:58:10".into(),
            client_ip: "198.18.58.10".into(),
            label: 58,
            reply_ttl: 64,
            scenario: Scenario::Normal {},
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct TestBudget {
    pub phase_bounds_ms: Vec<u64>,
    pub total_ms: u64,
    pub checks: u64,
    pub quiet_ms: u64,
}
impl MplsConfig {
    pub fn validate(&self) -> Result<()> {
        if ip(&self.source_ip)? == ip(&self.client_ip)? {
            bail!("config.roles: source and client IP must differ")
        };
        if self.source_mac != mac(&self.source_mac)?
            || self.client_mac != mac(&self.client_mac)?
            || self.source_mac == self.client_mac
        {
            bail!("config.mac: distinct canonical source/client MAC required")
        };
        let n = self.link.interface().as_bytes();
        if n.is_empty()
            || n.len() > 15
            || !(n[0].is_ascii_alphanumeric() || n[0] == b'_')
            || !n
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || [b'_', b'.', b'-'].contains(b))
        {
            bail!("config.link.interface: existing kernel interface name required")
        };
        if !(16..=1048575).contains(&self.label) || self.reply_ttl == 0 {
            bail!("config.label/reply_ttl: label16..1048575 and TTL1..255 required")
        };
        Ok(())
    }
    pub fn patch(&self, patch: Value) -> Result<Self> {
        let p = patch.as_object().context("config.patch: object required")?;
        if p.is_empty() {
            bail!("config.patch: empty object")
        };
        let mut v = serde_json::to_value(self)?;
        for (k, x) in p {
            if !v.as_object().unwrap().contains_key(k) || x.is_null() {
                bail!("config.patch: unknown/null field {k}")
            };
            v[k] = x.clone();
        }
        let c: Self =
            serde_json::from_value(v).context("config.patch: invalid MPLS configuration")?;
        c.validate()?;
        Ok(c)
    }
    pub fn observer_hash(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(self).expect("serializable MPLS config"))
                    .expect("serializable MPLS config")
            )
        )
    }
    pub fn test_budget(&self, method: &str) -> Result<TestBudget> {
        self.validate()?;
        if !CASES.contains(&method) {
            bail!("config.test: choose MPLS case or ALL")
        };
        let checks = if method == "ALL" { 8 } else { 2 };
        Ok(TestBudget {
            phase_bounds_ms: vec![3000; checks as usize],
            total_ms: 30000,
            checks,
            quiet_ms: 500,
        })
    }
    pub fn role_addresses(&self) -> Result<Vec<Ipv4Addr>> {
        let mut v = vec![ip(&self.source_ip)?, ip(&self.client_ip)?];
        let change = match self.scenario {
            Scenario::WrongIpSrc {} => Some(&self.source_ip),
            Scenario::WrongIpDst {} => Some(&self.client_ip),
            _ => None,
        };
        if let Some(s) = change {
            let mut octets = ip(s)?.octets();
            octets[3] ^= 1;
            v.push(octets.into());
        }
        Ok(v)
    }
}
pub fn config_args(c: &MplsConfig) -> Result<Vec<String>> {
    c.validate()?;
    Ok(vec!["--config-json".into(), serde_json::to_string(c)?])
}
pub fn schema() -> Value {
    let scenarios=["normal","silent","wrong-eth-src","wrong-eth-dst","wrong-ip-src","wrong-ip-dst","wrong-id","wrong-seq","wrong-payload","bad-ip-checksum","bad-icmp-checksum","short-ethernet","short-ipv4","short-icmp"].iter().map(|m|json!({"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":m}}})).collect::<Vec<_>>();
    json!({"protocol_id":"mpls","type":"object","additionalProperties":false,"default":MplsConfig::default(),"required":["wire_profile","link","source_mac","source_ip","client_mac","client_ip","label","reply_ttl","scenario"],"properties":{"wire_profile":{"const":"mpls-single-label-ipv4-icmp-echo"},"link":{"oneOf":[{"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"docker-bridge"}}},{"type":"object","additionalProperties":false,"required":["mode","interface"],"properties":{"mode":{"const":"host-interface"},"interface":{"type":"string","pattern":"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$"}}}]},"source_mac":{"type":"string"},"source_ip":{"type":"string","format":"ipv4"},"client_mac":{"type":"string"},"client_ip":{"type":"string","format":"ipv4"},"label":{"type":"integer","minimum":16,"maximum":1048575},"reply_ttl":{"type":"integer","minimum":1,"maximum":255},"scenario":{"oneOf":scenarios}},"notes":["Finite software MPLS single-label IPv4/ICMP Echo target; normal response is unlabelled IPv4","No general MPLS router/label switching or host MPLS configuration","ALL checks current applied scenario,8 checks; TX submission and peer reception are separate","13-byte short-ethernet may produce explicit per-request tx_error/environment_unavailable without killing the target","Role IPs do not assign OS addresses; source and peer need real separate Ethernet endpoints"]})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_config_bounds_and_atomic_patch() {
        let c = MplsConfig::default();
        c.validate().unwrap();
        assert_eq!(c.test_budget("ALL").unwrap().checks, 8);
        let upper = c
            .patch(json!({"label":1048575,"reply_ttl":255,"source_mac":"02:AA:00:00:58:20"}))
            .unwrap();
        assert_eq!(upper.source_mac, "02:aa:00:00:58:20");
        for p in [
            json!({"label":15}),
            json!({"label":1048576}),
            json!({"label":true}),
            json!({"reply_ttl":0}),
            json!({"reply_ttl":256}),
            json!({"source_ip":"0.1.2.3"}),
            json!({"client_mac":c.source_mac}),
            json!({"link":{"mode":"docker-bridge","interface":"eth0"}}),
            json!({"scenario":{"mode":"normal","duration":1}}),
            json!({"scenario":{"mode":"unknown"}}),
            json!({"wire_profile":null}),
        ] {
            assert!(c.patch(p).is_err());
        }
        let mut v = serde_json::to_value(c).unwrap();
        v.as_object_mut().unwrap().remove("wire_profile");
        assert!(serde_json::from_value::<MplsConfig>(v).is_err());
    }
    #[test]
    fn all_fourteen_scenarios_and_mutated_ips() {
        let c = MplsConfig::default();
        for mode in [
            "normal",
            "silent",
            "wrong-eth-src",
            "wrong-eth-dst",
            "wrong-ip-src",
            "wrong-ip-dst",
            "wrong-id",
            "wrong-seq",
            "wrong-payload",
            "bad-ip-checksum",
            "bad-icmp-checksum",
            "short-ethernet",
            "short-ipv4",
            "short-icmp",
        ] {
            let n = c.patch(json!({"scenario":{"mode":mode}})).unwrap();
            assert_eq!(n.scenario.mode(), mode);
            assert_eq!(
                n.role_addresses().unwrap().len(),
                if mode.starts_with("wrong-ip-") { 3 } else { 2 }
            );
        }
        assert_eq!(
            format!("{:x}", Sha256::digest(serde_json::to_vec(&FILTER).unwrap())),
            FILTER_HASH
        );
    }
}
