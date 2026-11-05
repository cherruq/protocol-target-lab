//! Disposable same-image MPLS peer; source TX submission and actual peer reception remain distinct.
use crate::{docker, manager::Shared, model::ProtocolConfig, mpls, mpls_l2, testing::TestRun};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
const REPORT_LIMIT: u64 = 524288;
fn validate_report(report: &Value, method: &str, scenario: &str) -> Result<()> {
    let checks = report["checks"]
        .as_array()
        .context("MPLS report checks missing")?;
    let expected = if method == "ALL" { 8 } else { 2 };
    if !report["passed"].is_boolean()
        || report["protocol"] != "mpls"
        || checks.len() > expected
        || !report["summary"]["actual_requests"].is_u64()
        || !report["summary"]["actual_responses"].is_u64()
        || checks.iter().any(|v| !v["passed"].is_boolean())
    {
        bail!("invalid MPLS client report contract");
    }
    let requests = report["summary"]["actual_requests"].as_u64().unwrap();
    let responses = report["summary"]["actual_responses"].as_u64().unwrap();
    let expected_responses = if scenario == "silent" || method == "INVALID_REQUEST" {
        0
    } else if method == "ALL" {
        6
    } else {
        2
    };
    if report["passed"] == true
        && (responses > requests || requests != expected as u64 || responses != expected_responses)
    {
        bail!("MPLS passed report actual packet counts do not match selected case/scenario");
    }
    let passed = checks.iter().filter(|v| v["passed"] == true).count();
    if report["summary"]["total"] != checks.len()
        || report["summary"]["passed"] != passed
        || report["summary"]["failed"] != checks.len() - passed
        || (report["passed"] == true && (checks.len() != expected || passed != expected))
    {
        bail!("MPLS client report count or empty success mismatch");
    }
    Ok(())
}
pub async fn run(manager: &Shared, deployment: &str, image: &str, run: &TestRun) -> Result<Value> {
    tokio::time::timeout(Duration::from_secs(40),execute(manager,deployment,image,run)).await.context("MPLS client exceeded40-second execution deadline;5seconds reserved for exact-owned peer cleanup")?
}
async fn execute(manager: &Shared, deployment: &str, image: &str, run: &TestRun) -> Result<Value> {
    let ProtocolConfig::Mpls(c) = &run.applied_config else {
        bail!("MPLS client configuration required")
    };
    let before = docker::owned(deployment, Some(&run.instance_id)).await?;
    if before.len() != 1
        || before[0]["Image"] != image
        || docker::container_id(&before[0])? != run.source_container_id
    {
        bail!("MPLS source identity changed before peer creation");
    }
    let state =
        mpls_l2::snapshot(deployment, &run.instance_id, &run.source_container_id, c).await?;
    let (view, interface) = mpls_l2::client_preflight(
        deployment,
        &run.instance_id,
        &run.source_container_id,
        c,
        &run.method,
    )
    .await?;
    let mut args = vec![
        "run".into(),
        "--name".into(),
        run.container_name.clone(),
        "--pull".into(),
        "never".into(),
        "--network".into(),
        view.network_id.clone().unwrap_or_else(|| "host".into()),
        "--user".into(),
        "0:0".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--cap-add".into(),
        "NET_RAW".into(),
        "--ipc".into(),
        "private".into(),
    ];
    if c.link.is_bridge() {
        args.extend(["--mac-address".into(), c.client_mac.clone()]);
    }
    for (k, v) in [
        (docker::OWNER, deployment),
        (docker::INSTANCE, run.instance_id.as_str()),
        ("io.protocol-target-lab.test", "true"),
        ("io.protocol-target-lab.test-run", run.id.as_str()),
        (
            "io.protocol-target-lab.session",
            manager.session_id.as_str(),
        ),
        (mpls_l2::TEST_SOURCE, run.source_container_id.as_str()),
        (
            mpls_l2::PARENT_NONCE,
            state["runtime_id"]
                .as_str()
                .context("MPLS runtime ID missing")?,
        ),
    ] {
        args.extend(["--label".into(), format!("{k}={v}")]);
    }
    args.extend([
        "--entrypoint".into(),
        "python3".into(),
        image.into(),
        "-u".into(),
        "/opt/protocol-target-lab/client.py".into(),
    ]);
    args.extend(mpls::config_args(c)?);
    args.extend([
        "--interface".into(),
        interface,
        "--observer-host".into(),
        view.observer_host,
        "--observer-port".into(),
        mpls::OBSERVER_PORT.to_string(),
        "--expected-boot-id".into(),
        state["boot_id"]
            .as_str()
            .context("MPLS boot ID missing")?
            .into(),
        "--expected-runtime-id".into(),
        state["runtime_id"]
            .as_str()
            .context("MPLS runtime ID missing")?
            .into(),
        "--method".into(),
        run.method.clone(),
        "--path".into(),
        run.path.clone(),
    ]);
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
        .spawn()
        .context("cannot launch MPLS same-image client")?;
    let mut stdout = child
        .stdout
        .take()
        .context("MPLS client stdout unavailable")?
        .take(REPORT_LIMIT + 1);
    let mut stderr = child
        .stderr
        .take()
        .context("MPLS client stderr unavailable")?
        .take(65537);
    let (mut out, mut err) = (vec![], vec![]);
    let (status, _, _) = tokio::try_join!(
        async { child.wait().await.map_err(anyhow::Error::from) },
        async {
            stdout
                .read_to_end(&mut out)
                .await
                .map_err(anyhow::Error::from)
        },
        async {
            stderr
                .read_to_end(&mut err)
                .await
                .map_err(anyhow::Error::from)
        }
    )?;
    if out.len() as u64 > REPORT_LIMIT || err.len() > 65536 {
        bail!("MPLS client output budget exceeded");
    }
    let mut report: Value = serde_json::from_slice(&out).with_context(|| {
        format!(
            "invalid MPLS JSON exit{:?}: {}",
            status.code(),
            String::from_utf8_lossy(&err[..err.len().min(2000)])
        )
    })?;
    validate_report(&report, &run.method, c.scenario.mode())?;
    if !status.success() && report["passed"] == true {
        report["passed"] = false.into();
        report["error"] = "MPLS client failure exit status".into();
    }
    report["exit_code"] = json!(status.code());
    report["scope"]="same-host disposable software L2 peer; physical and native kernel oracle are separately verified".into();
    let after = docker::owned(deployment, Some(&run.instance_id)).await?;
    let observed =
        mpls_l2::snapshot(deployment, &run.instance_id, &run.source_container_id, c).await;
    if after.len() != 1
        || after[0]["Id"] != before[0]["Id"]
        || after[0]["Image"] != before[0]["Image"]
        || after[0]["State"]["Pid"] != before[0]["State"]["Pid"]
        || after[0]["State"]["StartedAt"] != before[0]["State"]["StartedAt"]
        || !observed.as_ref().is_ok_and(|s| {
            [
                "boot_id",
                "runtime_id",
                "config_sha256",
                "interface",
                "filter",
            ]
            .iter()
            .all(|k| s[k] == state[k])
        })
    {
        report["passed"] = false.into();
        report["error"] = "MPLS source identity or packet link changed during testing".into();
        report["source_verification_error"] = json!(observed.err().map(|e| format!("{e:#}")));
    }
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_or_inconsistent_reports_cannot_pass() {
        let mut r = json!({"protocol":"mpls","passed":true,"checks":[],"summary":{"actual_requests":0,"actual_responses":0,"total":0,"passed":0,"failed":0}});
        assert!(validate_report(&r, "ALL", "normal").is_err());
        r["passed"] = false.into();
        assert!(validate_report(&r, "ALL", "normal").is_ok());
        r["checks"] = json!([{"passed":true},{"passed":true}]);
        r["summary"] =
            json!({"actual_requests":2,"actual_responses":2,"total":2,"passed":2,"failed":0});
        r["passed"] = true.into();
        assert!(validate_report(&r, "ECHO", "normal").is_ok());
        assert!(validate_report(&r, "ALL", "normal").is_err());
        r["summary"]["actual_requests"] = json!(0);
        assert!(validate_report(&r, "ECHO", "normal").is_err());
        r["summary"]["actual_requests"] = json!(2);
        r["summary"]["actual_responses"] = json!(0);
        assert!(validate_report(&r, "ECHO", "normal").is_err());
        r["summary"]["actual_responses"] = json!(2);
        r["passed"] = json!(false);
        r["summary"]["actual_responses"] = json!(3);
        assert!(validate_report(&r, "ECHO", "normal").is_ok());
        r["passed"] = json!(true);
        r["summary"]["total"] = json!(99);
        assert!(validate_report(&r, "ECHO", "normal").is_err());
    }
}
