//! Private DCP/PTCP Ethernet resources. Receipts bind exact resources across manager restarts.
pub use crate::profinet::RUNTIME_LABEL;
use crate::{docker, model::ProtocolConfig, profinet::ProfinetConfig, storage::Settings};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
pub const TEST_SOURCE: &str = "io.protocol-target-lab.test-source";
pub const PARENT_NONCE: &str = "io.protocol-target-lab.profinet-parent-runtime-id";
const KIND: &str = "io.protocol-target-lab.kind";
const STORE_PATH: &str = "/var/lib/protocol-target-lab/profinet-native";
const ABI: &str = "pnet-v0.2.0-linux-x86_64-v1";
const RUN_TMPFS: &str = "rw,noexec,nosuid,nodev,size=2097152,mode=0700";
fn own_uid() -> Result<u32> {
    Ok(fs::metadata("/proc/self")?.uid())
}
fn trusted(path: &Path, directory: bool) -> Result<()> {
    let m = fs::symlink_metadata(path)?;
    if m.file_type().is_symlink()
        || m.uid() != own_uid()?
        || m.mode() & 0o077 != 0
        || (if directory {
            !m.is_dir()
        } else {
            !m.is_file() || m.nlink() != 1
        })
    {
        bail!("PROFINET trusted recovery path changed: {}", path.display());
    }
    Ok(())
}
fn state_dir(settings: &Settings) -> Result<PathBuf> {
    let data = &settings.data;
    // Reject symlink traversal, including an accidentally redirected custom data directory.
    for parent in data.ancestors() {
        if parent.as_os_str().is_empty() {
            continue;
        }
        if fs::symlink_metadata(parent)?.file_type().is_symlink() {
            bail!("PROFINET state path contains a symlink")
        }
    }
    let path = data.join("profinet");
    match fs::create_dir(&path) {
        Ok(()) => fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.into()),
    }
    trusted(&path, true)?;
    Ok(path)
}
fn receipt_path(settings: &Settings, instance: &str) -> Result<PathBuf> {
    if !crate::model::valid_id(instance) {
        bail!("invalid PROFINET workspace identity")
    }
    Ok(state_dir(settings)?.join(format!("{instance}.json")))
}
fn names(deployment: &str, instance: &str) -> (String, String, String, String, String) {
    let hash = format!(
        "{:x}",
        Sha256::digest(format!("{deployment}/{instance}").as_bytes())
    );
    (
        format!("plab-{}-{instance}-pn-mgmt", &deployment[..8]),
        format!("plab-{}-{instance}-pn-data", &deployment[..8]),
        format!("plpng{}", &hash[..10]),
        format!("plpnd{}", &hash[..10]),
        format!("plab-{deployment}-{instance}-pn-native"),
    )
}
fn load(settings: &Settings, deployment: &str, instance: &str) -> Result<Option<Value>> {
    let p = receipt_path(settings, instance)?;
    let mut f = match OpenOptions::new().read(true).custom_flags(0x20000).open(&p) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    trusted(&p, false)?;
    let m = f.metadata()?;
    if m.len() > 65536 || m.ino() != fs::symlink_metadata(&p)?.ino() {
        bail!("PROFINET receipt size/inode changed")
    }
    let mut bytes = vec![];
    f.read_to_end(&mut bytes)?;
    let r: Value = serde_json::from_slice(&bytes)?;
    let (_, _, _, _, volume) = names(deployment, instance);
    if r["schema_version"] != 1
        || r["deployment"] != deployment
        || r["instance"] != instance
        || r["abi"] != ABI
        || r["volume_name"] != volume
        || !valid_nonce(&r["nonce"])
    {
        bail!("PROFINET trusted receipt identity mismatch")
    }
    Ok(Some(r))
}
fn save(settings: &Settings, instance: &str, r: &Value) -> Result<()> {
    let p = receipt_path(settings, instance)?;
    if p.exists() {
        trusted(&p, false)?
    }
    let tmp = p.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(0x20000)
            .open(&tmp)?;
        f.write_all(&serde_json::to_vec(r)?)?;
        f.sync_all()?;
        fs::rename(&tmp, &p)?;
        fs::File::open(p.parent().unwrap())?.sync_all()?;
        Ok::<_, anyhow::Error>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
fn valid_nonce(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 32
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
async fn inspect(kind: &str, id: &str) -> Result<Option<Value>> {
    match docker::cmd(&[kind, "inspect", id]).await {
        Ok(s) => {
            let mut v: Vec<Value> = serde_json::from_str(&s)?;
            if v.len() != 1 {
                bail!("ambiguous PROFINET resource inspection")
            };
            Ok(v.pop())
        }
        Err(e)
            if e.to_string().to_ascii_lowercase().contains("no such")
                || e.to_string().to_ascii_lowercase().contains("not found") =>
        {
            Ok(None)
        }
        Err(e) => Err(e),
    }
}
fn labels(deployment: &str, instance: &str, role: &str, nonce: &str) -> Value {
    json!({docker::OWNER:deployment,docker::INSTANCE:instance,"io.protocol-target-lab.managed":"true",KIND:if role=="data"{crate::profinet::NETWORK_KIND.to_owned()}else{format!("profinet-{role}")},"io.protocol-target-lab.profinet-resource-schema":"1","io.protocol-target-lab.profinet-owner-nonce":nonce})
}
fn net_fingerprint(n: &Value) -> Value {
    json!({"Id":n["Id"],"Name":n["Name"],"Created":n["Created"],"Driver":n["Driver"],"Internal":n["Internal"],"EnableIPv6":n["EnableIPv6"],"Labels":n["Labels"],"Options":n["Options"],"IPAM":n["IPAM"]})
}
fn bridge_identity(name: &str) -> Result<Value> {
    let base = Path::new("/sys/class/net").join(name);
    if !base.join("bridge").is_dir() {
        bail!("PROFINET owned bridge missing")
    }
    Ok(
        json!({"name":name,"ifindex":fs::read_to_string(base.join("ifindex"))?.trim().parse::<u32>()?,"mac":fs::read_to_string(base.join("address"))?.trim(),"alias":fs::read_to_string(base.join("ifalias"))?.trim(),"group_fwd_mask":fs::read_to_string(base.join("bridge/group_fwd_mask"))?.trim()}),
    )
}
async fn create_net(
    settings: &Settings,
    instance: &str,
    r: &mut Value,
    role: &str,
    name: &str,
    bridge: &str,
) -> Result<Value> {
    if inspect("network", name).await?.is_some()
        || Path::new("/sys/class/net").join(bridge).exists()
    {
        bail!("PROFINET new network/bridge name already exists; refusing adoption")
    }
    let mut args = vec![
        "network".into(),
        "create".into(),
        "--driver".into(),
        "bridge".into(),
        "--internal".into(),
        "--opt".into(),
        "com.docker.network.bridge.enable_icc=true".into(),
        "--opt".into(),
        format!("com.docker.network.bridge.name={bridge}"),
    ];
    for (k, v) in labels(
        r["deployment"].as_str().unwrap(),
        instance,
        role,
        r["nonce"].as_str().unwrap(),
    )
    .as_object()
    .unwrap()
    {
        args.extend(["--label".into(), format!("{k}={}", v.as_str().unwrap())]);
    }
    args.push(name.into());
    let id = docker::command(&args).await?.trim().to_owned();
    let n = inspect("network", &id)
        .await?
        .context("PROFINET created network vanished")?;
    if n["Name"] != name
        || n["Options"]["com.docker.network.bridge.name"] != bridge
        || n["Labels"]
            != labels(
                r["deployment"].as_str().unwrap(),
                instance,
                role,
                r["nonce"].as_str().unwrap(),
            )
    {
        bail!("PROFINET created network identity mismatch")
    }
    let before = bridge_identity(bridge)?;
    if before["alias"] != ""
        || !["0x0", "0"].contains(&before["group_fwd_mask"].as_str().unwrap_or("?"))
    {
        bail!("PROFINET fresh bridge already configured; preserving resource")
    }
    r[role] = json!({"network":net_fingerprint(&n),"bridge":before,"prepared":false});
    save(settings, instance, r)?;
    let alias = format!(
        "plab:profinet:{}:{}",
        r["deployment"].as_str().unwrap(),
        r["nonce"].as_str().unwrap()
    );
    let out = tokio::process::Command::new("ip")
        .args(["link", "set", "dev", bridge, "alias", &alias])
        .kill_on_drop(true)
        .output()
        .await?;
    if !out.status.success() {
        bail!(
            "PROFINET cannot mark new owned bridge: {}",
            String::from_utf8_lossy(&out.stderr)
        )
    }
    if bridge_identity(bridge)?["ifindex"] != before["ifindex"] {
        bail!("PROFINET bridge changed before forwarding preparation")
    }
    if role == "data" {
        fs::write(
            format!("/sys/class/net/{bridge}/bridge/group_fwd_mask"),
            b"16384",
        )?;
    }
    let after = bridge_identity(bridge)?;
    if after["ifindex"] != before["ifindex"]
        || after["mac"] != before["mac"]
        || after["alias"] != alias
        || after["group_fwd_mask"] != if role == "data" { "0x4000" } else { "0x0" }
    {
        bail!("PROFINET owned bridge preparation readback mismatch")
    }
    r[role]["bridge"] = after;
    r[role]["prepared"] = true.into();
    save(settings, instance, r)?;
    Ok(n)
}
async fn checked_net(r: &Value, role: &str) -> Result<Option<Value>> {
    if r[role].is_null() {
        return Ok(None);
    }
    if r[role]["prepared"] != true {
        bail!("PROFINET bridge preparation incomplete; retaining recovery receipt")
    }
    let wanted = &r[role]["network"];
    let n = inspect(
        "network",
        wanted["Id"]
            .as_str()
            .context("PROFINET network ID missing")?,
    )
    .await?
    .context("PROFINET receipt network disappeared")?;
    let bridge = r[role]["bridge"]["name"]
        .as_str()
        .context("PROFINET bridge name missing")?;
    if net_fingerprint(&n) != *wanted || bridge_identity(bridge)? != r[role]["bridge"] {
        bail!("PROFINET owned network/bridge changed; refusing mutation")
    };
    Ok(Some(n))
}
fn volume_fingerprint(v: &Value) -> Value {
    json!({"Name":v["Name"],"Driver":v["Driver"],"CreatedAt":v["CreatedAt"],"Labels":v["Labels"],"Options":v["Options"],"Scope":v["Scope"]})
}
async fn checked_volume(r: &Value) -> Result<()> {
    let v = inspect("volume", r["volume_name"].as_str().unwrap())
        .await?
        .context("PROFINET retained native volume missing")?;
    if volume_fingerprint(&v) != r["volume"] {
        bail!("PROFINET native volume identity changed; refusing replacement")
    };
    Ok(())
}
async fn prepare(settings: &Settings, deployment: &str, instance: &str) -> Result<Value> {
    let (mgmt, data, mbridge, dbridge, volume) = names(deployment, instance);
    let mut r = if let Some(r) = load(settings, deployment, instance)? {
        r
    } else {
        if inspect("volume", &volume).await?.is_some() {
            bail!("PROFINET native volume exists without trusted receipt; refusing adoption")
        }
        let r = json!({"schema_version":1,"deployment":deployment,"instance":instance,"abi":ABI,"nonce":uuid::Uuid::new_v4().simple().to_string(),"volume_name":volume,"volume":null,"management":null,"data":null});
        save(settings, instance, &r)?;
        r
    };
    if r["volume"].is_null() {
        if inspect("volume", &volume).await?.is_some() {
            bail!("PROFINET uncommitted native volume exists; retaining it")
        }
        let mut args = vec![
            "volume".into(),
            "create".into(),
            "--driver".into(),
            "local".into(),
        ];
        let mut l = labels(
            deployment,
            instance,
            "native-store",
            r["nonce"].as_str().unwrap(),
        );
        l["io.protocol-target-lab.profinet-native-abi"] = ABI.into();
        for (k, v) in l.as_object().unwrap() {
            args.extend(["--label".into(), format!("{k}={}", v.as_str().unwrap())]);
        }
        args.push(volume.clone());
        docker::command(&args).await?;
        let v = inspect("volume", &volume)
            .await?
            .context("PROFINET native volume disappeared")?;
        if v["Labels"] != l || v["Driver"] != "local" {
            bail!("PROFINET native volume creation mismatch")
        }
        r["volume"] = volume_fingerprint(&v);
        save(settings, instance, &r)?;
    } else {
        checked_volume(&r).await?;
    }
    for (role, name, bridge) in [("management", mgmt, mbridge), ("data", data, dbridge)] {
        if r[role].is_null() {
            create_net(settings, instance, &mut r, role, &name, &bridge).await?;
        } else {
            checked_net(&r, role).await?;
        }
    }
    Ok(r)
}
fn members(n: &Value) -> Result<&serde_json::Map<String, Value>> {
    n["Containers"]
        .as_object()
        .context("PROFINET network endpoints unavailable")
}
fn source_macs(c: &ProfinetConfig) -> [&str; 3] {
    [&c.dcp.mac, &c.ptcp_n.mac, &c.ptcp_f.mac]
}
fn mac_conflicts(
    n: &Value,
    r: &Value,
    c: &ProfinetConfig,
    source: Option<&str>,
    peer: bool,
) -> Result<()> {
    let mut macs = source_macs(c).to_vec();
    if peer {
        macs.push(&c.test_peer_mac)
    }
    if macs.contains(&r["data"]["bridge"]["mac"].as_str().unwrap_or("")) {
        bail!("PROFINET configured MAC conflicts with data bridge")
    }
    for (cid, e) in members(n)? {
        if Some(cid.as_str()) != source && macs.contains(&e["MacAddress"].as_str().unwrap_or("")) {
            bail!("PROFINET configured MAC conflicts with an existing external endpoint")
        }
    }
    Ok(())
}
async fn management_members(
    n: &Value,
    source: Option<&Value>,
    deployment: &str,
    instance: &str,
) -> Result<()> {
    for (cid, _) in members(n)? {
        if source.is_some_and(|s| s["Id"] == *cid) {
            continue;
        }
        let p = inspect("container", cid)
            .await?
            .context("PROFINET management endpoint disappeared")?;
        let l = &p["Config"]["Labels"];
        if source.is_none()
            || l[docker::OWNER] != deployment
            || l[docker::INSTANCE] != instance
            || l["io.protocol-target-lab.test"] != "true"
            || l[TEST_SOURCE] != source.unwrap()["Id"]
            || l[PARENT_NONCE] != source.unwrap()["Config"]["Labels"][RUNTIME_LABEL]
            || p["Image"] != source.unwrap()["Image"]
        {
            bail!("PROFINET management network contains an unrecognized endpoint; preserving it")
        }
    }
    Ok(())
}
pub async fn preflight(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    c: &ProfinetConfig,
    old: Option<&ProfinetConfig>,
    source_id: Option<&str>,
) -> Result<()> {
    c.validate()?;
    let r = prepare(settings, deployment, instance).await?;
    let source = if let Some(cid) = source_id {
        let v = inspect("container", cid)
            .await?
            .context("PROFINET previous container vanished")?;
        if v["Config"]["Labels"][docker::OWNER] != deployment
            || v["Config"]["Labels"][docker::INSTANCE] != instance
            || old.is_some_and(|o| !docker::matches(&v, &o.clone().into()))
        {
            bail!("PROFINET previous source ownership changed")
        };
        Some(v)
    } else {
        None
    };
    let mgmt = checked_net(&r, "management").await?.unwrap();
    management_members(&mgmt, source.as_ref(), deployment, instance).await?;
    let data = checked_net(&r, "data").await?.unwrap();
    mac_conflicts(&data, &r, c, source_id, false)?;
    // Initial native data prefix must not overlap the actual management allocation.
    let suite = serde_json::to_value(&c.dcp.initial_ip_suite)?;
    if suite["ip"] != "0.0.0.0" {
        let ip: u32 = u32::from(
            suite["ip"]
                .as_str()
                .unwrap()
                .parse::<std::net::Ipv4Addr>()?,
        );
        let mask: u32 = u32::from(
            suite["netmask"]
                .as_str()
                .unwrap()
                .parse::<std::net::Ipv4Addr>()?,
        );
        for cfg in mgmt["IPAM"]["Config"]
            .as_array()
            .context("PROFINET management IPAM missing")?
        {
            let subnet = cfg["Subnet"]
                .as_str()
                .context("PROFINET management subnet missing")?;
            let (a, p) = subnet
                .split_once('/')
                .context("PROFINET management subnet invalid")?;
            let prefix: u32 = p.parse()?;
            if prefix > 32 {
                bail!("PROFINET management IPv4 prefix invalid")
            };
            let m = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            let a = u32::from(a.parse::<std::net::Ipv4Addr>()?);
            if ip & (mask & m) == a & (mask & m) {
                bail!("PROFINET initial IP suite overlaps actual management network")
            }
        }
    }
    Ok(())
}
pub fn runtime_id(v: &Value) -> Result<String> {
    let n = &v["Config"]["Labels"][RUNTIME_LABEL];
    if !valid_nonce(n) {
        bail!("PROFINET runtime nonce missing")
    };
    let nonce = n.as_str().unwrap();
    let env = v["Config"]["Env"]
        .as_array()
        .context("PROFINET source environment missing")?;
    if env
        .iter()
        .filter(|s| {
            s.as_str()
                .is_some_and(|s| s.starts_with("PLAB_RUNTIME_ID="))
        })
        .count()
        != 1
        || !env.iter().any(|s| s == &format!("PLAB_RUNTIME_ID={nonce}"))
    {
        bail!("PROFINET source nonce label/environment mismatch")
    };
    Ok(nonce.into())
}
pub fn container_matches(v: &Value, c: &ProfinetConfig) -> bool {
    let empty = |x: &Value| x.is_null() || x.as_object().is_some_and(|m| m.is_empty());
    let caps = v["HostConfig"]["CapAdd"].as_array().map(|a| {
        a.iter()
            .filter_map(|x| x.as_str())
            .map(|s| s.trim_start_matches("CAP_"))
            .collect::<std::collections::BTreeSet<_>>()
    });
    let l = &v["Config"]["Labels"];
    let Some(d) = l[docker::OWNER].as_str() else {
        return false;
    };
    let Some(i) = l[docker::INSTANCE].as_str() else {
        return false;
    };
    if uuid::Uuid::parse_str(d).is_err() || !crate::model::valid_id(i) {
        return false;
    }
    let (_, _, _, _, volume) = names(d, i);
    v["Config"]["User"] == "0:0"
        && v["HostConfig"]["Privileged"] == false
        && v["HostConfig"]["ReadonlyRootfs"] == true
        && v["HostConfig"]["Tmpfs"] == json!({"/run/protocol-target-lab":RUN_TMPFS})
        && v["HostConfig"]["IpcMode"] == "private"
        && ["", "private"].contains(&v["HostConfig"]["PidMode"].as_str().unwrap_or("?"))
        && empty(&v["HostConfig"]["PortBindings"])
        && v["HostConfig"]["Devices"]
            .as_array()
            .is_some_and(|a| a.is_empty())
        && v["HostConfig"]["CapDrop"] == json!(["ALL"])
        && caps == Some(["NET_RAW", "NET_ADMIN"].into_iter().collect())
        && crate::profinet::image_schemas_match(l)
        && runtime_id(v).is_ok()
        && v["Mounts"].as_array().is_some_and(|a| {
            a.len() == 1
                && a[0]["Type"] == "volume"
                && a[0]["Name"] == volume
                && a[0]["Destination"] == STORE_PATH
                && a[0]["RW"] == true
        })
        && v["NetworkSettings"]["Networks"]
            .as_object()
            .is_some_and(|n| {
                n.len() == 2 && n.values().filter(|e| e["MacAddress"] == c.dcp.mac).count() == 1
            })
}
pub async fn start(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    c: &ProfinetConfig,
    image: &str,
) -> Result<String> {
    let r = prepare(settings, deployment, instance).await?;
    let mgmt = checked_net(&r, "management").await?.unwrap();
    let data = checked_net(&r, "data").await?.unwrap();
    management_members(&mgmt, None, deployment, instance).await?;
    mac_conflicts(&data, &r, c, None, false)?;
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let immutable = docker::image_id(image).await?;
    let mut args = vec![
        "create".into(),
        "--name".into(),
        format!("plab-{}-{instance}", &deployment[..8]),
        "--network".into(),
        format!("name={}", mgmt["Id"].as_str().unwrap()),
        "--network".into(),
        format!(
            "name={},mac-address={}",
            data["Id"].as_str().unwrap(),
            c.dcp.mac
        ),
        "--read-only".into(),
        "--tmpfs".into(),
        format!("/run/protocol-target-lab:{RUN_TMPFS}"),
        "--restart".into(),
        "no".into(),
        "--pull".into(),
        "never".into(),
        "--user".into(),
        "0:0".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--cap-add".into(),
        "NET_RAW".into(),
        "--cap-add".into(),
        "NET_ADMIN".into(),
        "--ipc".into(),
        "private".into(),
        "--log-driver".into(),
        "json-file".into(),
        "--log-opt".into(),
        "max-size=5m".into(),
        "--log-opt".into(),
        "max-file=2".into(),
        "--mount".into(),
        format!(
            "type=volume,source={},target={STORE_PATH}",
            r["volume_name"].as_str().unwrap()
        ),
    ];
    for (k, v) in [
        (docker::OWNER, deployment.to_owned()),
        (docker::INSTANCE, instance.to_owned()),
        (docker::HASH, ProtocolConfig::from(c.clone()).fingerprint()),
        ("io.protocol-target-lab.managed", "true".into()),
        (RUNTIME_LABEL, nonce.clone()),
    ] {
        args.extend(["--label".into(), format!("{k}={v}")]);
    }
    for (k, v) in [
        ("PLAB_RUNTIME_ID", nonce),
        ("PLAB_DEPLOYMENT_ID", deployment.into()),
        ("PLAB_INSTANCE_ID", instance.into()),
        ("PLAB_STORE_NONCE", r["nonce"].as_str().unwrap().into()),
    ] {
        args.extend(["--env".into(), format!("{k}={v}")]);
    }
    args.push(immutable);
    args.extend(crate::profinet::config_args(c)?);
    let cid = docker::command(&args).await?.trim().to_owned();
    let result = async {
        docker::cmd(&["start", &cid]).await?;
        Ok::<_, anyhow::Error>(())
    }
    .await;
    if let Err(e) = result {
        let _ = docker::cmd(&["rm", "-f", &cid]).await;
        return Err(e);
    };
    Ok(cid)
}
pub async fn cleanup_empty(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    strict: bool,
) -> Result<()> {
    let Some(mut r) = load(settings, deployment, instance)? else {
        return Ok(());
    };
    checked_volume(&r).await?;
    let mut pending = vec![];
    for role in ["management", "data"] {
        if let Some(n) = checked_net(&r, role).await? {
            if !members(&n)?.is_empty() {
                pending.push(role);
                continue;
            }
            let fresh = checked_net(&r, role).await?.unwrap();
            if !members(&fresh)?.is_empty() {
                pending.push(role);
                continue;
            }
            docker::cmd(&["network", "rm", n["Id"].as_str().unwrap()]).await?;
            r[role] = Value::Null;
            save(settings, instance, &r)?;
        }
    }
    if strict && !pending.is_empty() {
        bail!(
            "PROFINET source stopped; external endpoints remain on {}; networks retained, cleanup pending",
            pending.join(",")
        )
    };
    Ok(())
}
pub async fn cleanup_deployment(settings: &Settings, deployment: &str) -> Result<()> {
    if !settings.data.join("profinet").exists() {
        return Ok(());
    }
    let dir = state_dir(settings)?;
    for e in fs::read_dir(dir)? {
        let e = e?;
        let name = e.file_name();
        let Some(s) = name.to_str().and_then(|s| s.strip_suffix(".json")) else {
            bail!("unrecognized PROFINET recovery metadata; retaining it")
        };
        cleanup_empty(settings, deployment, s, true).await?;
    }
    Ok(())
}
#[derive(Clone, Debug)]
pub struct SourceView {
    pub observer_host: String,
    pub management_id: String,
    pub data_id: String,
    pub access: Value,
}
async fn source_view(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    v: &Value,
    c: &ProfinetConfig,
    status: Option<&Value>,
) -> Result<SourceView> {
    if !container_matches(v, c) {
        bail!("PROFINET source capability/mount/network identity drift")
    }
    let r = load(settings, deployment, instance)?
        .context("PROFINET trusted recovery receipt missing")?;
    checked_volume(&r).await?;
    let mgmt = checked_net(&r, "management")
        .await?
        .context("PROFINET management network missing")?;
    let data = checked_net(&r, "data")
        .await?
        .context("PROFINET data network missing")?;
    management_members(&mgmt, Some(v), deployment, instance).await?;
    mac_conflicts(&data, &r, c, Some(docker::container_id(v)?.as_str()), false)?;
    let mut endpoints = vec![];
    for n in [&mgmt, &data] {
        let name = n["Name"]
            .as_str()
            .context("PROFINET network name missing")?;
        let e = &v["NetworkSettings"]["Networks"][name];
        let m = &n["Containers"][docker::container_id(v)?];
        if e["NetworkID"] != n["Id"]
            || e["EndpointID"].as_str().is_none_or(|s| s.len() != 64)
            || e["EndpointID"] != m["EndpointID"]
            || e["MacAddress"] != m["MacAddress"]
        {
            bail!("PROFINET exact source network endpoint mismatch")
        };
        endpoints.push(e.clone());
    }
    if endpoints[1]["MacAddress"] != c.dcp.mac || v["HostConfig"]["NetworkMode"] != mgmt["Id"] {
        bail!("PROFINET source data MAC/management network mode changed")
    }
    let env = v["Config"]["Env"]
        .as_array()
        .context("PROFINET source environment missing")?;
    for (k, value) in [
        ("PLAB_STORE_NONCE", r["nonce"].as_str().unwrap()),
        ("PLAB_DEPLOYMENT_ID", deployment),
        ("PLAB_INSTANCE_ID", instance),
    ] {
        let prefix = format!("{k}=");
        if env
            .iter()
            .filter(|x| x.as_str().is_some_and(|s| s.starts_with(&prefix)))
            .count()
            != 1
            || !env.iter().any(|s| s == &format!("{prefix}{value}"))
        {
            bail!("PROFINET store ownership environment changed")
        }
    }
    let host = endpoints[0]["IPAddress"]
        .as_str()
        .context("PROFINET management IP missing")?
        .to_owned();
    let ip: std::net::Ipv4Addr = host.parse()?;
    if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() {
        bail!("PROFINET invalid management observer IP")
    }
    let mut access = json!({"available":false,"reason":"native/source kernel observation pending","data_network":{"id":data["Id"],"name":data["Name"],"bridge":r["data"]["bridge"]},"management_network":{"id":mgmt["Id"],"name":mgmt["Name"]},"source_container_id":v["Id"],"source_endpoint_id":endpoints[1]["EndpointID"],"native_volume":r["volume_name"],"owner_nonce":r["nonce"]});
    if let Some(s) = status {
        let index = s["interfaces"]["data"]["iflink"]
            .as_u64()
            .context("PROFINET data interface host iflink missing")?;
        let child = s["interfaces"]["data"]["ifindex"]
            .as_u64()
            .context("PROFINET actual data ifindex missing")?;
        let matches = crate::mpls_l2::interfaces()
            .await?
            .into_iter()
            .filter(|i| i["ifindex"] == index)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            bail!("PROFINET exact source host veth missing")
        };
        let i = &matches[0];
        let name = i["ifname"]
            .as_str()
            .context("PROFINET host veth name missing")?;
        let base = Path::new("/sys/class/net").join(name);
        let iflink = fs::read_to_string(base.join("iflink"))?
            .trim()
            .parse::<u64>()?;
        let master = fs::read_link(base.join("master"))?;
        let master_name = master
            .file_name()
            .and_then(|s| s.to_str())
            .context("PROFINET host veth bridge master missing")?;
        if iflink != child
            || master_name != r["data"]["bridge"]["name"].as_str().unwrap()
            || i["link_type"] != "ether"
        {
            bail!("PROFINET host veth peer/master binding changed")
        }
        access["host_veth"] = json!({"name":name,"ifindex":index,"mac":i["address"],"iflink":iflink,"master_ifindex":r["data"]["bridge"]["ifindex"]});
        access["available"] = true.into();
        access.as_object_mut().unwrap().remove("reason");
    }
    Ok(SourceView {
        observer_host: host,
        management_id: mgmt["Id"].as_str().unwrap().into(),
        data_id: data["Id"].as_str().unwrap().into(),
        access,
    })
}
async fn status(host: &str) -> Result<Value> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(1))
        .build()?;
    let mut response = client
        .get(format!(
            "http://{host}:{}/v1/status",
            crate::profinet::OBSERVER_PORT
        ))
        .send()
        .await?;
    if response.status() != 200 {
        bail!("PROFINET private observer returned {}", response.status())
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > 65536 {
            bail!("PROFINET observer exceeded64KiB")
        };
        body.extend_from_slice(&chunk)
    }
    Ok(serde_json::from_slice(&body)?)
}
async fn socket_identity(
    v: &Value,
    s: &Value,
    view: &SourceView,
    deployment: &str,
    instance: &str,
) -> Result<Value> {
    let want = json!({"status":s,"observer_ip":view.observer_host,"observer_port":crate::profinet::OBSERVER_PORT,"native_binary_sha256":v["Config"]["Labels"]["io.protocol-target-lab.profinet-native-binary-sha256"],"store_marker":{"schema_version":1,"deployment_id":deployment,"instance_id":instance,"owner_nonce":view.access["owner_nonce"],"abi":ABI}});
    let args = vec![
        "exec".into(),
        "--user".into(),
        "0:0".into(),
        docker::container_id(v)?,
        "python3".into(),
        "-I".into(),
        "-c".into(),
        include_str!("../../client-tools/profinet_identity.py").into(),
        want.to_string(),
    ];
    Ok(serde_json::from_str(
        &docker::command(&args)
            .await
            .context("PROFINET actual source/native/kernel identity verification failed")?,
    )?)
}
fn status_matches(s: &Value, v: &Value, c: &ProfinetConfig, view: &SourceView) -> Result<()> {
    if s["schema_version"] != 1
        || s["protocol"] != "profinet"
        || s["runtime_id"] != runtime_id(v)?
        || s["config_sha256"] != c.observer_hash()
        || s["worker_ready_after_bind"] != true
        || s["event_loop_age_ms"].as_u64().is_none_or(|a| a > 2000)
        || s["components"]["dcp"]["ready"] != true
        || s["components"]["dcp"]["tick_age_ms"]
            .as_u64()
            .is_none_or(|a| a > 2000)
        || s["components"]["dcp"]["snapshot_stable"] != true
        || s["components"]["dcp"]["version"] != "0.2.0"
        || s["components"]["dcp"]["commit"] != "3e650720850e1f31f8a419c8aa135a2e81b44ddb"
        || s["storage"]["abi"] != ABI
        || s["storage"]["owner_nonce"] != view.access["owner_nonce"]
        || s["storage"]["writer_locked"] != true
        || s["storage"]["initialized"] != true
    {
        bail!("PROFINET native/observer/store identity or readiness mismatch")
    }
    uuid::Uuid::parse_str(
        s["boot_id"]
            .as_str()
            .context("PROFINET boot UUID missing")?,
    )?;
    for (role, mac, mode, scenario) in [
        (
            "ptcp_n",
            &c.ptcp_n.mac,
            "without-follow-up",
            c.ptcp_n.scenario.mode(),
        ),
        (
            "ptcp_f",
            &c.ptcp_f.mac,
            "with-follow-up",
            c.ptcp_f.scenario.mode(),
        ),
    ] {
        if s["interfaces"][role]["mac"] != *mac
            || s["components"][role]["ready"] != true
            || s["components"][role]["mode"] != mode
            || s["components"][role]["scenario"] != scenario
            || s["components"][role]["packet_filter"]["ethertype"] != 0x8892
        {
            bail!("PROFINET actual PTCP node configuration/readiness mismatch")
        }
    }
    if s["interfaces"]["data"]["mac"] != c.dcp.mac
        || s["interfaces"]["management"]["ipv4"]
            .as_array()
            .is_none_or(|a| !a.iter().any(|i| i["address"] == view.observer_host))
    {
        bail!("PROFINET actual data/management interface mismatch")
    };
    Ok(())
}
pub async fn snapshot(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &ProfinetConfig,
) -> Result<Value> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    tokio::time::timeout_at(deadline,async{
        let before=docker::owned(deployment,Some(instance)).await?;
        if before.len()!=1||docker::container_id(&before[0])?!=source_id||!docker::running(&before[0])||!docker::matches(&before[0],&c.clone().into()){bail!("PROFINET source ownership/configuration changed")}
        let view=source_view(settings,deployment,instance,&before[0],c,None).await?;let mut s=status(&view.observer_host).await?;let sampled=tokio::time::Instant::now();status_matches(&s,&before[0],c,&view)?;
        let proof=socket_identity(&before[0],&s,&view,deployment,instance).await?;let full=source_view(settings,deployment,instance,&before[0],c,Some(&s)).await?;
        let after=docker::owned(deployment,Some(instance)).await?;
        if after.len()!=1||after[0]["Id"]!=before[0]["Id"]||after[0]["Image"]!=before[0]["Image"]||after[0]["State"]["Pid"]!=before[0]["State"]["Pid"]||after[0]["State"]["StartedAt"]!=before[0]["State"]["StartedAt"]||!docker::running(&after[0])||!docker::matches(&after[0],&c.clone().into())||socket_identity(&after[0],&s,&full,deployment,instance).await?!=proof {bail!("PROFINET source/native sockets changed during observation")}
        if s["event_loop_age_ms"].as_u64().unwrap_or(u64::MAX).saturating_add(sampled.elapsed().as_millis() as u64)>2000||s["components"]["dcp"]["tick_age_ms"].as_u64().unwrap_or(u64::MAX).saturating_add(sampled.elapsed().as_millis() as u64)>2000{bail!("PROFINET sample became stale during verification")}
        s["backend_verified"]=json!({"source_container_id":source_id,"source_pid":before[0]["State"]["Pid"],"source_started_at":before[0]["State"]["StartedAt"],"source_image":before[0]["Image"],"kernel":proof,"access":full.access});Ok::<_,anyhow::Error>(s)
    }).await.context("PROFINET readiness exceeded absolute3-second deadline")?
}
pub async fn client_preflight(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &ProfinetConfig,
    method: &str,
) -> Result<SourceView> {
    c.test_budget(method)?;
    let before = docker::owned(deployment, Some(instance)).await?;
    if before.len() != 1
        || docker::container_id(&before[0])? != source_id
        || !docker::running(&before[0])
    {
        bail!("PROFINET source changed before peer test")
    };
    let view = source_view(settings, deployment, instance, &before[0], c, None).await?;
    let r = load(settings, deployment, instance)?.unwrap();
    let data = checked_net(&r, "data").await?.unwrap();
    mac_conflicts(&data, &r, c, Some(source_id), true)?;
    Ok(view)
}
pub async fn connection_access(
    settings: &Settings,
    deployment: &str,
    instance: &str,
    source_id: Option<&str>,
    c: &ProfinetConfig,
) -> Value {
    let Some(cid) = source_id else {
        return json!({"available":false,"reason":"workspace is not running"});
    };
    match snapshot(settings, deployment, instance, cid, c).await {
        Ok(s) => s["backend_verified"]["access"].clone(),
        Err(e) => json!({"available":false,"reason":format!("{e:#}")}),
    }
}
