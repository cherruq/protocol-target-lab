//! Finite fixed-response Ethernet configuration. Runtime link addresses are not OS IP settings.
pub use crate::arp_client::Link;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
pub const OBSERVER_PORT: u16 = 18087;
pub const PATH: &str = "frame";
pub const CASES: [&str; 3] = ["ROUNDTRIP", "REPEAT", "ALL"];
pub const NETWORK_KIND: &str = "custom-ethernet-l2";
pub const RUNTIME_LABEL: &str = "io.protocol-target-lab.custom-ethernet-runtime-id";
pub const FILTER_LABEL: &str = "io.protocol-target-lab.custom-ethernet-filter-sha256";
pub const LIBRARY_LABEL: &str = "io.protocol-target-lab.custom-ethernet-library-sha256";
pub const SNAPLEN: u32 = 262144;
pub const MAX_FRAME: usize = 65535;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "ethernet-fixed-response")]
    FixedResponse,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ResponseMode {
    Payload,
    Frame,
}
impl ResponseMode {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Payload => "payload",
            Self::Frame => "frame",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceMode {
    Interface,
    Override,
}
fn mac_octets(s: &str) -> Result<Vec<u8>> {
    let v = s.split(':').collect::<Vec<_>>();
    if v.len() != 6
        || v.iter()
            .any(|v| v.len() != 2 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        bail!("config.mac: six colon-separated octets required")
    }
    Ok(v.iter()
        .map(|x| u8::from_str_radix(x, 16))
        .collect::<std::result::Result<_, _>>()?)
}
fn mac<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<String, D::Error> {
    let s = String::deserialize(d)?;
    mac_octets(&s).map_err(serde::de::Error::custom)?;
    Ok(s.to_ascii_lowercase())
}
fn unicast(s: &str) -> Result<()> {
    let b = mac_octets(s)?;
    if b[0] & 1 != 0 || b.iter().all(|b| *b == 0) {
        bail!("config.mac: nonzero unicast required")
    }
    Ok(())
}
pub fn hex_bytes(s: &str) -> Result<Vec<u8>> {
    if !s.len().is_multiple_of(2) || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("config.hex: plain even-length hexadecimal without separators required")
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(Into::into))
        .collect()
}
fn hex<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<String, D::Error> {
    let s = String::deserialize(d)?;
    hex_bytes(&s).map_err(serde::de::Error::custom)?;
    Ok(s.to_ascii_lowercase())
}
fn multicast<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Vec<String>, D::Error> {
    Vec::<String>::deserialize(d)?
        .into_iter()
        .map(|s| {
            mac_octets(&s).map_err(serde::de::Error::custom)?;
            Ok(s.to_ascii_lowercase())
        })
        .collect()
}
fn marker<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Option<String>, D::Error> {
    let v = Option::<String>::deserialize(d)?;
    v.map(|s| {
        hex_bytes(&s).map_err(serde::de::Error::custom)?;
        Ok(s.to_ascii_lowercase())
    })
    .transpose()
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SourceMac {
    pub mode: SourceMode,
    #[serde(deserialize_with = "mac")]
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Vlan {
    pub enabled: bool,
    pub vid: u16,
    pub pcp: u8,
    pub dei: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Payload {
    #[serde(deserialize_with = "mac")]
    pub destination_mac: String,
    pub source_mac: SourceMac,
    pub ether_type: u16,
    #[serde(deserialize_with = "hex")]
    pub payload_hex: String,
    pub vlan: Vlan,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub mode: ResponseMode,
    pub payload: Payload,
    #[serde(deserialize_with = "hex")]
    pub frame_hex: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TestFixture {
    #[serde(deserialize_with = "hex")]
    pub frame_hex: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CustomEthernetConfig {
    pub wire_profile: WireProfile,
    pub link: Link,
    #[serde(deserialize_with = "mac")]
    pub local_mac: String,
    #[serde(deserialize_with = "mac")]
    pub peer_mac: String,
    pub packet_filter: String,
    #[serde(deserialize_with = "marker")]
    pub request_marker_hex: Option<String>,
    pub response: Response,
    pub promiscuous: bool,
    #[serde(deserialize_with = "multicast")]
    pub multicast_macs: Vec<String>,
    pub test_request: TestFixture,
}
fn hex_string(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}
impl Payload {
    pub fn frame(&self, local: &str) -> Result<Vec<u8>> {
        let mut b = mac_octets(&self.destination_mac)?;
        b.extend(mac_octets(
            if self.source_mac.mode == SourceMode::Interface {
                local
            } else {
                &self.source_mac.value
            },
        )?);
        if self.vlan.enabled {
            b.extend(0x8100u16.to_be_bytes());
            let tci =
                (u16::from(self.vlan.pcp) << 13) | (u16::from(self.vlan.dei) << 12) | self.vlan.vid;
            b.extend(tci.to_be_bytes());
        }
        b.extend(self.ether_type.to_be_bytes());
        b.extend(hex_bytes(&self.payload_hex)?);
        Ok(b)
    }
}
impl Default for CustomEthernetConfig {
    fn default() -> Self {
        let local = "02:00:00:00:02:20";
        let peer = "02:00:00:00:02:10";
        let mut data = b"PLAB-RESPONSE".to_vec();
        data.resize(64, 0);
        let payload = Payload {
            destination_mac: peer.into(),
            source_mac: SourceMac {
                mode: SourceMode::Interface,
                value: local.into(),
            },
            ether_type: 0x88b5,
            payload_hex: hex_string(&data),
            vlan: Vlan {
                enabled: false,
                vid: 7,
                pcp: 0,
                dei: false,
            },
        };
        let raw = hex_string(&payload.frame(local).expect("default frame"));
        let mut req = mac_octets(local).unwrap();
        req.extend(mac_octets(peer).unwrap());
        req.extend(0x88b5u16.to_be_bytes());
        req.extend(b"PLAB-REQUEST");
        req.resize(78, 0);
        Self {
            wire_profile: WireProfile::FixedResponse,
            link: Link::DockerBridge {},
            local_mac: local.into(),
            peer_mac: peer.into(),
            packet_filter: format!("ether proto 0x88b5 and ether src {peer}"),
            request_marker_hex: Some(hex_string(b"PLAB-REQUEST")),
            response: Response {
                mode: ResponseMode::Payload,
                payload,
                frame_hex: raw,
            },
            promiscuous: false,
            multicast_macs: vec![],
            test_request: TestFixture {
                frame_hex: hex_string(&req),
            },
        }
    }
}
impl CustomEthernetConfig {
    pub fn validate(&self) -> Result<()> {
        unicast(&self.local_mac)?;
        unicast(&self.peer_mac)?;
        if self.local_mac == self.peer_mac {
            bail!("config.mac: local_mac and peer_mac must differ")
        }
        let name = self.link.interface().as_bytes();
        if name.is_empty()
            || name.len() > 15
            || !(name[0].is_ascii_alphanumeric() || name[0] == b'_')
            || !name
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || [b'_', b'.', b'-'].contains(b))
        {
            bail!("config.link.interface: existing ASCII interface name1..15 required")
        }
        if self.packet_filter.trim().is_empty()
            || self.packet_filter.len() > 2048
            || self.packet_filter.contains('\0')
        {
            bail!("config.packet_filter: nonempty NUL-free expression<=2048 UTF8 bytes required")
        }
        if let Some(m) = &self.request_marker_hex {
            let n = hex_bytes(m)?.len();
            if !(1..=64).contains(&n) {
                bail!("config.request_marker_hex: null or1..64 bytes required")
            }
        }
        let p = &self.response.payload;
        let dst = mac_octets(&p.destination_mac)?;
        if dst.iter().all(|b| *b == 0) {
            bail!("config.response.payload.destination_mac: nonzero MAC required")
        };
        unicast(&p.source_mac.value)?;
        if p.ether_type < 1536 || [0x8100, 0x88a8, 0x9100].contains(&p.ether_type) {
            bail!(
                "config.response.payload.ether_type: EthernetII1536..65535 excluding tag TPIDs; use VLAN selector or raw frame"
            )
        }
        if p.vlan.vid > 4094 || p.vlan.pcp > 7 {
            bail!("config.response.payload.vlan: VID0..4094/PCP0..7 required")
        }
        if hex_bytes(&p.payload_hex)?.len() > 65521 || p.frame(&self.local_mac)?.len() > MAX_FRAME {
            bail!(
                "config.response.payload: constructed complete frame must be<=65535 bytes including tag"
            )
        }
        for (name, s) in [
            ("response.frame_hex", &self.response.frame_hex),
            ("test_request.frame_hex", &self.test_request.frame_hex),
        ] {
            let n = hex_bytes(s)?.len();
            if !(14..=MAX_FRAME).contains(&n) {
                bail!("config.{name}: complete raw frame14..65535 bytes required")
            }
        }
        if self.multicast_macs.len() > 16 {
            bail!("config.multicast_macs: at most16 memberships")
        }
        let mut seen = std::collections::HashSet::new();
        for m in &self.multicast_macs {
            let b = mac_octets(m)?;
            if b[0] & 1 == 0
                || b.iter().all(|b| *b == 255)
                || m != &m.to_ascii_lowercase()
                || !seen.insert(m)
            {
                bail!(
                    "config.multicast_macs: unique canonical multicast MACs excluding broadcast required"
                )
            }
        }
        Ok(())
    }
    pub fn frame(&self) -> Result<Vec<u8>> {
        match self.response.mode {
            ResponseMode::Payload => self.response.payload.frame(&self.local_mac),
            ResponseMode::Frame => hex_bytes(&self.response.frame_hex),
        }
    }
    pub fn observer_hash(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(self).expect("config")).expect("config")
            )
        )
    }
    pub fn patch(&self, patch: Value) -> Result<Self> {
        let o = patch
            .as_object()
            .context("config.patch: expected partial object")?;
        if o.is_empty() {
            bail!("config.patch: empty object")
        }
        let mut value = serde_json::to_value(self)?;
        fn merge(dst: &mut Value, src: &Value, path: &str) -> Result<()> {
            let d = dst
                .as_object_mut()
                .context("config.patch: expected object")?;
            let s = src.as_object().context("config.patch: expected object")?;
            if s.is_empty() {
                bail!("config.patch: empty nested object {path}")
            }
            for (k, v) in s {
                let out = d
                    .get_mut(k)
                    .with_context(|| format!("config.patch: unknown field {path}{k}"))?;
                if path.is_empty() && k == "link" {
                    *out = v.clone();
                } else if out.is_object() && v.is_object() {
                    merge(out, v, &format!("{path}{k}."))?;
                } else {
                    *out = v.clone();
                }
            }
            Ok(())
        }
        merge(&mut value, &patch, "")?;
        let c: Self = serde_json::from_value(value)
            .context("config.patch: invalid custom-Ethernet configuration")?;
        c.validate()?;
        Ok(c)
    }
    pub fn test_budget(&self, method: &str) -> Result<Value> {
        self.validate()?;
        if !CASES.contains(&method) {
            bail!("config.test: choose ROUNDTRIP/REPEAT/ALL")
        };
        Ok(
            json!({"per_check_ms":4000,"global_ms":30000,"manager_ms":45000,"check_groups":if method=="ALL"{4}else{2},"wire_exchanges":match method{"ALL"=>8,"REPEAT"=>6,_=>2}}),
        )
    }
    pub fn validate_mtu(&self, mtu: u64) -> Result<()> {
        let f = self.frame()?;
        validate_frame_mtu(&f, mtu, "response")
    }
}
pub fn validate_frame_mtu(frame: &[u8], mtu: u64, name: &str) -> Result<()> {
    if frame.len() < 14 || frame.len() > MAX_FRAME {
        bail!("config.{name}: complete frame14..65535 required")
    };
    let et = u16::from_be_bytes([frame[12], frame[13]]);
    let header = if [0x8100, 0x88a8].contains(&et) {
        18
    } else {
        14
    };
    if frame.len() as u64 > mtu + header {
        bail!(
            "config.{name}: frame length{} exceeds actual MTU{mtu}+header{header}",
            frame.len()
        )
    }
    Ok(())
}

/// Keep each exec argument below Linux MAX_ARG_STRLEN, without changing the JSON value.
pub fn config_args(c: &CustomEthernetConfig) -> Result<Vec<String>> {
    let text = serde_json::to_string(c)?;
    if text.len() <= 60000 {
        return Ok(vec!["--config-json".into(), text]);
    }
    let mut out = Vec::new();
    let mut left = text.as_str();
    while !left.is_empty() {
        let mut n = left.len().min(60000);
        while !left.is_char_boundary(n) {
            n -= 1
        }
        out.push("--config-json-part".into());
        out.push(left[..n].into());
        left = &left[n..];
    }
    Ok(out)
}

pub fn schema() -> Value {
    let object = |properties: Value, required: Vec<&str>| json!({"type":"object","additionalProperties":false,"required":required,"properties":properties});
    let mac = json!({"type":"string","pattern":"^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$"});
    let raw =
        json!({"type":"string","pattern":"^([0-9a-fA-F]{2})*$","minLength":28,"maxLength":131070});
    let source = object(
        json!({"mode":{"enum":["interface","override"]},"value":mac}),
        vec!["mode", "value"],
    );
    let vlan = object(
        json!({"enabled":{"type":"boolean"},"vid":{"type":"integer","minimum":0,"maximum":4094},"pcp":{"type":"integer","minimum":0,"maximum":7},"dei":{"type":"boolean"}}),
        vec!["enabled", "vid", "pcp", "dei"],
    );
    let payload = object(
        json!({"destination_mac":mac,"source_mac":source,"ether_type":{"type":"integer","minimum":1536,"maximum":65535,"not":{"enum":[33024,34984,37120]}},"payload_hex":{"type":"string","pattern":"^([0-9a-fA-F]{2})*$","maxLength":131042},"vlan":vlan}),
        vec![
            "destination_mac",
            "source_mac",
            "ether_type",
            "payload_hex",
            "vlan",
        ],
    );
    let response = object(
        json!({"mode":{"enum":["payload","frame"]},"payload":payload,"frame_hex":raw}),
        vec!["mode", "payload", "frame_hex"],
    );
    let link = json!({"oneOf":[object(json!({"mode":{"const":"docker-bridge"}}),vec!["mode"]),object(json!({"mode":{"const":"host-interface"},"interface":{"type":"string","pattern":"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$"}}),vec!["mode","interface"])]});
    let mut value = object(
        json!({"wire_profile":{"const":"ethernet-fixed-response"},"link":link,"local_mac":mac,"peer_mac":mac,"packet_filter":{"type":"string","minLength":1,"maxLength":2048},"request_marker_hex":{"anyOf":[{"type":"null"},{"type":"string","pattern":"^([0-9a-fA-F]{2})+$","minLength":2,"maxLength":128}]},"response":response,"promiscuous":{"type":"boolean"},"multicast_macs":{"type":"array","maxItems":16,"uniqueItems":true,"items":mac},"test_request":object(json!({"frame_hex":raw}),vec!["frame_hex"])}),
        vec![
            "wire_profile",
            "link",
            "local_mac",
            "peer_mac",
            "packet_filter",
            "request_marker_hex",
            "response",
            "promiscuous",
            "multicast_macs",
            "test_request",
        ],
    );
    value["capture_limits"] = json!({"filter_snaplen":SNAPLEN,"recv_budget":SNAPLEN,"max_accepted_original_and_normalized_frame":MAX_FRAME});
    value["protocol_id"] = "custom-ethernet".into();
    value["default"] = json!(CustomEthernetConfig::default());
    value["notes"] = json!([
        "Persistent one fixed Ethernet response per kernel-filter/optional payload-prefix match",
        "Both response banks and disabled VLAN/source override values are saved and hashed; response patches merge recursively, link replaces whole tag",
        "BPF expression<=2048 UTF8 bytes, NUL/blank rejected; hostname resolution and unsupported kernel expressions may fail bounded compilation",
        "Constructed frame including optional tag<=65535 bytes; active response and explicit fixture also checked against actual interface MTU",
        "Actual bound local/peer MACs distinct nonzero unicast; payload destination nonzero and override value unicast; memberships multicast excluding broadcast",
        "Independent BPF, fixture and TX values; no automatic rewriting",
        "ALL has4 check groups and8 actual exchanges of current fixture",
        "Live libpcap cBPF attach/readback; no userspace fallback or fake kernel-drop count",
        "Software L2 does not assert physical VLAN/FCS/runt transmission"
    ]);
    value
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_process_arguments_preserve_banks_and_full_config() {
        let mut c = CustomEthernetConfig::default();
        c.response.frame_hex = "00".repeat(65535);
        c.test_request.frame_hex = "00".repeat(65535);
        c.validate().unwrap();
        let args = config_args(&c).unwrap();
        assert!(args.len() > 4);
        assert!(
            args.chunks(2)
                .all(|a| a[0] == "--config-json-part" && a[1].len() <= 60000)
        );
        let joined = args.chunks(2).map(|a| a[1].as_str()).collect::<String>();
        let parsed: CustomEthernetConfig = serde_json::from_str(&joined).unwrap();
        assert_eq!(parsed, c);
        assert_eq!(parsed.observer_hash(), c.observer_hash());
        assert_eq!(
            config_args(&CustomEthernetConfig::default()).unwrap()[0],
            "--config-json"
        );
    }

    #[test]
    fn contract_defaults_and_bank_patch_preservation() {
        let c = CustomEthernetConfig::default();
        c.validate().unwrap();
        assert_eq!(c.frame().unwrap().len(), 78);
        assert_eq!(hex_bytes(&c.test_request.frame_hex).unwrap().len(), 78);
        assert_eq!(&c.frame().unwrap()[12..14], &[0x88, 0xb5]);
        assert_eq!(
            &hex_bytes(&c.test_request.frame_hex).unwrap()[14..26],
            b"PLAB-REQUEST"
        );
        let n=c.patch(json!({"response":{"mode":"frame","payload":{"vlan":{"vid":0,"pcp":7,"dei":true},"source_mac":{"value":"02:00:00:00:AB:CD"}}}})).unwrap();
        assert_eq!(n.response.payload.source_mac.value, "02:00:00:00:ab:cd");
        assert_eq!(n.response.frame_hex, c.response.frame_hex);
        assert_ne!(c.observer_hash(), n.observer_hash());
        let n = n.patch(json!({"response":{"mode":"payload"}})).unwrap();
        assert_eq!(n.response.payload.vlan.vid, 0);
        assert_eq!(n.response.payload.vlan.pcp, 7);
        assert_eq!(n.response.payload.source_mac.value, "02:00:00:00:ab:cd");
        assert_eq!(n.packet_filter, c.packet_filter);
        assert_eq!(n.test_request, c.test_request)
    }
    #[test]
    fn strict_nullable_types_and_required_fields() {
        let c = CustomEthernetConfig::default();
        for p in [
            json!({"port":0}),
            json!({"promiscuous":1}),
            json!({"response":{"payload":{"vlan":{"dei":1}}}}),
            json!({"local_mac":"01:00:00:00:00:01"}),
            json!({"request_marker_hex":""}),
            json!({"packet_filter":"\u{0}"}),
            json!({"response":{"what":1}}),
            json!({"link":{"mode":"docker-bridge","interface":"lo"}}),
        ] {
            assert!(c.patch(p.clone()).is_err(), "{p}")
        }
        assert!(
            c.patch(json!({"request_marker_hex":null}))
                .unwrap()
                .request_marker_hex
                .is_none()
        );
        let mut v = serde_json::to_value(&c).unwrap();
        v.as_object_mut().unwrap().remove("request_marker_hex");
        assert!(serde_json::from_value::<CustomEthernetConfig>(v).is_err());
    }
    #[test]
    fn closed_wire_lengths_and_actual_mtu() {
        let c = CustomEthernetConfig::default();
        let mut n = c.clone();
        n.response.payload.payload_hex = "00".repeat(65521);
        assert!(n.validate().is_ok());
        n.response.payload.vlan.enabled = true;
        assert!(n.validate().is_err());
        n.response.payload.payload_hex = "00".repeat(65517);
        n.validate().unwrap();
        assert_eq!(n.frame().unwrap().len(), 65535);
        assert!(n.validate_mtu(1500).is_err());
        n.validate_mtu(65535).unwrap();
        let mut n = c.clone();
        n.response.payload.vlan.enabled = true;
        n.response.payload.vlan.vid = 0;
        n.response.payload.vlan.pcp = 7;
        n.response.payload.vlan.dei = true;
        let f = n.frame().unwrap();
        assert_eq!(&f[12..18], &[0x81, 0, 0xf0, 0, 0x88, 0xb5]);
        assert_eq!(c.test_budget("ALL").unwrap()["check_groups"], 4);
        assert_eq!(c.test_budget("ALL").unwrap()["wire_exchanges"], 8)
    }
}
