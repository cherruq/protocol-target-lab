use crate::{
    docker,
    manager::Shared,
    model::{HTTP_METHODS, ProtocolConfig},
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{io::AsyncReadExt, process::Command};

const TEST: &str = "io.protocol-target-lab.test";
const RUN: &str = "io.protocol-target-lab.test-run";
const SESSION: &str = "io.protocol-target-lab.session";
const REPORT_LIMIT: u64 = 128 * 1024;
pub const PATHS: [&str; 27] = [
    "/ok",
    "/chunked",
    "/close",
    "/head",
    "/health",
    "/chunk-extension",
    "/split-length",
    "/flood",
    "/no-content",
    "/not-modified",
    "/informational",
    "/truncated",
    "/chunk-truncated",
    "/invalid-status",
    "/status-099",
    "/invalid-chunk",
    "/conflicting-length",
    "/negative-length",
    "/informational-error",
    "/only-informational",
    "/not-found",
    "/server-error",
    "/stall",
    "/auth/basic",
    "/auth/cookie",
    "/auth/header",
    "/auth/query",
];
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Serialize)]
pub struct TestRun {
    pub id: String,
    pub instance_id: String,
    pub method: String,
    pub path: String,
    pub status: String,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub container_name: String,
    pub source_container_id: String,
    pub applied_config: ProtocolConfig,
    pub report: Option<Value>,
    pub error: Option<String>,
    pub cleanup_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestRequest {
    pub method: String,
    pub path: String,
}
impl TestRequest {
    pub fn validate_for(&self, config: &ProtocolConfig) -> Result<()> {
        match config {
            ProtocolConfig::Http(_) => self.validate(),
            ProtocolConfig::Profinet(c) => {
                if self.path != crate::profinet::PATH {
                    bail!("config.test: choose suite path");
                }
                c.test_budget(&self.method)?;
                Ok(())
            }
            ProtocolConfig::Mpls(c) => {
                if self.path != crate::mpls::PATH {
                    bail!("config.test: choose echo path");
                }
                c.test_budget(&self.method)?;
                Ok(())
            }
            ProtocolConfig::Igmp(c) => {
                if self.path != crate::igmp::PATH {
                    bail!("config.test: choose membership path");
                }
                c.rounds(&self.method)?;
                Ok(())
            }
            ProtocolConfig::CustomEthernet(c) => {
                if self.path != crate::custom_ethernet::PATH {
                    bail!("config.test: choose frame path")
                };
                c.test_budget(&self.method)?;
                Ok(())
            }
            ProtocolConfig::ArpClient(c) => {
                if self.path != crate::arp_client::PATH {
                    bail!("config.test: choose inverse-peer path");
                }
                c.test_budget(&self.method)?;
                Ok(())
            }
            ProtocolConfig::Vxlan(_) => {
                if !crate::vxlan::CASES.contains(&self.method.as_str())
                    || self.path != crate::vxlan::PATH
                {
                    bail!(
                        "config.test: choose VXLAN ARP/RESERVED_BITS/REQUEST_THA/INVALID_REQUEST/ALL and arp path"
                    );
                }
                Ok(())
            }
            ProtocolConfig::Bfd(c) => {
                if !c.cases().contains(&self.method.as_str()) || self.path != crate::bfd::PATH {
                    bail!(
                        "config.test: choose the current applied BFD scenario or ALL and session path"
                    );
                }
                c.test_budget()?;
                Ok(())
            }
            ProtocolConfig::Iec101(_) => {
                if !crate::iec101::CASES.contains(&self.method.as_str())
                    || !crate::iec101::PATHS.contains(&self.path.as_str())
                {
                    bail!("config.test: choose an IEC101 case and dual/single/double path");
                }
                Ok(())
            }
            ProtocolConfig::Dlt645(c) => {
                if !c.cases().contains(&self.method.as_str()) || self.path != crate::dlt645::PATH {
                    bail!(
                        "config.test: choose an available DL/T645 case and meter path; optional cases require applied permissions/fixture"
                    );
                }
                Ok(())
            }
            ProtocolConfig::Rtcp(_) => {
                if !crate::rtcp::CASES.contains(&self.method.as_str())
                    || self.path != crate::rtcp::PATH
                {
                    bail!("config.test: choose available RTCP case and session path");
                }
                Ok(())
            }
            ProtocolConfig::Rtp(_) => {
                if !crate::rtp::CASES.contains(&self.method.as_str())
                    || self.path != crate::rtp::PATH
                {
                    bail!("config.test: choose an available RTP case and stream path");
                }
                Ok(())
            }
            ProtocolConfig::MqttSn(_) => {
                if !crate::mqtt_sn::CASES.contains(&self.method.as_str())
                    || self.path != crate::mqtt_sn::PATH
                {
                    bail!("config.test: choose an available MQTT-SN case and plab/test path");
                }
                Ok(())
            }
            ProtocolConfig::Iec104(_) => {
                if !crate::iec104::CASES.contains(&self.method.as_str())
                    || self.path != crate::iec104::PATH
                {
                    bail!("config.test: choose an available IEC104 case and station path");
                }
                Ok(())
            }
            ProtocolConfig::Telnet(_) => {
                if !crate::telnet::CASES.contains(&self.method.as_str())
                    || self.path != crate::telnet::PATH
                {
                    bail!("config.test: choose an available Telnet case and session path");
                }
                Ok(())
            }
            ProtocolConfig::Mqtt(c) => {
                if !crate::mqtt::CASES.contains(&self.method.as_str())
                    || self.path != crate::mqtt::TEST_TOPIC
                {
                    bail!(
                        "config.test: choose an available MQTT version/QoS case and plab/test topic prefix"
                    );
                }
                if c.max_connections < 2 {
                    bail!(
                        "config.max_connections: independent publisher/subscriber testing requires at least 2 connections"
                    );
                }
                Ok(())
            }
            ProtocolConfig::Dns(c) => {
                if self.method != "ALL" && !c.transports().contains(&self.method.as_str()) {
                    bail!("config.test.method: choose an enabled DNS transport or ALL");
                }
                if self.path != "ALL"
                    && !(if c.response_profile == "legacy-fixtures" {
                        crate::dns::fixture_paths(c).contains(&self.path)
                    } else {
                        c.names().contains(&crate::dns::canonical_name(&self.path))
                    })
                {
                    bail!("config.test.path: choose ALL or a configured DNS name");
                }
                if c.response_profile == "legacy-fixtures"
                    && self.path != "ALL"
                    && self.method != "ALL"
                    && ((self.path.starts_with("stream/") && self.method == "UDP")
                        || (!self.path.starts_with("stream/") && self.method != "UDP"))
                {
                    bail!("config.test: fixture does not support selected transport");
                }
                Ok(())
            }
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.method != "ALL" && !HTTP_METHODS.contains(&self.method.as_str()) {
            bail!("method: choose a supported HTTP method or ALL");
        }
        if !PATHS.contains(&self.path.as_str()) {
            bail!("path: choose a supported HTTP test path");
        }
        if !["/ok", "/chunked", "/close"].contains(&self.path.as_str()) {
            let expected = if ["/head", "/health"].contains(&self.path.as_str()) {
                "HEAD"
            } else {
                "GET"
            };
            if self.method != "ALL" && self.method != expected {
                bail!("config.test.method: selected fixed scenario requires {expected} or ALL");
            }
        }
        Ok(())
    }
}

async fn test_containers(deployment: &str) -> Result<Vec<Value>> {
    let ids = docker::cmd(&[
        "ps",
        "-aq",
        "--filter",
        &format!("label={}={deployment}", docker::OWNER),
        "--filter",
        &format!("label={TEST}=true"),
    ])
    .await?;
    if ids.trim().is_empty() {
        return Ok(vec![]);
    }
    let mut result = vec![];
    for id in ids.split_whitespace() {
        match docker::cmd(&["inspect", id]).await {
            Ok(text) => result.extend(serde_json::from_str::<Vec<Value>>(&text)?),
            Err(e) if e.to_string().contains("No such") => {}
            Err(e) => return Err(e),
        }
    }
    Ok(result)
}
async fn remove_test(v: &Value, deployment: &str, run_id: &str) -> Result<()> {
    let cid = docker::container_id(v)?;
    let current = match docker::cmd(&["inspect", &cid]).await {
        Ok(text) => serde_json::from_str::<Vec<Value>>(&text)?,
        Err(e) if e.to_string().contains("No such") => return Ok(()),
        Err(e) => return Err(e),
    };
    let labels = &current[0]["Config"]["Labels"];
    if labels[docker::OWNER].as_str() != Some(deployment)
        || labels[TEST].as_str() != Some("true")
        || labels[RUN].as_str() != Some(run_id)
        || labels["io.protocol-target-lab.managed"].as_str() == Some("true")
    {
        bail!("refusing cleanup of a container with mismatched test ownership");
    }
    match docker::cmd(&["rm", "--force", &cid]).await {
        Ok(_) => Ok(()),
        Err(e) if e.to_string().contains("No such") => Ok(()),
        Err(e) => Err(e),
    }
}
pub async fn cleanup_tests(deployment: &str, keep_session: Option<&str>) -> Result<Vec<Value>> {
    let mut cleaned = vec![];
    for v in test_containers(deployment).await? {
        if keep_session.is_some_and(|s| v["Config"]["Labels"][SESSION].as_str() == Some(s)) {
            continue;
        }
        let run = v["Config"]["Labels"][RUN]
            .as_str()
            .context("test container has no run identity; refusing cleanup")?;
        uuid::Uuid::parse_str(run).context("invalid test run identity")?;
        remove_test(&v, deployment, run).await?;
        cleaned.push(v);
    }
    Ok(cleaned)
}
pub async fn reap_stale(manager: &Shared, deployment: &str) -> Result<()> {
    let Ok(_control) = manager.settings.lock("control.lock") else {
        return Ok(());
    };
    let cleaned = cleanup_tests(deployment, Some(&manager.session_id)).await?;
    if !cleaned.is_empty() {
        let mut d = manager.data.lock().await;
        crate::manager::Manager::event(
            &mut d,
            format!(
                "cleaned {} interrupted one-shot client containers",
                cleaned.len()
            ),
        );
    }
    let pending = {
        let d = manager.data.lock().await;
        d.tests
            .values()
            .filter(|t| t.status != "running" && !t.cleanup_complete)
            .map(|t| (t.instance_id.clone(), t.id.clone()))
            .collect::<Vec<_>>()
    };
    for (instance, id) in pending {
        cleanup_run(deployment, &id).await?;
        let mut d = manager.data.lock().await;
        if let Some(t) = d.tests.get_mut(&instance).filter(|t| t.id == id) {
            t.cleanup_complete = true;
        }
    }
    Ok(())
}

pub async fn begin(manager: &Shared, instance_id: &str, request: TestRequest) -> Result<String> {
    let control = manager.control().await?;
    let (deployment, instance) = {
        let d = manager.data.lock().await;
        if d.tests.values().any(|t| t.status == "running") {
            bail!("another client test is already running");
        }
        let instance = d
            .doc
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .context("instance not found")?
            .clone();
        if !instance.enabled || instance.status != "running" || instance.current_operation.is_some()
        {
            bail!("instance must be running and idle before client testing");
        }
        (d.doc.deployment_id.clone(), instance)
    };
    let config = instance
        .applied_config
        .context("instance has no applied configuration")?;
    request.validate_for(&config)?;
    let resources = docker::owned(&deployment, Some(instance_id)).await?;
    if resources.len() != 1
        || !docker::running(&resources[0])
        || !docker::matches(&resources[0], &config)
    {
        bail!("no unique running target matches the applied configuration");
    }
    let source_id = docker::container_id(&resources[0])?;
    let image_id = docker::image_id(manager.settings.image_for(&instance.protocol_id))
        .await
        .context("client image is unavailable; import the matching protocol image")?;
    let metadata: Vec<Value> =
        serde_json::from_str(&docker::cmd(&["image", "inspect", &image_id]).await?)?;
    let capability = format!(
        "io.protocol-target-lab.{}-client-schema",
        instance.protocol_id
    );
    if metadata[0]["Config"]["Labels"][&capability].as_str() != Some("1") {
        bail!(
            "configured image has no built-in protocol client; import matching assets before testing"
        );
    }
    let extension_test = matches!(&config, ProtocolConfig::Http(c) if c.tls_enabled || !["/ok","/chunked","/close"].contains(&request.path.as_str()))
        || matches!(&config, ProtocolConfig::Dns(c) if c.requires_extensions());
    if extension_test
        && (metadata[0]["Config"]["Labels"]["io.protocol-target-lab.tls-scenarios"] != "1"
            || resources[0]["Config"]["Labels"]["io.protocol-target-lab.tls-scenarios"] != "1")
    {
        bail!(
            "config.test: source and client require TLS/scenario assets; save configuration and restart explicitly"
        );
    }
    if let ProtocolConfig::Profinet(c) = &config {
        if resources[0]["Image"] != image_id {
            bail!(
                "config.test: PROFINET client image differs from actual source; restart explicitly"
            );
        }
        crate::profinet_link::snapshot(&manager.settings, &deployment, instance_id, &source_id, c)
            .await?;
        crate::profinet_link::client_preflight(
            &manager.settings,
            &deployment,
            instance_id,
            &source_id,
            c,
            &request.method,
        )
        .await?;
    }
    if let ProtocolConfig::Mpls(c) = &config {
        if resources[0]["Image"] != image_id {
            bail!("config.test: MPLS client image differs from actual source; restart explicitly");
        }
        crate::mpls_l2::snapshot(&deployment, instance_id, &source_id, c).await?;
        crate::mpls_l2::client_preflight(&deployment, instance_id, &source_id, c, &request.method)
            .await?;
    }
    if let ProtocolConfig::Igmp(c) = &config {
        if resources[0]["Image"] != image_id {
            bail!(
                "config.test: IGMP peer image differs from actual source; restart explicitly to apply configured image"
            );
        }
        crate::igmp_link::client_preflight(
            &manager.settings,
            &deployment,
            instance_id,
            &source_id,
            c,
            &request.method,
        )
        .await?;
    }
    if let ProtocolConfig::Bfd(c) = &config {
        if resources[0]["Image"] != image_id {
            bail!(
                "config.test: BFD client image differs from running source image; restart explicitly to apply the configured image"
            );
        }
        let state = crate::bfd::snapshot(&deployment, instance_id, &source_id, c).await?;
        crate::bfd::client_preflight(c, &state).await?;
    }
    if let ProtocolConfig::Vxlan(c) = &config {
        if resources[0]["Image"] != image_id {
            bail!(
                "config.test: VXLAN client image differs from running source image; restart explicitly to apply configured image"
            );
        }
        crate::vxlan::snapshot(&deployment, instance_id, &source_id, c).await?;
        crate::vxlan::client_preflight(c).await?;
    }
    if let ProtocolConfig::CustomEthernet(c) = &config {
        if resources[0]["Image"] != image_id {
            bail!(
                "config.test: custom Ethernet peer image differs from actual source; restart explicitly to apply image"
            );
        }
        crate::custom_l2::snapshot(&deployment, instance_id, &source_id, c).await?;
        crate::custom_l2::client_preflight(
            &deployment,
            instance_id,
            &source_id,
            c,
            &request.method,
        )
        .await?;
    }
    if let ProtocolConfig::ArpClient(c) = &config {
        if resources[0]["Image"] != image_id {
            bail!(
                "config.test: inverse peer image differs from actual source; restart explicitly to apply image"
            );
        }
        crate::l2::snapshot(&deployment, instance_id, &source_id, c).await?;
        crate::l2::client_preflight(&deployment, instance_id, &source_id, c, &request.method)
            .await?;
    }
    cleanup_tests(&deployment, None)
        .await
        .context("cannot clean previous client resources")?;
    let id = uuid::Uuid::new_v4().to_string();
    let run = TestRun {
        id: id.clone(),
        instance_id: instance_id.into(),
        method: request.method,
        path: request.path,
        status: "running".into(),
        started_at: now(),
        finished_at: None,
        container_name: format!("plab-test-{}-{}", &deployment[..8], &id),
        source_container_id: source_id,
        applied_config: config,
        report: None,
        error: None,
        cleanup_complete: false,
        progress: None,
    };
    {
        let mut d = manager.data.lock().await;
        if d.tests.len() >= 64
            && !d.tests.contains_key(instance_id)
            && let Some(old) = d
                .tests
                .iter()
                .min_by_key(|(_, t)| t.started_at)
                .map(|(id, _)| id.clone())
        {
            d.tests.remove(&old);
        }
        d.tests.insert(instance_id.into(), run.clone());
    }
    let manager = manager.clone();
    tokio::spawn(async move {
        let _control = control;
        let outcome = run_client(&manager, &deployment, &image_id, &run).await;
        let cleanup = if matches!(
            run.applied_config,
            ProtocolConfig::Igmp(_) | ProtocolConfig::Mpls(_) | ProtocolConfig::Profinet(_)
        ) {
            tokio::time::timeout(
                Duration::from_millis(if matches!(run.applied_config,ProtocolConfig::Profinet(_)){crate::profinet::CLEANUP_BUDGET_MS}else{crate::igmp::CLEANUP_BUDGET_MS}),
                cleanup_run(&deployment, &run.id),
            ).await.unwrap_or_else(|_|Err(anyhow::anyhow!("exact-owned peer cleanup exceeded5-second reserve; completion is unconfirmed and retained for the owned-resource reaper")))
        } else {
            cleanup_run(&deployment, &run.id).await
        };
        let mut d = manager.data.lock().await;
        if let Some(current) = d.tests.get_mut(&run.instance_id).filter(|t| t.id == run.id) {
            current.finished_at = Some(now());
            match outcome {
                Ok(report) => {
                    current.status = if report["passed"] == true {
                        "passed"
                    } else {
                        "failed"
                    }
                    .into();
                    current.report = Some(report);
                }
                Err(e) => {
                    current.status = "error".into();
                    current.error = Some(format!("{e:#}"));
                }
            }
            match cleanup {
                Ok(()) => current.cleanup_complete = true,
                Err(e) => {
                    current.status = "error".into();
                    current.error = Some(format!(
                        "{}; temporary container cleanup failed: {e:#}",
                        current.error.as_deref().unwrap_or("test completed")
                    ));
                }
            }
        }
        crate::manager::Manager::event(
            &mut d,
            format!("{}: client {} test completed", run.instance_id, run.method),
        );
    });
    Ok(id)
}
async fn cleanup_run(deployment: &str, run_id: &str) -> Result<()> {
    for v in test_containers(deployment).await? {
        if v["Config"]["Labels"][RUN].as_str() == Some(run_id) {
            remove_test(&v, deployment, run_id).await?;
        }
    }
    Ok(())
}
async fn run_client(
    manager: &Shared,
    deployment: &str,
    image: &str,
    run: &TestRun,
) -> Result<Value> {
    if matches!(run.applied_config, ProtocolConfig::Profinet(_)) {
        return crate::profinet_testing::run(manager, deployment, image, run).await;
    }
    if matches!(run.applied_config, ProtocolConfig::Mpls(_)) {
        return crate::mpls_testing::run(manager, deployment, image, run).await;
    }
    if matches!(run.applied_config, ProtocolConfig::Igmp(_)) {
        return crate::igmp_testing::run(manager, deployment, image, run).await;
    }
    let custom_execution = if let ProtocolConfig::CustomEthernet(c) = &run.applied_config {
        let before = docker::owned(deployment, Some(&run.instance_id)).await?;
        if before.len() != 1 || before[0]["Image"] != image {
            bail!("custom Ethernet source image changed before peer execution");
        }
        let state =
            crate::custom_l2::snapshot(deployment, &run.instance_id, &run.source_container_id, c)
                .await?;
        let (view, interface) = crate::custom_l2::client_preflight(
            deployment,
            &run.instance_id,
            &run.source_container_id,
            c,
            &run.method,
        )
        .await?;
        Some((
            view,
            interface,
            state,
            before[0]["State"]["Pid"].clone(),
            before[0]["State"]["StartedAt"].clone(),
        ))
    } else {
        None
    };
    let arp_execution = if let ProtocolConfig::ArpClient(c) = &run.applied_config {
        let before = docker::owned(deployment, Some(&run.instance_id)).await?;
        if before.len() != 1 || before[0]["Image"] != image {
            bail!("ARP source image changed before peer execution");
        }
        let state =
            crate::l2::snapshot(deployment, &run.instance_id, &run.source_container_id, c).await?;
        let (view, interface) = crate::l2::client_preflight(
            deployment,
            &run.instance_id,
            &run.source_container_id,
            c,
            &run.method,
        )
        .await?;
        Some((
            view,
            interface,
            state,
            before[0]["State"]["Pid"].clone(),
            before[0]["State"]["StartedAt"].clone(),
        ))
    } else {
        None
    };
    let mut args = vec![
        "run".into(),
        "--rm".into(),
        "--name".into(),
        run.container_name.clone(),
        "--network".into(),
        arp_execution
            .as_ref()
            .and_then(|(view, _, _, _, _)| view.network_id.clone())
            .or_else(|| {
                custom_execution
                    .as_ref()
                    .and_then(|(view, _, _, _, _)| view.network_id.clone())
            })
            .unwrap_or_else(|| "host".into()),
        "--restart".into(),
        "no".into(),
        "--pull".into(),
        "never".into(),
        "--log-driver".into(),
        "json-file".into(),
        "--log-opt".into(),
        "max-size=1m".into(),
        "--log-opt".into(),
        "max-file=1".into(),
        "--label".into(),
        format!("{}={deployment}", docker::OWNER),
        "--label".into(),
        format!("{}={}", docker::INSTANCE, run.instance_id),
        "--label".into(),
        format!("{TEST}=true"),
        "--label".into(),
        format!("{RUN}={}", run.id),
        "--label".into(),
        format!("{SESSION}={}", manager.session_id),
        "--entrypoint".into(),
        "python3".into(),
        image.into(),
        "-u".into(),
        "/opt/protocol-target-lab/client.py".into(),
        "--method".into(),
        run.method.clone(),
        "--path".into(),
        run.path.clone(),
    ];
    if let Some(endpoint) = run.applied_config.ip_endpoint() {
        args.extend([
            "--host".into(),
            endpoint.probe_ip().into(),
            "--port".into(),
            endpoint.port.to_string(),
        ]);
    }
    match &run.applied_config {
        ProtocolConfig::Igmp(_) => unreachable!("IGMP uses dedicated bounded progress runner"),
        ProtocolConfig::Profinet(_) => unreachable!("PROFINET uses dedicated bounded peer runner"),
        ProtocolConfig::Mpls(c) => args.extend(crate::mpls::config_args(c)?),
        ProtocolConfig::CustomEthernet(c) => args.extend(crate::custom_ethernet::config_args(c)?),
        ProtocolConfig::Dns(_)
        | ProtocolConfig::Mqtt(_)
        | ProtocolConfig::Telnet(_)
        | ProtocolConfig::Iec104(_)
        | ProtocolConfig::MqttSn(_)
        | ProtocolConfig::Rtp(_)
        | ProtocolConfig::Rtcp(_)
        | ProtocolConfig::Dlt645(_)
        | ProtocolConfig::Iec101(_)
        | ProtocolConfig::Bfd(_)
        | ProtocolConfig::Vxlan(_)
        | ProtocolConfig::ArpClient(_) => args.extend([
            "--config-json".into(),
            serde_json::to_string(&run.applied_config)?,
        ]),
        ProtocolConfig::Http(c) => {
            if c.tls_enabled {
                args.push("--tls".into());
            }
            if let Some(body) = &c.legacy_body {
                args.push(format!("--legacy-body={body}"));
            } else {
                args.extend([
                    "--response-length".into(),
                    c.response_length.to_string(),
                    "--response-mode".into(),
                    c.response_mode.as_str().into(),
                ]);
            }
        }
    }
    if let (ProtocolConfig::CustomEthernet(c), Some((view, interface, state, _, _))) =
        (&run.applied_config, &custom_execution)
    {
        let index = args
            .iter()
            .position(|s| s == image)
            .context("peer image argument missing")?;
        let mut flags = vec![
            "--user".into(),
            "0:0".into(),
            "--cap-drop".into(),
            "ALL".into(),
            "--cap-add".into(),
            "NET_RAW".into(),
            "--ipc".into(),
            "private".into(),
            "--label".into(),
            format!(
                "{}={}",
                crate::custom_l2::TEST_SOURCE,
                run.source_container_id
            ),
            "--label".into(),
            format!(
                "{}={}",
                crate::custom_l2::PARENT_NONCE,
                state["runtime_id"]
                    .as_str()
                    .context("custom Ethernet runtime missing")?
            ),
        ];
        if c.link.is_bridge() {
            flags.extend(["--mac-address".into(), c.peer_mac.clone()]);
        }
        args.splice(index..index, flags);
        args.extend([
            "--interface".into(),
            interface.clone(),
            "--observer-host".into(),
            view.observer_host.clone(),
            "--observer-port".into(),
            crate::custom_ethernet::OBSERVER_PORT.to_string(),
            "--expected-boot-id".into(),
            state["boot_id"]
                .as_str()
                .context("custom Ethernet boot missing")?
                .into(),
            "--expected-runtime-id".into(),
            state["runtime_id"]
                .as_str()
                .context("custom Ethernet runtime missing")?
                .into(),
        ]);
    }
    if let (ProtocolConfig::ArpClient(c), Some((view, interface, state, _, _))) =
        (&run.applied_config, &arp_execution)
    {
        let index = args
            .iter()
            .position(|s| s == image)
            .context("peer image argument missing")?;
        let mut flags = vec![
            "--user".into(),
            "0:0".into(),
            "--cap-drop".into(),
            "ALL".into(),
            "--cap-add".into(),
            "NET_RAW".into(),
            "--ipc".into(),
            "private".into(),
            "--label".into(),
            format!("{}={}", crate::l2::TEST_SOURCE, run.source_container_id),
            "--label".into(),
            format!(
                "{}={}",
                crate::l2::PARENT_NONCE,
                state["runtime_id"]
                    .as_str()
                    .context("ARP runtime missing")?
            ),
        ];
        if c.link.is_bridge() {
            flags.extend(["--mac-address".into(), c.server_mac.clone()]);
        }
        args.splice(index..index, flags);
        args.extend([
            "--interface".into(),
            interface.clone(),
            "--observer-host".into(),
            view.observer_host.clone(),
            "--observer-port".into(),
            crate::arp_client::OBSERVER_PORT.to_string(),
            "--expected-boot-id".into(),
            state["boot_id"]
                .as_str()
                .context("ARP boot missing")?
                .into(),
            "--expected-runtime-id".into(),
            state["runtime_id"]
                .as_str()
                .context("ARP runtime missing")?
                .into(),
        ]);
    }
    let mut bfd_identity = None;
    if let ProtocolConfig::Bfd(c) = &run.applied_config {
        let before = docker::owned(deployment, Some(&run.instance_id)).await?;
        if before.len() != 1 || before[0]["Image"] != image {
            bail!("BFD source image changed before client execution");
        }
        let state =
            crate::bfd::snapshot(deployment, &run.instance_id, &run.source_container_id, c).await?;
        let interface = crate::bfd::client_preflight(c, &state).await?;
        let index = args
            .iter()
            .position(|s| s == image)
            .context("client image argument missing")?;
        args.splice(
            index..index,
            [
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_RAW".into(),
                "--ipc".into(),
                "private".into(),
            ],
        );
        args.extend([
            "--interface".into(),
            interface,
            "--observer-host".into(),
            "127.0.0.1".into(),
            "--observer-port".into(),
            crate::bfd::OBSERVER_PORT.to_string(),
            "--expected-boot-id".into(),
            state["boot_id"]
                .as_str()
                .context("BFD boot missing")?
                .into(),
            "--expected-runtime-id".into(),
            state["runtime_id"]
                .as_str()
                .context("BFD runtime missing")?
                .into(),
        ]);
        bfd_identity = Some((
            before[0]["State"]["Pid"].clone(),
            before[0]["State"]["StartedAt"].clone(),
            state["boot_id"].clone(),
            state["runtime_id"].clone(),
        ));
    }
    let mut vxlan_identity = None;
    if let ProtocolConfig::Vxlan(c) = &run.applied_config {
        let before = docker::owned(deployment, Some(&run.instance_id)).await?;
        if before.len() != 1 || before[0]["Image"] != image {
            bail!("VXLAN source image changed before client execution");
        }
        let state =
            crate::vxlan::snapshot(deployment, &run.instance_id, &run.source_container_id, c)
                .await?;
        crate::vxlan::client_preflight(c).await?;
        let index = args
            .iter()
            .position(|s| s == image)
            .context("client image argument missing")?;
        args.splice(
            index..index,
            [
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_BIND_SERVICE".into(),
                "--ipc".into(),
                "private".into(),
            ],
        );
        args.extend([
            "--observer-host".into(),
            "127.0.0.1".into(),
            "--observer-port".into(),
            crate::vxlan::OBSERVER_PORT.to_string(),
            "--expected-boot-id".into(),
            state["boot_id"]
                .as_str()
                .context("VXLAN boot missing")?
                .into(),
            "--expected-runtime-id".into(),
            state["runtime_id"]
                .as_str()
                .context("VXLAN runtime missing")?
                .into(),
        ]);
        vxlan_identity = Some((
            before[0]["State"]["Pid"].clone(),
            before[0]["State"]["StartedAt"].clone(),
            state["boot_id"].clone(),
            state["runtime_id"].clone(),
        ));
    }
    let mut iec101_identity = None;
    if let ProtocolConfig::Iec101(c) = &run.applied_config {
        let target = docker::owned(deployment, Some(&run.instance_id)).await?;
        if target.len() != 1
            || docker::container_id(&target[0])? != run.source_container_id
            || !docker::matches(&target[0], &run.applied_config)
            || !docker::running(&target[0])
        {
            bail!("IEC101 dual target changed before testing");
        }
        iec101_identity = Some((
            target[0]["State"]["Pid"].clone(),
            target[0]["State"]["StartedAt"].clone(),
        ));
        args.extend(["--secondary-port".into(), c.double.port.to_string()]);
    }
    let mut observer_identity = None;
    if matches!(
        run.applied_config,
        ProtocolConfig::Rtp(_) | ProtocolConfig::Rtcp(_)
    ) {
        let targets = docker::owned(deployment, Some(&run.instance_id)).await?;
        if targets.len() != 1 || docker::container_id(&targets[0])? != run.source_container_id {
            bail!("RTP target changed before testing");
        }
        let host = crate::receiver::observer_host(
            &targets[0],
            deployment,
            &run.instance_id,
            &run.applied_config,
        )?;
        observer_identity = Some((
            targets[0]["State"]["Pid"].clone(),
            targets[0]["State"]["StartedAt"].clone(),
        ));
        args.extend([
            "--observer-host".into(),
            host,
            "--observer-port".into(),
            crate::receiver::OBSERVER_PORT.to_string(),
        ]);
    }
    // Three DNS transports at the legal 32 x 253-byte AAAA boundary need
    // more than 512 KiB even after supplementary wire previews are omitted.
    let report_limit = match run.applied_config {
        ProtocolConfig::Dns(_) => 768 * 1024,
        ProtocolConfig::Http(_) => REPORT_LIMIT,
        _ => 512 * 1024,
    };
    let mut child = Command::new("docker")
        .arg("--host")
        .arg(format!(
            "unix://{}",
            std::env::var("PLAB_DOCKER_SOCKET").unwrap_or_else(|_| "/var/run/docker.sock".into())
        ))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .context("client stdout unavailable")?
        .take(report_limit + 1);
    let mut stderr = child
        .stderr
        .take()
        .context("client stderr unavailable")?
        .take(8193);
    let mut out = vec![];
    let mut err = vec![];
    let limit = if matches!(run.applied_config, ProtocolConfig::Bfd(_)) {
        135
    } else {
        45
    };
    let result = tokio::time::timeout(Duration::from_secs(limit), async {
        let (status, a, b) = tokio::join!(
            child.wait(),
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err)
        );
        a?;
        b?;
        Result::<_>::Ok(status?)
    })
    .await;
    let status = match result {
        Ok(status) => status?,
        Err(_) => {
            let _ = child.kill().await;
            bail!("client execution exceeded the {limit}-second limit");
        }
    };
    if out.len() as u64 > report_limit {
        bail!(
            "client report exceeded the {} KiB limit",
            report_limit / 1024
        );
    }
    let mut report: Value = serde_json::from_slice(&out).with_context(|| {
        format!(
            "client did not return a valid JSON report (exit {}): {}",
            status.code().unwrap_or(-1),
            String::from_utf8_lossy(&err)
                .chars()
                .take(2000)
                .collect::<String>()
        )
    })?;
    if !report["passed"].is_boolean() || !report["checks"].is_array() {
        bail!("invalid client report contract");
    }
    if !status.success() && report["passed"] == true {
        report["passed"] = false.into();
        report["error"] = "client returned a failure exit status".into();
    }
    report["exit_code"] = json!(status.code());
    report["scope"] = "same-host disposable client; does not prove cross-node reachability".into();
    let target = docker::owned(deployment, Some(&run.instance_id)).await?;
    if target.len() != 1
        || !docker::running(&target[0])
        || docker::container_id(&target[0])? != run.source_container_id
        || !docker::matches(&target[0], &run.applied_config)
        || iec101_identity.is_some_and(|(pid, start)| {
            target[0]["State"]["Pid"] != pid || target[0]["State"]["StartedAt"] != start
        })
        || observer_identity.is_some_and(|(pid, start)| {
            target[0]["State"]["Pid"] != pid || target[0]["State"]["StartedAt"] != start
        })
    {
        report["passed"] = false.into();
        report["error"] = "target container changed or stopped during testing".into();
    }
    if let (ProtocolConfig::Bfd(c), Some((pid, start, boot, nonce))) =
        (&run.applied_config, bfd_identity)
    {
        let result =
            crate::bfd::snapshot(deployment, &run.instance_id, &run.source_container_id, c).await;
        let unchanged = target.len() == 1
            && target[0]["State"]["Pid"] == pid
            && target[0]["State"]["StartedAt"] == start
            && result
                .as_ref()
                .is_ok_and(|s| s["boot_id"] == boot && s["runtime_id"] == nonce);
        if !unchanged {
            report["passed"] = false.into();
            report["source_verification_error"] = json!(
                result
                    .err()
                    .map(|e| format!("{e:#}"))
                    .unwrap_or_else(|| "BFD source PID/boot changed during testing".into())
            );
        }
    }
    if let (ProtocolConfig::Vxlan(c), Some((pid, start, boot, nonce))) =
        (&run.applied_config, vxlan_identity)
    {
        let result =
            crate::vxlan::snapshot(deployment, &run.instance_id, &run.source_container_id, c).await;
        let unchanged = target.len() == 1
            && target[0]["State"]["Pid"] == pid
            && target[0]["State"]["StartedAt"] == start
            && result
                .as_ref()
                .is_ok_and(|s| s["boot_id"] == boot && s["runtime_id"] == nonce);
        if !unchanged {
            report["passed"] = false.into();
            report["source_verification_error"] = json!(
                result
                    .err()
                    .map(|e| format!("{e:#}"))
                    .unwrap_or_else(|| "VXLAN source PID/boot changed during testing".into())
            );
        }
    }
    if let (ProtocolConfig::CustomEthernet(c), Some((_, _, state, pid, start))) =
        (&run.applied_config, custom_execution)
    {
        let verification =
            crate::custom_l2::snapshot(deployment, &run.instance_id, &run.source_container_id, c)
                .await;
        if target.len() != 1
            || target[0]["State"]["Pid"] != pid
            || target[0]["State"]["StartedAt"] != start
            || !verification.as_ref().is_ok_and(|s| {
                s["boot_id"] == state["boot_id"] && s["runtime_id"] == state["runtime_id"]
            })
        {
            report["passed"] = false.into();
            report["source_verification_error"] = json!(
                verification
                    .err()
                    .map(|e| format!("{e:#}"))
                    .unwrap_or_else(
                        || "custom Ethernet source changed during fixed-frame test".into()
                    )
            );
        }
    }
    if let (ProtocolConfig::ArpClient(c), Some((_, _, state, pid, start))) =
        (&run.applied_config, arp_execution)
    {
        let verification =
            crate::l2::snapshot(deployment, &run.instance_id, &run.source_container_id, c).await;
        if target.len() != 1
            || target[0]["State"]["Pid"] != pid
            || target[0]["State"]["StartedAt"] != start
            || !verification.as_ref().is_ok_and(|s| {
                s["boot_id"] == state["boot_id"] && s["runtime_id"] == state["runtime_id"]
            })
        {
            report["passed"] = false.into();
            report["source_verification_error"] = json!(
                verification
                    .err()
                    .map(|e| format!("{e:#}"))
                    .unwrap_or_else(|| "ARP source changed during inverse-peer test".into())
            );
        }
    }
    Ok(report)
}

pub fn empty_results() -> HashMap<String, TestRun> {
    HashMap::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_requests_cannot_override_target_or_run_arbitrary_cases() {
        for method in HTTP_METHODS.into_iter().chain(["ALL"]) {
            for path in ["/ok", "/chunked", "/close"] {
                assert!(
                    TestRequest {
                        method: method.into(),
                        path: path.into()
                    }
                    .validate()
                    .is_ok()
                );
            }
        }
        for (method, path) in [
            ("TRACE", "/ok"),
            ("GET", "http://example.test/ok"),
            ("ALL", "/unknown"),
        ] {
            assert!(
                TestRequest {
                    method: method.into(),
                    path: path.into()
                }
                .validate()
                .is_err()
            );
        }
        assert!(
            serde_json::from_value::<TestRequest>(
                json!({"method":"GET","path":"/ok","host":"example.test"})
            )
            .is_err()
        );
    }
}
