use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const OBSERVER_PORT: u16 = 18085;
pub const PATH: &str = "arp";
pub const CASES: [&str; 5] = [
    "ARP",
    "RESERVED_BITS",
    "REQUEST_THA",
    "INVALID_REQUEST",
    "ALL",
];
pub const RUNTIME_LABEL: &str = "io.protocol-target-lab.vxlan-runtime-id";
pub const MODES: [&str; 11] = [
    "normal",
    "silent",
    "wrong-vni",
    "clear-i",
    "wrong-eth-dst",
    "wrong-sha",
    "wrong-spa",
    "wrong-tha",
    "wrong-tpa",
    "short-header",
    "short-arp",
];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "vxlan-ipv4-arp")]
    Ipv4Arp,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Scenario {
    Normal {},
    Silent {},
    WrongVni {},
    ClearI {},
    WrongEthDst {},
    WrongSha {},
    WrongSpa {},
    WrongTha {},
    WrongTpa {},
    ShortHeader {},
    ShortArp {},
}
impl Scenario {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::Normal {} => "normal",
            Self::Silent {} => "silent",
            Self::WrongVni {} => "wrong-vni",
            Self::ClearI {} => "clear-i",
            Self::WrongEthDst {} => "wrong-eth-dst",
            Self::WrongSha {} => "wrong-sha",
            Self::WrongSpa {} => "wrong-spa",
            Self::WrongTha {} => "wrong-tha",
            Self::WrongTpa {} => "wrong-tpa",
            Self::ShortHeader {} => "short-header",
            Self::ShortArp {} => "short-arp",
        }
    }
}
fn mac_value(s: &str) -> Result<String> {
    let octets = s.split(':').collect::<Vec<_>>();
    if octets.len() != 6
        || octets
            .iter()
            .any(|x| x.len() != 2 || !x.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        bail!("config.mac: expected six colon-separated hex octets");
    }
    let bytes = octets
        .iter()
        .map(|x| u8::from_str_radix(x, 16))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if bytes[0] & 1 != 0 || bytes.iter().all(|b| *b == 0) {
        bail!("config.mac: nonzero unicast required");
    }
    Ok(s.to_ascii_lowercase())
}
fn deserialize_mac<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<String, D::Error> {
    let value = String::deserialize(d)?;
    mac_value(&value).map_err(serde::de::Error::custom)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct VxlanConfig {
    pub wire_profile: WireProfile,
    pub bind_ip: String,
    pub port: u16,
    pub peer_ip: String,
    pub peer_port: u16,
    pub source_port: u16,
    pub vni: u32,
    pub inner_ip: String,
    #[serde(deserialize_with = "deserialize_mac")]
    pub inner_mac: String,
    pub requester_ip: String,
    #[serde(deserialize_with = "deserialize_mac")]
    pub requester_mac: String,
    pub reply_padding: u8,
    pub scenario: Scenario,
}
impl Default for VxlanConfig {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::Ipv4Arp,
            bind_ip: "127.0.0.1".into(),
            port: 4789,
            peer_ip: "127.0.0.2".into(),
            peer_port: 4789,
            source_port: 55029,
            vni: 1000,
            inner_ip: "198.18.0.20".into(),
            inner_mac: "02:00:00:00:00:20".into(),
            requester_ip: "198.18.0.10".into(),
            requester_mac: "02:00:00:00:00:10".into(),
            reply_padding: 0,
            scenario: Scenario::Normal {},
        }
    }
}
fn address(s: &str, allow_zero: bool) -> Result<std::net::Ipv4Addr> {
    let ip: std::net::Ipv4Addr = s
        .parse()
        .context("config.ipv4: expected dotted unicast IPv4")?;
    if ip.is_multicast()
        || ip.is_broadcast()
        || (ip.octets()[0] == 0 && !(allow_zero && ip.is_unspecified()))
    {
        bail!("config.ipv4: expected unicast address; only requester_ip may be0.0.0.0");
    }
    Ok(ip)
}
impl VxlanConfig {
    pub fn validate(&self) -> Result<()> {
        let a = address(&self.bind_ip, false)?;
        let b = address(&self.peer_ip, false)?;
        let inner = address(&self.inner_ip, false)?;
        let requester = address(&self.requester_ip, true)?;
        if self.port == 0
            || self.peer_port == 0
            || self.source_port < 49152
            || self.port == self.source_port
            || (a == b && [self.port, self.source_port].contains(&self.peer_port))
        {
            bail!(
                "config.ports: nonzero listen/peer and high source49152..65535 required; same-IP listen/source/peer roles must not collide"
            );
        }
        if self.vni > 0xffffff || ![0, 18].contains(&self.reply_padding) {
            bail!("config.vni/reply_padding: vni0..16777215 and reply_padding0/18 required");
        }
        if inner == requester || mac_value(&self.inner_mac)? == mac_value(&self.requester_mac)? {
            bail!("config.roles: inner/requester IP and MAC roles must differ");
        }
        if self.inner_mac != mac_value(&self.inner_mac)?
            || self.requester_mac != mac_value(&self.requester_mac)?
        {
            bail!("config.mac: internal value must be normalized lowercase");
        }
        Ok(())
    }
    pub fn patch(&self, patch: Value) -> Result<Self> {
        let p = patch
            .as_object()
            .context("config.patch: expected partial object")?;
        if p.is_empty() {
            bail!("config.patch: empty object");
        }
        let mut v = serde_json::to_value(self)?;
        for (k, val) in p {
            if !v.as_object().unwrap().contains_key(k) || val.is_null() {
                bail!("config.patch: unknown or null field {k}");
            }
            v[k] = val.clone();
        }
        let c: Self =
            serde_json::from_value(v).context("config.patch: invalid VXLAN configuration")?;
        c.validate()?;
        Ok(c)
    }
    pub fn observer_hash(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(self).expect("serializable VXLAN config"))
                    .expect("serializable VXLAN config")
            )
        )
    }
}
pub fn schema() -> Value {
    let scenario=MODES.iter().map(|m|json!({"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":m}}})).collect::<Vec<_>>();
    json!({"protocol_id":"vxlan","type":"object","additionalProperties":false,"default":VxlanConfig::default(),"required":["wire_profile","bind_ip","port","peer_ip","peer_port","source_port","vni","inner_ip","inner_mac","requester_ip","requester_mac","reply_padding","scenario"],"properties":{"wire_profile":{"const":"vxlan-ipv4-arp"},"bind_ip":{"type":"string","format":"ipv4"},"port":{"type":"integer","minimum":1,"maximum":65535},"peer_ip":{"type":"string","format":"ipv4"},"peer_port":{"type":"integer","minimum":1,"maximum":65535},"source_port":{"type":"integer","minimum":49152,"maximum":65535},"vni":{"type":"integer","minimum":0,"maximum":16777215},"inner_ip":{"type":"string","format":"ipv4"},"inner_mac":{"type":"string","pattern":"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$"},"requester_ip":{"type":"string","format":"ipv4"},"requester_mac":{"type":"string","pattern":"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$"},"reply_padding":{"type":"integer","enum":[0,18]},"scenario":{"oneOf":scenario}},"notes":["Finite IPv4 unicast VXLAN Ethernet/IPv4 ARP responder, not a learning bridge or IPv4/ICMP service","Replies always use configured fixed peer_port, not Request source port; reserved bits and Request THA are ignored","ALL verifies the CURRENT applied mode with8checks; eleven-mode coverage requires eleven configurations","Readiness proves local socket/loop health, not a connected tunnel or LAN interoperability"]})
}

pub fn runtime_id(v: &Value) -> Result<String> {
    let id = v["Config"]["Labels"][RUNTIME_LABEL]
        .as_str()
        .context("VXLAN runtime nonce missing")?;
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        bail!("invalid VXLAN runtime nonce");
    }
    let env = v["Config"]["Env"]
        .as_array()
        .context("VXLAN environment missing")?;
    let expected = format!("PLAB_RUNTIME_ID={id}");
    if env
        .iter()
        .filter(|v| {
            v.as_str()
                .is_some_and(|s| s.starts_with("PLAB_RUNTIME_ID="))
        })
        .count()
        != 1
        || !env.iter().any(|v| v == &expected)
    {
        bail!("VXLAN runtime nonce label/environment mismatch");
    }
    Ok(id.into())
}
pub fn container_matches(v: &Value) -> bool {
    let empty = |v: &Value| v.is_null() || v.as_object().is_some_and(|m| m.is_empty());
    v["HostConfig"]["NetworkMode"] == "host"
        && v["Config"]["User"] == "0:0"
        && v["HostConfig"]["Privileged"] == false
        && v["HostConfig"]["IpcMode"] == "private"
        && ["", "private"].contains(&v["HostConfig"]["PidMode"].as_str().unwrap_or("invalid"))
        && empty(&v["HostConfig"]["PortBindings"])
        && v["Mounts"].as_array().is_some_and(|a| a.is_empty())
        && v["HostConfig"]["Devices"]
            .as_array()
            .is_some_and(|a| a.is_empty())
        && v["HostConfig"]["CapDrop"] == json!(["ALL"])
        && (v["HostConfig"]["CapAdd"] == json!(["NET_BIND_SERVICE"])
            || v["HostConfig"]["CapAdd"] == json!(["CAP_NET_BIND_SERVICE"]))
        && ["response", "control", "observer", "client"]
            .iter()
            .all(|k| {
                v["Config"]["Labels"][format!("io.protocol-target-lab.vxlan-{k}-schema")] == "1"
            })
        && runtime_id(v).is_ok()
}

/// Fixed independent /proc inspection via Docker's exact container identity.
/// PID1 is the process mapped to Docker inspect State.Pid; the client never gets
/// the Docker socket. No state observer claims are trusted for socket ownership.
const SOCKET_PROBE: &str = r#"import os,sys,json,socket
expected=json.loads(sys.argv[1]);want={(p,ip,int(port)) for p,ip,port in expected};found={}
inodes=set()
for name in os.listdir('/proc/1/fd'):
 try:
  target=os.readlink('/proc/1/fd/'+name)
  if target.startswith('socket:[') and target.endswith(']'):inodes.add(target[8:-1])
 except FileNotFoundError:pass
if len(inodes)>128:raise RuntimeError('VXLAN source socket bound exceeded')
for proto in ('tcp','udp'):
 with open('/proc/1/net/'+proto) as f:
  next(f)
  for n,line in enumerate(f):
   if n>100000:raise RuntimeError('VXLAN socket table inspection bound exceeded')
   a=line.split()
   if len(a)<10 or a[9] not in inodes or (proto=='tcp' and a[3]!='0A'):continue
   ip,port=a[1].split(':');ip=socket.inet_ntoa(bytes.fromhex(ip)[::-1]);key=(proto,ip,int(port,16))
   if key in want:
    name=':'.join(map(str,key))
    if name in found:raise RuntimeError('VXLAN duplicate source socket')
    found[name]=a[9]
if len(found)!=len(want):raise RuntimeError('VXLAN exact source PID does not own all three endpoints')
print(json.dumps(found,sort_keys=True))
"#;
async fn socket_identity(v: &Value, c: &VxlanConfig) -> Result<Value> {
    if v["State"]["Pid"].as_u64().unwrap_or(0) == 0 {
        bail!("VXLAN source PID is not running");
    }
    let endpoints = json!([
        ["udp", c.bind_ip, c.port],
        ["udp", c.bind_ip, c.source_port],
        ["tcp", "127.0.0.1", OBSERVER_PORT]
    ])
    .to_string();
    let args = vec![
        "exec".into(),
        "--user".into(),
        "0:0".into(),
        crate::docker::container_id(v)?,
        "python3".into(),
        "-I".into(),
        "-c".into(),
        SOCKET_PROBE.into(),
        endpoints,
    ];
    let result: Value = serde_json::from_str(
        &crate::docker::command(&args)
            .await
            .context("VXLAN source socket ownership inspection failed")?,
    )?;
    if result.as_object().is_none_or(|o| o.len() != 3) {
        bail!("invalid VXLAN source socket ownership result");
    }
    Ok(result)
}
async fn observer_status() -> Result<Value> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(1))
        .build()?;
    let mut response = client
        .get(format!("http://127.0.0.1:{OBSERVER_PORT}/v1/status"))
        .send()
        .await?;
    if response.status() != 200 {
        bail!("VXLAN private observer returned {}", response.status());
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > 65536 {
            bail!("VXLAN private response exceeded64KiB");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}
fn status_matches(s: &Value, c: &VxlanConfig, nonce: &str) -> Result<()> {
    if s["schema_version"] != 1
        || s["protocol"] != "vxlan"
        || s["runtime_id"] != nonce
        || s["config_sha256"] != c.observer_hash()
        || s["worker_ready_after_bind"] != true
        || s["event_loop_age_ms"].as_u64().is_none_or(|n| n > 2000)
        || s["receiver"]["bind_ip"] != c.bind_ip
        || s["receiver"]["port"] != c.port
        || s["receiver"]["source_port"] != c.source_port
        || s["receiver"]["peer_ip"] != c.peer_ip
        || s["receiver"]["peer_port"] != c.peer_port
        || s["scenario"]["mode"] != c.scenario.mode()
        || s["vni"] != c.vni
        || s["reply_inner_size"] != 42 + c.reply_padding
    {
        bail!("VXLAN observer readiness, heartbeat, endpoint or identity mismatch");
    }
    uuid::Uuid::parse_str(
        s["boot_id"]
            .as_str()
            .context("VXLAN boot identity missing")?,
    )?;
    Ok(())
}
pub async fn snapshot(
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &VxlanConfig,
) -> Result<Value> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    let task = async {
        let config: crate::model::ProtocolConfig = c.clone().into();
        let before = crate::docker::owned(deployment, Some(instance)).await?;
        if before.len() != 1
            || crate::docker::container_id(&before[0])? != source_id
            || !crate::docker::running(&before[0])
            || !crate::docker::matches(&before[0], &config)
        {
            bail!("VXLAN target ownership/configuration changed");
        }
        let nonce = runtime_id(&before[0])?;
        let sockets = socket_identity(&before[0], c).await?;
        let sample_started = tokio::time::Instant::now();
        let status = observer_status().await?;
        status_matches(&status, c, &nonce)?;
        if socket_identity(&before[0], c).await? != sockets {
            bail!("VXLAN source endpoints changed during state observation");
        }
        let after = crate::docker::owned(deployment, Some(instance)).await?;
        if after.len() != 1
            || crate::docker::container_id(&after[0])? != source_id
            || !crate::docker::running(&after[0])
            || !crate::docker::matches(&after[0], &config)
            || after[0]["State"]["Pid"] != before[0]["State"]["Pid"]
            || after[0]["State"]["StartedAt"] != before[0]["State"]["StartedAt"]
        {
            bail!("VXLAN target changed during state observation");
        }
        if status["event_loop_age_ms"]
            .as_u64()
            .unwrap_or(u64::MAX)
            .saturating_add(sample_started.elapsed().as_millis() as u64)
            > 2000
        {
            bail!("VXLAN event-loop observation became stale during identity verification");
        }
        Ok::<Value, anyhow::Error>(status)
    };
    let result = tokio::time::timeout_at(deadline, task)
        .await
        .context("VXLAN readiness exceeded absolute3-second deadline")??;
    if tokio::time::Instant::now() >= deadline {
        bail!("VXLAN readiness exceeded absolute3-second deadline");
    }
    Ok(result)
}

async fn interfaces() -> Result<Vec<Value>> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::process::Command::new("ip")
            .args(["-j", "-4", "address", "show"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("VXLAN interface inspection timed out")??;
    if !out.status.success() || out.stdout.len() > 1024 * 1024 {
        bail!("config.address: cannot inspect existing IPv4 interfaces; iproute2 is required");
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}
fn on_interface(item: &Value, ip: std::net::Ipv4Addr) -> bool {
    let exact = item["addr_info"].as_array().is_some_and(|rows| {
        rows.iter().any(|row| {
            row["local"]
                .as_str()
                .and_then(|s| s.parse::<std::net::Ipv4Addr>().ok())
                == Some(ip)
        })
    });
    exact
        || (ip.is_loopback()
            && item["flags"]
                .as_array()
                .is_some_and(|flags| flags.iter().any(|f| f == "LOOPBACK"))
            && item["addr_info"].as_array().is_some_and(|rows| {
                rows.iter().any(|row| {
                    let Some(local) = row["local"]
                        .as_str()
                        .and_then(|s| s.parse::<std::net::Ipv4Addr>().ok())
                        .filter(|v| v.is_loopback())
                    else {
                        return false;
                    };
                    let Some(prefix) = row["prefixlen"].as_u64().filter(|n| *n <= 32) else {
                        return false;
                    };
                    let mask = if prefix == 0 {
                        0
                    } else {
                        u32::MAX << (32 - prefix)
                    };
                    u32::from(ip) & mask == u32::from(local) & mask
                })
            }))
}
async fn require_local(ip: &str) -> Result<()> {
    let parsed = address(ip, false)?;
    if !interfaces().await?.iter().any(|i| on_interface(i, parsed)) {
        bail!(
            "config.address: {ip} is not assigned locally; run the client on the configured counterpart without spoofing remote addresses"
        );
    }
    Ok(())
}
fn overlap(a: &str, b: &str) -> bool {
    a == b
        || ["", "0.0.0.0", "::"].contains(&a)
        || b == "0.0.0.0"
        || a.parse::<std::net::Ipv6Addr>()
            .ok()
            .and_then(|v| v.to_ipv4_mapped())
            .is_some_and(|v| v.is_unspecified() || v.to_string() == b)
}
pub async fn preflight(
    c: &VxlanConfig,
    old: Option<&VxlanConfig>,
    source: Option<&str>,
) -> Result<()> {
    c.validate()?;
    // Read actual address membership even on hosts allowing nonlocal bind.
    require_local(&c.bind_ip).await?;
    // No host interface or routing changes.
    drop(
        std::net::UdpSocket::bind((c.bind_ip.as_str(), 0))
            .context("config.bind_ip: address is not available on this host")?,
    );
    // Source PID ownership is required before exempting its existing endpoints.
    if old.is_some() && source.is_none() {
        bail!("VXLAN owned endpoint has no source identity");
    }
    if let (Some(old), Some(id)) = (old, source) {
        let values: Vec<Value> =
            serde_json::from_str(&crate::docker::cmd(&["inspect", id]).await?)?;
        if values.len() != 1 || !crate::docker::matches(&values[0], &old.clone().into()) {
            bail!("VXLAN old source identity changed before preflight");
        }
        socket_identity(&values[0], old).await?;
    }
    let ids = crate::docker::cmd(&["ps", "-q"]).await?;
    let all = if ids.trim().is_empty() {
        vec![]
    } else {
        let mut args = vec!["inspect".to_string()];
        args.extend(ids.split_whitespace().map(str::to_owned));
        serde_json::from_str::<Vec<Value>>(&crate::docker::command(&args).await?)?
    };
    for (proto, ip, port) in [
        ("udp", c.bind_ip.as_str(), c.port),
        ("udp", c.bind_ip.as_str(), c.source_port),
        ("tcp", "127.0.0.1", OBSERVER_PORT),
    ] {
        for v in &all {
            if v["Id"].as_str() == source {
                continue;
            }
            if let Some(ports) = v["NetworkSettings"]["Ports"].as_object() {
                for (k, values) in ports {
                    if !k.ends_with(&format!("/{proto}")) {
                        continue;
                    }
                    if values.as_array().is_some_and(|vs| {
                        vs.iter().any(|b| {
                            b["HostPort"].as_str() == Some(port.to_string().as_str())
                                && overlap(b["HostIp"].as_str().unwrap_or(""), ip)
                        })
                    }) {
                        bail!(
                            "config VXLAN {proto} {ip}:{port}: conflicts with another Docker publication"
                        );
                    }
                }
            }
        }
        let own = old.is_some_and(|o| {
            proto == "tcp" || (o.bind_ip == ip && [o.port, o.source_port].contains(&port))
        });
        if own {
            continue;
        }
        if proto == "tcp" {
            drop(std::net::TcpListener::bind((ip, port)).with_context(|| {
                format!("config VXLAN observer endpoint {ip}:{port} is unavailable")
            })?);
        } else {
            drop(std::net::UdpSocket::bind((ip, port)).with_context(|| {
                format!("config VXLAN UDP endpoint {ip}:{port} is unavailable")
            })?);
        }
    }
    Ok(())
}

pub async fn client_preflight(c: &VxlanConfig) -> Result<()> {
    c.validate()?;
    require_local(&c.peer_ip).await?;
    // Only a client owns the configured peer receive port; startup never steals it.
    drop(std::net::UdpSocket::bind((c.peer_ip.as_str(),c.peer_port)).context("config.test: peer receive address/port is unavailable here; run the same-image client on the configured counterpart; existing listener will not be evicted")?);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn role_boundaries_and_normalization() {
        let c = VxlanConfig::default();
        c.validate().unwrap();
        for patch in [
            json!({"vni":0}),
            json!({"vni":16777215,"reply_padding":18}),
            json!({"requester_ip":"0.0.0.0"}),
            json!({"peer_ip":"127.0.0.1","peer_port":4790}),
            json!({"inner_mac":"02:AA:BB:CC:DD:20"}),
        ] {
            let n = c.patch(patch).unwrap();
            n.validate().unwrap();
        }
        assert_eq!(
            c.patch(json!({"inner_mac":"02:AA:BB:CC:DD:20"}))
                .unwrap()
                .inner_mac,
            "02:aa:bb:cc:dd:20"
        );
        for patch in [
            json!({"vni":16777216}),
            json!({"peer_ip":"127.0.0.1"}),
            json!({"peer_ip":"127.0.0.1","peer_port":55029}),
            json!({"port":55029}),
            json!({"port":0}),
            json!({"peer_port":0}),
            json!({"inner_ip":"0.0.0.0"}),
            json!({"requester_ip":"224.0.0.1"}),
            json!({"inner_mac":"01:00:00:00:00:20"}),
            json!({"inner_mac":"02:00:00:00:00:10"}),
            json!({"inner_mac":"00:00:00:00:00:00"}),
            json!({"inner_mac":"02:0:00:00:00:20"}),
            json!({"reply_padding":17}),
            json!({"scenario":{"mode":"silent","duration_ms":1}}),
            json!({"scenario":{"mode":"normal","mode_extra":1}}),
            json!({"scenario":null}),
            json!({"vni":true}),
            json!({"wire_profile":"rtp"}),
        ] {
            assert!(c.patch(patch.clone()).is_err(), "{patch}");
        }
        for mode in MODES {
            let n = c.patch(json!({"scenario":{"mode":mode}})).unwrap();
            assert_eq!(n.scenario.mode(), mode);
            assert_eq!(n.patch(json!({"scenario":{"mode":"normal"}})).unwrap(), c);
        }
    }
    #[test]
    fn adoption_requires_nonce_minimum_capability_and_three_private_endpoints() {
        let c: crate::model::ProtocolConfig = VxlanConfig::default().into();
        let nonce = "0123456789abcdef0123456789abcdef";
        let mut v = json!({"Config":{"User":"0:0","Env":[format!("PLAB_RUNTIME_ID={nonce}")],"Labels":{}},"HostConfig":{"NetworkMode":"host","Privileged":false,"IpcMode":"private","PidMode":"","PortBindings":{},"Devices":[],"CapDrop":["ALL"],"CapAdd":["NET_BIND_SERVICE"]},"Mounts":[]});
        v["Config"]["Labels"][crate::docker::HASH] = c.fingerprint().into();
        v["Config"]["Labels"][RUNTIME_LABEL] = nonce.into();
        for k in ["response", "control", "observer", "client"] {
            v["Config"]["Labels"][format!("io.protocol-target-lab.vxlan-{k}-schema")] = "1".into();
        }
        assert!(crate::docker::matches(&v, &c));
        for (key, val) in [
            ("CapAdd", json!(["NET_RAW"])),
            ("CapAdd", json!(["NET_BIND_SERVICE", "NET_ADMIN"])),
            ("NetworkMode", json!("bridge")),
            ("Privileged", json!(true)),
            ("PidMode", json!("host")),
        ] {
            let mut bad = v.clone();
            bad["HostConfig"][key] = val;
            assert!(!crate::docker::matches(&bad, &c));
        }
        let mut bad = v.clone();
        bad["Config"]["Env"] = json!([
            format!("PLAB_RUNTIME_ID={nonce}"),
            format!("PLAB_RUNTIME_ID={nonce}")
        ]);
        assert!(!crate::docker::matches(&bad, &c));
        let mut bad = v;
        bad["Mounts"] = json!([{"Source":"/var/run/docker.sock"}]);
        assert!(!crate::docker::matches(&bad, &c));
    }
    #[test]
    fn assigned_address_membership_is_independent_of_socket_bind_policy() {
        let iface =
            json!({"flags":["UP"],"addr_info":[{"local":"192.0.2.1"},{"local":"192.0.2.2"}]});
        assert!(on_interface(&iface, "192.0.2.2".parse().unwrap()));
        assert!(!on_interface(&iface, "203.0.113.66".parse().unwrap()));
        assert!(!on_interface(&iface, "127.0.0.2".parse().unwrap()));
        assert!(on_interface(
            &json!({"flags":["UP","LOOPBACK"],"addr_info":[{"local":"127.0.0.1","prefixlen":8}]}),
            "127.0.0.2".parse().unwrap()
        ));
    }
    #[test]
    fn normalized_observer_hash_is_stable() {
        let c = VxlanConfig::default()
            .patch(json!({"inner_mac":"02:AA:BB:CC:DD:20"}))
            .unwrap();
        let d = c.patch(json!({"inner_mac":"02:aa:bb:cc:dd:20"})).unwrap();
        assert_eq!(c.observer_hash(), d.observer_hash());
        let mut raw = serde_json::to_value(c).unwrap();
        raw.as_object_mut().unwrap().remove("wire_profile");
        assert!(serde_json::from_value::<VxlanConfig>(raw).is_err());
    }
}
