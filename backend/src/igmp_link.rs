//! Owned Ethernet dependencies and passive source identity. No IGMP response is synthesized here.
use crate::{
    docker,
    igmp::{IgmpConfig, Link, NETWORK_KIND, OBSERVER_PORT, RUNTIME_LABEL},
    storage::Settings,
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
const KIND: &str = "io.protocol-target-lab.kind";
const NET_SCHEMA: &str = "io.protocol-target-lab.igmp-network-schema";
pub const TEST_SOURCE: &str = "io.protocol-target-lab.test-source";
pub const PARENT_NONCE: &str = "io.protocol-target-lab.igmp-parent-runtime-id";
fn network_name(deployment: &str, instance: &str) -> String {
    format!("plab-{}-{instance}-igmp-l2", &deployment[..8])
}
fn bridge_name(deployment: &str, instance: &str) -> String {
    format!(
        "pligb{}",
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
        bail!("ambiguous owned IGMP link networks; refusing automatic cleanup");
    }
    if let Some(id) = ids.first() {
        let rows: Vec<Value> =
            serde_json::from_str(&docker::cmd(&["network", "inspect", id]).await?)?;
        if rows.len() != 1 || !network_valid(&rows[0], deployment, instance) {
            bail!("owned IGMP link network identity/configuration drift");
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
        .context("created IGMP network cannot be identified")
}
fn members(n: &Value) -> Result<&serde_json::Map<String, Value>> {
    n["Containers"]
        .as_object()
        .context("network endpoint listing missing")
}
async fn validate_members(
    n: &Value,
    source: Option<&Value>,
    _c: &IgmpConfig,
    deployment: &str,
    instance: &str,
) -> Result<()> {
    let source_id = source.and_then(|s| s["Id"].as_str());
    for cid in members(n)?.keys() {
        if Some(cid.as_str()) == source_id {
            continue;
        }
        let rows: Vec<Value> = serde_json::from_str(&docker::cmd(&["inspect", cid]).await?)?;
        let Some(peer) = rows.first().filter(|_| rows.len() == 1) else {
            bail!("IGMP network contains an unknown endpoint");
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
        {
            bail!(
                "config.link: foreign endpoint on owned IGMP network; refusing to detach or remove it"
            );
        }
    }
    Ok(())
}
pub async fn cleanup_empty(deployment: &str, instance: &str, strict: bool) -> Result<()> {
    if let Some(n) = network(deployment, instance).await? {
        if !members(&n)?.is_empty() {
            if strict {
                bail!("owned IGMP network still contains endpoints; preserving them");
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
            bail!("IGMP dependency changed during cleanup");
        }
        docker::cmd(&["network", "rm", net_id(&n)?]).await?;
    }
    Ok(())
}
async fn cleanup_bridge_deployment(deployment: &str) -> Result<()> {
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
            .context("IGMP network workspace label missing")?;
        cleanup_empty(deployment, instance, true).await?;
    }
    Ok(())
}

pub fn runtime_id(v: &Value) -> Result<String> {
    let id = v["Config"]["Labels"][RUNTIME_LABEL]
        .as_str()
        .context("IGMP runtime nonce missing")?;
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        bail!("invalid IGMP runtime nonce")
    }
    let env = v["Config"]["Env"]
        .as_array()
        .context("IGMP environment missing")?;
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
        bail!("IGMP runtime label/env mismatch")
    }
    Ok(id.into())
}
pub fn container_matches(v: &Value, c: &IgmpConfig) -> bool {
    let empty = |v: &Value| v.is_null() || v.as_object().is_some_and(|o| o.is_empty());
    v["Config"]["User"] == "0:0"
        && v["HostConfig"]["Privileged"] == false
        && v["HostConfig"]["IpcMode"] == "private"
        && ["", "private"].contains(&v["HostConfig"]["PidMode"].as_str().unwrap_or("invalid"))
        && empty(&v["HostConfig"]["PortBindings"])
        && empty(&v["HostConfig"]["Sysctls"])
        && v["Mounts"].as_array().is_some_and(|a| a.is_empty())
        && v["HostConfig"]["Devices"]
            .as_array()
            .is_some_and(|a| a.is_empty())
        && v["HostConfig"]["CapDrop"] == json!(["ALL"])
        && [json!(["NET_RAW"]), json!(["CAP_NET_RAW"])].contains(&v["HostConfig"]["CapAdd"])
        && ["membership", "response", "client", "control", "observer"]
            .iter()
            .all(|k| {
                v["Config"]["Labels"][format!("io.protocol-target-lab.igmp-{k}-schema")] == "1"
            })
        && runtime_id(v).is_ok()
        && if c.link.is_bridge() {
            v["NetworkSettings"]["Networks"].as_object().is_some_and(|n|n.len()==1&&n.values().all(|e|e["NetworkID"]==v["HostConfig"]["NetworkMode"]&&e["DriverOpts"]==json!({"com.docker.network.endpoint.sysctls":"net.ipv4.conf.ifname.force_igmp_version=2"})))
        } else {
            v["HostConfig"]["NetworkMode"] == "host"
        }
}
async fn ip_json(args: &[&str]) -> Result<Value> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::process::Command::new("ip")
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("IGMP interface inspection deadline")??;
    if !out.status.success() || out.stdout.len() > 1048576 {
        bail!("config.link: cannot inspect actual interface; iproute2 required")
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}
async fn actual_interface(name: &str, expected_ip: Option<&str>) -> Result<Value> {
    crate::igmp::interface_name(name)?;
    let rows = ip_json(&["-j", "link", "show", "dev", name]).await?;
    let link = rows
        .as_array()
        .and_then(|a| a.first())
        .context("IGMP interface missing")?;
    if link["link_type"] != "ether"
        || link["flags"]
            .as_array()
            .is_none_or(|a| !a.iter().any(|v| v == "UP"))
    {
        bail!("config.link: actual UP Ethernet interface required")
    }
    let rows = ip_json(&["-j", "-4", "address", "show", "dev", name]).await?;
    let addresses = rows
        .as_array()
        .and_then(|a| a.first())
        .and_then(|r| r["addr_info"].as_array())
        .context("IGMP IPv4 addresses missing")?;
    if addresses.len() != 1 || addresses[0]["family"] != "inet" || addresses[0]["secondary"] == true
    {
        bail!("config.link: exactly one primary IPv4 required")
    }
    let ip = addresses[0]["local"]
        .as_str()
        .context("primary IPv4 missing")?;
    if expected_ip.is_some_and(|e| e != ip) {
        bail!("config.link.interface_ip: configured address is not actual unique primary")
    }
    Ok(
        json!({"name":name,"ifindex":link["ifindex"],"hardware_type":1,"mac":link["address"],"primary_ipv4":ip,"prefixlen":addresses[0]["prefixlen"],"mtu":link["mtu"]}),
    )
}
async fn helper(settings: &Settings, action: &str, spec: &Value) -> Result<Value> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(if action == "_cleanup_package" {
            31
        } else if action == "start" || action == "_preflight" {
            11
        } else {
            6
        }),
        tokio::process::Command::new("/usr/bin/python3")
            .arg("-I")
            .arg(&settings.igmp_link_helper)
            .args([action, "--spec-json", &spec.to_string(), "--state-dir"])
            .arg(settings.data.join("igmp-links"))
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("IGMP native link helper deadline")??;
    if out.stdout.len() > 65536 || out.stderr.len() > 65536 {
        bail!("IGMP link helper output exceeded64KiB")
    }
    let v: Value = serde_json::from_slice(&out.stdout).context("IGMP helper single JSON report")?;
    if !out.status.success() || v["passed"] != true {
        bail!(
            "config.link: IGMP helper {}",
            v["error"].as_str().unwrap_or("runtime failure")
        )
    }
    Ok(v)
}
#[derive(Clone, Debug)]
pub struct SourceContext {
    pub network_mode: String,
    pub interface: String,
    pub interface_ip: Option<String>,
}
pub async fn network_for_start(deployment: &str, instance: &str, c: &IgmpConfig) -> Result<String> {
    if !c.link.is_bridge() {
        return Ok("host".into());
    }
    let n = if let Some(n) = network(deployment, instance).await? {
        n
    } else {
        create_network(deployment, instance).await?
    };
    validate_members(&n, None, c, deployment, instance).await?;
    Ok(net_id(&n)?.into())
}
pub async fn prepare_start(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    c: &IgmpConfig,
) -> Result<SourceContext> {
    c.validate()?;
    match &c.link {
        Link::DockerBridge {} => Ok(SourceContext {
            network_mode: network_for_start(deployment, instance, c).await?,
            interface: "eth0".into(),
            interface_ip: None,
        }),
        Link::HostInterface {
            interface,
            interface_ip,
            ..
        } => {
            actual_interface(interface, Some(interface_ip)).await?;
            Ok(SourceContext {
                network_mode: "host".into(),
                interface: interface.clone(),
                interface_ip: Some(interface_ip.clone()),
            })
        }
        Link::OwnedVxlan { .. } => {
            let r = helper(
                settings,
                "start",
                &c.helper_spec(deployment, instance, None)?,
            )
            .await?;
            let i = &r["interface"];
            Ok(SourceContext {
                network_mode: "host".into(),
                interface: i["name"]
                    .as_str()
                    .context("helper interface missing")?
                    .into(),
                interface_ip: Some(
                    i["primary_ipv4"]
                        .as_str()
                        .context("helper primary IPv4 missing")?
                        .into(),
                ),
            })
        }
    }
}
pub async fn stop_link(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    c: &IgmpConfig,
) -> Result<()> {
    if matches!(c.link, Link::OwnedVxlan { .. }) {
        helper(
            settings,
            "stop",
            &c.helper_spec(deployment, instance, None)?,
        )
        .await?;
    }
    Ok(())
}
pub async fn cleanup_deployment(settings: &Settings, deployment: &str) -> Result<()> {
    cleanup_bridge_deployment(deployment).await?;
    // Helper deployment cleanup is typed and local; it checks each persistent receipt.
    if settings.data.join("igmp-links").try_exists()? {
        let spec = json!({"schema_version":1,"deployment_id":deployment});
        helper(settings, "_cleanup_deployment", &spec).await?;
    }
    Ok(())
}
/// Clean only receipts in this installation's package-owned helper state root,
/// including explicit peers whose deployment UUID differs from the manager doc.
pub async fn cleanup_package(settings: &Settings) -> Result<()> {
    if settings.data.join("igmp-links").try_exists()? {
        helper(settings, "_cleanup_package", &json!({"schema_version":1})).await?;
    }
    Ok(())
}
#[derive(Clone, Debug)]
pub struct SourceView {
    pub network_id: Option<String>,
    pub observer_host: String,
    pub interface: String,
    pub source_ip: String,
    pub target_ip: String,
    pub target_mac: String,
}
#[derive(Clone, Debug, PartialEq)]
struct NativeView {
    network_id: Option<String>,
    observer_host: String,
    interface: Value,
    owned_link: Option<Value>,
}
async fn source_view(
    settings: &Settings,
    v: &Value,
    c: &IgmpConfig,
    deployment: &str,
    instance: &str,
) -> Result<NativeView> {
    if !container_matches(v, c) {
        bail!("IGMP exact source capability/network drift")
    }
    match &c.link {
        Link::DockerBridge {} => {
            let n = network(deployment, instance)
                .await?
                .context("IGMP owned network missing")?;
            validate_members(&n, Some(v), c, deployment, instance).await?;
            let e = &v["NetworkSettings"]["Networks"][network_name(deployment, instance)];
            let id = net_id(&n)?;
            if e["NetworkID"] != id || !members(&n)?.contains_key(&docker::container_id(v)?) {
                bail!("IGMP source endpoint is not in exact owned network")
            }
            let host = e["IPAddress"]
                .as_str()
                .context("IGMP observer primary missing")?;
            let ip: std::net::Ipv4Addr = host.parse()?;
            if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() {
                bail!("invalid source endpoint IPv4")
            }
            Ok(NativeView {
                owned_link: None,
                network_id: Some(id.into()),
                observer_host: host.into(),
                interface: json!({"name":"eth0","mac":e["MacAddress"],"primary_ipv4":host,"prefixlen":e["IPPrefixLen"]}),
            })
        }
        Link::HostInterface {
            interface,
            interface_ip,
            ..
        } => Ok(NativeView {
            owned_link: None,
            network_id: None,
            observer_host: "127.0.0.1".into(),
            interface: actual_interface(interface, Some(interface_ip)).await?,
        }),
        Link::OwnedVxlan { .. } => {
            let r = helper(
                settings,
                "status",
                &c.helper_spec(deployment, instance, None)?,
            )
            .await?;
            if r["ready"] != true || r["matches_requested"] != true {
                bail!("IGMP owned native link not ready/matching")
            };
            Ok(NativeView {
                owned_link: Some(
                    json!({"ready":r["ready"],"matches_requested":r["matches_requested"],"interface":r["interface"],"receipt":r["receipt"]}),
                ),
                network_id: None,
                observer_host: "127.0.0.1".into(),
                interface: r["interface"].clone(),
            })
        }
    }
}
const SOCKET_PROBE: &str = r#"import os,sys,json,socket,re
w=json.loads(sys.argv[1]);name=w['name'];index=int(open('/sys/class/net/'+name+'/ifindex').read());mac=open('/sys/class/net/'+name+'/address').read().strip()
if mac!=w['mac']:raise RuntimeError('actual source MAC mismatch')
inodes=set()
for f in os.listdir('/proc/1/fd'):
 try:
  v=os.readlink('/proc/1/fd/'+f)
  if v.startswith('socket:['):inodes.add(v[8:-1])
 except FileNotFoundError:pass
if len(inodes)>128:raise RuntimeError('source FD budget')
packets=[]
with open('/proc/1/net/packet') as f:
 h=next(f).split()
 for n,line in enumerate(f):
  if n>100000:raise RuntimeError('packet row budget')
  r=dict(zip(h,line.split()))
  if r.get('Inode') in inodes and int(r.get('Iface','0'))==index and int(r.get('Type','0'))==3 and int(r.get('Proto','0'),16)==3:packets.append(r['Inode'])
def table(which,port,ip):
 found=[]
 with open('/proc/1/net/'+which) as f:
  next(f)
  for n,line in enumerate(f):
   if n>100000:raise RuntimeError('socket row budget')
   r=line.split()
   if len(r)<10 or r[9] not in inodes:continue
   addr,p=r[1].split(':');addr=socket.inet_ntoa(bytes.fromhex(addr)[::-1])
   if addr==ip and (port is None or int(p,16)==port) and (which!='tcp' or r[3]=='0A'):found.append({'inode':r[9],'port':int(p,16)})
 return found
udp=table('udp',None,w['ip']);tcp=table('tcp',18088,w['observer_ip'])
if len(packets)!=1 or len(udp)!=1 or len(tcp)!=1:raise RuntimeError('exact native source endpoints not unique')
selected=False;groups={}
with open('/proc/1/net/igmp') as f:
 for n,line in enumerate(f):
  if n>100000:raise RuntimeError('IGMP group row budget')
  values=line.split();header=re.match(r'^\s*[0-9]+\s+([^\s:]+)\s*:',line)
  if header:selected=header.group(1)==name
  elif selected and len(values)>=4:
   try:group=socket.inet_ntoa(bytes.fromhex(values[0])[::-1]);groups[group]=int(values[1])
   except (ValueError,OSError):pass
if any(groups.get(g,0)<1 for g in w['groups']):raise RuntimeError('actual configured kernel group reference missing')
ns=os.stat('/proc/1/ns/net')
print(json.dumps({'configured_groups_present':True,'kernel_release':os.uname().release,'ifindex':index,'packet_inode':packets[0],'udp_inode':udp[0]['inode'],'udp_port':udp[0]['port'],'observer_inode':tcp[0]['inode'],'network_namespace':{'device':ns.st_dev,'inode':ns.st_ino}}))
"#;
async fn socket_identity(v: &Value, view: &NativeView, c: &IgmpConfig) -> Result<Value> {
    let want = json!({"name":view.interface["name"],"mac":view.interface["mac"],"ip":view.interface["primary_ipv4"],"observer_ip":if c.link.is_bridge(){"0.0.0.0"}else{"127.0.0.1"},"groups":c.groups});
    let out = docker::command(&[
        "exec".into(),
        "--user".into(),
        "0:0".into(),
        docker::container_id(v)?,
        "python3".into(),
        "-I".into(),
        "-c".into(),
        SOCKET_PROBE.into(),
        want.to_string(),
    ])
    .await?;
    Ok(serde_json::from_str(&out)?)
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
        bail!("IGMP observer HTTP status")
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > 65536 {
            bail!("IGMP observer exceeded64KiB")
        };
        body.extend_from_slice(&chunk)
    }
    Ok(serde_json::from_slice(&body)?)
}
pub async fn snapshot(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &IgmpConfig,
) -> Result<Value> {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let config: crate::model::ProtocolConfig = c.clone().into();
        let before = docker::owned(deployment, Some(instance)).await?;
        if before.len() != 1
            || docker::container_id(&before[0])? != source_id
            || !docker::running(&before[0])
            || !docker::matches(&before[0], &config)
        {
            bail!("IGMP source ownership/config drift")
        }
        let view = source_view(settings, &before[0], c, deployment, instance).await?;
        let sockets = socket_identity(&before[0], &view, c).await?;
        let sampled = tokio::time::Instant::now();
        let mut s = status(&view.observer_host).await?;
        if s["schema_version"] != 1
            || s["protocol"] != "igmp"
            || s["runtime_id"] != runtime_id(&before[0])?
            || s["config_sha256"] != c.observer_hash()
            || s["worker_ready_after_bind"] != true
            || s["interface"]["name"] != view.interface["name"]
            || s["interface"]["mac"] != view.interface["mac"]
            || s["interface"]["primary_ipv4"] != view.interface["primary_ipv4"]
            || s["interface"]["ifindex"] != sockets["ifindex"]
            || s["kernel"]["network_namespace"] != sockets["network_namespace"]
            || s["kernel"]["release"] != sockets["kernel_release"]
            || sockets["configured_groups_present"] != true
        {
            bail!("IGMP native source status/interface/namespace mismatch")
        }
        for (field, expected) in [("packet_socket_inode", &sockets["packet_inode"])] {
            if s[field].as_u64().map(|n| n.to_string()).as_deref() != expected.as_str() {
                bail!("IGMP actual packet socket inode mismatch")
            }
        }
        if s["membership"]["udp_socket_inode"]
            .as_u64()
            .map(|n| n.to_string())
            .as_deref()
            != sockets["udp_inode"].as_str()
            || s["membership"]["udp_local_address"]
                != json!([view.interface["primary_ipv4"], sockets["udp_port"]])
        {
            bail!("IGMP actual membership socket mismatch")
        }
        let groups = s["membership"]["groups"]
            .as_array()
            .context("native groups missing")?;
        if groups.len() != c.groups.len()
            || groups.iter().zip(&c.groups).any(|(v, g)| {
                v["group"] != *g || v["current_kernel_refs"].as_u64().is_none_or(|n| n < 1)
            })
        {
            bail!("IGMP kernel membership references missing")
        }
        if c.link.is_bridge() && s["parameters"]["current"]["interface_force"] != 2 {
            bail!("IGMP dedicated interface force-version drift")
        }
        uuid::Uuid::parse_str(s["boot_id"].as_str().context("IGMP boot missing")?)?;
        if socket_identity(&before[0], &view, c).await? != sockets {
            bail!("IGMP kernel source sockets changed")
        }
        let after = docker::owned(deployment, Some(instance)).await?;
        if after.len() != 1
            || docker::container_id(&after[0])? != source_id
            || !docker::running(&after[0])
            || !docker::matches(&after[0], &config)
            || after[0]["State"]["Pid"] != before[0]["State"]["Pid"]
            || after[0]["State"]["StartedAt"] != before[0]["State"]["StartedAt"]
            || source_view(settings, &after[0], c, deployment, instance).await? != view
        {
            bail!("IGMP source or native link changed during snapshot")
        }
        if s["event_loop_age_ms"]
            .as_u64()
            .unwrap_or(u64::MAX)
            .saturating_add(sampled.elapsed().as_millis() as u64)
            > 2000
        {
            bail!("IGMP native main-loop sample stale")
        }
        if let Some(owned) = view.owned_link {
            s["owned_link"] = owned;
        }
        Ok::<_, anyhow::Error>(s)
    })
    .await
    .context("IGMP readiness exceeded absolute3-second deadline")?
}
pub async fn preflight(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    c: &IgmpConfig,
    old: Option<&IgmpConfig>,
    oldcid: Option<&str>,
) -> Result<()> {
    c.validate()?;
    let source = if let (Some(old), Some(cid)) = (old, oldcid) {
        let rows = docker::owned(deployment, Some(instance)).await?;
        if rows.len() != 1
            || docker::container_id(&rows[0])? != cid
            || !docker::matches(&rows[0], &old.clone().into())
        {
            bail!("IGMP old source identity changed")
        };
        Some(rows[0].clone())
    } else {
        None
    };
    if let Some(n) = network(deployment, instance).await? {
        validate_members(&n, source.as_ref(), old.unwrap_or(c), deployment, instance).await?;
    }
    match &c.link {
        Link::DockerBridge {} => {}
        Link::HostInterface {
            interface,
            interface_ip,
            ..
        } => {
            actual_interface(interface, Some(interface_ip)).await?;
        }
        Link::OwnedVxlan { .. } => {
            helper(
                settings,
                "_preflight",
                &c.helper_spec(deployment, instance, None)?,
            )
            .await?;
        }
    }
    if !c.link.is_bridge() && old.is_none_or(|o| o.link.is_bridge()) {
        drop(
            std::net::TcpListener::bind(("127.0.0.1", OBSERVER_PORT))
                .context("config.link: IGMP private observer occupied")?,
        );
    }
    Ok(())
}
pub async fn client_preflight(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &IgmpConfig,
    method: &str,
) -> Result<SourceView> {
    let rounds = c.rounds(method)?;
    let s = snapshot(settings, deployment, instance, source_id, c).await?;
    if s["testability"]["available"] != true {
        bail!(
            "config.test: native IGMP causal test unavailable: {}",
            s["testability"]["reason"]
        )
    }
    if s["testability"]["remaining_warmup_upper_ms"]
        .as_u64()
        .context("warmup bound missing")?
        .saturating_add(rounds * 12000 + 10000)
        > 90000
    {
        bail!("config.test: conservative native startup bound exceeds selected90s budget")
    }
    let rows = docker::owned(deployment, Some(instance)).await?;
    if rows.len() != 1 || docker::container_id(&rows[0])? != source_id {
        bail!("IGMP source changed before peer")
    };
    let v = source_view(settings, &rows[0], c, deployment, instance).await?;
    let (interface, source_ip) = match &c.link {
        Link::DockerBridge {} => ("eth0".into(), "auto".into()),
        Link::HostInterface {
            interface,
            peer_interface,
            ..
        } => {
            let peer=peer_interface.as_ref().context("config.test: explicit different peer_interface required, otherwise use external client")?;
            if peer == interface {
                bail!("peer interface must differ")
            };
            let info = actual_interface(peer, None).await?;
            if info["mac"] == v.interface["mac"]
                || info["primary_ipv4"] == v.interface["primary_ipv4"]
            {
                bail!("actual peer roles must differ")
            };
            (peer.clone(), info["primary_ipv4"].as_str().unwrap().into())
        }
        Link::OwnedVxlan {
            peer_inner_ip,
            peer_inner_mac,
            ..
        } => {
            let r = helper(
                settings,
                "_peer_status",
                &c.helper_spec(deployment, instance, None)?,
            )
            .await?;
            if r["ready"] != true {
                bail!("config.test: no exact local peer helper receipt; use explicit external peer")
            }
            let i = &r["interface"];
            if i["primary_ipv4"] != *peer_inner_ip || i["mac"] != *peer_inner_mac {
                bail!("config.test: peer receipt actual IP/MAC differs from configured peer role")
            }
            (
                i["name"]
                    .as_str()
                    .context("peer receipt interface missing")?
                    .into(),
                i["primary_ipv4"]
                    .as_str()
                    .context("peer receipt IPv4 missing")?
                    .into(),
            )
        }
    };
    Ok(SourceView {
        network_id: v.network_id,
        observer_host: v.observer_host,
        interface,
        source_ip,
        target_ip: v.interface["primary_ipv4"].as_str().unwrap().into(),
        target_mac: v.interface["mac"].as_str().unwrap().into(),
    })
}
