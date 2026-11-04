use crate::model::Document;
use anyhow::{Context, Result};
use fs2::FileExt;
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone)]
pub struct Settings {
    pub config: PathBuf,
    pub data: PathBuf,
    pub listen: String,
    pub image: String,
    pub dns_image: String,
    pub mqtt_image: String,
    pub telnet_image: String,
    pub iec104_image: String,
    pub mqtt_sn_image: String,
}
impl Settings {
    pub fn env() -> Result<Self> {
        let mut defaults = std::collections::HashMap::new();
        let env_path = std::env::var("PLAB_ENV_FILE")
            .unwrap_or_else(|_| "/etc/default/protocol-target-lab".into());
        match std::fs::read_to_string(&env_path) {
            Ok(text) => {
                for line in text
                    .lines()
                    .map(str::trim)
                    .filter(|s| !s.is_empty() && !s.starts_with('#'))
                {
                    let (key, value) = line
                        .split_once('=')
                        .context("invalid manager defaults; expected KEY=VALUE")?;
                    if ![
                        "PLAB_CONFIG_FILE",
                        "PLAB_DATA_DIR",
                        "PLAB_LISTEN",
                        "PLAB_HTTP_IMAGE",
                        "PLAB_DNS_IMAGE",
                        "PLAB_MQTT_IMAGE",
                        "PLAB_TELNET_IMAGE",
                        "PLAB_IEC104_IMAGE",
                        "PLAB_MQTTSN_IMAGE",
                    ]
                    .contains(&key)
                    {
                        anyhow::bail!("unsupported key in manager defaults: {key}");
                    }
                    let value = value.trim();
                    let value = if value.len() >= 2
                        && ((value.starts_with('\'') && value.ends_with('\''))
                            || (value.starts_with('"') && value.ends_with('"')))
                    {
                        &value[1..value.len() - 1]
                    } else {
                        value
                    };
                    defaults.insert(key.to_owned(), value.to_owned());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e).context("cannot read manager defaults"),
        }
        let value = |key: &str, fallback: &str| {
            std::env::var(key)
                .ok()
                .or_else(|| defaults.get(key).cloned())
                .unwrap_or_else(|| fallback.into())
        };
        Ok(Self {
            config: value(
                "PLAB_CONFIG_FILE",
                "/etc/protocol-target-lab/instances.json",
            )
            .into(),
            data: value("PLAB_DATA_DIR", "/var/lib/protocol-target-lab").into(),
            listen: value("PLAB_LISTEN", "0.0.0.0:18000"),
            image: value("PLAB_HTTP_IMAGE", "protocol-target-lab/http:0.3.0"),
            dns_image: value("PLAB_DNS_IMAGE", "protocol-target-lab/dns:0.1.1"),
            mqtt_image: value("PLAB_MQTT_IMAGE", "protocol-target-lab/mqtt:0.1.1"),
            telnet_image: value("PLAB_TELNET_IMAGE", "protocol-target-lab/telnet:0.1.0"),
            iec104_image: value("PLAB_IEC104_IMAGE", "protocol-target-lab/iec104:0.1.1"),
            mqtt_sn_image: value("PLAB_MQTTSN_IMAGE", "protocol-target-lab/mqtt-sn:0.1.1"),
        })
    }
    pub fn image_for(&self, protocol: &str) -> &str {
        if protocol == "mqtt-sn" {
            &self.mqtt_sn_image
        } else if protocol == "iec104" {
            &self.iec104_image
        } else if protocol == "telnet" {
            &self.telnet_image
        } else if protocol == "mqtt" {
            &self.mqtt_image
        } else if protocol == "dns" {
            &self.dns_image
        } else {
            &self.image
        }
    }
    pub fn lock(&self, name: &str) -> Result<File> {
        std::fs::create_dir_all(&self.data)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.data.join(name))?;
        file.try_lock_exclusive()
            .with_context(|| format!("another operation holds {name}"))?;
        Ok(file)
    }
}

pub fn save(path: &Path, doc: &Document) -> Result<()> {
    let parent = path.parent().context("configuration path has no parent")?;
    std::fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".instances-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        f.write_all(&serde_json::to_vec_pretty(doc)?)?;
        f.write_all(b"\n")?;
        f.sync_all()?;
        std::fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if temporary.exists() {
        let _ = std::fs::remove_file(temporary);
    }
    result.with_context(|| format!("cannot save {}", path.display()))
}
pub fn load(settings: &Settings) -> Result<Document> {
    if !settings.config.exists() {
        // A missing existing config must not silently create a new deployment.
        if settings.data.join("deployment-id").exists() {
            anyhow::bail!(
                "configuration missing: {} (deployment marker exists)",
                settings.config.display()
            );
        }
        let d = Document::new();
        save(&settings.config, &d)?;
        std::fs::write(settings.data.join("deployment-id"), &d.deployment_id)?;
        return Ok(d);
    }
    let bytes = std::fs::read(&settings.config)?;
    let mut d: Document = serde_json::from_slice(&bytes)
        .with_context(|| format!("invalid configuration {}", settings.config.display()))?;
    d.validate()?;
    let marker = settings.data.join("deployment-id");
    if marker.exists() {
        if std::fs::read_to_string(&marker)?.trim() != d.deployment_id {
            anyhow::bail!("deployment_id does not match persistent ownership marker");
        }
    } else {
        std::fs::write(marker, &d.deployment_id)?;
    }
    // Older versions allowed deleting the last entry. Restore a disabled fixed
    // workspace only after validating the entire document and ownership marker.
    // Existing IDs, snapshots and container labels are never rewritten.
    let mut changed = false;
    for mut default in Document::new().instances {
        if d.instances
            .iter()
            .any(|i| i.protocol_id == default.protocol_id)
        {
            continue;
        }
        let base = default.id.clone();
        let mut suffix = 2;
        while d.instances.iter().any(|i| i.id == default.id) {
            default.id = format!("{base}-{suffix}");
            suffix += 1;
        }
        d.instances.push(default);
        changed = true;
    }
    if changed {
        d.schema_version = 2;
        save(&settings.config, &d)?;
    }
    for i in &mut d.instances {
        i.status = if i.error.is_some() {
            "error"
        } else if i.enabled {
            "checking"
        } else {
            "stopped"
        }
        .into();
    }
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("build/tests")
                .join(uuid::Uuid::new_v4().to_string());
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn settings(&self) -> Settings {
            Settings {
                config: self.0.join("instances.json"),
                data: self.0.clone(),
                listen: "127.0.0.1:0".into(),
                image: "unused".into(),
                dns_image: "unused".into(),
                mqtt_image: "unused".into(),
                telnet_image: "unused".into(),
                iec104_image: "unused".into(),
                mqtt_sn_image: "unused".into(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn corrupted_config_is_preserved_and_missing_existing_config_is_rejected() {
        let f = Fixture::new();
        let s = f.settings();
        let d = load(&s).unwrap();
        assert!(!d.instances[0].enabled);
        assert!(d.instances[0].applied_config.is_none());
        std::fs::write(&s.config, b"broken configuration").unwrap();
        assert!(load(&s).is_err());
        assert_eq!(std::fs::read(&s.config).unwrap(), b"broken configuration");
        std::fs::remove_file(&s.config).unwrap();
        assert!(load(&s).is_err());
        assert!(!s.config.exists());
    }
    #[test]
    fn draft_and_successful_snapshot_remain_separate_after_reload() {
        let f = Fixture::new();
        let s = f.settings();
        let mut d = load(&s).unwrap();
        let i = &mut d.instances[0];
        i.enabled = true;
        i.applied_config = Some(i.config.clone());
        if let crate::model::ProtocolConfig::Http(c) = &mut i.config {
            c.response_length = 128;
        }
        save(&s.config, &d).unwrap();
        let loaded = load(&s).unwrap();
        assert!(loaded.instances[0].enabled);
        assert_eq!(
            loaded.instances[0]
                .applied_config
                .as_ref()
                .unwrap()
                .as_http()
                .unwrap()
                .response_length,
            64
        );
        assert_eq!(
            loaded.instances[0]
                .config
                .as_http()
                .unwrap()
                .response_length,
            128
        );
    }
    #[test]
    fn fixed_workspace_preserves_custom_id_legacy_bytes_and_snapshots() {
        let f = Fixture::new();
        let s = f.settings();
        let mut d = load(&s).unwrap();
        d.schema_version = 1;
        let i = &mut d.instances[0];
        i.id = "custom-http".into();
        i.config = serde_json::from_str(
            r#"{"bind_ip":"0.0.0.0","port":18091,"response_body":"old body"}"#,
        )
        .unwrap();
        i.applied_config = Some(i.config.clone());
        i.enabled = true;
        let hash = i.config.fingerprint();
        save(&s.config, &d).unwrap();
        let bytes = std::fs::read(&s.config).unwrap();
        let loaded = load(&s).unwrap();
        assert_eq!(loaded.instances.len(), 6);
        assert_eq!(loaded.instances[0].id, "custom-http");
        assert!(loaded.instances[0].enabled);
        assert_eq!(loaded.instances[0].status, "checking");
        assert_eq!(
            loaded.instances[0]
                .applied_config
                .as_ref()
                .unwrap()
                .fingerprint(),
            hash
        );
        assert_eq!(std::fs::read(&s.config).unwrap(), bytes);
    }
    #[test]
    fn duplicate_protocol_is_rejected_without_changing_file_or_marker() {
        let f = Fixture::new();
        let s = f.settings();
        let mut d = load(&s).unwrap();
        let mut second = d.instances[0].clone();
        second.id = "http-second".into();
        d.instances.push(second);
        save(&s.config, &d).unwrap();
        let bytes = std::fs::read(&s.config).unwrap();
        let marker = std::fs::read(s.data.join("deployment-id")).unwrap();
        assert!(
            format!("{:#}", load(&s).err().unwrap())
                .contains("multiple workspaces for protocol http")
        );
        assert_eq!(std::fs::read(&s.config).unwrap(), bytes);
        assert_eq!(std::fs::read(s.data.join("deployment-id")).unwrap(), marker);
    }
    #[test]
    fn empty_legacy_document_restores_only_disabled_workspace_after_marker_check() {
        let f = Fixture::new();
        let s = f.settings();
        let mut d = load(&s).unwrap();
        d.instances.clear();
        d.schema_version = 1;
        save(&s.config, &d).unwrap();
        let loaded = load(&s).unwrap();
        assert_eq!(loaded.deployment_id, d.deployment_id);
        assert_eq!(loaded.instances.len(), 6);
        let i = &loaded.instances[0];
        assert_eq!(i.id, "http-demo");
        assert!(!i.enabled);
        assert!(i.applied_config.is_none());
        assert_eq!(load(&s).unwrap().instances.len(), 6);
        d.deployment_id = uuid::Uuid::new_v4().to_string();
        save(&s.config, &d).unwrap();
        let bytes = std::fs::read(&s.config).unwrap();
        assert!(load(&s).is_err());
        assert_eq!(std::fs::read(&s.config).unwrap(), bytes);
    }
    #[test]
    fn http_only_migration_keeps_identity_snapshots_and_hash_even_with_dns_id_collision() {
        let f = Fixture::new();
        let settings = f.settings();
        let mut doc = load(&settings).unwrap();
        doc.instances.retain(|i| i.protocol_id == "http");
        let http = &mut doc.instances[0];
        http.id = "dns-demo".into();
        http.enabled = true;
        http.applied_config = Some(http.config.clone());
        let original = serde_json::to_value(&http).unwrap();
        let hash = http.config.fingerprint();
        save(&settings.config, &doc).unwrap();
        let loaded = load(&settings).unwrap();
        assert_eq!(loaded.deployment_id, doc.deployment_id);
        assert_eq!(
            serde_json::to_value(&loaded.instances[0]).unwrap(),
            original
        );
        assert_eq!(loaded.instances[0].config.fingerprint(), hash);
        let dns = &loaded.instances[1];
        assert_eq!(dns.id, "dns-demo-2");
        assert_eq!(dns.protocol_id, "dns");
        assert!(!dns.enabled);
        assert!(dns.applied_config.is_none());
        let stable = std::fs::read(&settings.config).unwrap();
        load(&settings).unwrap();
        assert_eq!(std::fs::read(&settings.config).unwrap(), stable);
    }
    #[test]
    fn http_dns_upgrade_adds_disabled_mqtt_and_preserves_both_snapshots() {
        let fixture = Fixture::new();
        let settings = fixture.settings();
        let mut doc = load(&settings).unwrap();
        doc.instances
            .retain(|i| ["http", "dns"].contains(&i.protocol_id.as_str()));
        doc.instances[0].id = "mqtt-demo".into();
        for instance in &mut doc.instances {
            instance.enabled = true;
            instance.applied_config = Some(instance.config.clone());
        }
        let original = serde_json::to_value(&doc.instances).unwrap();
        let hashes = doc
            .instances
            .iter()
            .map(|i| i.config.fingerprint())
            .collect::<Vec<_>>();
        save(&settings.config, &doc).unwrap();
        let loaded = load(&settings).unwrap();
        assert_eq!(
            serde_json::to_value(&loaded.instances[..2]).unwrap(),
            original
        );
        assert_eq!(
            loaded.instances[..2]
                .iter()
                .map(|i| i.config.fingerprint())
                .collect::<Vec<_>>(),
            hashes
        );
        assert_eq!(loaded.deployment_id, doc.deployment_id);
        let mqtt = &loaded.instances[2];
        assert_eq!(mqtt.id, "mqtt-demo-2");
        assert_eq!(mqtt.protocol_id, "mqtt");
        assert!(!mqtt.enabled);
        assert!(mqtt.applied_config.is_none());
        let bytes = std::fs::read(&settings.config).unwrap();
        load(&settings).unwrap();
        assert_eq!(std::fs::read(&settings.config).unwrap(), bytes);
    }
    #[test]
    fn three_protocol_upgrade_adds_telnet_without_touching_existing_ids_or_hashes() {
        let fixture = Fixture::new();
        let settings = fixture.settings();
        let mut doc = load(&settings).unwrap();
        doc.instances
            .retain(|i| ["http", "dns", "mqtt"].contains(&i.protocol_id.as_str()));
        doc.instances[0].id = "telnet-demo".into();
        for i in &mut doc.instances {
            i.enabled = true;
            i.applied_config = Some(i.config.clone());
        }
        let original = serde_json::to_value(&doc.instances).unwrap();
        let hashes = doc
            .instances
            .iter()
            .map(|i| i.config.fingerprint())
            .collect::<Vec<_>>();
        save(&settings.config, &doc).unwrap();
        let loaded = load(&settings).unwrap();
        assert_eq!(
            serde_json::to_value(&loaded.instances[..3]).unwrap(),
            original
        );
        assert_eq!(
            loaded.instances[..3]
                .iter()
                .map(|i| i.config.fingerprint())
                .collect::<Vec<_>>(),
            hashes
        );
        assert_eq!(loaded.deployment_id, doc.deployment_id);
        let telnet = &loaded.instances[3];
        assert_eq!(telnet.id, "telnet-demo-2");
        assert!(!telnet.enabled);
        assert!(telnet.applied_config.is_none());
        let bytes = std::fs::read(&settings.config).unwrap();
        load(&settings).unwrap();
        assert_eq!(std::fs::read(&settings.config).unwrap(), bytes);
    }
    #[test]
    fn four_protocol_upgrade_preserves_live_snapshots_with_iec104_id_collision() {
        let fixture = Fixture::new();
        let settings = fixture.settings();
        let mut doc = load(&settings).unwrap();
        doc.instances
            .retain(|i| ["http", "dns", "mqtt", "telnet"].contains(&i.protocol_id.as_str()));
        doc.instances[0].id = "iec104-demo".into();
        for i in &mut doc.instances {
            i.enabled = true;
            i.applied_config = Some(i.config.clone());
        }
        let original = serde_json::to_value(&doc.instances).unwrap();
        let hashes = doc
            .instances
            .iter()
            .map(|i| i.config.fingerprint())
            .collect::<Vec<_>>();
        save(&settings.config, &doc).unwrap();
        let loaded = load(&settings).unwrap();
        assert_eq!(loaded.deployment_id, doc.deployment_id);
        assert_eq!(
            serde_json::to_value(&loaded.instances[..4]).unwrap(),
            original
        );
        assert_eq!(
            loaded.instances[..4]
                .iter()
                .map(|i| i.config.fingerprint())
                .collect::<Vec<_>>(),
            hashes
        );
        assert_eq!(loaded.instances[4].id, "iec104-demo-2");
        assert!(!loaded.instances[4].enabled && loaded.instances[4].applied_config.is_none());
        let bytes = std::fs::read(&settings.config).unwrap();
        load(&settings).unwrap();
        assert_eq!(std::fs::read(&settings.config).unwrap(), bytes);
    }
    #[test]
    fn five_protocol_upgrade_preserves_snapshots_and_resolves_mqtt_sn_id_collision() {
        let fixture = Fixture::new();
        let settings = fixture.settings();
        let mut doc = load(&settings).unwrap();
        doc.instances.retain(|i| i.protocol_id != "mqtt-sn");
        doc.instances[0].id = "mqtt-sn-demo".into();
        for i in &mut doc.instances {
            i.enabled = true;
            i.applied_config = Some(i.config.clone());
        }
        let original = serde_json::to_value(&doc.instances).unwrap();
        let hashes = doc
            .instances
            .iter()
            .map(|i| i.config.fingerprint())
            .collect::<Vec<_>>();
        save(&settings.config, &doc).unwrap();
        let loaded = load(&settings).unwrap();
        assert_eq!(loaded.deployment_id, doc.deployment_id);
        assert_eq!(
            serde_json::to_value(&loaded.instances[..5]).unwrap(),
            original
        );
        assert_eq!(
            loaded.instances[..5]
                .iter()
                .map(|i| i.config.fingerprint())
                .collect::<Vec<_>>(),
            hashes
        );
        assert_eq!(loaded.instances[5].id, "mqtt-sn-demo-2");
        assert!(!loaded.instances[5].enabled && loaded.instances[5].applied_config.is_none());
        let bytes = std::fs::read(&settings.config).unwrap();
        load(&settings).unwrap();
        assert_eq!(std::fs::read(&settings.config).unwrap(), bytes);
    }
    #[test]
    fn mismatched_protocol_variant_is_rejected_without_migration() {
        let f = Fixture::new();
        let settings = f.settings();
        let mut doc = load(&settings).unwrap();
        doc.instances[0].protocol_id = "dns".into();
        save(&settings.config, &doc).unwrap();
        let bytes = std::fs::read(&settings.config).unwrap();
        assert!(load(&settings).is_err());
        assert_eq!(std::fs::read(&settings.config).unwrap(), bytes);
    }
    #[test]
    fn deployment_mismatch_cannot_claim_resources() {
        let f = Fixture::new();
        let s = f.settings();
        let mut d = load(&s).unwrap();
        d.deployment_id = uuid::Uuid::new_v4().to_string();
        save(&s.config, &d).unwrap();
        assert!(load(&s).is_err());
    }
}
