use crate::{
    docker,
    manager::Shared,
    model::{HTTP_METHODS, HttpConfig},
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
pub const PATHS: [&str; 3] = ["/ok", "/chunked", "/close"];
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
    pub applied_config: HttpConfig,
    pub report: Option<Value>,
    pub error: Option<String>,
    pub cleanup_complete: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestRequest {
    pub method: String,
    pub path: String,
}
impl TestRequest {
    pub fn validate(&self) -> Result<()> {
        if self.method != "ALL" && !HTTP_METHODS.contains(&self.method.as_str()) {
            bail!("method: choose a supported HTTP method or ALL");
        }
        if !PATHS.contains(&self.path.as_str()) {
            bail!("path: choose /ok, /chunked or /close");
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
    request.validate()?;
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
    let resources = docker::owned(&deployment, Some(instance_id)).await?;
    if resources.len() != 1
        || !docker::running(&resources[0])
        || !docker::matches(&resources[0], &config)
    {
        bail!("no unique running target matches the applied configuration");
    }
    let source_id = docker::container_id(&resources[0])?;
    let image_id = docker::image_id(&manager.settings.image)
        .await
        .context("client image is unavailable; import the matching HTTP image")?;
    let metadata: Vec<Value> =
        serde_json::from_str(&docker::cmd(&["image", "inspect", &image_id]).await?)?;
    if metadata[0]["Config"]["Labels"]["io.protocol-target-lab.http-client-schema"].as_str()
        != Some("1")
    {
        bail!(
            "configured HTTP image has no built-in client; import version 0.3.0 or newer before testing"
        );
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
        let cleanup = cleanup_run(&deployment, &run.id).await;
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
    let mut args = vec![
        "run".into(),
        "--rm".into(),
        "--name".into(),
        run.container_name.clone(),
        "--network".into(),
        "host".into(),
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
        "--host".into(),
        run.applied_config.probe_ip().into(),
        "--port".into(),
        run.applied_config.port.to_string(),
        "--method".into(),
        run.method.clone(),
        "--path".into(),
        run.path.clone(),
    ];
    if let Some(body) = &run.applied_config.legacy_body {
        args.push(format!("--legacy-body={body}"));
    } else {
        args.extend([
            "--response-length".into(),
            run.applied_config.response_length.to_string(),
            "--response-mode".into(),
            run.applied_config.response_mode.as_str().into(),
        ]);
    }
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
        .take(REPORT_LIMIT + 1);
    let mut stderr = child
        .stderr
        .take()
        .context("client stderr unavailable")?
        .take(8193);
    let mut out = vec![];
    let mut err = vec![];
    let result = tokio::time::timeout(Duration::from_secs(45), async {
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
            bail!("client execution exceeded the 45-second limit");
        }
    };
    if out.len() as u64 > REPORT_LIMIT {
        bail!("client report exceeded the 128 KiB limit");
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
    {
        report["passed"] = false.into();
        report["error"] = "target container changed or stopped during testing".into();
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
            for path in PATHS {
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
