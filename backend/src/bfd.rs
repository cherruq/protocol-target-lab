use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const PORT: u16 = 3784;
pub const OBSERVER_PORT: u16 = 18084;
pub const PATH: &str = "session";
pub const RUNTIME_LABEL: &str = "io.protocol-target-lab.bfd-runtime-id";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "bfd-ipv4-single-hop")]
    SingleHop,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Scenario {
    Normal {},
    Poll { after_up_ms: u32 },
    Quiet { after_up_ms: u32, duration_ms: u32 },
    WrongYour { after_up_ms: u32, duration_ms: u32 },
    Ttl254 { after_up_ms: u32, duration_ms: u32 },
    Short { after_up_ms: u32, duration_ms: u32 },
}
impl Scenario {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::Normal {} => "normal",
            Self::Poll { .. } => "poll",
            Self::Quiet { .. } => "quiet",
            Self::WrongYour { .. } => "wrong-your",
            Self::Ttl254 { .. } => "ttl254",
            Self::Short { .. } => "short",
        }
    }
    pub fn method(&self) -> &'static str {
        match self {
            Self::Normal {} => "NORMAL",
            Self::Poll { .. } => "POLL",
            Self::Quiet { .. } => "QUIET",
            Self::WrongYour { .. } => "WRONG_YOUR",
            Self::Ttl254 { .. } => "TTL254",
            Self::Short { .. } => "SHORT",
        }
    }
    fn timings(&self) -> (u32, Option<u32>) {
        match self {
            Self::Normal {} => (0, None),
            Self::Poll { after_up_ms } => (*after_up_ms, None),
            Self::Quiet {
                after_up_ms,
                duration_ms,
            }
            | Self::WrongYour {
                after_up_ms,
                duration_ms,
            }
            | Self::Ttl254 {
                after_up_ms,
                duration_ms,
            }
            | Self::Short {
                after_up_ms,
                duration_ms,
            } => (*after_up_ms, Some(*duration_ms)),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BfdConfig {
    pub wire_profile: WireProfile,
    pub bind_ip: String,
    pub peer_ip: String,
    pub interface: String,
    pub source_port: u16,
    pub local_discriminator: u32,
    pub min_tx_us: u32,
    pub min_rx_us: u32,
    pub detect_mult: u8,
    pub scenario: Scenario,
}
impl Default for BfdConfig {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::SingleHop,
            bind_ip: "127.0.0.1".into(),
            peer_ip: "127.0.0.2".into(),
            interface: "lo".into(),
            source_port: 55028,
            local_discriminator: 1111901224,
            min_tx_us: 1000000,
            min_rx_us: 1000000,
            detect_mult: 3,
            scenario: Scenario::Normal {},
        }
    }
}
fn address(text: &str) -> Result<std::net::Ipv4Addr> {
    let ip: std::net::Ipv4Addr = text
        .parse()
        .context("config.bind_ip/peer_ip: expected IPv4")?;
    if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() || ip.octets()[0] == 0 {
        bail!("config.bind_ip/peer_ip: expected explicit unicast IPv4");
    }
    Ok(ip)
}
impl BfdConfig {
    pub fn validate(&self) -> Result<()> {
        let a = address(&self.bind_ip)?;
        let b = address(&self.peer_ip)?;
        if a == b {
            bail!("config.peer_ip: must differ from bind_ip");
        }
        let name = self.interface.as_bytes();
        if name.is_empty()
            || name.len() > 15
            || !(name[0].is_ascii_alphanumeric() || name[0] == b'_')
            || !name
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || [b'_', b'.', b'-'].contains(b))
        {
            bail!(
                "config.interface: expected existing kernel interface name matching [A-Za-z0-9_][A-Za-z0-9_.-]{{0,14}}"
            );
        }
        if self.source_port < 49152
            || self.local_discriminator == 0
            || self.detect_mult == 0
            || self.min_tx_us < 1000000
            || self.min_rx_us < 1000000
        {
            bail!(
                "config: source_port49152..65535, nonzero discriminator/detect_mult and min_tx_us/min_rx_us>=1000000 required"
            );
        }
        let (after, duration) = self.scenario.timings();
        if after > 3600000 || duration.is_some_and(|d| d == 0 || d > 3600000) {
            bail!("config.scenario: after_up_ms0..3600000, duration_ms1..3600000 required");
        }
        Ok(())
    }
    pub fn cases(&self) -> [&'static str; 2] {
        [self.scenario.method(), "ALL"]
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
            if ![
                "wire_profile",
                "bind_ip",
                "peer_ip",
                "interface",
                "source_port",
                "local_discriminator",
                "min_tx_us",
                "min_rx_us",
                "detect_mult",
                "scenario",
            ]
            .contains(&k.as_str())
                || val.is_null()
            {
                bail!("config.patch: unknown or null field {k}");
            }
            // Tagged scenarios are complete replacements, never merged across modes.
            v[k] = val.clone();
        }
        let c: Self =
            serde_json::from_value(v).context("config.patch: invalid BFD configuration")?;
        c.validate()?;
        Ok(c)
    }
    pub fn observer_hash(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(self).expect("serializable BFD config"))
                    .expect("serializable BFD config")
            )
        )
    }
    pub fn test_budget(&self) -> Result<f64> {
        self.validate()?;
        let t = self.min_tx_us as f64 / 1e6;
        let c = self.min_rx_us as f64 / 1e6;
        let m = t.max(c);
        let h = (4.0 * m + 2.0).max(5.0);
        let s = 3.0 * t + 1.0;
        let poll = (2.0 * m + 1.0).max(3.0);
        let (after, duration) = self.scenario.timings();
        let w = after as f64 / 1000.0 + 2.0 * t + 1.0;
        let (phases, total) = match self.scenario {
            Scenario::Normal {} => (vec![h, s, poll], 2.0 * (h + s + poll) + 5.0),
            Scenario::Poll { .. } => (vec![h, w, poll, s], 2.0 * (h + w + poll + s) + 5.0),
            _ => {
                let f = duration.unwrap() as f64 / 1000.0;
                if f < (self.detect_mult as f64 * t + 0.5).max(2.0 * t + 0.25) {
                    bail!(
                        "config.test: fault window is legal for runtime but too short for observable detection; no test packets sent"
                    );
                }
                let f = f + m + 1.0;
                (vec![h, w, f, h, s], 2.0 * (h + w + f + h + s) + 5.0)
            }
        };
        if phases.iter().any(|p| *p > 15.0) || total > 120.0 {
            bail!(
                "config.test: configured timers/window cannot fit bounded120s test and15s phases; runtime configuration remains valid"
            );
        }
        Ok(total)
    }
}
pub fn schema() -> Value {
    let mut alternatives = vec![
        json!({"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"normal"}}}),
    ];
    for mode in ["poll", "quiet", "wrong-your", "ttl254", "short"] {
        let mut p = json!({"mode":{"const":mode},"after_up_ms":{"type":"integer","minimum":0,"maximum":3600000}});
        let mut required = vec!["mode", "after_up_ms"];
        if mode != "poll" {
            p["duration_ms"] = json!({"type":"integer","minimum":1,"maximum":3600000});
            required.push("duration_ms");
        }
        alternatives.push(json!({"type":"object","additionalProperties":false,"required":required,"properties":p}));
    }
    json!({"protocol_id":"bfd","type":"object","additionalProperties":false,"default":BfdConfig::default(),"required":["wire_profile","bind_ip","peer_ip","interface","source_port","local_discriminator","min_tx_us","min_rx_us","detect_mult","scenario"],"properties":{"wire_profile":{"const":"bfd-ipv4-single-hop"},"bind_ip":{"type":"string","format":"ipv4"},"peer_ip":{"type":"string","format":"ipv4"},"interface":{"type":"string","pattern":"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$"},"source_port":{"type":"integer","minimum":49152,"maximum":65535},"local_discriminator":{"type":"integer","minimum":1,"maximum":4294967295u64},"min_tx_us":{"type":"integer","minimum":1000000,"maximum":4294967295u64},"min_rx_us":{"type":"integer","minimum":1000000,"maximum":4294967295u64},"detect_mult":{"type":"integer","minimum":1,"maximum":255},"scenario":{"oneOf":alternatives}},"control_port":PORT,"notes":["IPv4 single-hop active BFD Control; exact existing address/interface, real incoming TTL255, no authentication/Echo/Demand/multihop","ALL verifies the current applied target scenario twice; full six-mode coverage requires six explicit configurations","Local running readiness differs from actual peer Up; internal health never creates a fake peer","Same-host tests require peer_ip to be local and idle; remote peers must run the client on the specified counterpart"]})
}

pub fn runtime_id(v: &Value) -> Result<String> {
    let id = v["Config"]["Labels"][RUNTIME_LABEL]
        .as_str()
        .context("BFD runtime nonce missing")?;
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        bail!("invalid BFD runtime nonce");
    }
    let env = v["Config"]["Env"]
        .as_array()
        .context("BFD environment missing")?;
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
        bail!("BFD runtime nonce label/environment mismatch");
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
        && (v["HostConfig"]["CapAdd"] == json!(["NET_RAW"])
            || v["HostConfig"]["CapAdd"] == json!(["CAP_NET_RAW"]))
        && ["response", "control", "observer", "client"]
            .iter()
            .all(|k| v["Config"]["Labels"][format!("io.protocol-target-lab.bfd-{k}-schema")] == "1")
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
if len(inodes)>128:raise RuntimeError('BFD source socket bound exceeded')
for proto in ('tcp','udp'):
 with open('/proc/1/net/'+proto) as f:
  next(f)
  for n,line in enumerate(f):
   if n>100000:raise RuntimeError('BFD socket table inspection bound exceeded')
   a=line.split()
   if len(a)<10 or a[9] not in inodes or (proto=='tcp' and a[3]!='0A'):continue
   ip,port=a[1].split(':');ip=socket.inet_ntoa(bytes.fromhex(ip)[::-1]);key=(proto,ip,int(port,16))
   if key in want:
    name=':'.join(map(str,key))
    if name in found:raise RuntimeError('BFD duplicate source socket')
    found[name]=a[9]
if len(found)!=len(want):raise RuntimeError('BFD exact source PID does not own all three endpoints')
print(json.dumps(found,sort_keys=True))
"#;
async fn socket_identity(v: &Value, c: &BfdConfig) -> Result<Value> {
    if v["State"]["Pid"].as_u64().unwrap_or(0) == 0 {
        bail!("BFD source PID is not running");
    }
    let endpoints = json!([
        ["udp", c.bind_ip, PORT],
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
            .context("BFD source socket ownership inspection failed")?,
    )?;
    if result.as_object().is_none_or(|o| o.len() != 3) {
        bail!("invalid BFD source socket ownership result");
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
        bail!("BFD private observer returned {}", response.status());
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > 65536 {
            bail!("BFD private response exceeded64KiB");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}
fn status_matches(s: &Value, c: &BfdConfig, nonce: &str) -> Result<()> {
    if s["schema_version"] != 1
        || s["protocol"] != "bfd"
        || s["runtime_id"] != nonce
        || s["config_sha256"] != c.observer_hash()
        || s["worker_ready_after_bind"] != true
        || s["event_loop_age_ms"].as_u64().is_none_or(|n| n > 2000)
        || s["receiver"]["bind_ip"] != c.bind_ip
        || s["receiver"]["port"] != PORT
        || s["receiver"]["source_port"] != c.source_port
        || s["receiver"]["interface"] != c.interface
        || s["receiver"]["ifindex"].as_u64().is_none_or(|n| n == 0)
        || !["Down", "Init", "Up", "AdminDown"]
            .contains(&s["local_state"].as_str().unwrap_or("invalid"))
    {
        bail!("BFD observer readiness, heartbeat, endpoint or identity mismatch");
    }
    uuid::Uuid::parse_str(s["boot_id"].as_str().context("BFD boot identity missing")?)?;
    Ok(())
}
pub async fn snapshot(
    deployment: &str,
    instance: &str,
    source_id: &str,
    c: &BfdConfig,
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
            bail!("BFD target ownership/configuration changed");
        }
        let nonce = runtime_id(&before[0])?;
        let sockets = socket_identity(&before[0], c).await?;
        let sample_started = tokio::time::Instant::now();
        let status = observer_status().await?;
        status_matches(&status, c, &nonce)?;
        if socket_identity(&before[0], c).await? != sockets {
            bail!("BFD source endpoints changed during state observation");
        }
        let after = crate::docker::owned(deployment, Some(instance)).await?;
        if after.len() != 1
            || crate::docker::container_id(&after[0])? != source_id
            || !crate::docker::running(&after[0])
            || !crate::docker::matches(&after[0], &config)
            || after[0]["State"]["Pid"] != before[0]["State"]["Pid"]
            || after[0]["State"]["StartedAt"] != before[0]["State"]["StartedAt"]
        {
            bail!("BFD target changed during state observation");
        }
        if status["event_loop_age_ms"]
            .as_u64()
            .unwrap_or(u64::MAX)
            .saturating_add(sample_started.elapsed().as_millis() as u64)
            > 2000
        {
            bail!("BFD event-loop observation became stale during identity verification");
        }
        Ok::<Value, anyhow::Error>(status)
    };
    let result = tokio::time::timeout_at(deadline, task)
        .await
        .context("BFD readiness exceeded absolute3-second deadline")??;
    if tokio::time::Instant::now() >= deadline {
        bail!("BFD readiness exceeded absolute3-second deadline");
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
    .context("BFD interface inspection timed out")??;
    if !out.status.success() || out.stdout.len() > 1024 * 1024 {
        bail!("config.interface: cannot inspect existing IPv4 interfaces; iproute2 is required");
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}
fn on_interface(item: &Value, ip: std::net::Ipv4Addr) -> bool {
    (ip.is_loopback()
        && item["flags"]
            .as_array()
            .is_some_and(|v| v.iter().any(|f| f == "LOOPBACK")))
        || item["addr_info"].as_array().is_some_and(|v| {
            v.iter().any(|a| {
                a["local"]
                    .as_str()
                    .and_then(|s| s.parse::<std::net::Ipv4Addr>().ok())
                    == Some(ip)
            })
        })
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
pub async fn preflight(c: &BfdConfig, old: Option<&BfdConfig>, source: Option<&str>) -> Result<()> {
    c.validate()?;
    let ifaces = interfaces().await?;
    let local = address(&c.bind_ip)?;
    let iface = ifaces
        .iter()
        .find(|i| i["ifname"] == c.interface)
        .context("config.interface: existing target interface not found")?;
    if !on_interface(iface, local) {
        bail!("config.bind_ip/interface: bind address does not belong to that existing interface");
    }
    // Source PID ownership is required before exempting its existing endpoints.
    if old.is_some() && source.is_none() {
        bail!("BFD owned endpoint has no source identity");
    }
    if let (Some(old), Some(id)) = (old, source) {
        let values: Vec<Value> =
            serde_json::from_str(&crate::docker::cmd(&["inspect", id]).await?)?;
        if values.len() != 1 || !crate::docker::matches(&values[0], &old.clone().into()) {
            bail!("BFD old source identity changed before preflight");
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
        ("udp", c.bind_ip.as_str(), PORT),
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
                            "config BFD {proto} {ip}:{port}: conflicts with another Docker publication"
                        );
                    }
                }
            }
        }
        let own = old.is_some_and(|o| {
            proto == "tcp" || (o.bind_ip == ip && [PORT, o.source_port].contains(&port))
        });
        if own {
            continue;
        }
        if proto == "tcp" {
            drop(std::net::TcpListener::bind((ip, port)).with_context(|| {
                format!("config BFD observer endpoint {ip}:{port} is unavailable")
            })?);
        } else {
            drop(
                std::net::UdpSocket::bind((ip, port)).with_context(|| {
                    format!("config BFD UDP endpoint {ip}:{port} is unavailable")
                })?,
            );
        }
    }
    Ok(())
}
pub async fn client_preflight(c: &BfdConfig, status: &Value) -> Result<String> {
    c.test_budget()?;
    let peer = address(&c.peer_ip)?;
    let names = interfaces().await?;
    let iface=names.iter().find(|i|on_interface(i,peer)).and_then(|i|i["ifname"].as_str()).context("config.peer_ip: built-in client cannot bind this remote peer address; run the same-image client on the configured counterpart host")?;
    drop(std::net::UdpSocket::bind((peer,PORT)).context("config.test: peer receive endpoint is already occupied; existing BFD peer will not be evicted")?);
    if ["Up", "Init"].contains(&status["local_state"].as_str().unwrap_or("invalid"))
        || (status["remote_state"] != "AdminDown"
            && status["last_valid_age_ms"].as_u64().is_some_and(|age| {
                age.saturating_mul(1000)
                    <= status["receive_detection_us"]
                        .as_u64()
                        .unwrap_or(0)
                        .max(2000000)
            }))
    {
        bail!("config.test: active or recently valid BFD peer is busy; no new test epoch sent");
    }
    Ok(iface.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tagged_scenarios_replace_atomically_and_keep_old_snapshot_on_invalid_patch() {
        let c = BfdConfig::default();
        c.validate().unwrap();
        let f = c
            .patch(json!({"scenario":{"mode":"quiet","after_up_ms":1000,"duration_ms":4000}}))
            .unwrap();
        assert_eq!(f.cases(), ["QUIET", "ALL"]);
        assert!(f.test_budget().unwrap() < 120.0);
        let n = f.patch(json!({"scenario":{"mode":"normal"}})).unwrap();
        assert_eq!(n, c);
        for v in [
            json!({"scenario":{"mode":"normal","duration_ms":1}}),
            json!({"scenario":{"mode":"quiet","after_up_ms":1}}),
            json!({"peer_ip":"127.0.0.1"}),
            json!({"interface":"../../x"}),
            json!({"interface":"eth0:1"}),
            json!({"source_port":3784}),
            json!({"min_tx_us":999999}),
            json!({"detect_mult":0}),
            json!({"wire_profile":null}),
        ] {
            assert!(c.patch(v).is_err());
        }
        assert_eq!(c, BfdConfig::default());
    }
    #[test]
    fn valid_large_runtime_timers_and_short_faults_are_distinct_from_testability() {
        let c = BfdConfig::default()
            .patch(json!({"min_tx_us":4294967295u64,"detect_mult":255}))
            .unwrap();
        assert!(c.test_budget().is_err());
        let c = BfdConfig::default()
            .patch(json!({"scenario":{"mode":"ttl254","after_up_ms":0,"duration_ms":1}}))
            .unwrap();
        assert!(c.test_budget().is_err());
        assert!(BfdConfig::default().test_budget().is_ok());
        let a = serde_json::to_value(BfdConfig::default()).unwrap();
        let decoded: BfdConfig = serde_json::from_value(a).unwrap();
        assert_eq!(
            decoded.observer_hash(),
            BfdConfig::default().observer_hash()
        );
    }
}
