//! Owned Ethernet dependencies and passive source identity. No custom Ethernet response is synthesized here.
use crate::{
    custom_ethernet::{
        CustomEthernetConfig, FILTER_LABEL, LIBRARY_LABEL, Link, NETWORK_KIND, OBSERVER_PORT,
        RUNTIME_LABEL,
    },
    docker,
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
const KIND: &str = "io.protocol-target-lab.kind";
const NET_SCHEMA: &str = "io.protocol-target-lab.custom-ethernet-network-schema";
pub const TEST_SOURCE: &str = "io.protocol-target-lab.test-source";
pub const PARENT_NONCE: &str = "io.protocol-target-lab.custom-ethernet-parent-runtime-id";
fn network_name(deployment: &str, instance: &str) -> String {
    format!("plab-{}-{instance}-custom-l2", &deployment[..8])
}
fn bridge_name(deployment: &str, instance: &str) -> String {
    format!(
        "plce{}",
        &format!(
            "{:x}",
            Sha256::digest(format!("{deployment}/{instance}").as_bytes())
        )[..10]
    )
}
fn network_valid(n: &Value, deployment: &str, instance: &str) -> bool {
    n["Name"] == network_name(deployment, instance)
        && n["Driver"] == "bridge"
        && n["Internal"] == true
        && n["EnableIPv6"] == false
        && n["Labels"][docker::OWNER] == deployment
        && n["Labels"][docker::INSTANCE] == instance
        && n["Labels"][KIND] == NETWORK_KIND
        && n["Labels"][NET_SCHEMA] == "1"
        && n["Labels"]["io.protocol-target-lab.managed"] == "true"
        && n["Options"]["com.docker.network.bridge.enable_icc"] == "true"
        && n["Options"]["com.docker.network.bridge.name"] == bridge_name(deployment, instance)
}
pub async fn network(deployment: &str, instance: &str) -> Result<Option<Value>> {
    let ids = docker::command(&[
        "network".into(),
        "ls".into(),
        "-q".into(),
        "--filter".into(),
        format!("label={}={deployment}", docker::OWNER),
        "--filter".into(),
        format!("label={}={instance}", docker::INSTANCE),
        "--filter".into(),
        format!("label={KIND}={NETWORK_KIND}"),
    ])
    .await?;
    let ids = ids.split_whitespace().collect::<Vec<_>>();
    if ids.len() > 1 {
        bail!("ambiguous owned custom Ethernet link networks; refusing automatic cleanup");
    }
    if let Some(id) = ids.first() {
        let rows: Vec<Value> =
            serde_json::from_str(&docker::cmd(&["network", "inspect", id]).await?)?;
        if rows.len() != 1 || !network_valid(&rows[0], deployment, instance) {
            bail!("owned custom Ethernet link network identity/configuration drift");
        }
        return Ok(rows.into_iter().next());
    }
    let name = network_name(deployment, instance);
    match docker::cmd(&["network", "inspect", &name]).await {
        Ok(_) => bail!("config.link: network name already belongs to an unrecognized resource"),
        Err(e) if e.to_string().contains("not found") || e.to_string().contains("No such") => {}
        Err(e) => return Err(e),
    }
    Ok(None)
}
fn net_id(n: &Value) -> Result<&str> {
    n["Id"].as_str().context("owned network ID missing")
}
async fn create_network(deployment: &str, instance: &str) -> Result<Value> {
    let args = vec![
        "network".into(),
        "create".into(),
        "--driver".into(),
        "bridge".into(),
        "--internal".into(),
        "--opt".into(),
        "com.docker.network.bridge.enable_icc=true".into(),
        "--opt".into(),
        format!(
            "com.docker.network.bridge.name={}",
            bridge_name(deployment, instance)
        ),
        "--label".into(),
        "io.protocol-target-lab.managed=true".into(),
        "--label".into(),
        format!("{}={deployment}", docker::OWNER),
        "--label".into(),
        format!("{}={instance}", docker::INSTANCE),
        "--label".into(),
        format!("{KIND}={NETWORK_KIND}"),
        "--label".into(),
        format!("{NET_SCHEMA}=1"),
        network_name(deployment, instance),
    ];
    docker::command(&args).await?;
    network(deployment, instance)
        .await?
        .context("created custom Ethernet network cannot be identified")
}
fn members(n: &Value) -> Result<&serde_json::Map<String, Value>> {
    n["Containers"]
        .as_object()
        .context("network endpoint listing missing")
}
async fn validate_members(
    n: &Value,
    source: Option<&Value>,
    c: &CustomEthernetConfig,
    deployment: &str,
    instance: &str,
) -> Result<()> {
    let source_id = source.and_then(|s| s["Id"].as_str());
    for (cid, endpoint) in members(n)? {
        if Some(cid.as_str()) == source_id {
            continue;
        }
        let rows: Vec<Value> = serde_json::from_str(&docker::cmd(&["inspect", cid]).await?)?;
        let Some(peer) = rows.first().filter(|_| rows.len() == 1) else {
            bail!("custom Ethernet network contains an unknown endpoint");
        };
        let labels = &peer["Config"]["Labels"];
        if labels[KIND] == "custom-compiler"
            && labels["io.protocol-target-lab.custom-ethernet-compiler"] == "true"
        {
            if labels[docker::OWNER] != deployment
                || labels[docker::INSTANCE] != instance
                || labels["io.protocol-target-lab.test"] != "true"
                || !labels["io.protocol-target-lab.session"]
                    .as_str()
                    .is_some_and(|s| s.starts_with("compiler-"))
                || labels["io.protocol-target-lab.test-run"]
                    .as_str()
                    .is_none_or(|s| uuid::Uuid::parse_str(s).is_err())
                || !labels["io.protocol-target-lab.candidate-config"]
                    .as_str()
                    .is_some_and(valid_sha)
                || peer["Config"]["Image"] != peer["Image"]
                || peer["HostConfig"]["NetworkMode"] != n["Id"]
                || endpoint["MacAddress"] == c.local_mac
                || endpoint["MacAddress"] == c.peer_mac
                || peer["HostConfig"]["CapDrop"] != json!(["ALL"])
                || peer["HostConfig"]["CapAdd"] != json!(["NET_RAW"])
                || peer["Mounts"].as_array().is_none_or(|a| !a.is_empty())
            {
                bail!("custom compiler endpoint ownership/capability drift")
            }
            continue;
        }
        if source.is_none()
            || labels[docker::OWNER] != deployment
            || labels[docker::INSTANCE] != instance
            || labels["io.protocol-target-lab.test"] != "true"
            || labels[TEST_SOURCE].as_str() != source_id
            || labels[PARENT_NONCE].as_str()
                != source.and_then(|s| s["Config"]["Labels"][RUNTIME_LABEL].as_str())
            || peer["Image"] != source.unwrap()["Image"]
            || endpoint["MacAddress"] != c.peer_mac
        {
            bail!(
                "config.link: foreign endpoint on owned custom Ethernet network; refusing to detach or remove it"
            );
        }
    }
    Ok(())
}
fn check_mac_conflicts(n: &Value, c: &CustomEthernetConfig, source: Option<&str>) -> Result<()> {
    let gateway_mac = std::fs::read_to_string(format!(
        "/sys/class/net/{}/address",
        n["Options"]["com.docker.network.bridge.name"]
            .as_str()
            .context("custom Ethernet bridge device missing")?
    ))
    .context("config.link: owned bridge actual MAC unavailable")?;
    if [c.local_mac.as_str(), c.peer_mac.as_str()].contains(&gateway_mac.trim()) {
        bail!("config.mac: source/server MAC conflicts with owned bridge gateway MAC");
    }
    for (cid, e) in members(n)? {
        if Some(cid.as_str()) != source
            && [c.local_mac.as_str(), c.peer_mac.as_str()]
                .contains(&e["MacAddress"].as_str().unwrap_or(""))
        {
            bail!("config.mac: role conflicts with an existing link endpoint");
        }
    }
    Ok(())
}
pub async fn cleanup_empty(deployment: &str, instance: &str, strict: bool) -> Result<()> {
    if let Some(n) = network(deployment, instance).await? {
        if !members(&n)?.is_empty() {
            if strict {
                bail!("owned custom Ethernet network still contains endpoints; preserving them");
            }
            return Ok(());
        }
        // Reinspect exact immutable ID and ownership immediately before removal.
        let rows: Vec<Value> =
            serde_json::from_str(&docker::cmd(&["network", "inspect", net_id(&n)?]).await?)?;
        if rows.len() != 1
            || !network_valid(&rows[0], deployment, instance)
            || !members(&rows[0])?.is_empty()
        {
            bail!("custom Ethernet dependency changed during cleanup");
        }
        docker::cmd(&["network", "rm", net_id(&n)?]).await?;
    }
    Ok(())
}
pub async fn cleanup_deployment(deployment: &str) -> Result<()> {
    let ids = docker::command(&[
        "network".into(),
        "ls".into(),
        "-q".into(),
        "--filter".into(),
        format!("label={}={deployment}", docker::OWNER),
        "--filter".into(),
        format!("label={KIND}={NETWORK_KIND}"),
    ])
    .await?;
    for id in ids.split_whitespace() {
        let rows: Vec<Value> =
            serde_json::from_str(&docker::cmd(&["network", "inspect", id]).await?)?;
        let instance = rows
            .first()
            .and_then(|n| n["Labels"][docker::INSTANCE].as_str())
            .context("custom Ethernet network workspace label missing")?;
        cleanup_empty(deployment, instance, true).await?;
    }
    Ok(())
}
pub fn runtime_id(v: &Value) -> Result<String> {
    let id = v["Config"]["Labels"][RUNTIME_LABEL]
        .as_str()
        .context("custom Ethernet runtime nonce missing")?;
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        bail!("invalid custom Ethernet runtime nonce");
    }
    let env = v["Config"]["Env"]
        .as_array()
        .context("custom Ethernet environment missing")?;
    if env
        .iter()
        .filter(|v| {
            v.as_str()
                .is_some_and(|s| s.starts_with("PLAB_RUNTIME_ID="))
        })
        .count()
        != 1
        || !env.iter().any(|v| v == &format!("PLAB_RUNTIME_ID={id}"))
    {
        bail!("custom Ethernet nonce label/environment mismatch");
    }
    Ok(id.into())
}
pub fn container_matches(v: &Value, c: &CustomEthernetConfig) -> bool {
    let empty = |v: &Value| v.is_null() || v.as_object().is_some_and(|m| m.is_empty());
    v["Config"]["User"] == "0:0"
        && v["HostConfig"]["Privileged"] == false
        && v["HostConfig"]["IpcMode"] == "private"
        && ["", "private"].contains(&v["HostConfig"]["PidMode"].as_str().unwrap_or("invalid"))
        && empty(&v["HostConfig"]["PortBindings"])
        && v["Mounts"].as_array().is_some_and(|a| a.is_empty())
        && v["HostConfig"]["Devices"]
            .as_array()
            .is_some_and(|a| a.is_empty())
        && v["HostConfig"]["CapDrop"] == json!(["ALL"])
        && [json!(["NET_RAW"]), json!(["CAP_NET_RAW"])].contains(&v["HostConfig"]["CapAdd"])
        && [
            "request", "response", "client", "control", "observer", "compiler",
        ]
        .iter()
        .all(|k| {
            v["Config"]["Labels"][format!("io.protocol-target-lab.custom-ethernet-{k}-schema")]
                == "1"
        })
        && runtime_id(v).is_ok()
        && v["Config"]["Labels"][FILTER_LABEL]
            .as_str()
            .is_some_and(valid_sha)
        && v["Config"]["Labels"][LIBRARY_LABEL]
            .as_str()
            .is_some_and(valid_sha)
        && if c.link.is_bridge() {
            v["NetworkSettings"]["Networks"]
                .as_object()
                .is_some_and(|nets| {
                    nets.len() == 1
                        && nets.values().all(|e| {
                            e["MacAddress"] == c.local_mac
                                && e["NetworkID"]
                                    .as_str()
                                    .is_some_and(|id| v["HostConfig"]["NetworkMode"] == id)
                        })
                })
        } else {
            v["HostConfig"]["NetworkMode"] == "host"
        }
}
pub async fn interfaces() -> Result<Vec<Value>> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::process::Command::new("ip")
            .args(["-j", "link", "show"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("interface inspection deadline")??;
    if !out.status.success() || out.stdout.len() > 1048576 {
        bail!("config.link: cannot inspect actual Ethernet interfaces; iproute2 required");
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}
fn ethernet(v: &Value, mac: &str) -> bool {
    v["link_type"] == "ether"
        && v["address"]
            .as_str()
            .is_some_and(|s| s.eq_ignore_ascii_case(mac))
        && v["ifindex"].as_u64().is_some_and(|n| n > 0)
}
pub async fn host_interface(c: &CustomEthernetConfig, peer: bool) -> Result<String> {
    let rows = interfaces().await?;
    if peer {
        let matches = rows
            .iter()
            .filter(|v| ethernet(v, &c.peer_mac))
            .collect::<Vec<_>>();
        if matches.len() != 1 || matches[0]["ifname"] == c.link.interface() {
            bail!(
                "config.test: inverse peer needs exactly one different actual Ethernet interface matching server_mac on this host; use same-image peer with explicit --interface on the configured counterpart"
            );
        }
        return Ok(matches[0]["ifname"]
            .as_str()
            .context("peer interface name missing")?
            .into());
    }
    let iface = rows
        .iter()
        .find(|v| v["ifname"] == c.link.interface())
        .context("config.link.interface: existing interface not found")?;
    if !ethernet(iface, &c.local_mac) {
        bail!("config.link.interface/source_mac: actual Ethernet interface/MAC mismatch");
    }
    if iface["flags"]
        .as_array()
        .is_none_or(|f| !f.iter().any(|s| s == "UP"))
    {
        bail!("config.link.interface: interface is administratively down");
    }
    Ok(c.link.interface().into())
}
const SOCKET_PROBE: &str = r#"import os,sys,json,socket
want=json.loads(sys.argv[1]);name=want['interface'];base='/sys/class/net/'+name
ifindex=int(open(base+'/ifindex').read());hardware=int(open(base+'/type').read());mac=open(base+'/address').read().strip().lower()
if hardware!=1 or mac!=want['mac']:raise RuntimeError('custom Ethernet actual Ethernet interface/MAC mismatch')
inodes=set()
for entry in os.listdir('/proc/1/fd'):
 try:
  value=os.readlink('/proc/1/fd/'+entry)
  if value.startswith('socket:['):inodes.add(value[8:-1])
 except FileNotFoundError:pass
if len(inodes)>128:raise RuntimeError('custom Ethernet source FD budget exceeded')
packets=[]
with open('/proc/1/net/packet') as f:
 header=next(f).split()
 for count,line in enumerate(f):
  if count>100000:raise RuntimeError('custom Ethernet packet table budget exceeded')
  row=dict(zip(header,line.split()));inode=row.get('Inode')
  if inode in inodes and int(row.get('Iface','0'))==ifindex and int(row.get('Type','0'))==3 and int(row.get('Proto','0'),16)==3:packets.append(inode)
tcp=[]
with open('/proc/1/net/tcp') as f:
 next(f)
 for count,line in enumerate(f):
  if count>100000:raise RuntimeError('custom Ethernet TCP table budget exceeded')
  a=line.split()
  if len(a)<10 or a[9] not in inodes or a[3]!='0A':continue
  ip,port=a[1].split(':');ip=socket.inet_ntoa(bytes.fromhex(ip)[::-1])
  if ip==want['observer_ip'] and int(port,16)==want['observer_port']:tcp.append(a[9])
if len(packets)!=1 or len(tcp)!=1:raise RuntimeError('custom Ethernet exact source PID does not own unique packet and observer endpoints')
print(json.dumps(dict(interface=name,ifindex=ifindex,hardware_type=hardware,mac=mac,packet_inode=packets[0],observer_inode=tcp[0])))
"#;
async fn socket_identity(v: &Value, c: &CustomEthernetConfig) -> Result<Value> {
    if v["State"]["Pid"].as_u64().unwrap_or(0) == 0 {
        bail!("custom Ethernet source PID not running");
    }
    let want = json!({"interface":c.link.interface(),"mac":c.local_mac,"observer_ip":if c.link.is_bridge(){"0.0.0.0"}else{"127.0.0.1"},"observer_port":OBSERVER_PORT});
    let args = vec![
        "exec".into(),
        "--user".into(),
        "0:0".into(),
        docker::container_id(v)?,
        "python3".into(),
        "-I".into(),
        "-c".into(),
        SOCKET_PROBE.into(),
        want.to_string(),
    ];
    Ok(serde_json::from_str(
        &docker::command(&args)
            .await
            .context("custom Ethernet source kernel socket identity inspection failed")?,
    )?)
}
#[derive(Clone, Debug)]
pub struct SourceView {
    pub observer_host: String,
    pub network_id: Option<String>,
}
async fn source_view(
    v: &Value,
    c: &CustomEthernetConfig,
    deployment: &str,
    instance: &str,
) -> Result<SourceView> {
    if !container_matches(v, c) {
        bail!("custom Ethernet exact source container capability/network drift");
    }
    if c.link.is_bridge() {
        let n = network(deployment, instance)
            .await?
            .context("custom Ethernet owned network missing")?;
        validate_members(&n, Some(v), c, deployment, instance).await?;
        let entry = &v["NetworkSettings"]["Networks"][network_name(deployment, instance)];
        let id = net_id(&n)?;
        if entry["NetworkID"] != id || !members(&n)?.contains_key(&docker::container_id(v)?) {
            bail!("custom Ethernet source endpoint is not in its exact owned network");
        }
        let host = entry["IPAddress"]
            .as_str()
            .context("custom Ethernet private observer address missing")?;
        let ip: std::net::Ipv4Addr = host.parse()?;
        if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() {
            bail!("invalid custom Ethernet private observer address");
        }
        Ok(SourceView {
            observer_host: host.into(),
            network_id: Some(id.into()),
        })
    } else {
        host_interface(c, false).await?;
        Ok(SourceView {
            observer_host: "127.0.0.1".into(),
            network_id: None,
        })
    }
}
async fn status(host: &str) -> Result<Value> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(1))
        .build()?;
    let mut response = client
        .get(format!("http://{host}:{OBSERVER_PORT}/v1/status"))
        .send()
        .await?;
    if response.status() != 200 {
        bail!(
            "custom Ethernet private observer returned {}",
            response.status()
        );
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > 65536 {
            bail!("custom Ethernet observer exceeded64KiB");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}
fn status_matches(s: &Value, c: &CustomEthernetConfig, nonce: &str, sockets: &Value) -> Result<()> {
    if s["schema_version"] != 1
        || s["protocol"] != "custom-ethernet"
        || s["runtime_id"] != nonce
        || s["config_sha256"] != c.observer_hash()
        || s["worker_ready_after_bind"] != true
        || s["event_loop_age_ms"].as_u64().is_none_or(|n| n > 2000)
        || s["link_mode"] != c.link.mode()
        || s["response_mode"] != c.response.mode.name()
        || s["interface"]["name"] != c.link.interface()
        || s["interface"]["ifindex"] != sockets["ifindex"]
        || s["interface"]["mac"] != c.local_mac
        || s["filter"]["installed"] != true
        || s["filter"]["instructions"] != s["filter"]["readback_instructions"]
        || s["capture_snaplen"] != 262144
        || s["recv_budget"] != 262144
        || s["max_accepted_original_and_normalized_rx"] != 65535
        || s["filter"]["packet_socket_inode"]
            .as_u64()
            .map(|n| n.to_string())
            .as_deref()
            != sockets["packet_inode"].as_str()
    {
        bail!(
            "custom Ethernet observer readiness, heartbeat, packet binding/filter or source identity mismatch"
        );
    }
    validate_program(&s["filter"])?;
    c.validate_mtu(
        s["interface"]["mtu"]
            .as_u64()
            .context("actual MTU missing")?,
    )?;
    uuid::Uuid::parse_str(
        s["boot_id"]
            .as_str()
            .context("custom Ethernet boot identity missing")?,
    )?;
    Ok(())
}
pub async fn snapshot(
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &CustomEthernetConfig,
) -> Result<Value> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    let task = async {
        let config: crate::model::ProtocolConfig = c.clone().into();
        let before = docker::owned(deployment, Some(instance)).await?;
        if before.len() != 1
            || docker::container_id(&before[0])? != source_id
            || !docker::running(&before[0])
            || !docker::matches(&before[0], &config)
        {
            bail!("custom Ethernet target ownership/configuration changed");
        }
        let view = source_view(&before[0], c, deployment, instance).await?;
        let nonce = runtime_id(&before[0])?;
        let sockets = socket_identity(&before[0], c).await?;
        let sampled = tokio::time::Instant::now();
        let s = status(&view.observer_host).await?;
        status_matches(&s, c, &nonce, &sockets)?;
        if s["filter"]["sha256"] != before[0]["Config"]["Labels"][FILTER_LABEL]
            || s["library"]["sha256"] != before[0]["Config"]["Labels"][LIBRARY_LABEL]
            || s["library"]["version"]
                != before[0]["Config"]["Labels"]["io.protocol-target-lab.custom-ethernet-library-version"]
            || !s["library"]["version"]
                .as_str()
                .is_some_and(|v| v.contains("1.10.5"))
        {
            bail!("custom Ethernet immutable compiled/library identity mismatch")
        }

        if socket_identity(&before[0], c).await? != sockets {
            bail!("custom Ethernet packet/observer endpoints changed during state observation");
        }
        let after = docker::owned(deployment, Some(instance)).await?;
        if after.len() != 1
            || docker::container_id(&after[0])? != source_id
            || !docker::running(&after[0])
            || !docker::matches(&after[0], &config)
            || after[0]["State"]["Pid"] != before[0]["State"]["Pid"]
            || after[0]["State"]["StartedAt"] != before[0]["State"]["StartedAt"]
        {
            bail!("custom Ethernet source changed during observation");
        }
        let after_view = source_view(&after[0], c, deployment, instance).await?;
        if after_view.network_id != view.network_id
            || after_view.observer_host != view.observer_host
        {
            bail!("custom Ethernet link dependency changed during observation");
        }
        if s["event_loop_age_ms"]
            .as_u64()
            .unwrap_or(u64::MAX)
            .saturating_add(sampled.elapsed().as_millis() as u64)
            > 2000
        {
            bail!("custom Ethernet event-loop sample became stale during identity verification");
        }
        Ok::<_, anyhow::Error>(s)
    };
    let result = tokio::time::timeout_at(deadline, task)
        .await
        .context("custom Ethernet readiness exceeded absolute3-second deadline")??;
    if tokio::time::Instant::now() >= deadline {
        bail!("custom Ethernet readiness exceeded absolute3-second deadline");
    }
    Ok(result)
}
fn observer_publication_overlaps(ip: &str) -> bool {
    if ["", "0.0.0.0", "127.0.0.1"].contains(&ip) {
        return true;
    }
    ip.parse::<std::net::Ipv6Addr>().ok().is_some_and(|v| {
        v.is_unspecified()
            || v.to_ipv4_mapped()
                .is_some_and(|v| v.is_unspecified() || v == std::net::Ipv4Addr::LOCALHOST)
    })
}
async fn link_preflight(
    deployment: &str,
    instance: &str,
    c: &CustomEthernetConfig,
    old: Option<&CustomEthernetConfig>,
    source_id: Option<&str>,
) -> Result<()> {
    c.validate()?;
    let source = if let (Some(old), Some(cid)) = (old, source_id) {
        let rows: Vec<Value> = serde_json::from_str(&docker::cmd(&["inspect", cid]).await?)?;
        if rows.len() != 1
            || !docker::matches(&rows[0], &old.clone().into())
            || !docker::running(&rows[0])
            || rows[0]["Config"]["Labels"][docker::OWNER] != deployment
            || rows[0]["Config"]["Labels"][docker::INSTANCE] != instance
        {
            bail!("custom Ethernet old source identity changed before preflight");
        }
        socket_identity(&rows[0], old).await?;
        Some(rows[0].clone())
    } else {
        if old.is_some() {
            bail!("custom Ethernet existing source has no exact identity");
        }
        None
    };
    if let Some(n) = network(deployment, instance).await? {
        validate_members(&n, source.as_ref(), old.unwrap_or(c), deployment, instance).await?;
    }
    if c.link.is_bridge() {
        let previous = network(deployment, instance).await?;
        let created = previous.is_none();
        let n = if let Some(n) = previous {
            n
        } else {
            create_network(deployment, instance).await?
        };
        let check = async {
            validate_members(&n, source.as_ref(), old.unwrap_or(c), deployment, instance).await?;
            check_mac_conflicts(&n, c, source_id)?;
            Ok::<_, anyhow::Error>(())
        }
        .await;
        if check.is_err() && created {
            cleanup_empty(deployment, instance, true).await?;
        }
        return check;
    }
    host_interface(c, false).await?;
    let own_observer = old.is_some_and(|o| matches!(o.link, Link::HostInterface { .. }));
    if !own_observer {
        drop(
            std::net::TcpListener::bind(("127.0.0.1", OBSERVER_PORT))
                .context("config.link: custom Ethernet private observer port is unavailable")?,
        );
    }
    // Docker may hold a NAT publication without a host listening FD.
    let ids = docker::cmd(&["ps", "-q"]).await?;
    if !ids.trim().is_empty() {
        let mut args = vec!["inspect".into()];
        args.extend(ids.split_whitespace().map(str::to_owned));
        let rows: Vec<Value> = serde_json::from_str(&docker::command(&args).await?)?;
        for v in rows {
            if v["Id"].as_str() == source_id {
                continue;
            }
            if v["NetworkSettings"]["Ports"]
                .as_object()
                .is_some_and(|ports| {
                    ports.iter().any(|(k, bindings)| {
                        k.ends_with("/tcp")
                            && bindings.as_array().is_some_and(|bs| {
                                bs.iter().any(|b| {
                                    b["HostPort"].as_str().and_then(|p| p.parse::<u16>().ok())
                                        == Some(OBSERVER_PORT)
                                        && observer_publication_overlaps(
                                            b["HostIp"].as_str().unwrap_or(""),
                                        )
                                })
                            })
                    })
                })
            {
                bail!("config.link: custom Ethernet observer conflicts with a Docker publication");
            }
        }
    }
    Ok(())
}
pub async fn network_for_start(
    deployment: &str,
    instance: &str,
    c: &CustomEthernetConfig,
) -> Result<String> {
    if !c.link.is_bridge() {
        return Ok("host".into());
    }
    let n = if let Some(n) = network(deployment, instance).await? {
        n
    } else {
        create_network(deployment, instance).await?
    };
    validate_members(&n, None, c, deployment, instance).await?;
    check_mac_conflicts(&n, c, None)?;
    Ok(net_id(&n)?.into())
}
pub async fn client_preflight(
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &CustomEthernetConfig,
    method: &str,
) -> Result<(SourceView, String)> {
    c.test_budget(method)?;
    let rows = docker::owned(deployment, Some(instance)).await?;
    if rows.len() != 1 || docker::container_id(&rows[0])? != source_id {
        bail!("custom Ethernet source changed before inverse peer test");
    }
    let view = source_view(&rows[0], c, deployment, instance).await?;
    if c.link.is_bridge() {
        let n = network(deployment, instance)
            .await?
            .context("custom Ethernet owned network missing")?;
        check_mac_conflicts(&n, c, Some(source_id))?;
        let bridge = n["Options"]["com.docker.network.bridge.name"]
            .as_str()
            .context("owned bridge interface missing")?;
        let mtu: u64 = std::fs::read_to_string(format!("/sys/class/net/{bridge}/mtu"))?
            .trim()
            .parse()?;
        crate::custom_ethernet::validate_frame_mtu(
            &crate::custom_ethernet::hex_bytes(&c.test_request.frame_hex)?,
            mtu,
            "test_request.frame_hex",
        )?;
        Ok((view, "eth0".into()))
    } else {
        let name = host_interface(c, true).await?;
        let row = interfaces()
            .await?
            .into_iter()
            .find(|v| v["ifname"] == name)
            .context("peer interface disappeared")?;
        crate::custom_ethernet::validate_frame_mtu(
            &crate::custom_ethernet::hex_bytes(&c.test_request.frame_hex)?,
            row["mtu"].as_u64().context("peer MTU missing")?,
            "test_request.frame_hex",
        )?;
        Ok((view, name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absent_compiler_diagnostic_is_case_independent_but_not_daemon_failure() {
        for text in [
            "Docker: Error: No such object: plab-compiler",
            "Docker: error: no such object: plab-compiler",
            "Docker: No such container: plab-compiler",
        ] {
            assert!(compiler_absent(text))
        }
        assert!(!compiler_absent(
            "Docker: dial unix /var/run/docker.sock: no such file or directory"
        ));
        assert!(!compiler_absent("cannot execute Docker CLI"));
    }
    #[test]
    fn installed_program_rejects_capture_clipping_or_changed_readback() {
        let make = |rows: Value| {
            let hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&rows).unwrap()));
            json!({"instructions":rows,"readback_instructions":rows,"installed":true,"sha256":hash})
        };
        assert!(validate_program(&make(json!([[6, 0, 0, 262144]]))).is_ok());
        for rows in [
            json!([[6, 0, 0, 65535]]),
            json!([[22, 0, 0, 0]]),
            json!([[6, 256, 0, 262144]]),
            json!([]),
        ] {
            assert!(validate_program(&make(rows)).is_err())
        }
        let mut valid = make(json!([[6, 0, 0, 262144]]));
        valid["readback_instructions"] = json!([[6, 0, 0, 0]]);
        assert!(validate_program(&valid).is_err());
    }
    #[test]
    fn observer_conflicts_include_mapped_and_full_ipv6_wildcards() {
        for ip in [
            "",
            "0.0.0.0",
            "127.0.0.1",
            "::",
            "0:0:0:0:0:0:0:0",
            "::ffff:127.0.0.1",
            "::ffff:0.0.0.0",
        ] {
            assert!(observer_publication_overlaps(ip), "{ip}");
        }
        for ip in ["127.0.0.2", "192.0.2.1", "::1", "::ffff:192.0.2.1"] {
            assert!(!observer_publication_overlaps(ip), "{ip}");
        }
    }
}

fn compiler_absent(message: &str) -> bool {
    let text = message.to_ascii_lowercase();
    text.contains("no such object:") || text.contains("no such container:")
}

fn valid_sha(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate_program(filter: &Value) -> Result<()> {
    let a = filter["instructions"]
        .as_array()
        .context("compiled instructions missing")?;
    if !(1..=512).contains(&a.len()) {
        bail!("compiled instruction bound")
    }
    for i in a {
        let i = i.as_array().context("BPF row")?;
        if i.len() != 4
            || i.iter().any(|v| v.as_u64().is_none())
            || i[0].as_u64().unwrap() > 65535
            || i[1].as_u64().unwrap() > 255
            || i[2].as_u64().unwrap() > 255
            || i[3].as_u64().unwrap() > u32::MAX as u64
        {
            bail!("BPF instruction range")
        };
        let code = i[0].as_u64().unwrap();
        let k = i[3].as_u64().unwrap();
        if code & 7 == 6 && (code != 6 || ![0, 262144].contains(&k)) {
            bail!("BPF capture clipping return")
        }
    }
    let hash = format!("{:x}", Sha256::digest(serde_json::to_vec(a)?));
    if filter["sha256"] != hash
        || filter["readback_instructions"] != filter["instructions"]
        || filter["installed"] != true
    {
        bail!("compiled/installed filter identity mismatch")
    };
    Ok(())
}
#[derive(Clone, Debug)]
pub struct Compilation {
    pub image: String,
    pub filter_hash: String,
    pub library_hash: String,
    pub library_version: String,
}

pub async fn preflight(
    deployment: &str,
    instance: &str,
    c: &CustomEthernetConfig,
    old: Option<&CustomEthernetConfig>,
    oldcid: Option<&str>,
    image: &str,
    session: &str,
) -> Result<Compilation> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    let previously = tokio::time::timeout_at(
        deadline - std::time::Duration::from_millis(1500),
        network(deployment, instance),
    )
    .await
    .context("compiler initial network inspection deadline")??
    .is_some();
    let job = uuid::Uuid::new_v4().to_string();
    let name = format!("plab-custom-compiler-{job}");
    let result =
        tokio::time::timeout_at(deadline - std::time::Duration::from_millis(1500), async {
            link_preflight(deployment, instance, c, old, oldcid).await?;
            let immutable = docker::image_id(image).await?;
            if !immutable.starts_with("sha256:") {
                bail!("compiler immutable image required")
            }
            let mut args = vec![
                "create".into(),
                "--name".into(),
                name.clone(),
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_RAW".into(),
                "--ipc".into(),
                "private".into(),
                "--memory".into(),
                "128m".into(),
                "--pids-limit".into(),
                "32".into(),
                "--log-opt".into(),
                "max-size=64k".into(),
                "--log-opt".into(),
                "max-file=1".into(),
            ];
            for (k, v) in [
                (docker::OWNER, deployment.to_owned()),
                (docker::INSTANCE, instance.to_owned()),
                (KIND, "custom-compiler".into()),
                (
                    "io.protocol-target-lab.custom-ethernet-compiler",
                    "true".into(),
                ),
                ("io.protocol-target-lab.candidate-config", c.observer_hash()),
                ("io.protocol-target-lab.test", "true".into()),
                ("io.protocol-target-lab.test-run", job.clone()),
                (
                    "io.protocol-target-lab.session",
                    format!("compiler-{session}"),
                ),
            ] {
                args.extend(["--label".into(), format!("{k}={v}")]);
            }
            if c.link.is_bridge() {
                let n = network(deployment, instance)
                    .await?
                    .context("compiler owned network missing")?;
                let mut chosen = None;
                for _ in 0..16 {
                    let b = uuid::Uuid::new_v4();
                    let raw = b.as_bytes();
                    let candidate = format!(
                        "02:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
                        raw[0], raw[1], raw[2], raw[3], raw[4]
                    );
                    if candidate != c.local_mac
                        && candidate != c.peer_mac
                        && !members(&n)?.values().any(|e| e["MacAddress"] == candidate)
                    {
                        chosen = Some(candidate);
                        break;
                    }
                }
                args.extend([
                    "--network".into(),
                    net_id(&n)?.into(),
                    "--mac-address".into(),
                    chosen.context("unique compiler MAC unavailable")?,
                ]);
            } else {
                args.extend(["--network".into(), "host".into()]);
            }
            args.extend([
                "--entrypoint".into(),
                "python3".into(),
                immutable.clone(),
                "-u".into(),
                "/opt/protocol-target-lab/compile.py".into(),
            ]);
            args.extend(crate::custom_ethernet::config_args(c)?);
            args.extend(["--interface".into(), c.link.interface().into()]);
            if c.link.is_bridge() {
                args.push("--verify-memberships".into());
            }
            let cid = docker::command(&args).await?.trim().to_owned();
            let rows: Vec<Value> = serde_json::from_str(&docker::cmd(&["inspect", &cid]).await?)?;
            if rows.len() != 1
                || rows[0]["Image"] != immutable
                || rows[0]["Config"]["Labels"]["io.protocol-target-lab.test-run"] != job
            {
                bail!("compiler create identity mismatch")
            }
            docker::cmd(&["start", &cid]).await?;
            let code = docker::cmd(&["wait", &cid]).await?;
            let output = docker::cmd(&["logs", &cid]).await?;
            if output.len() > 65536 {
                bail!("compiler response exceeded64KiB")
            }
            let report: Value =
                serde_json::from_str(output.trim()).context("compiler single JSON report")?;
            if code.trim() != "0" || report["passed"] != true {
                bail!(
                    "config.packet_filter: compiler probe rejected: {}",
                    report["error"].as_str().unwrap_or("unknown error")
                )
            }
            if report["schema_version"] != 1
                || report["protocol"] != "custom-ethernet"
                || report["config_sha256"] != c.observer_hash()
                || report["capture_snaplen"] != 262144
            {
                bail!("compiler report context mismatch")
            }
            if report["interface"]["name"] != c.link.interface()
                || report["interface"]["ifindex"]
                    .as_u64()
                    .is_none_or(|n| n == 0)
                || (!c.link.is_bridge() && report["interface"]["mac"] != c.local_mac)
            {
                bail!("compiler actual interface context mismatch")
            }
            validate_program(&report["filter"])?;
            c.validate_mtu(
                report["interface"]["mtu"]
                    .as_u64()
                    .context("compiler actual MTU missing")?,
            )?;
            let frame = c.frame()?;
            if report["active_frame"]["wire_length"] != frame.len()
                || report["active_frame"]["raw_sha256"] != format!("{:x}", Sha256::digest(&frame))
            {
                bail!("compiler active response mismatch")
            }
            let hash = report["library"]["sha256"]
                .as_str()
                .filter(|s| valid_sha(s))
                .context("compiler library SHA missing")?;
            let version = report["library"]["version"]
                .as_str()
                .filter(|s| s.contains("1.10.5"))
                .context("compiler library version mismatch")?;
            Ok::<_, anyhow::Error>(Compilation {
                image: immutable,
                filter_hash: report["filter"]["sha256"].as_str().unwrap().into(),
                library_hash: hash.into(),
                library_version: version.into(),
            })
        })
        .await
        .context("compiler exceeded absolute orchestration deadline")
        .and_then(|v| v);
    // Remove only our generated name after exact immutable run/owner identity verification.
    let cleanup = async {
        match docker::cmd(&["inspect", &name]).await {
            Ok(text) => {
                let rows: Vec<Value> = serde_json::from_str(&text)?;
                if rows.len() != 1
                    || rows[0]["Config"]["Labels"][docker::OWNER] != deployment
                    || rows[0]["Config"]["Labels"][docker::INSTANCE] != instance
                    || rows[0]["Config"]["Labels"]["io.protocol-target-lab.test-run"] != job
                {
                    bail!("compiler cleanup identity drift")
                };
                docker::cmd(&["rm", "-f", &docker::container_id(&rows[0])?]).await?;
            }
            Err(e) if compiler_absent(&e.to_string()) => {}
            Err(e) => return Err(e),
        }
        if result.is_err() && !previously {
            cleanup_empty(deployment, instance, true).await?;
        }
        Ok::<_, anyhow::Error>(())
    };
    let cleanup_result = tokio::time::timeout_at(deadline, cleanup)
        .await
        .context("compiler cleanup absolute deadline")
        .and_then(|v| v);
    match (result, cleanup_result) {
        (Ok(v), Ok(())) => Ok(v),
        (Err(primary), Ok(())) => Err(primary),
        (Ok(_), Err(cleanup)) => Err(cleanup),
        (Err(primary), Err(cleanup)) => Err(anyhow::anyhow!(
            "{primary}; compiler cleanup also failed: {cleanup}"
        )),
    }
}
