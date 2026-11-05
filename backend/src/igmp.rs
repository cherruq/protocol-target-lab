//! Configuration for a persistent native Linux multicast member, not a synthetic responder.
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::net::Ipv4Addr;

pub const OBSERVER_PORT: u16 = 18088;
pub const PATH: &str = "membership";
pub const CASES: [&str; 3] = ["GENERAL_QUERY", "GROUP_QUERY", "ALL"];
pub const RUNTIME_LABEL: &str = "io.protocol-target-lab.igmp-runtime-id";
pub const NETWORK_KIND: &str = "igmp-member-l2";
pub const CLIENT_BUDGET_MS: u64 = 90000;
pub const MANAGER_BUDGET_MS: u64 = 105000;
pub const CLEANUP_BUDGET_MS: u64 = 5000;
pub const EXECUTION_BUDGET_MS: u64 = MANAGER_BUDGET_MS - CLEANUP_BUDGET_MS;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "linux-kernel-igmp-v2")]
    LinuxKernelV2,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Link {
    DockerBridge {},
    HostInterface {
        interface: String,
        interface_ip: String,
        #[serde(deserialize_with = "required_nullable")]
        peer_interface: Option<String>,
    },
    OwnedVxlan {
        outer_interface: String,
        local_outer_ip: String,
        peer_outer_ip: String,
        vni: u32,
        udp_port: u16,
        mtu: u32,
        local_inner_cidr: String,
        #[serde(deserialize_with = "deserialize_mac")]
        local_inner_mac: String,
        peer_inner_ip: String,
        #[serde(deserialize_with = "deserialize_mac")]
        peer_inner_mac: String,
    },
}
fn required_nullable<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
impl Link {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::DockerBridge {} => "docker-bridge",
            Self::HostInterface { .. } => "host-interface",
            Self::OwnedVxlan { .. } => "owned-vxlan",
        }
    }
    pub fn is_bridge(&self) -> bool {
        matches!(self, Self::DockerBridge {})
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct QueryProfile {
    pub version: u8,
    pub max_response_code: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct IgmpConfig {
    pub wire_profile: WireProfile,
    pub link: Link,
    pub groups: Vec<String>,
    pub query_profile: QueryProfile,
}
impl Default for IgmpConfig {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::LinuxKernelV2,
            link: Link::DockerBridge {},
            groups: vec!["239.192.19.1".into()],
            query_profile: QueryProfile {
                version: 2,
                max_response_code: 100,
            },
        }
    }
}
pub fn interface_name(s: &str) -> Result<()> {
    if s.is_empty()
        || s.len() > 15
        || !s.bytes().enumerate().all(|(i, b)| {
            b.is_ascii_alphanumeric() || b == b'_' || (i > 0 && [b'.', b'-'].contains(&b))
        })
    {
        bail!("config.link.interface: expected kernel interface name1..15 ASCII bytes");
    }
    Ok(())
}
fn unicast(s: &str) -> Result<Ipv4Addr> {
    let ip: Ipv4Addr = s
        .parse()
        .context("config.link.ipv4: expected literal IPv4")?;
    if ip.to_string() != s || ip.octets()[0] == 0 || ip.octets()[0] >= 224 || ip.is_broadcast() {
        bail!("config.link.ipv4: canonical nonzero unicast IPv4 required");
    }
    Ok(ip)
}
fn normalized_mac(s: &str) -> Result<String> {
    let parts = s.split(':').collect::<Vec<_>>();
    if parts.len() != 6
        || parts
            .iter()
            .any(|p| p.len() != 2 || !p.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        bail!("config.link.mac: six two-hex colon-separated octets required");
    }
    let bytes = parts
        .iter()
        .map(|p| u8::from_str_radix(p, 16))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if bytes[0] & 1 != 0 || bytes.iter().all(|b| *b == 0) {
        bail!("config.link.mac: nonzero unicast required");
    }
    Ok(s.to_ascii_lowercase())
}
fn deserialize_mac<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<String, D::Error> {
    normalized_mac(&String::deserialize(d)?).map_err(serde::de::Error::custom)
}
impl IgmpConfig {
    pub fn validate(&self) -> Result<()> {
        if self.groups.is_empty() || self.groups.len() > 16 {
            bail!("config.groups: expected1..16 groups");
        }
        let mut seen = std::collections::HashSet::new();
        for g in &self.groups {
            let ip: Ipv4Addr = g.parse().context("config.groups: literal IPv4 required")?;
            if ip.octets()[0] != 239 || ip.to_string() != *g || !seen.insert(ip) {
                bail!("config.groups: unique canonical239/8 groups required");
            }
        }
        if self.query_profile.version != 2 || self.query_profile.max_response_code != 100 {
            bail!("config.query_profile: version2 and max_response_code100 required");
        }
        match &self.link {
            Link::DockerBridge {} => {}
            Link::HostInterface {
                interface,
                interface_ip,
                peer_interface,
            } => {
                interface_name(interface)?;
                unicast(interface_ip)?;
                if let Some(peer) = peer_interface {
                    interface_name(peer)?;
                    if peer == interface {
                        bail!(
                            "config.link.peer_interface: distinct actual peer interface required"
                        );
                    }
                }
            }
            Link::OwnedVxlan {
                outer_interface,
                local_outer_ip,
                peer_outer_ip,
                vni,
                udp_port,
                mtu,
                local_inner_cidr,
                local_inner_mac,
                peer_inner_ip,
                peer_inner_mac,
            } => {
                interface_name(outer_interface)?;
                let outer = unicast(local_outer_ip)?;
                let peer_outer = unicast(peer_outer_ip)?;
                if outer == peer_outer
                    || !(1..=16777215).contains(vni)
                    || *udp_port < 1024
                    || !(576..=9000).contains(mtu)
                {
                    bail!(
                        "config.link: distinct outer addresses, VNI1..16777215, carrierUDP1024..65535 and MTU576..9000 required"
                    );
                }
                let (addr, prefix) = local_inner_cidr
                    .split_once('/')
                    .context("config.link.local_inner_cidr: IPv4/prefix required")?;
                let local = unicast(addr)?;
                let prefix: u8 = prefix
                    .parse()
                    .context("config.link.local_inner_cidr: prefix required")?;
                if !(16..=30).contains(&prefix) || format!("{local}/{prefix}") != *local_inner_cidr
                {
                    bail!("config.link.local_inner_cidr: canonical prefix16..30 required");
                }
                let peer = unicast(peer_inner_ip)?;
                let mask = u32::MAX << (32 - prefix);
                let network = u32::from(local) & mask;
                let broadcast = network | !mask;
                if local == peer
                    || [outer, peer_outer].contains(&local)
                    || [outer, peer_outer].contains(&peer)
                    || u32::from(peer) & mask != network
                    || [network, broadcast].contains(&u32::from(local))
                    || [network, broadcast].contains(&u32::from(peer))
                {
                    bail!(
                        "config.link.inner: distinct usable addresses in same prefix, separate from outer roles required"
                    );
                }
                if *local_inner_mac != normalized_mac(local_inner_mac)?
                    || *peer_inner_mac != normalized_mac(peer_inner_mac)?
                    || local_inner_mac == peer_inner_mac
                {
                    bail!("config.link.mac: distinct canonical unicast MACs required");
                }
            }
        }
        Ok(())
    }
    pub fn patch(&self, patch: Value) -> Result<Self> {
        let p = patch
            .as_object()
            .context("config.patch: partial object required")?;
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
            serde_json::from_value(v).context("config.patch: invalid IGMP configuration")?;
        c.validate()?;
        Ok(c)
    }
    pub fn observer_hash(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(self).expect("serializable IGMP config"))
                    .expect("serializable IGMP config")
            )
        )
    }
    pub fn rounds(&self, method: &str) -> Result<u64> {
        self.validate()?;
        if !CASES.contains(&method) {
            bail!("config.test: choose GENERAL_QUERY, GROUP_QUERY or ALL");
        }
        Ok(if method == "ALL" { 4 } else { 2 })
    }
    pub fn helper_spec(
        &self,
        deployment: &str,
        instance: &str,
        peer_outer_interface: Option<&str>,
    ) -> Result<Value> {
        self.validate()?;
        uuid::Uuid::parse_str(deployment)?;
        if !crate::model::valid_id(instance) {
            bail!("invalid IGMP instance ID");
        }
        let Link::OwnedVxlan {
            outer_interface,
            local_outer_ip,
            peer_outer_ip,
            vni,
            udp_port,
            mtu,
            local_inner_cidr,
            local_inner_mac,
            peer_inner_ip,
            peer_inner_mac,
        } = &self.link
        else {
            bail!("IGMP owned-vxlan link required");
        };
        let peer = peer_outer_interface.is_some();
        if let Some(name) = peer_outer_interface {
            interface_name(name)?;
        }
        let prefix = local_inner_cidr.split_once('/').unwrap().1;
        Ok(
            json!({"schema_version":1,"deployment_id":deployment,"instance_id":instance,"role":if peer {"peer"}else{"target"},"link":{"outer_interface":peer_outer_interface.unwrap_or(outer_interface),"local_outer_ip":if peer {peer_outer_ip}else{local_outer_ip},"peer_outer_ip":if peer {local_outer_ip}else{peer_outer_ip},"vni":vni,"udp_port":udp_port,"mtu":mtu,"inner_cidr":if peer {format!("{peer_inner_ip}/{prefix}")}else{local_inner_cidr.clone()},"inner_mac":if peer {peer_inner_mac}else{local_inner_mac}}}),
        )
    }
}
pub fn config_args(c: &IgmpConfig) -> Result<Vec<String>> {
    Ok(vec!["--config-json".into(), serde_json::to_string(c)?])
}
pub fn schema() -> Value {
    let name = json!({"type":"string","pattern":"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$"});
    let ip = json!({"type":"string","format":"ipv4"});
    let mac = json!({"type":"string","pattern":"^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$"});
    json!({"protocol_id":"igmp","type":"object","additionalProperties":false,"required":["wire_profile","link","groups","query_profile"],"default":IgmpConfig::default(),"properties":{"wire_profile":{"const":"linux-kernel-igmp-v2"},"link":{"oneOf":[{"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"docker-bridge"}}},{"type":"object","additionalProperties":false,"required":["mode","interface","interface_ip","peer_interface"],"properties":{"mode":{"const":"host-interface"},"interface":name,"interface_ip":ip,"peer_interface":{"anyOf":[name,{"type":"null"}]}}},{"type":"object","additionalProperties":false,"required":["mode","outer_interface","local_outer_ip","peer_outer_ip","vni","udp_port","mtu","local_inner_cidr","local_inner_mac","peer_inner_ip","peer_inner_mac"],"properties":{"mode":{"const":"owned-vxlan"},"outer_interface":name,"local_outer_ip":ip,"peer_outer_ip":ip,"vni":{"type":"integer","minimum":1,"maximum":16777215},"udp_port":{"type":"integer","minimum":1024,"maximum":65535},"mtu":{"type":"integer","minimum":576,"maximum":9000},"local_inner_cidr":{"type":"string"},"local_inner_mac":mac,"peer_inner_ip":ip,"peer_inner_mac":mac}}]},"groups":{"type":"array","minItems":1,"maxItems":16,"uniqueItems":true,"items":{"type":"string","pattern":"^239\\."}},"query_profile":{"type":"object","additionalProperties":false,"required":["version","max_response_code"],"properties":{"version":{"const":2},"max_response_code":{"const":100}}}},"notes":["Real persistent Linux kernel membership; no synthetic Report or ACK","IGMP is IPv4 protocol2, not an application UDP service","General Query tests all groups; Group Query tests first configured group; two rounds per method","Native kernel version compatibility, warmup upper bound and other membership references may make causal testing unavailable","Owned VXLAN uses a typed root helper only for new project-owned devices; external peer requires explicit setup"]})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn required_fields_strict_types_and_atomic_link_patch() {
        let c = IgmpConfig::default();
        c.validate().unwrap();
        for key in ["wire_profile", "link", "groups", "query_profile"] {
            let mut v = serde_json::to_value(&c).unwrap();
            v.as_object_mut().unwrap().remove(key);
            assert!(serde_json::from_value::<IgmpConfig>(v).is_err());
        }
        for p in [
            json!({"groups":[]}),
            json!({"groups":["239.1.2.3","239.1.2.3"]}),
            json!({"groups":["224.0.0.1"]}),
            json!({"query_profile":{"version":true,"max_response_code":100}}),
            json!({"link":{"mode":"host-interface","interface":"eth0","interface_ip":"192.0.2.20"}}),
            json!({"link":{"mode":"docker-bridge","interface":"eth0"}}),
            json!({"link":null}),
        ] {
            assert!(c.patch(p.clone()).is_err(), "{p}");
        }
        let h = c.patch(json!({"link":{"mode":"host-interface","interface":"eth0","interface_ip":"192.0.2.20","peer_interface":null},"groups":["239.2.2.2","239.1.1.1"]})).unwrap();
        assert_eq!(h.groups[0], "239.2.2.2");
        assert!(
            h.patch(json!({"link":{"mode":"docker-bridge"}}))
                .unwrap()
                .link
                .is_bridge()
        );
        assert_eq!(h.rounds("ALL").unwrap(), 4);
    }
    #[test]
    fn vxlan_role_bounds_and_explicit_peer_spec() {
        let c = IgmpConfig::default().patch(json!({"link":{"mode":"owned-vxlan","outer_interface":"eth0","local_outer_ip":"192.0.2.20","peer_outer_ip":"192.0.2.10","vni":1919,"udp_port":47895,"mtu":1400,"local_inner_cidr":"198.18.19.20/24","local_inner_mac":"02:00:00:00:19:20","peer_inner_ip":"198.18.19.10","peer_inner_mac":"02:00:00:00:19:10"}})).unwrap();
        let p = c
            .helper_spec(
                "00000000-0000-4000-8000-000000000001",
                "igmp-demo",
                Some("peer0"),
            )
            .unwrap();
        assert_eq!(p["link"]["inner_cidr"], "198.18.19.10/24");
        assert_eq!(p["link"]["outer_interface"], "peer0");
        for (key, value) in [
            ("vni", json!(0)),
            ("udp_port", json!(1023)),
            ("local_inner_cidr", json!("198.18.19.0/24")),
            ("peer_inner_ip", json!("198.18.20.10")),
            ("local_inner_mac", json!("01:00:00:00:19:20")),
        ] {
            let mut v = serde_json::to_value(&c).unwrap();
            v["link"][key] = value;
            assert!(
                serde_json::from_value::<IgmpConfig>(v)
                    .map(|c| c.validate().is_err())
                    .unwrap_or(true),
                "{key}"
            );
        }
    }
}
