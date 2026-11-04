use crate::{
    docker,
    model::{Document, HttpConfig},
    storage::{self, Settings},
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

pub struct Data {
    pub doc: Document,
    pub config_error: Option<String>,
    pub docker_error: Option<String>,
    pub docker_version: Option<String>,
    pub events: VecDeque<String>,
    pub tests: std::collections::HashMap<String, crate::testing::TestRun>,
}
pub struct Manager {
    pub settings: Settings,
    pub data: Mutex<Data>,
    pub session_id: String,
}
pub type Shared = Arc<Manager>;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl Manager {
    pub(crate) async fn control(&self) -> Result<std::fs::File> {
        // A read-only reconcile briefly owns the same resource lock. Allow it
        // to finish without surfacing random conflicts for ordinary UI saves.
        for _ in 0..20 {
            if let Ok(lock) = self.settings.lock("control.lock") {
                return Ok(lock);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        self.settings.lock("control.lock")
    }
    pub fn new(settings: Settings) -> Self {
        let (doc, error) = match storage::load(&settings) {
            Ok(d) => (d, None),
            Err(e) => (
                Document {
                    schema_version: 1,
                    deployment_id: String::new(),
                    instances: vec![],
                },
                Some(format!("{e:#}")),
            ),
        };
        Self {
            settings,
            data: Mutex::new(Data {
                doc,
                config_error: error,
                docker_error: Some("Connecting to Docker".into()),
                docker_version: None,
                events: VecDeque::new(),
                tests: crate::testing::empty_results(),
            }),
            session_id: uuid::Uuid::new_v4().to_string(),
        }
    }
    pub fn writable(d: &Data) -> Result<()> {
        if let Some(e) = &d.config_error {
            bail!("configuration is read-only: {e}");
        }
        Ok(())
    }
    pub fn persist(&self, d: &mut Data, mut next: Document) -> Result<()> {
        Self::writable(d)?;
        next.schema_version = 2;
        next.validate()?;
        storage::save(&self.settings.config, &next)?;
        d.doc = next;
        Ok(())
    }
    pub fn event(d: &mut Data, message: String) {
        println!(
            "{}",
            json!({"source":"manager","time":now(),"message":message})
        );
        d.events.push_back(format!("[manager] {} {message}", now()));
        while d.events.len() > 100 {
            d.events.pop_front();
        }
    }
    pub async fn save_config(&self, id: &str, config: HttpConfig) -> Result<Value> {
        let _control = self.control().await?;
        let mut d = self.data.lock().await;
        let mut next = d.doc.clone();
        let i = next
            .instances
            .iter_mut()
            .find(|i| i.id == id)
            .context("instance not found")?;
        i.config = config;
        let view = i.view();
        self.persist(&mut d, next)?;
        Ok(view)
    }
    pub async fn begin(self: &Shared, id: &str, kind: &str) -> Result<String> {
        let control = self.control().await?;
        let operation = uuid::Uuid::new_v4().to_string();
        {
            let mut d = self.data.lock().await;
            let mut next = d.doc.clone();
            let i = next
                .instances
                .iter_mut()
                .find(|i| i.id == id)
                .context("instance not found")?;
            if i.current_operation.is_some() {
                bail!("instance operation already in progress");
            }
            if kind != "stop" {
                i.config.validate()?;
            }
            // Intent is durable before changing any Docker resource.
            i.enabled = kind != "stop";
            i.current_operation = Some(json!({"id":operation,"kind":kind}));
            i.status = if kind == "stop" {
                "stopping"
            } else {
                "starting"
            }
            .into();
            i.retry_count = 0;
            self.persist(&mut d, next)?;
        }
        let manager = self.clone();
        let id = id.to_owned();
        let kind = kind.to_owned();
        tokio::spawn(async move {
            let _control = control;
            let result = manager.execute(&id, &kind, None).await;
            manager.finish(&id, &kind, result).await;
        });
        Ok(operation)
    }
    async fn execute(
        &self,
        id: &str,
        kind: &str,
        restore: Option<HttpConfig>,
    ) -> Result<Option<HttpConfig>> {
        let (deployment, instance) = {
            let d = self.data.lock().await;
            Self::writable(&d)?;
            (
                d.doc.deployment_id.clone(),
                d.doc
                    .instances
                    .iter()
                    .find(|i| i.id == id)
                    .context("instance not found")?
                    .clone(),
            )
        };
        let resources = docker::owned(&deployment, Some(id)).await?;
        if resources.len() > 1 {
            bail!("multiple owned resources found; refusing ambiguous automatic cleanup");
        }
        if kind == "stop" {
            for v in resources {
                docker::remove(&v, &deployment, id).await?;
            }
            return Ok(None);
        }
        let config = restore.unwrap_or(instance.config.clone());
        config.validate()?;
        // Resolve image before stopping an existing service; start never pulls.
        let prepared_image = docker::prepare_image(&self.settings.image, &config)
            .await
            .context("HTTP image is missing or incompatible; build/import matching assets first")?;
        if let Some(existing) = resources.first() {
            if kind != "restart" && docker::running(existing) && docker::matches(existing, &config)
            {
                docker::probe(&config).await?;
                self.record_container(id, docker::container_id(existing)?)
                    .await;
                return Ok(Some(config));
            }
            if docker::running(existing)
                && instance
                    .applied_config
                    .as_ref()
                    .is_none_or(|c| !docker::matches(existing, c))
            {
                bail!(
                    "owned container configuration drift; refusing to stop an unrecognized resource"
                );
            }
        }
        let own_endpoint = resources
            .first()
            .filter(|v| docker::running(v))
            .and(instance.applied_config.as_ref());
        docker::preflight_port(&config, own_endpoint).await?;
        for v in &resources {
            docker::remove(v, &deployment, id).await?;
        }
        let container = docker::start(&deployment, id, &config, &prepared_image).await?;
        let mut ready_error = "HTTP worker did not become ready".to_owned();
        for _ in 0..40 {
            match docker::probe(&config).await {
                Ok(()) => {
                    let owned = docker::owned(&deployment, Some(id)).await?;
                    if owned.len() == 1
                        && docker::running(&owned[0])
                        && docker::container_id(&owned[0])? == container
                    {
                        self.record_container(id, container.clone()).await;
                        return Ok(Some(config));
                    }
                    break;
                }
                Err(e) => ready_error = e.to_string(),
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        // Roll back only the exact resource created by this operation.
        for v in docker::owned(&deployment, Some(id)).await? {
            if docker::container_id(&v)? == container {
                docker::remove(&v, &deployment, id).await?;
            }
        }
        bail!("HTTP readiness failed: {ready_error}")
    }
    async fn record_container(&self, id: &str, container: String) {
        let mut d = self.data.lock().await;
        if let Some(i) = d.doc.instances.iter_mut().find(|i| i.id == id) {
            i.container_id = Some(container);
        }
    }
    async fn finish(&self, id: &str, kind: &str, result: Result<Option<HttpConfig>>) {
        let mut d = self.data.lock().await;
        let mut next = d.doc.clone();
        if let Some(i) = next.instances.iter_mut().find(|i| i.id == id) {
            let operation_id = i
                .current_operation
                .as_ref()
                .and_then(|op| op.get("id"))
                .cloned();
            i.current_operation = None;
            match result {
                Ok(config) => {
                    if let Some(c) = config {
                        i.applied_config = Some(c);
                    }
                    i.status = if kind == "stop" { "stopped" } else { "running" }.into();
                    if kind == "stop" {
                        i.container_id = None;
                    }
                    i.error = None;
                    i.retry_count = 0;
                    i.last_result =
                        Some(json!({"operation_id":operation_id,"kind":kind,"success":true}));
                }
                Err(e) => {
                    let message = format!("{e:#}");
                    i.status = "error".into();
                    i.error = Some(message.clone());
                    i.retry_count += 1;
                    i.retry_after = now() + 2u64.pow(i.retry_count.min(5));
                    i.last_result = Some(
                        json!({"operation_id":operation_id,"kind":kind,"success":false,"error":message}),
                    );
                }
            }
        }
        if let Err(e) = self.persist(&mut d, next) {
            d.config_error = Some(format!("cannot persist operation result: {e:#}"));
        }
        Self::event(&mut d, format!("{id}: {kind} completed"));
    }
    pub async fn monitor(self: Shared) {
        loop {
            match docker::available().await {
                Err(e) => {
                    let mut d = self.data.lock().await;
                    d.docker_error = Some(format!("{e:#}"));
                    d.docker_version = None;
                    for i in &mut d.doc.instances {
                        if i.current_operation.is_none() {
                            i.status = "environment-unavailable".into();
                        }
                    }
                }
                Ok(version) => {
                    let (deployment, ids, blocked) = {
                        let mut d = self.data.lock().await;
                        d.docker_error = None;
                        d.docker_version = Some(version.trim().into());
                        (
                            d.doc.deployment_id.clone(),
                            d.doc
                                .instances
                                .iter()
                                .map(|i| i.id.clone())
                                .collect::<Vec<_>>(),
                            d.config_error.is_some(),
                        )
                    };
                    if !blocked {
                        if let Err(e) = crate::testing::reap_stale(&self, &deployment).await {
                            let mut d = self.data.lock().await;
                            Self::event(&mut d, format!("interrupted client cleanup: {e:#}"));
                        }
                        for id in ids {
                            if let Err(e) = self.reconcile(&deployment, &id).await {
                                let mut d = self.data.lock().await;
                                if let Some(i) = d.doc.instances.iter_mut().find(|i| i.id == id) {
                                    i.status = "environment-unavailable".into();
                                    i.runtime_error =
                                        Some(format!("cannot verify container state: {e:#}"));
                                }
                                Self::event(&mut d, format!("{id}: reconcile: {e:#}"));
                            }
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
    async fn reconcile(self: &Shared, deployment: &str, id: &str) -> Result<()> {
        let Ok(control) = self.settings.lock("control.lock") else {
            return Ok(());
        };
        let resources = docker::owned(deployment, Some(id)).await?;
        let mut recover = None;
        {
            let mut d = self.data.lock().await;
            let i = d
                .doc
                .instances
                .iter_mut()
                .find(|i| i.id == id)
                .context("instance not found")?;
            if i.current_operation.is_some() {
                return Ok(());
            }
            i.runtime_error = None;
            i.container_id = resources.first().and_then(|v| docker::container_id(v).ok());
            if resources.len() > 1 {
                i.status = "error".into();
                i.error = Some("multiple owned containers found".into());
                return Ok(());
            }
            if let Some(v) = resources.first().filter(|v| docker::running(v)) {
                if !i.enabled {
                    i.status = "error".into();
                    i.error = Some(
                        "disabled instance has a residual running container; stop to clean up"
                            .into(),
                    );
                    return Ok(());
                }
                if let Some(applied) = &i.applied_config
                    && docker::matches(v, applied)
                {
                    i.status = "running".into();
                    // Preserve explicit failed-operation diagnostics until a successful retry.
                    return Ok(());
                }
                i.status = "error".into();
                i.error = Some("container found without a matching successfully applied snapshot; explicit retry required".into());
                return Ok(());
            }
            if !i.enabled {
                i.status = if resources.is_empty() {
                    "stopped"
                } else {
                    "error"
                }
                .into();
                return Ok(());
            }
            if let Some(config) = &i.applied_config {
                if i.retry_count < 5 && now() >= i.retry_after {
                    recover = Some(config.clone());
                    i.status = "starting".into();
                    i.current_operation = Some(json!({"id":uuid::Uuid::new_v4(),"kind":"restore"}));
                } else if i.retry_count >= 5 {
                    i.status = "error".into();
                }
            } else {
                i.status = "error".into();
                if i.error.is_none() {
                    i.error =
                        Some("no successful applied configuration; explicit start required".into());
                }
            }
        }
        if let Some(config) = recover {
            let result = self.execute(id, "restore", Some(config)).await;
            self.finish(id, "restore", result).await;
        }
        drop(control);
        Ok(())
    }
    pub async fn logs(&self, id: &str) -> Result<Vec<String>> {
        let (deployment, mut lines) = {
            let d = self.data.lock().await;
            if !d.doc.instances.iter().any(|i| i.id == id) {
                bail!("instance not found");
            }
            (
                d.doc.deployment_id.clone(),
                d.events
                    .iter()
                    .filter(|l| l.contains(&format!("{id}:")))
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        };
        match docker::owned(&deployment, Some(id)).await {
            Ok(resources) => {
                if let Some(v) = resources.first() {
                    let cid = docker::container_id(v)?;
                    let output =
                        docker::cmd(&["logs", "--tail", "200", "--timestamps", &cid]).await?;
                    lines.extend(
                        output
                            .lines()
                            .map(|s| s.chars().take(4096).collect::<String>()),
                    );
                }
            }
            Err(e) => lines.push(format!("Docker logs unavailable: {e:#}")),
        }
        if lines.len() > 250 {
            lines.drain(..lines.len() - 250);
        }
        Ok(lines)
    }
}
