//! Same-image one-shot IGMP peer with bounded progress from the actual child stderr.
use crate::{docker, igmp, igmp_link, manager::Shared, model::ProtocolConfig, testing::TestRun};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

const PREFIX: &[u8] = b"PLAB_IGMP_PROGRESS ";
const LINE_LIMIT: usize = 4096;
const STDERR_LIMIT: usize = 262144;
const REPORT_LIMIT: u64 = 524288;

fn progress(line: &[u8], run: &TestRun, previous: Option<&Value>) -> Result<Option<Value>> {
    if !line.starts_with(PREFIX) {
        return Ok(None);
    }
    let v: Value = serde_json::from_slice(&line[PREFIX.len()..])
        .context("invalid IGMP client progress JSON")?;
    let ProtocolConfig::Igmp(c) = &run.applied_config else {
        unreachable!()
    };
    if v["schema_version"] != 1
        || v["test_run_id"] != run.id
        || !v["phase"].as_str().is_some_and(|p| {
            [
                "warmup",
                "general-query",
                "group-query",
                "cleanup",
                "complete",
                "failed",
            ]
            .contains(&p)
        })
        || (!v["round"].is_null() && !matches!(v["round"].as_u64(), Some(1 | 2)))
    {
        bail!("invalid IGMP client progress identity/phase");
    }
    for key in [
        "sequence",
        "queries_sent",
        "reports_matched",
        "prequery_reports",
        "warmup_remaining_upper_ms",
        "elapsed_ms",
        "remaining_ms",
    ] {
        if v[key].as_u64().is_none() {
            bail!("invalid IGMP client progress counter {key}");
        }
    }
    for key in ["groups_expected", "groups_covered"] {
        let groups = v[key].as_array().context("invalid IGMP progress groups")?;
        let mut seen = std::collections::HashSet::new();
        if groups.len() > 16
            || groups.iter().any(|g| {
                g.as_str()
                    .is_none_or(|s| !c.groups.iter().any(|g| g == s) || !seen.insert(s))
            })
        {
            bail!("invalid IGMP progress group scope");
        }
    }
    if let Some(old) = previous {
        if v["sequence"].as_u64() <= old["sequence"].as_u64() {
            bail!("IGMP progress sequence did not advance");
        }
        for key in [
            "queries_sent",
            "reports_matched",
            "prequery_reports",
            "elapsed_ms",
        ] {
            if v[key].as_u64() < old[key].as_u64() {
                bail!("IGMP progress counter regressed");
            }
        }
    }
    Ok(Some(v))
}
fn query_epoch_still_eligible(before: &Value, after: &Value) -> bool {
    before["testability"]["available"] == true
        && after["testability"]["available"] == true
        && after["boot_id"] == before["boot_id"]
        && after["runtime_id"] == before["runtime_id"]
        && after["config_sha256"] == before["config_sha256"]
}
pub async fn run(manager: &Shared, deployment: &str, image: &str, run: &TestRun) -> Result<Value> {
    tokio::time::timeout(
        Duration::from_millis(igmp::EXECUTION_BUDGET_MS),
        execute(manager, deployment, image, run),
    )
    .await
    .context("IGMP client exceeded100-second execution deadline;5seconds reserved for exact-owned peer cleanup")?
}
async fn execute(manager: &Shared, deployment: &str, image: &str, run: &TestRun) -> Result<Value> {
    let ProtocolConfig::Igmp(c) = &run.applied_config else {
        bail!("IGMP client configuration required")
    };
    let before = docker::owned(deployment, Some(&run.instance_id)).await?;
    if before.len() != 1
        || before[0]["Image"] != image
        || docker::container_id(&before[0])? != run.source_container_id
    {
        bail!("IGMP actual source changed before peer creation");
    }
    let state = igmp_link::snapshot(
        &manager.settings,
        deployment,
        &run.instance_id,
        &run.source_container_id,
        c,
    )
    .await?;
    let view = igmp_link::client_preflight(
        &manager.settings,
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
        "--label".into(),
        format!("{}={deployment}", docker::OWNER),
        "--label".into(),
        format!("{}={}", docker::INSTANCE, run.instance_id),
        "--label".into(),
        "io.protocol-target-lab.test=true".into(),
        "--label".into(),
        format!("io.protocol-target-lab.test-run={}", run.id),
        "--label".into(),
        format!("io.protocol-target-lab.session={}", manager.session_id),
        "--label".into(),
        format!(
            "io.protocol-target-lab.test-source={}",
            run.source_container_id
        ),
        "--label".into(),
        format!(
            "io.protocol-target-lab.igmp-parent-runtime-id={}",
            state["runtime_id"]
                .as_str()
                .context("IGMP source runtime ID missing")?
        ),
        "--entrypoint".into(),
        "python3".into(),
        image.into(),
        "-u".into(),
        "/opt/protocol-target-lab/client.py".into(),
    ];
    args.extend(igmp::config_args(c)?);
    args.extend([
        "--interface".into(),
        view.interface,
        "--source-ip".into(),
        view.source_ip,
        "--target-ip".into(),
        view.target_ip,
        "--target-mac".into(),
        view.target_mac,
        "--observer-host".into(),
        view.observer_host,
        "--observer-port".into(),
        igmp::OBSERVER_PORT.to_string(),
        "--expected-boot-id".into(),
        state["boot_id"]
            .as_str()
            .context("IGMP boot ID missing")?
            .into(),
        "--expected-runtime-id".into(),
        state["runtime_id"]
            .as_str()
            .context("IGMP runtime ID missing")?
            .into(),
        "--method".into(),
        run.method.clone(),
        "--path".into(),
        run.path.clone(),
        "--test-run-id".into(),
        run.id.clone(),
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
        .context("cannot launch same-image IGMP peer")?;
    let mut stdout = child
        .stdout
        .take()
        .context("IGMP client stdout unavailable")?
        .take(REPORT_LIMIT + 1);
    let mut stderr = child
        .stderr
        .take()
        .context("IGMP client stderr unavailable")?;
    let mut out = vec![];
    let err_read = async {
        let mut total = 0;
        let mut pending = vec![];
        let mut previous = None;
        let mut diagnostics = vec![];
        loop {
            let mut chunk = [0u8; 2048];
            let n = stderr.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            total += n;
            if total > STDERR_LIMIT {
                bail!("IGMP client stderr exceeded256KiB");
            }
            for b in &chunk[..n] {
                if *b == b'\n' {
                    if let Some(v) = progress(&pending, run, previous.as_ref())? {
                        let mut d = manager.data.lock().await;
                        if let Some(current) = d
                            .tests
                            .get_mut(&run.instance_id)
                            .filter(|t| t.id == run.id && t.status == "running")
                        {
                            current.progress = Some(v.clone());
                        }
                        previous = Some(v);
                    } else if diagnostics.len() < 2000 {
                        diagnostics.extend_from_slice(
                            &pending[..pending.len().min(2000 - diagnostics.len())],
                        );
                    }
                    pending.clear();
                } else {
                    pending.push(*b);
                    if pending.len() > LINE_LIMIT {
                        bail!("IGMP client stderr line exceeded4096bytes");
                    }
                }
            }
        }
        if !pending.is_empty() {
            bail!("IGMP client stderr ended with incomplete line");
        }
        Ok::<_, anyhow::Error>(diagnostics)
    };
    let (status, output, diagnostics) = tokio::try_join!(
        async { child.wait().await.map_err(anyhow::Error::from) },
        async {
            stdout
                .read_to_end(&mut out)
                .await
                .map_err(anyhow::Error::from)
        },
        err_read
    )?;
    let _ = output;
    if out.len() as u64 > REPORT_LIMIT {
        bail!("IGMP final report exceeded512KiB");
    }
    let mut report: Value = serde_json::from_slice(&out).with_context(|| {
        format!(
            "IGMP client returned invalid JSON (exit {:?}): {}",
            status.code(),
            String::from_utf8_lossy(&diagnostics)
        )
    })?;
    if !report["passed"].is_boolean()
        || !report["checks"].is_array()
        || !report["summary"]["actual_queries"].is_u64()
        || !report["summary"]["actual_reports"].is_u64()
    {
        bail!("invalid IGMP final report contract");
    }
    if !status.success() && report["passed"] == true {
        report["passed"] = false.into();
        report["error"] = "IGMP client failure exit status".into();
    }
    report["exit_code"] = json!(status.code());
    report["scope"] =
        "same-host disposable native IGMP peer; physical path requires separate actual validation"
            .into();
    let after = docker::owned(deployment, Some(&run.instance_id)).await?;
    let observed = igmp_link::snapshot(
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
        || !observed
            .as_ref()
            .is_ok_and(|s| query_epoch_still_eligible(&state, s))
    {
        report["passed"] = false.into();
        if report["error"].is_null() {
            report["error"] =
                "IGMP source identity or native query-test eligibility changed during testing"
                    .into();
        }
        report["source_verification_error"] =
            json!(observed.err().map(|e| format!("{e:#}")).unwrap_or_else(|| {
                "IGMP source/link identity or native query-test eligibility changed during test"
                    .into()
            }));
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run() -> TestRun {
        TestRun {
            id: "00000000-0000-4000-8000-000000000019".into(),
            instance_id: "igmp-demo".into(),
            method: "ALL".into(),
            path: igmp::PATH.into(),
            status: "running".into(),
            started_at: 0,
            finished_at: None,
            container_name: "test".into(),
            source_container_id: "source".into(),
            applied_config: igmp::IgmpConfig::default().into(),
            report: None,
            error: None,
            cleanup_complete: false,
            progress: None,
        }
    }
    #[test]
    fn progress_is_bound_to_same_run_and_monotonic_actual_counters() {
        let r = run();
        let v = json!({"schema_version":1,"test_run_id":r.id,"sequence":1,"phase":"warmup","round":null,"groups_expected":[],"groups_covered":[],"queries_sent":0,"reports_matched":0,"prequery_reports":0,"warmup_remaining_upper_ms":1000,"elapsed_ms":1,"remaining_ms":89999});
        let line = |v: &Value| [PREFIX, serde_json::to_vec(v).unwrap().as_slice()].concat();
        assert!(progress(&line(&v), &r, None).unwrap().is_some());
        assert!(progress(&line(&v), &r, Some(&v)).is_err());
        for (key, bad) in [
            ("test_run_id", json!("another-run")),
            ("queries_sent", json!(true)),
            ("phase", json!("assumed-pass")),
            ("round", json!(3)),
            ("groups_covered", json!(["239.9.9.9"])),
        ] {
            let mut bad_v = v.clone();
            bad_v[key] = bad;
            assert!(progress(&line(&bad_v), &r, None).is_err(), "{key}");
        }
        assert!(
            progress(b"non-progress diagnostic", &r, None)
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn optional_progress_preserves_legacy_test_api() {
        let mut r = run();
        r.applied_config = crate::model::HttpConfig::default().into();
        assert!(serde_json::to_value(r).unwrap().get("progress").is_none());
    }
    #[test]
    fn late_shared_reference_or_parameter_change_cannot_publish_a_pass() {
        let before = json!({"boot_id":"boot","runtime_id":"runtime","config_sha256":"config","testability":{"available":true}});
        assert!(query_epoch_still_eligible(&before, &before));
        let mut after = before.clone();
        after["testability"] = json!({"available":false,"reason":"shared or changed native state"});
        assert!(!query_epoch_still_eligible(&before, &after));
        for key in ["boot_id", "runtime_id", "config_sha256"] {
            let mut after = before.clone();
            after[key] = "changed".into();
            assert!(!query_epoch_still_eligible(&before, &after));
        }
    }
}
