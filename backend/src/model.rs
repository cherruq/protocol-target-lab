use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HttpConfig {
    pub bind_ip: String,
    pub port: u16,
    pub response_body: String,
}
impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 18090,
            response_body: "hello".into(),
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
        if self.response_body.len() > 65536 || self.response_body.contains('\0') {
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
    pub fn probe_ip(&self) -> &str {
        if self.bind_ip == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &self.bind_ip
        }
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
            schema_version: 1,
            deployment_id: uuid::Uuid::new_v4().to_string(),
            instances: vec![Instance::new("http-demo".into(), HttpConfig::default())],
        }
    }
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            bail!("unsupported schema_version {}", self.schema_version);
        }
        uuid::Uuid::parse_str(&self.deployment_id)?;
        let mut ids = std::collections::HashSet::new();
        for i in &self.instances {
            if !valid_id(&i.id) || !ids.insert(&i.id) {
                bail!("invalid or duplicate instance id");
            }
            if i.protocol_id != "http" || i.runtime != "docker" {
                bail!("unsupported protocol or runtime");
            }
            i.config.validate()?;
            if let Some(c) = &i.applied_config {
                c.validate()?;
            }
        }
        Ok(())
    }
}
