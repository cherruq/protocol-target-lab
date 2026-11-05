//! Three concurrent PROFINET lab nodes: native p-net DCP and two software PTCP nodes.
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::net::Ipv4Addr;
pub const OBSERVER_PORT: u16 = 18092;
pub const PATH: &str = "suite";
pub const RUNTIME_LABEL: &str = "io.protocol-target-lab.profinet-runtime-id";
pub const NETWORK_KIND: &str = "profinet-data";
pub const CASES: [&str; 10] = [
    "DCP_READ",
    "PTCP_N_DELAY",
    "PTCP_F_DELAY",
    "PTCP_SYNC",
    "PTCP_SYNC_FOLLOW_UP",
    "PTCP_ANNOUNCE",
    "ALL",
    "DCP_WRITE_STATION_TEMP",
    "DCP_WRITE_IP_TEMP",
    "DCP_SIGNAL",
];
pub const IMAGE_SCHEMAS: [&str; 6] = [
    "request", "response", "client", "control", "observer", "native",
];
pub const CLIENT_BUDGET_MS: u64 = 90000;
pub const EXECUTION_BUDGET_MS: u64 = 100000;
pub const CLEANUP_BUDGET_MS: u64 = 5000;
pub const MANAGER_BUDGET_MS: u64 = 105000;
pub fn image_schemas_match(v: &Value) -> bool {
    IMAGE_SCHEMAS
        .iter()
        .all(|s| v[format!("io.protocol-target-lab.profinet-{s}-schema")] == "1")
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "pnet-dcp-ptcp-lab-v1")]
    PnetDcpPtcpLabV1,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Link {
    OwnedDataL2 {},
}
impl Link {
    pub fn mode(&self) -> &'static str {
        "owned-data-l2"
    }
}
fn mac(s: &str) -> Result<String> {
    let p = s.split(':').collect::<Vec<_>>();
    if p.len() != 6
        || p.iter()
            .any(|v| v.len() != 2 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        bail!("config.mac: six hex octets required")
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
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct IpSuite {
    pub ip: String,
    pub netmask: String,
    pub gateway: String,
}
fn ipv4(s: &str) -> Result<u32> {
    let a: Ipv4Addr = s
        .parse()
        .context("config.ip_suite: canonical dotted IPv4 required")?;
    if a.to_string() != s {
        bail!("config.ip_suite: canonical dotted IPv4 required")
    };
    Ok(u32::from(a))
}
impl IpSuite {
    pub fn validate(&self) -> Result<()> {
        let i = ipv4(&self.ip)?;
        let m = ipv4(&self.netmask)?;
        let g = ipv4(&self.gateway)?;
        if i == 0 && m == 0 && g == 0 {
            return Ok(());
        };
        let valid = |v: u32| v >> 24 != 0 && v >> 24 < 224 && v >> 24 != 127 && v != u32::MAX;
        if !valid(i) || m == 0 || (!m).wrapping_add(1) & !m != 0 {
            bail!("config.ip_suite: unicast IP and contiguous /1..32 mask required")
        };
        let host = i & !m;
        if host == 0 || host == !m {
            bail!("config.ip_suite: network/broadcast host forbidden")
        };
        if g != 0
            && (!valid(g) || (g & m) != (i & m) || (m != u32::MAX && (g & !m == 0 || g & !m == !m)))
        {
            bail!("config.ip_suite: gateway zero or same-subnet unicast required")
        };
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DcpConfig {
    #[serde(deserialize_with = "deserialize_mac")]
    pub mac: String,
    pub initial_station_name: String,
    pub initial_ip_suite: IpSuite,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Scenario {
    Good {},
    WrongSeq {},
    MissingFollowUp {},
    BadTlv {},
    WrongPort {},
    OldSeqFirst {},
    TruncatedFollowUp {},
    FollowUpReserved {},
    FollowUpPadding {},
    FollowUpDuplicatePort {},
    FollowUpBadEnd {},
}
impl Scenario {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::Good {} => "good",
            Self::WrongSeq {} => "wrong-seq",
            Self::MissingFollowUp {} => "missing-follow-up",
            Self::BadTlv {} => "bad-tlv",
            Self::WrongPort {} => "wrong-port",
            Self::OldSeqFirst {} => "old-seq-first",
            Self::TruncatedFollowUp {} => "truncated-follow-up",
            Self::FollowUpReserved {} => "follow-up-reserved",
            Self::FollowUpPadding {} => "follow-up-padding",
            Self::FollowUpDuplicatePort {} => "follow-up-duplicate-port",
            Self::FollowUpBadEnd {} => "follow-up-bad-end",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PtcpN {
    #[serde(deserialize_with = "deserialize_mac")]
    pub mac: String,
    pub scenario: Scenario,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PtcpF {
    #[serde(deserialize_with = "deserialize_mac")]
    pub mac: String,
    pub scenario: Scenario,
    pub truncated_follow_up_size: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProfinetConfig {
    pub wire_profile: WireProfile,
    pub link: Link,
    #[serde(deserialize_with = "deserialize_mac")]
    pub test_peer_mac: String,
    pub dcp: DcpConfig,
    pub ptcp_n: PtcpN,
    pub ptcp_f: PtcpF,
}
impl Default for ProfinetConfig {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::PnetDcpPtcpLabV1,
            link: Link::OwnedDataL2 {},
            test_peer_mac: "02:00:00:00:86:10".into(),
            dcp: DcpConfig {
                mac: "02:00:00:00:86:20".into(),
                initial_station_name: "protocol-target-lab-profinet".into(),
                initial_ip_suite: IpSuite {
                    ip: "198.18.86.20".into(),
                    netmask: "255.255.255.0".into(),
                    gateway: "0.0.0.0".into(),
                },
            },
            ptcp_n: PtcpN {
                mac: "02:00:00:00:86:21".into(),
                scenario: Scenario::Good {},
            },
            ptcp_f: PtcpF {
                mac: "02:00:00:00:86:22".into(),
                scenario: Scenario::Good {},
                truncated_follow_up_size: 37,
            },
        }
    }
}
pub fn station_name(s: &str) -> Result<()> {
    let labels = s.split('.').collect::<Vec<_>>();
    if s.is_empty()
        || s.len() > 240
        || labels.iter().any(|x| {
            x.is_empty()
                || x.len() > 63
                || x.starts_with('-')
                || x.ends_with('-')
                || !x
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
    {
        bail!(
            "config.dcp.initial_station_name: canonical lowercase DNS labels1..63, total<=240 required"
        )
    };
    if labels.len() == 4 && labels.iter().all(|x| x.bytes().all(|b| b.is_ascii_digit())) {
        bail!("config.dcp.initial_station_name: four numeric labels forbidden")
    };
    for l in labels.into_iter().take(1) {
        let p = l.split('-').collect::<Vec<_>>();
        if p.first() == Some(&"port")
            && ((p.len() == 2 && p[1].len() == 3 && p[1].bytes().all(|b| b.is_ascii_digit()))
                || (p.len() == 3
                    && p[1].len() == 3
                    && p[2].len() == 5
                    && p[1..].iter().all(|x| x.bytes().all(|b| b.is_ascii_digit()))))
        {
            bail!("config.dcp.initial_station_name: reserved port name")
        }
    }
    Ok(())
}
#[derive(Clone, Debug, Serialize)]
pub struct TestBudget {
    pub checks: u64,
    pub actual_requests: u64,
    pub phase_bounds_ms: Vec<u64>,
    pub total_ms: u64,
    pub restore_reserve_ms: u64,
}
impl ProfinetConfig {
    pub fn validate(&self) -> Result<()> {
        let mut seen = std::collections::HashSet::new();
        for s in [
            &self.test_peer_mac,
            &self.dcp.mac,
            &self.ptcp_n.mac,
            &self.ptcp_f.mac,
        ] {
            if *s != mac(s)? || !seen.insert(s) {
                bail!("config.mac: all four roles must be canonical and distinct")
            }
        }
        station_name(&self.dcp.initial_station_name)?;
        self.dcp.initial_ip_suite.validate()?;
        if ![
            "good",
            "wrong-seq",
            "bad-tlv",
            "wrong-port",
            "old-seq-first",
        ]
        .contains(&self.ptcp_n.scenario.mode())
        {
            bail!("config.ptcp_n.scenario: no follow-up faults on N node")
        };
        if !(16..=45).contains(&self.ptcp_f.truncated_follow_up_size) {
            bail!("config.ptcp_f.truncated_follow_up_size: integer16..45 required")
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
            v[k] = x.clone()
        }
        let c: Self =
            serde_json::from_value(v).context("config.patch: invalid PROFINET configuration")?;
        c.validate()?;
        Ok(c)
    }
    pub fn observer_hash(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(self).expect("serializable config"))
                    .expect("serializable config")
            )
        )
    }
    pub fn test_budget(&self, method: &str) -> Result<TestBudget> {
        self.validate()?;
        if !CASES.contains(&method) {
            bail!("config.test: select PROFINET case or ALL")
        };
        let checks = if method == "ALL" {
            24
        } else if method == "DCP_READ" {
            14
        } else if method.starts_with("DCP_WRITE_") {
            1
        } else {
            2
        };
        let requests = if method == "ALL" {
            26
        } else if method == "PTCP_SYNC_FOLLOW_UP" {
            4
        } else {
            checks
        };
        Ok(TestBudget {
            checks,
            actual_requests: requests,
            phase_bounds_ms: vec![
                if method == "DCP_SIGNAL" { 5000 } else { 3000 };
                checks as usize
            ],
            total_ms: 90000,
            restore_reserve_ms: if method.starts_with("DCP_WRITE_") {
                30000
            } else {
                0
            },
        })
    }
}
pub fn config_args(c: &ProfinetConfig) -> Result<Vec<String>> {
    c.validate()?;
    Ok(vec!["--config-json".into(), serde_json::to_string(c)?])
}
pub fn schema() -> Value {
    let scenario = |modes: &[&str]| json!({"oneOf":modes.iter().map(|m|json!({"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":m}}})).collect::<Vec<_>>()});
    let n = [
        "good",
        "wrong-seq",
        "bad-tlv",
        "wrong-port",
        "old-seq-first",
    ];
    let f = [
        "good",
        "wrong-seq",
        "missing-follow-up",
        "bad-tlv",
        "wrong-port",
        "old-seq-first",
        "truncated-follow-up",
        "follow-up-reserved",
        "follow-up-padding",
        "follow-up-duplicate-port",
        "follow-up-bad-end",
    ];
    let node = |extra: bool| {
        let mut v = json!({"type":"object","additionalProperties":false,"required":["mac","scenario"],"properties":{"mac":{"type":"string"},"scenario":scenario(if extra{&f}else{&n})}});
        if extra {
            v["required"]
                .as_array_mut()
                .unwrap()
                .push(json!("truncated_follow_up_size"));
            v["properties"]["truncated_follow_up_size"] =
                json!({"type":"integer","minimum":16,"maximum":45})
        };
        v
    };
    json!({"protocol_id":"profinet","type":"object","additionalProperties":false,"required":["wire_profile","link","test_peer_mac","dcp","ptcp_n","ptcp_f"],"default":ProfinetConfig::default(),"properties":{"wire_profile":{"const":"pnet-dcp-ptcp-lab-v1"},"link":{"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"owned-data-l2"}}},"test_peer_mac":{"type":"string"},"dcp":{"type":"object","additionalProperties":false,"required":["mac","initial_station_name","initial_ip_suite"],"properties":{"mac":{"type":"string"},"initial_station_name":{"type":"string","minLength":1,"maxLength":240},"initial_ip_suite":{"type":"object","additionalProperties":false,"required":["ip","netmask","gateway"],"properties":{"ip":{"type":"string","format":"ipv4"},"netmask":{"type":"string","format":"ipv4"},"gateway":{"type":"string","format":"ipv4"}}}}},"ptcp_n":node(false),"ptcp_f":node(true)},"notes":["Three simultaneous actual data MAC identities; native p-net DCP and autonomous software PTCP N/F","initial_* apply only to a new persistent native store, existing native values take priority","Read-only ALL24 checks/26 transmitted request frames; Sync/Announce have no wire ACK","No cyclic IO, IRT, hardware precision, GPIO or PI certification claim"]})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_strict() {
        let c = ProfinetConfig::default();
        c.validate().unwrap();
        assert_eq!(c.test_budget("ALL").unwrap().checks, 24);
        for p in [
            json!({"dcp":{}}),
            json!({"ptcp_n":{"mac":c.ptcp_n.mac,"scenario":{"mode":"missing-follow-up"}}}),
            json!({"test_peer_mac":c.dcp.mac}),
            json!({"wire_profile":null}),
            json!({"link":{"mode":"host-interface"}}),
        ] {
            assert!(c.patch(p).is_err())
        }
        for n in [
            "",
            "ABC",
            "a..b",
            "-a",
            "a-",
            "1.2.3.4",
            "port-001",
            "port-001-00001",
        ] {
            assert!(station_name(n).is_err(), "{n}")
        }
    }
    #[test]
    fn ip_boundaries() {
        for (i, m, g) in [
            ("0.0.0.0", "0.0.0.0", "0.0.0.0"),
            ("198.18.1.2", "255.255.255.0", "0.0.0.0"),
        ] {
            IpSuite {
                ip: i.into(),
                netmask: m.into(),
                gateway: g.into(),
            }
            .validate()
            .unwrap()
        }
        for (i, m, g) in [
            ("198.18.1.2", "255.255.255.255", "198.18.1.2"),
            ("198.18.1.2", "255.255.255.254", "0.0.0.0"),
            ("198.18.1.0", "255.255.255.0", "0.0.0.0"),
            ("198.18.1.2", "255.0.255.0", "0.0.0.0"),
            ("198.18.1.2", "255.255.255.0", "198.18.2.1"),
        ] {
            assert!(
                IpSuite {
                    ip: i.into(),
                    netmask: m.into(),
                    gateway: g.into()
                }
                .validate()
                .is_err()
            )
        }
    }
}
