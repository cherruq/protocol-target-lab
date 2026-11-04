use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const MAX_RESPONSE_LENGTH: u32 = 1024 * 1024;
pub const PROTOCOLS: [&str; 11] = [
    "http", "dns", "mqtt", "telnet", "iec104", "mqtt-sn", "rtp", "rtcp", "dlt645", "iec101", "bfd",
];
pub const HTTP_METHODS: [&str; 7] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
pub const FIXED_PATTERN: &[u8] = b"0123456789abcdef";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ResponseMode {
    Fixed,
    Random,
}
impl ResponseMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fixed => "fixed",
            Self::Random => "random",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HttpConfig {
    pub bind_ip: String,
    pub port: u16,
    pub response_length: u32,
    pub response_mode: ResponseMode,
    // Preserve the old serialized form and fingerprint until explicit editing.
    pub legacy_body: Option<String>,
}
impl Serialize for HttpConfig {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut value = serializer
            .serialize_struct("HttpConfig", if self.legacy_body.is_some() { 3 } else { 4 })?;
        value.serialize_field("bind_ip", &self.bind_ip)?;
        value.serialize_field("port", &self.port)?;
        if let Some(body) = &self.legacy_body {
            value.serialize_field("response_body", body)?;
        } else {
            value.serialize_field("response_length", &self.response_length)?;
            value.serialize_field("response_mode", &self.response_mode)?;
        }
        value.end()
    }
}
impl<'de> Deserialize<'de> for HttpConfig {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            bind_ip: String,
            port: u16,
            response_length: Option<u32>,
            response_mode: Option<ResponseMode>,
            response_body: Option<String>,
        }
        let raw = Input::deserialize(deserializer)?;
        let (response_length, response_mode, legacy_body) = match (
            raw.response_length,
            raw.response_mode,
            raw.response_body,
        ) {
            (Some(length), Some(mode), None) => (length, mode, None),
            (None, None, Some(body)) => (
                u32::try_from(body.len()).map_err(serde::de::Error::custom)?,
                ResponseMode::Fixed,
                Some(body),
            ),
            _ => {
                return Err(serde::de::Error::custom(
                    "config: provide response_length and response_mode, or a legacy response_body; do not mix formats",
                ));
            }
        };
        Ok(Self {
            bind_ip: raw.bind_ip,
            port: raw.port,
            response_length,
            response_mode,
            legacy_body,
        })
    }
}
impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 18090,
            response_length: 64,
            response_mode: ResponseMode::Fixed,
            legacy_body: None,
        }
    }
}
impl HttpConfig {
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
        if self.response_length > MAX_RESPONSE_LENGTH {
            bail!("config.response_length: must be between 0 and 1048576 bytes");
        }
        if let Some(body) = &self.legacy_body
            && (body.len() > 65536 || body.contains('\0'))
        {
            bail!("config.response_body: maximum 65536 UTF-8 bytes; NUL is not allowed");
        }
        Ok(())
    }
    pub fn fingerprint(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(self).expect("serializable config"))
        )
    }
    pub fn expected_body(&self) -> Option<Vec<u8>> {
        if let Some(body) = &self.legacy_body {
            return Some(body.as_bytes().to_vec());
        }
        match self.response_mode {
            ResponseMode::Fixed => Some(
                (0..self.response_length as usize)
                    .map(|i| FIXED_PATTERN[i % FIXED_PATTERN.len()])
                    .collect(),
            ),
            ResponseMode::Random => None,
        }
    }
    pub fn probe_ip(&self) -> &str {
        if self.bind_ip == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &self.bind_ip
        }
    }
}

fn present<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// A partial edit is merged with the latest saved configuration under the
/// manager's control/data locks. Null and unknown fields are rejected.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HttpConfigPatch {
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub bind_ip: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub port: Option<u16>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub response_length: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub response_mode: Option<ResponseMode>,
}
impl HttpConfigPatch {
    pub fn apply(self, mut config: HttpConfig) -> Result<HttpConfig> {
        if self.bind_ip.is_none()
            && self.port.is_none()
            && self.response_length.is_none()
            && self.response_mode.is_none()
        {
            bail!("config.patch: provide at least one configuration field");
        }
        if self.response_length.is_some() || self.response_mode.is_some() {
            config.legacy_body = None;
        }
        if let Some(ip) = self.bind_ip {
            config.bind_ip = ip;
        }
        if let Some(port) = self.port {
            config.port = port;
        }
        if let Some(length) = self.response_length {
            config.response_length = length;
        }
        if let Some(mode) = self.response_mode {
            config.response_mode = mode;
        }
        config.validate()?;
        Ok(config)
    }
}

/// Untagged serialization preserves existing HTTP ownership fingerprints.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ProtocolConfig {
    Http(HttpConfig),
    Dns(crate::dns::DnsConfig),
    Mqtt(crate::mqtt::MqttConfig),
    Telnet(crate::telnet::TelnetConfig),
    Iec104(crate::iec104::Iec104Config),
    MqttSn(crate::mqtt_sn::MqttSnConfig),
    Rtp(crate::rtp::RtpConfig),
    Rtcp(crate::rtcp::RtcpConfig),
    Dlt645(crate::dlt645::Dlt645Config),
    Iec101(crate::iec101::Iec101Config),
    Bfd(crate::bfd::BfdConfig),
}
impl From<HttpConfig> for ProtocolConfig {
    fn from(c: HttpConfig) -> Self {
        Self::Http(c)
    }
}
impl From<crate::dns::DnsConfig> for ProtocolConfig {
    fn from(c: crate::dns::DnsConfig) -> Self {
        Self::Dns(c)
    }
}
impl From<crate::mqtt::MqttConfig> for ProtocolConfig {
    fn from(c: crate::mqtt::MqttConfig) -> Self {
        Self::Mqtt(c)
    }
}
impl From<crate::telnet::TelnetConfig> for ProtocolConfig {
    fn from(config: crate::telnet::TelnetConfig) -> Self {
        Self::Telnet(config)
    }
}
impl From<crate::iec104::Iec104Config> for ProtocolConfig {
    fn from(config: crate::iec104::Iec104Config) -> Self {
        Self::Iec104(config)
    }
}
impl From<crate::mqtt_sn::MqttSnConfig> for ProtocolConfig {
    fn from(config: crate::mqtt_sn::MqttSnConfig) -> Self {
        Self::MqttSn(config)
    }
}
impl From<crate::rtp::RtpConfig> for ProtocolConfig {
    fn from(config: crate::rtp::RtpConfig) -> Self {
        Self::Rtp(config)
    }
}
impl From<crate::rtcp::RtcpConfig> for ProtocolConfig {
    fn from(c: crate::rtcp::RtcpConfig) -> Self {
        Self::Rtcp(c)
    }
}
impl From<crate::dlt645::Dlt645Config> for ProtocolConfig {
    fn from(c: crate::dlt645::Dlt645Config) -> Self {
        Self::Dlt645(c)
    }
}
impl From<crate::iec101::Iec101Config> for ProtocolConfig {
    fn from(c: crate::iec101::Iec101Config) -> Self {
        Self::Iec101(c)
    }
}
impl From<crate::bfd::BfdConfig> for ProtocolConfig {
    fn from(c: crate::bfd::BfdConfig) -> Self {
        Self::Bfd(c)
    }
}
impl ProtocolConfig {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Http(c) => c.validate(),
            Self::Dns(c) => c.validate(),
            Self::Mqtt(c) => c.validate(),
            Self::Telnet(c) => c.validate(),
            Self::Iec104(c) => c.validate(),
            Self::MqttSn(c) => c.validate(),
            Self::Rtp(c) => c.validate(),
            Self::Rtcp(c) => c.validate(),
            Self::Dlt645(c) => c.validate(),
            Self::Iec101(c) => c.validate(),
            Self::Bfd(c) => c.validate(),
        }
    }
    pub fn as_http(&self) -> Option<&HttpConfig> {
        if let Self::Http(c) = self {
            Some(c)
        } else {
            None
        }
    }
    pub fn protocol_id(&self) -> &'static str {
        match self {
            Self::Http(_) => "http",
            Self::Dns(_) => "dns",
            Self::Mqtt(_) => "mqtt",
            Self::Telnet(_) => "telnet",
            Self::Iec104(_) => "iec104",
            Self::MqttSn(_) => "mqtt-sn",
            Self::Rtp(_) => "rtp",
            Self::Rtcp(_) => "rtcp",
            Self::Dlt645(_) => "dlt645",
            Self::Iec101(_) => "iec101",
            Self::Bfd(_) => "bfd",
        }
    }
    pub fn bind_ip(&self) -> &str {
        match self {
            Self::Http(c) => &c.bind_ip,
            Self::Dns(c) => &c.bind_ip,
            Self::Mqtt(c) => &c.bind_ip,
            Self::Telnet(c) => &c.bind_ip,
            Self::Iec104(c) => &c.bind_ip,
            Self::MqttSn(c) => &c.bind_ip,
            Self::Rtp(c) => &c.bind_ip,
            Self::Rtcp(c) => &c.bind_ip,
            Self::Dlt645(c) => &c.bind_ip,
            Self::Iec101(c) => &c.bind_ip,
            Self::Bfd(c) => &c.bind_ip,
        }
    }
    pub fn port(&self) -> u16 {
        match self {
            Self::Http(c) => c.port,
            Self::Dns(c) => c.port,
            Self::Mqtt(c) => c.port,
            Self::Telnet(c) => c.port,
            Self::Iec104(c) => c.port,
            Self::MqttSn(c) => c.port,
            Self::Rtp(c) => c.port,
            Self::Rtcp(c) => c.port,
            Self::Dlt645(c) => c.port,
            Self::Iec101(c) => c.single.port,
            Self::Bfd(_) => crate::bfd::PORT,
        }
    }
    pub fn transports(&self) -> Vec<&'static str> {
        match self {
            Self::Dns(c) => c.transports(),
            Self::MqttSn(_) | Self::Rtp(_) | Self::Rtcp(_) | Self::Bfd(_) => vec!["UDP"],
            Self::Http(_)
            | Self::Mqtt(_)
            | Self::Telnet(_)
            | Self::Iec104(_)
            | Self::Dlt645(_)
            | Self::Iec101(_) => {
                vec!["TCP"]
            }
        }
    }
    pub fn internal_port(&self) -> u16 {
        match self {
            Self::Dns(_) => 15353,
            Self::Mqtt(_) => 18883,
            Self::Telnet(_) => 2323,
            Self::Iec104(_) => 2404,
            Self::MqttSn(c) => c.port,
            Self::Rtp(_) => 5004,
            Self::Rtcp(_) => 5005,
            Self::Dlt645(_) => 20645,
            Self::Iec101(_) => 24741,
            Self::Bfd(_) => crate::bfd::PORT,
            Self::Http(c) => c.port,
        }
    }
    pub fn probe_ip(&self) -> &str {
        if self.bind_ip() == "0.0.0.0" {
            "127.0.0.1"
        } else {
            self.bind_ip()
        }
    }
    pub fn fingerprint(&self) -> String {
        match self {
            Self::Http(c) => c.fingerprint(),
            Self::Dns(_)
            | Self::Mqtt(_)
            | Self::Telnet(_)
            | Self::Iec104(_)
            | Self::MqttSn(_)
            | Self::Rtp(_)
            | Self::Rtcp(_)
            | Self::Dlt645(_)
            | Self::Iec101(_)
            | Self::Bfd(_) => {
                format!(
                    "{:x}",
                    Sha256::digest(serde_json::to_vec(self).expect("serializable config"))
                )
            }
        }
    }
    pub fn patch(&self, value: Value) -> Result<Self> {
        match self {
            Self::Http(c) => Ok(serde_json::from_value::<HttpConfigPatch>(value)
                .map_err(|e| anyhow::anyhow!("config.patch: {e}"))?
                .apply(c.clone())?
                .into()),
            Self::Dns(c) => {
                let result: Self = typed_patch(
                    c,
                    value,
                    &["bind_ip", "port", "udp_enabled", "tcp_enabled", "records"],
                )?
                .into();
                result.validate()?;
                Ok(result)
            }
            Self::Mqtt(c) => {
                let result: Self = typed_patch(
                    c,
                    value,
                    &["bind_ip", "port", "max_connections", "max_packet_size"],
                )?
                .into();
                result.validate()?;
                Ok(result)
            }
            Self::Iec101(c) => Ok(c.patch(value)?.into()),
            Self::Bfd(c) => Ok(c.patch(value)?.into()),
            Self::Dlt645(c) => {
                let r: Self = typed_patch(
                    c,
                    value,
                    &[
                        "wire_profile",
                        "bind_ip",
                        "port",
                        "meter_address",
                        "energy_hundredths",
                        "period_minutes",
                        "programming_key_enabled",
                        "max_connections",
                        "security",
                    ],
                )?
                .into();
                r.validate()?;
                Ok(r)
            }
            Self::Rtcp(c) => {
                let r: Self = typed_patch(
                    c,
                    value,
                    &["bind_ip", "port", "max_packet_size", "packet_profile"],
                )?
                .into();
                r.validate()?;
                Ok(r)
            }
            Self::Rtp(c) => {
                let result: Self =
                    typed_patch(c, value, &["bind_ip", "port", "max_packet_size"])?.into();
                result.validate()?;
                Ok(result)
            }
            Self::MqttSn(c) => {
                let result: Self = typed_patch(
                    c,
                    value,
                    &[
                        "bind_ip",
                        "port",
                        "discovery_group",
                        "discovery_port",
                        "gateway_id",
                        "broker_host",
                        "broker_port",
                        "predefined_topics",
                    ],
                )?
                .into();
                result.validate()?;
                Ok(result)
            }
            Self::Iec104(c) => {
                let result: Self =
                    typed_patch(c, value, &["bind_ip", "port", "max_connections", "points"])?
                        .into();
                result.validate()?;
                Ok(result)
            }
            Self::Telnet(c) => {
                let result: Self = typed_patch(
                    c,
                    value,
                    &[
                        "bind_ip",
                        "port",
                        "banner",
                        "max_connections",
                        "max_line_bytes",
                    ],
                )?
                .into();
                result.validate()?;
                Ok(result)
            }
        }
    }
}
fn typed_patch<T: Serialize + serde::de::DeserializeOwned>(
    config: &T,
    value: Value,
    fields: &[&str],
) -> Result<T> {
    let patch = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("config.patch: expected object"))?;
    if patch.is_empty()
        || patch
            .iter()
            .any(|(key, value)| !fields.contains(&key.as_str()) || value.is_null())
    {
        bail!(
            "config.patch: provide supported protocol fields; unknown fields and null are not allowed"
        );
    }
    let mut full = serde_json::to_value(config)?;
    for (key, value) in patch {
        full[key] = value.clone();
    }
    let edited: T =
        serde_json::from_value(full).map_err(|e| anyhow::anyhow!("config.patch: {e}"))?;
    // Validation is performed by the typed caller before persistence.
    Ok(edited)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub protocol_id: String,
    pub runtime: String,
    pub enabled: bool,
    pub config: ProtocolConfig,
    pub applied_config: Option<ProtocolConfig>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(skip)]
    pub status: String,
    #[serde(skip)]
    pub runtime_error: Option<String>,
    #[serde(skip)]
    pub container_id: Option<String>,
    #[serde(skip)]
    pub current_operation: Option<Value>,
    #[serde(skip)]
    pub last_result: Option<Value>,
    #[serde(skip)]
    pub retry_count: u32,
    #[serde(skip)]
    pub retry_after: u64,
}
impl Instance {
    pub fn new(id: String, config: impl Into<ProtocolConfig>) -> Self {
        let config = config.into();
        Self {
            id,
            protocol_id: config.protocol_id().into(),
            runtime: "docker".into(),
            enabled: false,
            config,
            applied_config: None,
            error: None,
            status: "stopped".into(),
            runtime_error: None,
            container_id: None,
            current_operation: None,
            last_result: None,
            retry_count: 0,
            retry_after: 0,
        }
    }
    pub fn view(&self) -> Value {
        let mut value = serde_json::to_value(self).expect("serializable instance");
        let v = value.as_object_mut().unwrap();
        v.insert("status".into(), self.status.clone().into());
        v.insert(
            "error".into(),
            serde_json::to_value(self.runtime_error.as_ref().or(self.error.as_ref())).unwrap(),
        );
        v.insert(
            "container_id".into(),
            serde_json::to_value(&self.container_id).unwrap(),
        );
        v.insert(
            "current_operation".into(),
            serde_json::to_value(&self.current_operation).unwrap(),
        );
        v.insert(
            "last_result".into(),
            serde_json::to_value(&self.last_result).unwrap(),
        );
        value
    }
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && id.as_bytes()[0].is_ascii_alphanumeric()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub schema_version: u32,
    pub deployment_id: String,
    pub instances: Vec<Instance>,
}
impl Document {
    pub fn new() -> Self {
        Self {
            schema_version: 2,
            deployment_id: uuid::Uuid::new_v4().to_string(),
            instances: vec![
                Instance::new("http-demo".into(), HttpConfig::default()),
                Instance::new("dns-demo".into(), crate::dns::DnsConfig::default()),
                Instance::new("mqtt-demo".into(), crate::mqtt::MqttConfig::default()),
                Instance::new("telnet-demo".into(), crate::telnet::TelnetConfig::default()),
                Instance::new("iec104-demo".into(), crate::iec104::Iec104Config::default()),
                Instance::new(
                    "mqtt-sn-demo".into(),
                    crate::mqtt_sn::MqttSnConfig::default(),
                ),
                Instance::new("rtp-demo".into(), crate::rtp::RtpConfig::default()),
                Instance::new("rtcp-demo".into(), crate::rtcp::RtcpConfig::default()),
                Instance::new("dlt645-demo".into(), crate::dlt645::Dlt645Config::default()),
                Instance::new("iec101-demo".into(), crate::iec101::Iec101Config::default()),
                Instance::new("bfd-demo".into(), crate::bfd::BfdConfig::default()),
            ],
        }
    }
    pub fn validate(&self) -> Result<()> {
        if ![1, 2].contains(&self.schema_version) {
            bail!("unsupported schema_version {}", self.schema_version);
        }
        uuid::Uuid::parse_str(&self.deployment_id)?;
        let mut ids = std::collections::HashSet::new();
        let mut protocols = std::collections::HashSet::new();
        for i in &self.instances {
            if !valid_id(&i.id) || !ids.insert(&i.id) {
                bail!("invalid or duplicate instance id");
            }
            if !PROTOCOLS.contains(&i.protocol_id.as_str())
                || i.runtime != "docker"
                || i.config.protocol_id() != i.protocol_id
                || i.applied_config
                    .as_ref()
                    .is_some_and(|c| c.protocol_id() != i.protocol_id)
            {
                bail!("unsupported protocol or runtime");
            }
            if !protocols.insert(&i.protocol_id) {
                bail!(
                    "multiple workspaces for protocol {}; keep one configuration after reviewing existing resources; no configuration or containers were changed",
                    i.protocol_id
                );
            }
            i.config.validate()?;
            if let Some(c) = &i.applied_config {
                c.validate()?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registered_protocols_have_unique_disabled_defaults() {
        let doc = Document::new();
        doc.validate().unwrap();
        assert_eq!(
            doc.instances
                .iter()
                .map(|i| i.protocol_id.as_str())
                .collect::<Vec<_>>(),
            PROTOCOLS
        );
        assert!(
            doc.instances
                .iter()
                .all(|i| !i.enabled && i.applied_config.is_none())
        );
        for instance in &doc.instances {
            let decoded: ProtocolConfig =
                serde_json::from_value(serde_json::to_value(&instance.config).unwrap()).unwrap();
            assert_eq!(decoded.protocol_id(), instance.protocol_id);
            assert_eq!(decoded.fingerprint(), instance.config.fingerprint());
        }
    }
    #[test]
    fn legacy_json_and_ownership_fingerprint_are_unchanged() {
        let raw = r#"{"bind_ip":"127.0.0.1","port":18090,"response_body":"hello"}"#;
        let c: HttpConfig = serde_json::from_str(raw).unwrap();
        assert_eq!(serde_json::to_string(&c).unwrap(), raw);
        assert_eq!(
            c.fingerprint(),
            format!("{:x}", Sha256::digest(raw.as_bytes()))
        );
        assert_eq!(c.expected_body().unwrap(), b"hello");
        assert_eq!(c.response_length, 5);
        assert_eq!(crate::docker::worker_args(&c), ["--response-body=hello"]);
    }
    #[test]
    fn generated_shapes_are_strict_and_lengths_are_bounded() {
        for raw in [
            r#"{"bind_ip":"0.0.0.0","port":18090,"response_length":64,"response_mode":"fixed","response_body":"hello"}"#,
            r#"{"bind_ip":"0.0.0.0","port":18090,"response_length":64}"#,
            r#"{"bind_ip":"0.0.0.0","port":18090,"response_length":-1,"response_mode":"fixed"}"#,
            r#"{"bind_ip":"0.0.0.0","port":18090,"response_length":64,"response_mode":"unknown"}"#,
        ] {
            assert!(serde_json::from_str::<HttpConfig>(raw).is_err());
        }
        let mut c = HttpConfig {
            response_length: 0,
            ..HttpConfig::default()
        };
        assert!(c.validate().is_ok());
        assert!(c.expected_body().unwrap().is_empty());
        c.response_length = 17;
        assert_eq!(c.expected_body().unwrap(), b"0123456789abcdef0");
        c.response_length = MAX_RESPONSE_LENGTH;
        assert!(c.validate().is_ok());
        c.response_length += 1;
        assert!(c.validate().is_err());
        c.response_length = 64;
        c.response_mode = ResponseMode::Random;
        assert!(c.expected_body().is_none());
    }
    #[test]
    fn protocol_config_keeps_http_bytes_and_dns_patches_are_atomic() {
        let raw = r#"{"bind_ip":"127.0.0.1","port":18090,"response_body":"hello"}"#;
        let http: ProtocolConfig = serde_json::from_str(raw).unwrap();
        assert_eq!(serde_json::to_string(&http).unwrap(), raw);
        assert_eq!(
            http.fingerprint(),
            format!("{:x}", Sha256::digest(raw.as_bytes()))
        );
        let dns: ProtocolConfig = crate::dns::DnsConfig::default().into();
        let patched = dns
            .patch(serde_json::json!({"port":15453,"udp_enabled":false}))
            .unwrap();
        assert_eq!(patched.port(), 15453);
        let ProtocolConfig::Dns(c) = patched else {
            panic!("DNS variant lost")
        };
        assert_eq!(c.records, crate::dns::DnsConfig::default().records);
        assert!(c.tcp_enabled);
        assert!(!c.udp_enabled);
        for patch in [
            serde_json::json!({}),
            serde_json::json!({"records":null}),
            serde_json::json!({"response_length":4}),
            serde_json::json!({"udp_enabled":false,"tcp_enabled":false}),
        ] {
            assert!(dns.patch(patch).is_err());
        }
        assert!(http.patch(serde_json::json!({"udp_enabled":true})).is_err());
    }
    #[test]
    fn atomic_patch_preserves_unmentioned_fields_and_rejects_empty_null_or_unknown() {
        let old: HttpConfig = serde_json::from_str(
            r#"{"bind_ip":"127.0.0.1","port":18191,"response_body":"old body"}"#,
        )
        .unwrap();
        let patch: HttpConfigPatch = serde_json::from_str(r#"{"port":18192}"#).unwrap();
        let edited = patch.apply(old.clone()).unwrap();
        assert_eq!(edited.legacy_body, old.legacy_body);
        let patch: HttpConfigPatch = serde_json::from_str(r#"{"response_length":128}"#).unwrap();
        let edited = patch.apply(old.clone()).unwrap();
        assert_eq!(edited.port, 18191);
        assert_eq!(edited.bind_ip, old.bind_ip);
        assert!(edited.legacy_body.is_none());
        assert_eq!(edited.response_length, 128);
        for raw in [
            r#"{"port":null}"#,
            r#"{"response_mode":null}"#,
            r#"{"unknown":1}"#,
        ] {
            assert!(serde_json::from_str::<HttpConfigPatch>(raw).is_err());
        }
        for raw in ["{}", r#"{"port":0}"#, r#"{"response_length":1048577}"#] {
            assert!(
                serde_json::from_str::<HttpConfigPatch>(raw)
                    .unwrap()
                    .apply(old.clone())
                    .is_err()
            );
        }
    }
}
