//! Disposable same-image MPLS peer; source TX submission and actual peer reception remain distinct.
use crate::{docker, manager::Shared, model::ProtocolConfig, mpls, mpls_l2, testing::TestRun};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
const REPORT_LIMIT: u64 = 524288;
fn validate_report(report: &Value, method: &str, scenario: &str) -> Result<()> {
    let checks = report["checks"]
        .as_array()
        .context("MPLS report checks missing")?;
    let expected = if method == "TX_BOUNDARY" {
        6
    } else if method == "ALL" {
        8
    } else {
        2
    };
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
    let expected_responses =
        if method == "TX_BOUNDARY" || scenario == "silent" || method == "INVALID_REQUEST" {
            0
        } else if method == "ALL" {
            6
        } else {
            2
        };
    if report["passed"] == true
        && (responses > requests
            || requests
                != if method == "TX_BOUNDARY" {
                    18
                } else {
                    expected as u64
                }
            || responses != expected_responses)
    {
        bail!("MPLS passed report actual packet counts do not match selected case/scenario");
    }
    let v2 = report["verification_schema"] == 2;
    if method == "TX_BOUNDARY"
        && (!v2 || scenario != "short-ethernet" || report["verification_layer"] != "tx_boundary")
    {
        bail!("MPLS TX_BOUNDARY requires schema2, short-ethernet and explicit boundary layer");
    }
    let limited = checks
        .iter()
        .filter(|v| v2 && v["classification"] == "environment_limited")
        .count();
    if v2 {
        if report["verification_layer"]
            != if method == "TX_BOUNDARY" {
                "tx_boundary"
            } else {
                "ethernet_receive"
            }
        {
            bail!("MPLS verification layer mismatch");
        }
        for (index, check) in checks.iter().enumerate() {
            let classification = check["classification"]
                .as_str()
                .context("MPLS check classification missing")?;
            if !["passed", "failed", "environment_limited"].contains(&classification)
                || (check["passed"] == true) != (classification == "passed")
            {
                bail!("MPLS contradictory check classification");
            }
            if classification == "environment_limited"
                && (method == "TX_BOUNDARY"
                    || scenario != "short-ethernet"
                    || check["environment_unavailable"] != true)
            {
                bail!("MPLS unqualified environment limitation");
            }
            if method == "TX_BOUNDARY" && check["passed"] == true {
                let expected_method =
                    ["ECHO", "ECHO", "TC_TTL", "TC_TTL", "PADDING", "PADDING"][index];
                if check["request"]["method"] != expected_method
                    || check["request"]["round"] != (index % 2 + 1)
                {
                    bail!("MPLS boundary selected case/round mismatch");
                }
                validate_boundary_check(check)?;
            }
        }
        let passed = checks.iter().filter(|v| v["passed"] == true).count();
        let outcome = if report.get("error").is_some()
            || checks.is_empty()
            || checks.len() - passed - limited > 0
        {
            "failed"
        } else if limited > 0 {
            "environment_limited"
        } else {
            "passed"
        };
        if report["outcome"] != outcome
            || report["summary"]["environment_limited"] != limited
            || (report["passed"] == true) != (outcome == "passed")
        {
            bail!("MPLS report outcome or environment count mismatch");
        }
    }
    let passed = checks.iter().filter(|v| v["passed"] == true).count();
    if report["summary"]["total"] != checks.len()
        || report["summary"]["passed"] != passed
        || report["summary"]["failed"] != checks.len() - passed - limited
        || (report["passed"] == true && (checks.len() != expected || passed != expected))
    {
        bail!("MPLS client report count or empty success mismatch");
    }
    Ok(())
}
fn validate_boundary_check(check: &Value) -> Result<()> {
    let response = &check["response"];
    let b = &response["boundary_evidence"];
    let controls = response["controls"]
        .as_array()
        .context("MPLS boundary controls missing")?;
    let events = response["source_events"]
        .as_array()
        .context("MPLS boundary source events missing")?;
    if b["errno"] != 22
        || b["submitted"] != false
        || b["wire_receive_verified"] != false
        || b["source_identity_unchanged"] != true
        || b["actual_peer_responses"] != 0
        || b["expected_frame"]["wire_length"] != 13
        || response["quiet_ms"] != 500
        || !response["peer"].is_null()
        || controls.len() != 2
        || controls
            .iter()
            .any(|c| c["passed"] != true || c["request"]["method"] != "INVALID_REQUEST")
    {
        bail!("MPLS boundary rejection/control proof incomplete");
    }
    let expected_sha = check["request"]["frame"]["sha256"]
        .as_str()
        .context("MPLS boundary request hash missing")?;
    if expected_sha.len() != 64 || !expected_sha.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("MPLS boundary request hash invalid");
    }
    let preview = b["expected_frame"]["preview_hex"]
        .as_str()
        .context("MPLS boundary preview missing")?;
    let decoded = &check["request"]["decoded"];
    let expected_preview = format!(
        "{}{}08",
        decoded["ethernet_source"]
            .as_str()
            .context("MPLS boundary source MAC missing")?
            .replace(':', ""),
        decoded["ethernet_destination"]
            .as_str()
            .context("MPLS boundary destination MAC missing")?
            .replace(':', "")
    );
    if preview.len() != 26
        || preview != expected_preview
        || !preview.bytes().all(|c| c.is_ascii_hexdigit())
        || b["expected_frame"]["truncated"] != false
    {
        bail!("MPLS boundary independent 13-byte oracle mismatch");
    }
    let wire = (0..13)
        .map(|i| u8::from_str_radix(&preview[i * 2..i * 2 + 2], 16))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if b["expected_frame"]["sha256"] != format!("{:x}", Sha256::digest(&wire)) {
        bail!("MPLS boundary frame hash mismatch");
    }
    let accepted = events
        .iter()
        .find(|e| e["kind"] == "accepted")
        .context("MPLS boundary accepted event missing")?;
    let output = events
        .iter()
        .find(|e| e["kind"] == "tx_error")
        .context("MPLS boundary TX error missing")?;
    if events.len() != 2
        || accepted["request_sha256"] != check["request"]["frame"]["sha256"]
        || output["request_sha256"] != accepted["request_sha256"]
        || output["request_id"] != accepted["request_id"]
        || output["event_id"].as_u64() <= accepted["event_id"].as_u64()
        || output["frame"] != b["expected_frame"]
        || output["errno"] != 22
        || output["submitted"] != false
        || output["scenario"] != "short-ethernet"
    {
        bail!("MPLS boundary current-request event proof mismatch");
    }
    for (key, delta) in [
        ("accepted", 1),
        ("tx_error", 1),
        ("tx_submitted", 0),
        ("suppressed", 0),
    ] {
        let before = b["counters_before"][key]
            .as_u64()
            .context("MPLS boundary before counter missing")?;
        let after = b["counters_after"][key]
            .as_u64()
            .context("MPLS boundary after counter missing")?;
        if before.checked_add(delta) != Some(after) {
            bail!("MPLS boundary counter delta mismatch");
        }
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
    report["scope"]=if run.method=="TX_BOUNDARY" {"same-host actual AF_PACKET kernel rejection and processing controls; no 13-byte Ethernet receive proof"} else {"same-host disposable software L2 peer; physical and native kernel oracle are separately verified"}.into();
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
    if report["passed"] != true && report["error"].is_string() {
        report["outcome"] = "failed".into();
    }
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boundary_proof_requires_actual_error_controls_and_counter_deltas() {
        let frame = json!({"wire_length":13,"sha256":"fbc62a64c884cf00c9b550ea09bd1b9e5e40854453f70fb52007c549babc411b","preview_hex":"02000000581002000000582008","truncated":false});
        let sha = "a".repeat(64);
        let check = json!({"passed":true,"request":{"frame":{"sha256":sha},"decoded":{"ethernet_source":"02:00:00:00:58:10","ethernet_destination":"02:00:00:00:58:20"}},"response":{"quiet_ms":500,"peer":null,"controls":[{"passed":true,"request":{"method":"INVALID_REQUEST"}},{"passed":true,"request":{"method":"INVALID_REQUEST"}}],"source_events":[{"kind":"accepted","request_sha256":sha,"request_id":1,"event_id":1},{"kind":"tx_error","request_sha256":sha,"request_id":1,"event_id":2,"frame":frame,"errno":22,"submitted":false,"scenario":"short-ethernet"}],"boundary_evidence":{"expected_frame":frame,"errno":22,"submitted":false,"wire_receive_verified":false,"source_identity_unchanged":true,"actual_peer_responses":0,"counters_before":{"accepted":1,"tx_error":1,"tx_submitted":0,"suppressed":0},"counters_after":{"accepted":2,"tx_error":2,"tx_submitted":0,"suppressed":0}}}});
        assert!(validate_boundary_check(&check).is_ok());
        for (path, value) in [
            ("/response/boundary_evidence/errno", json!(1)),
            ("/response/boundary_evidence/submitted", json!(true)),
            (
                "/response/boundary_evidence/wire_receive_verified",
                json!(true),
            ),
            (
                "/response/boundary_evidence/counters_after/tx_submitted",
                json!(1),
            ),
            ("/response/source_events/1/request_id", json!(2)),
            ("/response/source_events/1/event_id", json!(0)),
            ("/response/controls/1/passed", json!(false)),
            ("/response/controls", json!([])),
        ] {
            let mut invalid = check.clone();
            *invalid.pointer_mut(path).unwrap() = value;
            assert!(validate_boundary_check(&invalid).is_err(), "{path}");
        }
    }
    #[test]
    fn environment_counts_never_become_receive_success_or_boundary_success() {
        let checks=(0..8).map(|i|json!({"passed":i>=6,"classification":if i>=6 {"passed"} else {"environment_limited"},"environment_unavailable":i<6})).collect::<Vec<_>>();
        let mut r = json!({"verification_schema":2,"verification_layer":"ethernet_receive","outcome":"environment_limited","protocol":"mpls","passed":false,"checks":checks,"summary":{"actual_requests":8,"actual_responses":0,"total":8,"passed":2,"failed":0,"environment_limited":6}});
        assert!(validate_report(&r, "ALL", "short-ethernet").is_ok());
        assert!(validate_report(&r, "ALL", "normal").is_err());
        assert!(validate_report(&r, "TX_BOUNDARY", "short-ethernet").is_err());
        r["passed"] = true.into();
        assert!(validate_report(&r, "ALL", "short-ethernet").is_err());
    }
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
