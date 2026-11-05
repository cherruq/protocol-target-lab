use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const OBSERVER_PORT: u16 = 18086;
pub const PATH: &str = "peer";
pub const CASES: [&str; 5] = [
    "OBSERVE_REQUEST",
    "MAPPING",
    "REJECT_REPLY",
    "TIMEOUT",
    "ALL",
];
pub const RUNTIME_LABEL: &str = "io.protocol-target-lab.arp-client-runtime-id";
pub const NETWORK_KIND: &str = "arp-client-l2";
pub const FILTER_HASH: &str = "4c5aa70c5e4491d80464cc65f5a5bbc5a041c913542e6e541f54b4c5b08be132";
pub const FILTER: [[u32; 4]; 5] = [
    [40, 0, 0, 12],
    [21, 2, 0, 2054],
    [21, 1, 0, 32821],
    [6, 0, 0, 0],
    [6, 0, 0, 4294967295],
];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "ethernet-ipv4-active-arp")]
    EthernetIpv4,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Link {
    DockerBridge {},
    HostInterface { interface: String },
}
impl Link {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::DockerBridge {} => "docker-bridge",
            Self::HostInterface { .. } => "host-interface",
        }
    }
    pub fn interface(&self) -> &str {
        match self {
            Self::DockerBridge {} => "eth0",
            Self::HostInterface { interface } => interface,
        }
    }
    pub fn is_bridge(&self) -> bool {
        matches!(self, Self::DockerBridge {})
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    Whois,
    ResponseFuzz,
    Rarp,
    Inarp,
}
impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Self::Whois => "whois",
            Self::ResponseFuzz => "response-fuzz",
            Self::Rarp => "rarp",
            Self::Inarp => "inarp",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Scenario {
    Normal {},
    WrongTargetIp {},
    WrongTargetMac {},
    UnknownTha {},
    ShortArp {},
    NonzeroRarpProto {},
    NonzeroWhoisTha {},
}
impl Scenario {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::Normal {} => "normal",
            Self::WrongTargetIp {} => "wrong-target-ip",
            Self::WrongTargetMac {} => "wrong-target-mac",
            Self::UnknownTha {} => "unknown-tha",
            Self::ShortArp {} => "short-arp",
            Self::NonzeroRarpProto {} => "nonzero-rarp-proto",
            Self::NonzeroWhoisTha {} => "nonzero-whois-tha",
        }
    }
    pub fn positive(&self) -> bool {
        matches!(
            self,
            Self::Normal {} | Self::NonzeroRarpProto {} | Self::NonzeroWhoisTha {}
        )
    }
    pub fn valid_for(&self, mode: Mode) -> bool {
        match self {
            Self::Normal {} | Self::ShortArp {} => true,
            Self::WrongTargetIp {} | Self::NonzeroWhoisTha {} => {
                matches!(mode, Mode::Whois | Mode::ResponseFuzz)
            }
            Self::UnknownTha {} | Self::NonzeroRarpProto {} => mode == Mode::Rarp,
            Self::WrongTargetMac {} => mode == Mode::Inarp,
        }
    }
}
fn normalized_mac(value: &str) -> Result<String> {
    let octets = value.split(':').collect::<Vec<_>>();
    if octets.len() != 6
        || octets
            .iter()
            .any(|v| v.len() != 2 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        bail!("config.mac: expected six two-hex colon-separated octets");
    }
    let b = octets
        .iter()
        .map(|v| u8::from_str_radix(v, 16))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if b[0] & 1 != 0 || b.iter().all(|v| *v == 0) {
        bail!("config.mac: nonzero unicast required");
    }
    Ok(value.to_ascii_lowercase())
}
fn deserialize_mac<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<String, D::Error> {
    normalized_mac(&String::deserialize(d)?).map_err(serde::de::Error::custom)
}
fn role_ip(value: &str) -> Result<std::net::Ipv4Addr> {
    let ip: std::net::Ipv4Addr = value.parse().context("config.ipv4: expected dotted IPv4")?;
    if ip.octets()[0] == 0 || ip.is_multicast() || ip.is_broadcast() {
        bail!("config.ipv4: nonzero unicast role required");
    }
    Ok(ip)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ArpClientConfig {
    pub wire_profile: WireProfile,
    pub link: Link,
    #[serde(deserialize_with = "deserialize_mac")]
    pub source_mac: String,
    pub source_ip: String,
    #[serde(deserialize_with = "deserialize_mac")]
    pub server_mac: String,
    pub server_ip: String,
    pub assigned_ip: String,
    pub mode: Mode,
    pub request_scenario: Scenario,
    pub interval_ms: u32,
    pub timeout_ms: u32,
    pub retries: u8,
}
impl Default for ArpClientConfig {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::EthernetIpv4,
            link: Link::DockerBridge {},
            source_mac: "02:00:00:00:01:10".into(),
            source_ip: "198.18.1.10".into(),
            server_mac: "02:00:00:00:01:20".into(),
            server_ip: "198.18.1.20".into(),
            assigned_ip: "198.18.1.10".into(),
            mode: Mode::Whois,
            request_scenario: Scenario::Normal {},
            interval_ms: 500,
            timeout_ms: 1000,
            retries: 0,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct TestBudget {
    pub phase_bounds_ms: Vec<u64>,
    pub total_ms: u64,
    pub positive: bool,
}
impl ArpClientConfig {
    pub fn validate(&self) -> Result<()> {
        let source = role_ip(&self.source_ip)?;
        let server = role_ip(&self.server_ip)?;
        role_ip(&self.assigned_ip)?;
        if source == server {
            bail!("config.roles: source_ip must differ from server_ip");
        }
        if self.source_mac != normalized_mac(&self.source_mac)?
            || self.server_mac != normalized_mac(&self.server_mac)?
            || self.source_mac == self.server_mac
        {
            bail!("config.mac: distinct canonical source and server MAC required");
        }
        let name = self.link.interface().as_bytes();
        if name.is_empty()
            || name.len() > 15
            || !(name[0].is_ascii_alphanumeric() || name[0] == b'_')
            || !name
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || [b'_', b'.', b'-'].contains(b))
        {
            bail!(
                "config.link.interface: expected existing kernel interface name1..15 ASCII bytes"
            );
        }
        if !(10..=60000).contains(&self.interval_ms)
            || !(10..=60000).contains(&self.timeout_ms)
            || self.retries > 10
        {
            bail!("config.timers: interval_ms/timeout_ms10..60000, retries0..10 required");
        }
        if !self.request_scenario.valid_for(self.mode) {
            bail!(
                "config.request_scenario: {} is not supported by {}",
                self.request_scenario.mode(),
                self.mode.name()
            );
        }
        Ok(())
    }
    pub fn patch(&self, patch: Value) -> Result<Self> {
        let p = patch
            .as_object()
            .context("config.patch: expected partial object")?;
        if p.is_empty() {
            bail!("config.patch: empty object");
        }
        let mut v = serde_json::to_value(self)?;
        for (k, value) in p {
            if !v.as_object().unwrap().contains_key(k) || value.is_null() {
                bail!("config.patch: unknown or null field {k}");
            }
            v[k] = value.clone();
        }
        let c: Self =
            serde_json::from_value(v).context("config.patch: invalid ARP-client configuration")?;
        c.validate()?;
        Ok(c)
    }
    pub fn observer_hash(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(self).expect("serializable ARP config"))
                    .expect("serializable ARP config")
            )
        )
    }
    pub fn test_budget(&self, method: &str) -> Result<TestBudget> {
        self.validate()?;
        if !CASES.contains(&method) {
            bail!("config.test: choose ARP-client case or ALL");
        }
        let positive = self.request_scenario.positive();
        let w = u64::from(self.interval_ms) + u64::from(self.timeout_ms);
        let timeout = u64::from(self.timeout_ms);
        let one = |m: &str| match m {
            "OBSERVE_REQUEST" => w + 1000,
            "MAPPING" => w + 1000 + if positive { 0 } else { timeout },
            "REJECT_REPLY" => w + 1000 + if positive { 100 } else { timeout },
            "TIMEOUT" => w + timeout + 1000,
            _ => unreachable!(),
        };
        let phase_bounds_ms = if method == "ALL" {
            CASES[..4].iter().map(|m| one(m)).collect::<Vec<_>>()
        } else {
            vec![one(method)]
        };
        let total_ms = 4000 + 2 * phase_bounds_ms.iter().sum::<u64>();
        if self.timeout_ms < 250 || phase_bounds_ms.iter().any(|n| *n > 4000) || total_ms > 30000 {
            bail!(
                "config.test: legal runtime timers cannot fit selected bounded test (timeout>=250ms, phase<=4000ms, total<=30000ms required); source remains unchanged"
            );
        }
        Ok(TestBudget {
            phase_bounds_ms,
            total_ms,
            positive,
        })
    }
    pub fn role_addresses(&self) -> Result<Vec<std::net::Ipv4Addr>> {
        let mut ips = vec![
            role_ip(&self.source_ip)?,
            role_ip(&self.server_ip)?,
            role_ip(&self.assigned_ip)?,
        ];
        if matches!(self.request_scenario, Scenario::WrongTargetIp {}) {
            let mut octets = role_ip(&self.server_ip)?.octets();
            octets[3] ^= 1;
            ips.push(octets.into());
        }
        if matches!(self.request_scenario, Scenario::NonzeroRarpProto {}) {
            ips.push(std::net::Ipv4Addr::new(5, 6, 7, 8));
        }
        Ok(ips)
    }
}
pub fn schema() -> Value {
    let scenarios=["normal","wrong-target-ip","wrong-target-mac","unknown-tha","short-arp","nonzero-rarp-proto","nonzero-whois-tha"].iter().map(|m|json!({"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":m}}})).collect::<Vec<_>>();
    json!({"protocol_id":"arp-client","type":"object","additionalProperties":false,"default":ArpClientConfig::default(),"required":["wire_profile","link","source_mac","source_ip","server_mac","server_ip","assigned_ip","mode","request_scenario","interval_ms","timeout_ms","retries"],"properties":{"wire_profile":{"const":"ethernet-ipv4-active-arp"},"link":{"oneOf":[{"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"docker-bridge"}}},{"type":"object","additionalProperties":false,"required":["mode","interface"],"properties":{"mode":{"const":"host-interface"},"interface":{"type":"string","pattern":"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$"}}}]},"source_mac":{"type":"string"},"source_ip":{"type":"string","format":"ipv4"},"server_mac":{"type":"string"},"server_ip":{"type":"string","format":"ipv4"},"assigned_ip":{"type":"string","format":"ipv4"},"mode":{"type":"string","enum":["whois","response-fuzz","rarp","inarp"]},"request_scenario":{"oneOf":scenarios},"interval_ms":{"type":"integer","minimum":10,"maximum":60000},"timeout_ms":{"type":"integer","minimum":10,"maximum":60000},"retries":{"type":"integer","minimum":0,"maximum":10}},"notes":["Persistent active requester; disposable client is inverse responder","Role IPs do not assign OS addresses; no application UDP/TCP bind port","Fifteen valid mode/scenario pairs; wrong combinations rejected atomically","ALL verifies current applied pair with8checks; legal runtime timers may be unavailable for bounded tests","No wire transaction ID or ACK; late identical replies are ambiguous","Default owned internal Docker bridge provides software L2; host-interface uses actual existing Ethernet NIC/MAC"]})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn valid_combinations_and_bounds_are_atomic() {
        let c = ArpClientConfig::default();
        c.validate().unwrap();
        let modes = ["whois", "response-fuzz", "rarp", "inarp"];
        let scenarios = [
            "normal",
            "wrong-target-ip",
            "wrong-target-mac",
            "unknown-tha",
            "short-arp",
            "nonzero-rarp-proto",
            "nonzero-whois-tha",
        ];
        let mut valid = 0;
        for mode in modes {
            for scenario in scenarios {
                if let Ok(n) = c.patch(json!({"mode":mode,"request_scenario":{"mode":scenario}})) {
                    valid += 1;
                    n.validate().unwrap();
                }
            }
        }
        assert_eq!(valid, 15);
        let n=c.patch(json!({"source_mac":"02:AA:BB:CC:DD:10","link":{"mode":"host-interface","interface":"eth0"}})).unwrap();
        assert_eq!(n.source_mac, "02:aa:bb:cc:dd:10");
        assert_eq!(
            n.patch(json!({"link":{"mode":"docker-bridge"}}))
                .unwrap()
                .link,
            Link::DockerBridge {}
        );
        for p in [
            json!({"mode":"inarp","request_scenario":{"mode":"nonzero-whois-tha"}}),
            json!({"link":{"mode":"docker-bridge","interface":"eth0"}}),
            json!({"link":{"mode":"host-interface","interface":"../../x"}}),
            json!({"source_ip":"0.0.0.0"}),
            json!({"assigned_ip":"0.1.2.3"}),
            json!({"source_mac":"01:00:00:00:01:10"}),
            json!({"source_mac":"02:00:00:00:01:20"}),
            json!({"timeout_ms":true}),
            json!({"request_scenario":{"mode":"normal","duration":1}}),
            json!({"retries":11}),
            json!({"interval_ms":9}),
        ] {
            assert!(c.patch(p.clone()).is_err(), "{p}");
        }
    }
    #[test]
    fn experiment_role_collision_set_includes_actual_mutated_wire_targets() {
        let c = ArpClientConfig::default();
        let wrong = c
            .patch(json!({"request_scenario":{"mode":"wrong-target-ip"}}))
            .unwrap();
        assert!(
            wrong
                .role_addresses()
                .unwrap()
                .contains(&std::net::Ipv4Addr::new(198, 18, 1, 21))
        );
        let r = c
            .patch(json!({"mode":"rarp","request_scenario":{"mode":"nonzero-rarp-proto"}}))
            .unwrap();
        assert!(
            r.role_addresses()
                .unwrap()
                .contains(&std::net::Ipv4Addr::new(5, 6, 7, 8))
        );
    }
    #[test]
    fn legal_runtime_and_selected_testability_are_distinct() {
        let c = ArpClientConfig::default();
        assert_eq!(c.test_budget("ALL").unwrap().total_ms, 26200);
        let n = c
            .patch(json!({"request_scenario":{"mode":"short-arp"}}))
            .unwrap();
        assert_eq!(n.test_budget("ALL").unwrap().total_ms, 30000);
        assert_eq!(n.test_budget("TIMEOUT").unwrap().total_ms, 11000);
        assert_eq!(
            n.patch(json!({"retries":10}))
                .unwrap()
                .test_budget("ALL")
                .unwrap()
                .total_ms,
            30000
        );
        let large = n.patch(json!({"timeout_ms":1100})).unwrap();
        assert!(large.test_budget("ALL").is_err());
        assert!(large.test_budget("TIMEOUT").is_ok());
        assert!(
            c.patch(json!({"timeout_ms":10}))
                .unwrap()
                .test_budget("ALL")
                .is_err()
        );
        let r = c
            .patch(json!({"mode":"rarp","assigned_ip":"198.18.1.99"}))
            .unwrap();
        assert_ne!(r.source_ip, r.assigned_ip);
        assert!(r.request_scenario.positive());
    }
}
