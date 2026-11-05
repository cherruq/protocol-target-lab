//! Owned Ethernet dependencies and passive source identity. No MPLS response is synthesized here.
use crate::{
    docker,
    mpls::{Link, MplsConfig, NETWORK_KIND, OBSERVER_PORT, RUNTIME_LABEL},
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
const KIND: &str = "io.protocol-target-lab.kind";
const NET_SCHEMA: &str = "io.protocol-target-lab.mpls-network-schema";
pub const TEST_SOURCE: &str = "io.protocol-target-lab.test-source";
pub const PARENT_NONCE: &str = "io.protocol-target-lab.mpls-parent-runtime-id";
fn network_name(deployment: &str, instance: &str) -> String {
    format!("plab-{}-{instance}-mpls-l2", &deployment[..8])
}
fn bridge_name(deployment: &str, instance: &str) -> String {
    format!(
        "plmpp{}",
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
        bail!("ambiguous owned MPLS link networks; refusing automatic cleanup");
    }
    if let Some(id) = ids.first() {
        let rows: Vec<Value> =
            serde_json::from_str(&docker::cmd(&["network", "inspect", id]).await?)?;
        if rows.len() != 1 || !network_valid(&rows[0], deployment, instance) {
            bail!("owned MPLS link network identity/configuration drift");
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
        .context("created MPLS network cannot be identified")
}
fn members(n: &Value) -> Result<&serde_json::Map<String, Value>> {
    n["Containers"]
        .as_object()
        .context("network endpoint listing missing")
}
async fn validate_members(
    n: &Value,
    source: Option<&Value>,
    c: &MplsConfig,
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
            bail!("MPLS network contains an unknown endpoint");
        };
        let labels = &peer["Config"]["Labels"];
        if source.is_none()
            || labels[docker::OWNER] != deployment
            || labels[docker::INSTANCE] != instance
            || labels["io.protocol-target-lab.test"] != "true"
            || labels[TEST_SOURCE].as_str() != source_id
            || labels[PARENT_NONCE].as_str()
                != source.and_then(|s| s["Config"]["Labels"][RUNTIME_LABEL].as_str())
            || peer["Image"] != source.unwrap()["Image"]
            || endpoint["MacAddress"] != c.client_mac
        {
            bail!(
                "config.link: foreign endpoint on owned MPLS network; refusing to detach or remove it"
            );
        }
    }
    Ok(())
}
fn check_mac_conflicts(n: &Value, c: &MplsConfig, source: Option<&str>) -> Result<()> {
    let gateway_mac = std::fs::read_to_string(format!(
        "/sys/class/net/{}/address",
        n["Options"]["com.docker.network.bridge.name"]
            .as_str()
            .context("MPLS bridge device missing")?
    ))
    .context("config.link: owned bridge actual MAC unavailable")?;
    if [c.source_mac.as_str(), c.client_mac.as_str()].contains(&gateway_mac.trim()) {
        bail!("config.mac: source/server MAC conflicts with owned bridge gateway MAC");
    }
    for (cid, e) in members(n)? {
        if Some(cid.as_str()) != source
            && [c.source_mac.as_str(), c.client_mac.as_str()]
                .contains(&e["MacAddress"].as_str().unwrap_or(""))
        {
            bail!("config.mac: role conflicts with an existing link endpoint");
        }
    }
    Ok(())
}
fn bridge_role_preflight(n: &Value, c: &MplsConfig) -> Result<()> {
    let mut actual = vec![];
    for e in members(n)?.values() {
        if let Some(ip) = e["IPv4Address"].as_str() {
            actual.push(ip.split('/').next().unwrap().to_owned());
        }
    }
    if let Some(configs) = n["IPAM"]["Config"].as_array() {
        for e in configs {
            if let Some(ip) = e["Gateway"].as_str() {
                actual.push(ip.to_owned());
            }
        }
    }
    for ip in c.role_addresses()? {
        if actual.iter().any(|s| s == &ip.to_string()) {
            bail!(
                "config.link: simulated MPLS role or mutated IP collides with an actual bridge endpoint/gateway"
            );
        }
    }
    Ok(())
}
pub async fn cleanup_empty(deployment: &str, instance: &str, strict: bool) -> Result<()> {
    if let Some(n) = network(deployment, instance).await? {
        if !members(&n)?.is_empty() {
            if strict {
                bail!("owned MPLS network still contains endpoints; preserving them");
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
            bail!("MPLS dependency changed during cleanup");
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
            .context("MPLS network workspace label missing")?;
        cleanup_empty(deployment, instance, true).await?;
    }
    Ok(())
}
pub fn runtime_id(v: &Value) -> Result<String> {
    let id = v["Config"]["Labels"][RUNTIME_LABEL]
        .as_str()
        .context("MPLS runtime nonce missing")?;
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        bail!("invalid MPLS runtime nonce");
    }
    let env = v["Config"]["Env"]
        .as_array()
        .context("MPLS environment missing")?;
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
        bail!("MPLS nonce label/environment mismatch");
    }
    Ok(id.into())
}
pub fn container_matches(v: &Value, c: &MplsConfig) -> bool {
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
        && crate::mpls::image_schemas_match(&v["Config"]["Labels"])
        && runtime_id(v).is_ok()
        && if c.link.is_bridge() {
            v["NetworkSettings"]["Networks"]
                .as_object()
                .is_some_and(|nets| {
                    nets.len() == 1
                        && nets.values().all(|e| {
                            e["MacAddress"] == c.source_mac
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
pub async fn host_interface(c: &MplsConfig, peer: bool) -> Result<String> {
    let rows = interfaces().await?;
    if peer {
        let matches = rows
            .iter()
            .filter(|v| ethernet(v, &c.client_mac))
            .collect::<Vec<_>>();
        if matches.len() != 1
            || matches[0]["ifname"] == c.link.interface()
            || matches[0]["flags"]
                .as_array()
                .is_none_or(|f| !f.iter().any(|s| s == "UP"))
        {
            bail!(
                "config.test: MPLS client needs exactly one different actual Ethernet interface matching client_mac on this host; use same-image peer with explicit --interface on the configured counterpart"
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
    if !ethernet(iface, &c.source_mac) {
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
ifindex=int(open(base+'/ifindex').read());hardware=int(open(base+'/type').read());mac=open(base+'/address').read().strip().lower();mtu=int(open(base+'/mtu').read())
if hardware!=1 or mac!=want['mac']:raise RuntimeError('MPLS actual Ethernet interface/MAC mismatch')
inodes=set()
for entry in os.listdir('/proc/1/fd'):
 try:
  value=os.readlink('/proc/1/fd/'+entry)
  if value.startswith('socket:['):inodes.add(value[8:-1])
 except FileNotFoundError:pass
if len(inodes)>128:raise RuntimeError('MPLS source FD budget exceeded')
packets=[]
with open('/proc/1/net/packet') as f:
 header=next(f).split()
 for count,line in enumerate(f):
  if count>100000:raise RuntimeError('MPLS packet table budget exceeded')
  row=dict(zip(header,line.split()));inode=row.get('Inode')
  if inode in inodes and int(row.get('Iface','0'))==ifindex and int(row.get('Type','0'))==3 and int(row.get('Proto','0'),16)==3:packets.append(inode)
tcp=[]
with open('/proc/1/net/tcp') as f:
 next(f)
 for count,line in enumerate(f):
  if count>100000:raise RuntimeError('MPLS TCP table budget exceeded')
  a=line.split()
  if len(a)<10 or a[9] not in inodes or a[3]!='0A':continue
  ip,port=a[1].split(':');ip=socket.inet_ntoa(bytes.fromhex(ip)[::-1])
  if ip==want['observer_ip'] and int(port,16)==want['observer_port']:tcp.append(a[9])
if len(packets)!=1 or len(tcp)!=1:raise RuntimeError('MPLS exact source PID does not own unique packet and observer endpoints')
print(json.dumps(dict(interface=name,ifindex=ifindex,hardware_type=hardware,mac=mac,mtu=mtu,packet_inode=packets[0],observer_inode=tcp[0])))
"#;
async fn socket_identity(v: &Value, c: &MplsConfig) -> Result<Value> {
    if v["State"]["Pid"].as_u64().unwrap_or(0) == 0 {
        bail!("MPLS source PID not running");
    }
    let want = json!({"interface":c.link.interface(),"mac":c.source_mac,"observer_ip":if c.link.is_bridge(){"0.0.0.0"}else{"127.0.0.1"},"observer_port":OBSERVER_PORT});
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
            .context("MPLS source kernel socket identity inspection failed")?,
    )?)
}
#[derive(Clone, Debug)]
pub struct SourceView {
    pub observer_host: String,
    pub network_id: Option<String>,
}
async fn source_view(
    v: &Value,
    c: &MplsConfig,
    deployment: &str,
    instance: &str,
) -> Result<SourceView> {
    if !container_matches(v, c) {
        bail!("MPLS exact source container capability/network drift");
    }
    if c.link.is_bridge() {
        let n = network(deployment, instance)
            .await?
            .context("MPLS owned network missing")?;
        validate_members(&n, Some(v), c, deployment, instance).await?;
        let entry = &v["NetworkSettings"]["Networks"][network_name(deployment, instance)];
        let id = net_id(&n)?;
        if entry["NetworkID"] != id || !members(&n)?.contains_key(&docker::container_id(v)?) {
            bail!("MPLS source endpoint is not in its exact owned network");
        }
        let host = entry["IPAddress"]
            .as_str()
            .context("MPLS private observer address missing")?;
        let ip: std::net::Ipv4Addr = host.parse()?;
        if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() {
            bail!("invalid MPLS private observer address");
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
        bail!("MPLS private observer returned {}", response.status());
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > 65536 {
            bail!("MPLS observer exceeded64KiB");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}
fn status_matches(s: &Value, c: &MplsConfig, nonce: &str, sockets: &Value) -> Result<()> {
    if s["schema_version"] != 1
        || s["protocol"] != "mpls"
        || s["runtime_id"] != nonce
        || s["config_sha256"] != c.observer_hash()
        || s["worker_ready_after_bind"] != true
        || s["event_loop_age_ms"].as_u64().is_none_or(|n| n > 2000)
        || s["link_mode"] != c.link.mode()
        || s["scenario"] != c.scenario.mode()
        || s["label"] != c.label
        || s["reply_ttl"] != c.reply_ttl
        || s["packet_auxdata"] != true
        || s["interface"]["name"] != c.link.interface()
        || s["interface"]["ifindex"] != sockets["ifindex"]
        || s["interface"]["hardware_type"] != 1
        || s["interface"]["mtu"] != sockets["mtu"]
        || s["interface"]["mac"] != c.source_mac
        || s["filter"]["attached"] != true
        || s["filter"]["name"] != "mpls-unicast-ethertype-v1"
        || s["filter"]["instructions"] != json!(crate::mpls::FILTER)
        || s["filter"]["sha256"] != crate::mpls::FILTER_HASH
        || s["filter"]["packet_socket_inode"]
            .as_u64()
            .map(|n| n.to_string())
            .as_deref()
            != sockets["packet_inode"].as_str()
    {
        bail!(
            "MPLS observer readiness, heartbeat, packet binding/filter or source identity mismatch"
        );
    }
    uuid::Uuid::parse_str(
        s["boot_id"]
            .as_str()
            .context("MPLS boot identity missing")?,
    )?;
    Ok(())
}
pub async fn snapshot(
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &MplsConfig,
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
            bail!("MPLS target ownership/configuration changed");
        }
        let view = source_view(&before[0], c, deployment, instance).await?;
        let nonce = runtime_id(&before[0])?;
        let sockets = socket_identity(&before[0], c).await?;
        let sampled = tokio::time::Instant::now();
        let s = status(&view.observer_host).await?;
        status_matches(&s, c, &nonce, &sockets)?;
        if socket_identity(&before[0], c).await? != sockets {
            bail!("MPLS packet/observer endpoints changed during state observation");
        }
        let after = docker::owned(deployment, Some(instance)).await?;
        if after.len() != 1
            || docker::container_id(&after[0])? != source_id
            || !docker::running(&after[0])
            || !docker::matches(&after[0], &config)
            || after[0]["State"]["Pid"] != before[0]["State"]["Pid"]
            || after[0]["State"]["StartedAt"] != before[0]["State"]["StartedAt"]
        {
            bail!("MPLS source changed during observation");
        }
        let after_view = source_view(&after[0], c, deployment, instance).await?;
        if after_view.network_id != view.network_id
            || after_view.observer_host != view.observer_host
        {
            bail!("MPLS link dependency changed during observation");
        }
        if s["event_loop_age_ms"]
            .as_u64()
            .unwrap_or(u64::MAX)
            .saturating_add(sampled.elapsed().as_millis() as u64)
            > 2000
        {
            bail!("MPLS event-loop sample became stale during identity verification");
        }
        Ok::<_, anyhow::Error>(s)
    };
    let result = tokio::time::timeout_at(deadline, task)
        .await
        .context("MPLS readiness exceeded absolute3-second deadline")??;
    if tokio::time::Instant::now() >= deadline {
        bail!("MPLS readiness exceeded absolute3-second deadline");
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
async fn host_role_preflight(c: &MplsConfig) -> Result<()> {
    if c.link.is_bridge() {
        return Ok(());
    }
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::process::Command::new("ip")
            .args(["-j", "-4", "addr", "show"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("MPLS address inspection deadline")??;
    if !out.status.success() || out.stdout.len() > 1048576 {
        bail!("MPLS actual role address inspection failed");
    }
    let rows: Vec<Value> = serde_json::from_slice(&out.stdout)?;
    let roles = c.role_addresses()?;
    for row in rows {
        if let Some(addrs) = row["addr_info"].as_array() {
            for a in addrs {
                if a["local"]
                    .as_str()
                    .is_some_and(|s| roles.iter().any(|ip| ip.to_string() == s))
                {
                    bail!(
                        "config.test: simulated MPLS role or mutated IP collides with an existing OS address; refusing kernel ICMP contamination"
                    );
                }
            }
        }
    }
    // No module loading or mutation. Inspect only when native MPLS is present in this namespace.
    if std::path::Path::new("/proc/sys/net/mpls/platform_labels").exists() {
        let out = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            tokio::process::Command::new("ip")
                .args(["-j", "-f", "mpls", "route", "show"])
                .kill_on_drop(true)
                .output(),
        )
        .await
        .context("MPLS route inspection deadline")??;
        if !out.status.success() || out.stdout.len() > 1048576 {
            bail!("config.link: cannot inspect native MPLS routes safely");
        }
        let rows: Vec<Value> = serde_json::from_slice(&out.stdout)?;
        for row in rows {
            if row["dst"]
                .as_str()
                .is_some_and(|s| s.split('/').next() == Some(c.label.to_string().as_str()))
                || row["dst"].as_u64() == Some(c.label as u64)
            {
                bail!(
                    "config.label: matching native MPLS route already exists; use an isolated interface/namespace"
                );
            }
        }
    }
    Ok(())
}
pub async fn preflight(
    deployment: &str,
    instance: &str,
    c: &MplsConfig,
    old: Option<&MplsConfig>,
    source_id: Option<&str>,
) -> Result<()> {
    c.validate()?;
    host_role_preflight(c).await?;
    let source = if let (Some(old), Some(cid)) = (old, source_id) {
        let rows: Vec<Value> = serde_json::from_str(&docker::cmd(&["inspect", cid]).await?)?;
        if rows.len() != 1
            || !docker::matches(&rows[0], &old.clone().into())
            || !docker::running(&rows[0])
            || rows[0]["Config"]["Labels"][docker::OWNER] != deployment
            || rows[0]["Config"]["Labels"][docker::INSTANCE] != instance
        {
            bail!("MPLS old source identity changed before preflight");
        }
        socket_identity(&rows[0], old).await?;
        Some(rows[0].clone())
    } else {
        if old.is_some() {
            bail!("MPLS existing source has no exact identity");
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
            bridge_role_preflight(&n, c)?;
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
                .context("config.link: MPLS private observer port is unavailable")?,
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
                bail!("config.link: MPLS observer conflicts with a Docker publication");
            }
        }
    }
    Ok(())
}
pub async fn network_for_start(deployment: &str, instance: &str, c: &MplsConfig) -> Result<String> {
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
    bridge_role_preflight(&n, c)?;
    Ok(net_id(&n)?.into())
}
pub async fn client_preflight(
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &MplsConfig,
    method: &str,
) -> Result<(SourceView, String)> {
    c.test_budget(method)?;
    host_role_preflight(c).await?;
    let rows = docker::owned(deployment, Some(instance)).await?;
    if rows.len() != 1 || docker::container_id(&rows[0])? != source_id {
        bail!("MPLS source changed before MPLS client test");
    }
    let view = source_view(&rows[0], c, deployment, instance).await?;
    if c.link.is_bridge() {
        let n = network(deployment, instance)
            .await?
            .context("MPLS owned network missing")?;
        check_mac_conflicts(&n, c, Some(source_id))?;
        bridge_role_preflight(&n, c)?;
        Ok((view, "eth0".into()))
    } else {
        Ok((view, host_interface(c, true).await?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
