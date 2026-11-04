use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const MAX_RESPONSE_LENGTH: u32 = 1024 * 1024;
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub protocol_id: String,
    pub runtime: String,
    pub enabled: bool,
    pub config: HttpConfig,
    pub applied_config: Option<HttpConfig>,
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
    pub fn new(id: String, config: HttpConfig) -> Self {
        Self {
            id,
            protocol_id: "http".into(),
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
            instances: vec![Instance::new("http-demo".into(), HttpConfig::default())],
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
            if i.protocol_id != "http" || i.runtime != "docker" {
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
        let mut c = HttpConfig::default();
        c.response_length = 0;
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
