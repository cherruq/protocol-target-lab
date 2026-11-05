//! Disposable same-image PROFINET peer; source TX submission and actual peer reception remain distinct.
use crate::{
    docker, manager::Shared, model::ProtocolConfig, profinet, profinet_link, testing::TestRun,
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
const REPORT_LIMIT: u64 = 524288;
fn validate_report(report: &Value, method: &str, c: &profinet::ProfinetConfig) -> Result<()> {
    let checks = report["checks"]
        .as_array()
        .context("PROFINET report checks missing")?;
    let budget = c.test_budget(method)?;
    if !report["passed"].is_boolean()
        || report["protocol"] != "profinet"
        || report["wire_profile"] != "pnet-dcp-ptcp-lab-v1"
        || checks.len() > budget.checks as usize
        || checks.iter().any(|v| !v["passed"].is_boolean())
    {
        bail!("invalid PROFINET report contract")
    }
    let summary = &report["summary"];
    for k in [
        "actual_requests",
        "actual_responses",
        "matched_responses",
        "other_node_responses",
        "unexpected_responses",
    ] {
        if !summary[k].is_u64() {
            bail!("PROFINET report actual count missing: {k}")
        }
    }
    let pass = checks.iter().filter(|v| v["passed"] == true).count();
    if summary["total"] != checks.len()
        || summary["passed"] != pass
        || summary["failed"] != checks.len() - pass
    {
        bail!("PROFINET report check counts inconsistent")
    }
    if report["passed"] == true {
        if checks.len() != budget.checks as usize || pass != checks.len() {
            bail!("PROFINET empty/partial checks cannot pass")
        }
        if method.starts_with("DCP_WRITE_") {
            if report["restoration_complete"] != true
                || summary["actual_requests"].as_u64().unwrap() < 4
            {
                bail!(
                    "PROFINET temporary write cannot pass without actual transaction and complete restoration"
                )
            }
        } else if summary["actual_requests"] != budget.actual_requests {
            bail!("PROFINET passed report request count mismatch")
        }
        let response = summary["actual_responses"].as_u64().unwrap();
        let accounted = [
            "matched_responses",
            "other_node_responses",
            "unexpected_responses",
        ]
        .into_iter()
        .try_fold(0u64, |n, k| n.checked_add(summary[k].as_u64().unwrap()))
        .context("PROFINET response count overflow")?;
        if response != accounted || summary["unexpected_responses"] != 0 {
            bail!("PROFINET response accounting does not cover actual incoming frames")
        }
        if let Some((matched, other)) = expected_reply_counts(method, c)
            && (summary["matched_responses"] != matched
                || summary["other_node_responses"] != other
                || response != matched + other)
        {
            bail!(
                "PROFINET passed response counts do not match selected methods and applied role faults"
            )
        }
    }
    Ok(())
}
fn expected_reply_counts(method: &str, c: &profinet::ProfinetConfig) -> Option<(u64, u64)> {
    let n = if c.ptcp_n.scenario.mode() == "old-seq-first" {
        2
    } else {
        1
    };
    let f = match c.ptcp_f.scenario.mode() {
        "old-seq-first" => 4,
        "missing-follow-up" => 1,
        _ => 2,
    };
    match method {
        "ALL" => Some((14 + 2 * n + 2 * f, 2 * n + 2 * f)),
        "DCP_READ" => Some((14, 0)),
        "DCP_SIGNAL" => Some((2, 0)),
        "PTCP_N_DELAY" => Some((2 * n, 2 * f)),
        "PTCP_F_DELAY" => Some((2 * f, 2 * n)),
        "PTCP_SYNC" | "PTCP_SYNC_FOLLOW_UP" | "PTCP_ANNOUNCE" => Some((0, 0)),
        _ => None,
    }
}
pub async fn run(manager: &Shared, deployment: &str, image: &str, run: &TestRun) -> Result<Value> {
    tokio::time::timeout(Duration::from_millis(profinet::EXECUTION_BUDGET_MS),execute(manager,deployment,image,run)).await.context("PROFINET client exceeded100-second execution deadline;5seconds reserved for exact-owned peer cleanup")?
}
async fn execute(manager: &Shared, deployment: &str, image: &str, run: &TestRun) -> Result<Value> {
    let ProtocolConfig::Profinet(c) = &run.applied_config else {
        bail!("PROFINET client configuration required")
    };
    let before = docker::owned(deployment, Some(&run.instance_id)).await?;
    if before.len() != 1
        || before[0]["Image"] != image
        || docker::container_id(&before[0])? != run.source_container_id
    {
        bail!("PROFINET source identity changed before peer creation");
    }
    let state = profinet_link::snapshot(
        &manager.settings,
        deployment,
        &run.instance_id,
        &run.source_container_id,
        c,
    )
    .await?;
    let view = profinet_link::client_preflight(
        &manager.settings,
        deployment,
        &run.instance_id,
        &run.source_container_id,
        c,
        &run.method,
    )
    .await?;
    let mut args = vec![
        "create".into(),
        "--name".into(),
        run.container_name.clone(),
        "--pull".into(),
        "never".into(),
        "--network".into(),
        format!("name={}", view.management_id),
        "--network".into(),
        format!("name={},mac-address={}", view.data_id, c.test_peer_mac),
        "--user".into(),
        "0:0".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--cap-add".into(),
        "NET_RAW".into(),
        "--ipc".into(),
        "private".into(),
    ];
    for (k, v) in [
        (docker::OWNER, deployment),
        (docker::INSTANCE, run.instance_id.as_str()),
        ("io.protocol-target-lab.test", "true"),
        ("io.protocol-target-lab.test-run", run.id.as_str()),
        (
            "io.protocol-target-lab.session",
            manager.session_id.as_str(),
        ),
        (profinet_link::TEST_SOURCE, run.source_container_id.as_str()),
        (
            profinet_link::PARENT_NONCE,
            state["runtime_id"]
                .as_str()
                .context("PROFINET runtime ID missing")?,
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
    args.extend(profinet::config_args(c)?);
    args.extend([
        "--interface".into(),
        "auto".into(),
        "--observer-host".into(),
        view.observer_host,
        "--observer-port".into(),
        profinet::OBSERVER_PORT.to_string(),
        "--expected-boot-id".into(),
        state["boot_id"]
            .as_str()
            .context("PROFINET boot ID missing")?
            .into(),
        "--expected-runtime-id".into(),
        state["runtime_id"]
            .as_str()
            .context("PROFINET runtime ID missing")?
            .into(),
        "--method".into(),
        run.method.clone(),
        "--path".into(),
        run.path.clone(),
    ]);
    let peer = docker::command(&args).await?.trim().to_owned();
    let attach = vec!["start".to_owned(), "--attach".into(), peer];
    let mut child = Command::new("docker")
        .arg("--host")
        .arg(format!(
            "unix://{}",
            std::env::var("PLAB_DOCKER_SOCKET").unwrap_or_else(|_| "/var/run/docker.sock".into())
        ))
        .args(attach)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("cannot launch PROFINET same-image client")?;
    let mut stdout = child
        .stdout
        .take()
        .context("PROFINET client stdout unavailable")?
        .take(REPORT_LIMIT + 1);
    let mut stderr = child
        .stderr
        .take()
        .context("PROFINET client stderr unavailable")?
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
        bail!("PROFINET client output budget exceeded");
    }
    let mut report: Value = serde_json::from_slice(&out).with_context(|| {
        format!(
            "invalid PROFINET JSON exit{:?}: {}",
            status.code(),
            String::from_utf8_lossy(&err[..err.len().min(2000)])
        )
    })?;
    if let Err(e) = validate_report(&report, &run.method, c) {
        report["passed"] = false.into();
        report["contract_error"] = format!("{e:#}").into();
    }
    if !status.success() && report["passed"] == true {
        report["passed"] = false.into();
        report["error"] = "PROFINET client failure exit status".into();
    }
    report["exit_code"] = json!(status.code());
    report["scope"]="same-host disposable L2 client; native DCP and two simultaneous software PTCP nodes; no hardware precision claim".into();
    let after = docker::owned(deployment, Some(&run.instance_id)).await?;
    let observed = profinet_link::snapshot(
        &manager.settings,
        deployment,
        &run.instance_id,
        &run.source_container_id,
        c,
    )
    .await;
    if after.len() != 1
        || after[0]["Id"] != before[0]["Id"]
        || after[0]["Image"] != before[0]["Image"]
        || after[0]["State"]["Pid"] != before[0]["State"]["Pid"]
        || after[0]["State"]["StartedAt"] != before[0]["State"]["StartedAt"]
        || !observed.as_ref().is_ok_and(|s| {
            ["boot_id", "runtime_id", "config_sha256", "interfaces"]
                .iter()
                .all(|k| s[k] == state[k])
        })
    {
        report["passed"] = false.into();
        report["error"] = "PROFINET source identity or packet link changed during testing".into();
        report["source_verification_error"] = json!(observed.err().map(|e| format!("{e:#}")));
    }
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_partial_and_unaccounted_reports_cannot_pass() {
        let c = profinet::ProfinetConfig::default();
        let mut r = json!({"protocol":"profinet","wire_profile":"pnet-dcp-ptcp-lab-v1","passed":true,"checks":[],"summary":{"total":0,"passed":0,"failed":0,"actual_requests":0,"actual_responses":0,"matched_responses":0,"other_node_responses":0,"unexpected_responses":0}});
        assert!(validate_report(&r, "ALL", &c).is_err());
        r["passed"] = false.into();
        assert!(validate_report(&r, "ALL", &c).is_ok());
        r["checks"] = json!(vec![json!({"passed":true}); 24]);
        r["summary"] = json!({"total":24,"passed":24,"failed":0,"actual_requests":26,"actual_responses":26,"matched_responses":20,"other_node_responses":6,"unexpected_responses":0});
        r["passed"] = true.into();
        assert!(validate_report(&r, "ALL", &c).is_ok());
        r["summary"]["actual_responses"] = 27.into();
        assert!(validate_report(&r, "ALL", &c).is_err());
    }
    #[test]
    fn each_applied_fault_has_exact_selected_and_other_node_counts() {
        let mut c = profinet::ProfinetConfig::default();
        assert_eq!(expected_reply_counts("ALL", &c), Some((20, 6)));
        c.ptcp_n.scenario = profinet::Scenario::OldSeqFirst {};
        assert_eq!(expected_reply_counts("ALL", &c), Some((22, 8)));
        c.ptcp_f.scenario = profinet::Scenario::OldSeqFirst {};
        assert_eq!(expected_reply_counts("ALL", &c), Some((26, 12)));
        c.ptcp_f.scenario = profinet::Scenario::MissingFollowUp {};
        assert_eq!(expected_reply_counts("PTCP_N_DELAY", &c), Some((4, 2)));
        assert_eq!(expected_reply_counts("PTCP_F_DELAY", &c), Some((2, 4)));
        assert_eq!(
            expected_reply_counts("PTCP_SYNC_FOLLOW_UP", &c),
            Some((0, 0))
        );
    }
}
