use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use socket2::{Domain, Protocol, Socket, Type};
use std::{
    collections::HashSet,
    net::{Ipv4Addr, Ipv6Addr, SocketAddrV4},
    time::Duration,
};

pub const CASES: [&str; 5] = [
    "CONNECT",
    "REGISTER_PUBLISH",
    "PREDEFINED_PUBLISH",
    "DISCOVERY",
    "ALL",
];
pub const PATH: &str = "plab/test";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PredefinedTopic {
    pub topic_id: u16,
    pub topic: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MqttSnConfig {
    pub bind_ip: String,
    pub port: u16,
    pub discovery_group: String,
    pub discovery_port: u16,
    pub gateway_id: u16,
    pub broker_host: String,
    pub broker_port: u16,
    pub predefined_topics: Vec<PredefinedTopic>,
}
impl Default for MqttSnConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 1884,
            discovery_group: "239.192.0.2".into(),
            discovery_port: 1885,
            gateway_id: 1,
            broker_host: "127.0.0.1".into(),
            broker_port: 28897,
            predefined_topics: vec![PredefinedTopic {
                topic_id: 1,
                topic: "plab/predefined".into(),
            }],
        }
    }
}
impl MqttSnConfig {
    pub fn validate(&self) -> Result<()> {
        if self.bind_ip != "0.0.0.0" || self.broker_host != "127.0.0.1" {
            bail!(
                "config.bind_ip/config.broker_host: Paho listens on 0.0.0.0; the private broker must use 127.0.0.1"
            );
        }
        if self.port == 0
            || self.discovery_port == 0
            || self.broker_port == 0
            || self.port == self.discovery_port
        {
            bail!(
                "config.port/config.discovery_port/config.broker_port: ports must be1..65535; the two UDP ports must differ"
            );
        }
        let group: Ipv4Addr = self
            .discovery_group
            .parse()
            .context("config.discovery_group: expected IPv4 multicast group")?;
        if !group.is_multicast() {
            bail!("config.discovery_group: expected IPv4 multicast group");
        }
        if !(1..=255).contains(&self.gateway_id) {
            bail!("config.gateway_id: expected1..255");
        }
        if !(1..=16).contains(&self.predefined_topics.len()) {
            bail!("config.predefined_topics: expected1..16 mappings");
        }
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        for topic in &self.predefined_topics {
            if topic.topic.starts_with('$') {
                bail!(
                    "config.predefined_topics.topic: leading $ is excluded from this lab configuration to avoid private broker reserved namespaces"
                );
            }
            if !(1..=65534).contains(&topic.topic_id)
                || !ids.insert(topic.topic_id)
                || !names.insert(&topic.topic)
            {
                bail!("config.predefined_topics: IDs1..65534 and topic names must each be unique");
            }
            if topic.topic.is_empty()
                || topic.topic.len() > 128
                || !topic
                    .topic
                    .bytes()
                    .all(|b| (0x21..=0x7e).contains(&b) && ![b',', b'+', b'#'].contains(&b))
            {
                bail!(
                    "config.predefined_topics.topic: expected1..128 visible ASCII bytes without whitespace, comma or wildcards"
                );
            }
            if topic.topic == PATH || topic.topic.starts_with(&format!("{PATH}/")) {
                bail!(
                    "config.predefined_topics.topic: plab/test and its subtopics are reserved for client verification"
                );
            }
        }
        Ok(())
    }
    pub fn endpoints(&self) -> [Endpoint; 3] {
        [
            Endpoint {
                role: "gateway",
                ip: Ipv4Addr::UNSPECIFIED,
                port: self.port,
                transport: "UDP",
                shared: false,
            },
            Endpoint {
                role: "discovery",
                ip: Ipv4Addr::UNSPECIFIED,
                port: self.discovery_port,
                transport: "UDP",
                shared: true,
            },
            Endpoint {
                role: "broker",
                ip: Ipv4Addr::LOCALHOST,
                port: self.broker_port,
                transport: "TCP",
                shared: false,
            },
        ]
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Endpoint {
    pub role: &'static str,
    pub ip: Ipv4Addr,
    pub port: u16,
    pub transport: &'static str,
    pub shared: bool,
}
fn socket(ip: Ipv4Addr, port: u16, shared: bool) -> Result<std::net::UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(shared)?;
    socket.bind(&SocketAddrV4::new(ip, port).into())?;
    Ok(socket.into())
}
fn route_source(group: Ipv4Addr, port: u16) -> Result<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
    // UDP connect chooses a local route without sending a packet.
    socket
        .connect((group, port))
        .context("config.discovery_group: no multicast route")?;
    match socket.local_addr()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_unspecified() => Ok(ip),
        _ => bail!("config.discovery_group: no IPv4 multicast source address"),
    }
}
fn receiver(group: Ipv4Addr, port: u16) -> Result<std::net::UdpSocket> {
    // Linux group-address binding also filters destination, rather than accepting
    // unrelated groups that share this discovery port.
    let socket = socket(group, port, true)?;
    socket.join_multicast_v4(&group, &Ipv4Addr::UNSPECIFIED)?;
    socket.set_nonblocking(true)?;
    Ok(socket)
}
pub async fn probe(config: &MqttSnConfig) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(6), async {
        let group: Ipv4Addr = config.discovery_group.parse()?;
        let source = route_source(group, config.discovery_port)?;
        let socket = tokio::net::UdpSocket::from_std(receiver(group, config.discovery_port)?)?;
        let mut data = [0; 2048];
        for _ in 0..32 {
            match socket.try_recv_from(&mut data) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => return Err(e.into()),
            }
        }
        let request = tokio::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).await?;
        request
            .send_to(&[3, 1, 0], (Ipv4Addr::LOCALHOST, config.port))
            .await?;
        tokio::time::timeout(Duration::from_secs(3), async {
            for _ in 0..64 {
                let (size, peer) = socket.recv_from(&mut data).await?;
                if size == 3
                    && data[..3] == [3, 2, config.gateway_id as u8]
                    && peer.port() == config.port
                    && [
                        std::net::IpAddr::V4(source),
                        std::net::IpAddr::V4(Ipv4Addr::LOCALHOST),
                    ]
                    .contains(&peer.ip())
                {
                    return Ok::<_, anyhow::Error>(());
                }
            }
            bail!("MQTT-SN discovery exceeded datagram budget without matching GWINFO")
        })
        .await
        .context("MQTT-SN discovery timed out waiting for matching multicast GWINFO")??;
        crate::mqtt::probe(&crate::mqtt::MqttConfig {
            bind_ip: config.broker_host.clone(),
            port: config.broker_port,
            max_connections: 128,
            max_packet_size: 1048576,
        })
        .await?;
        Ok::<_, anyhow::Error>(())
    })
    .await
    .context("MQTT-SN gateway/private broker readiness timed out")?
}

fn overlaps(a: Ipv4Addr, b: Ipv4Addr) -> bool {
    a == b || a.is_unspecified() || b.is_unspecified()
}
fn proc_ip(value: &str, ipv6: bool) -> Result<Option<Ipv4Addr>> {
    if !ipv6 {
        return Ok(Some(Ipv4Addr::from(
            u32::from_str_radix(value, 16)?.to_le_bytes(),
        )));
    }
    if value.len() != 32 {
        bail!("invalid IPv6 socket table address");
    }
    let mut bytes = [0; 16];
    for i in 0..4 {
        bytes[i * 4..i * 4 + 4]
            .copy_from_slice(&u32::from_str_radix(&value[i * 8..i * 8 + 8], 16)?.to_le_bytes());
    }
    let ip = Ipv6Addr::from(bytes);
    Ok(if ip.is_unspecified() {
        Some(Ipv4Addr::UNSPECIFIED)
    } else {
        ip.to_ipv4_mapped()
    })
}
fn listener_inodes(endpoint: Endpoint) -> Result<HashSet<u64>> {
    let mut inodes = HashSet::new();
    for (suffix, ipv6) in [("", false), ("6", true)] {
        let path = format!(
            "/proc/net/{}{suffix}",
            endpoint.transport.to_ascii_lowercase()
        );
        let text = match std::fs::read_to_string(path) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        for line in text.lines().skip(1) {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            if fields.len() < 10 || (endpoint.transport == "TCP" && fields[3] != "0A") {
                continue;
            }
            let Some((ip, port)) = fields[1].split_once(':') else {
                continue;
            };
            if u16::from_str_radix(port, 16)? != endpoint.port {
                continue;
            }
            if proc_ip(ip, ipv6)?.is_some_and(|ip| overlaps(ip, endpoint.ip)) {
                inodes.insert(fields[9].parse()?);
            }
        }
    }
    Ok(inodes)
}
async fn owned_socket_inodes(id: &str, config: &MqttSnConfig) -> Result<HashSet<u64>> {
    let before: Vec<Value> = serde_json::from_str(&crate::docker::cmd(&["inspect", id]).await?)?;
    let before = before.first().context("missing existing MQTT-SN worker")?;
    let expected: crate::model::ProtocolConfig = config.clone().into();
    if !crate::docker::running(before)
        || !crate::docker::matches(before, &expected)
        || before["HostConfig"]["NetworkMode"] != "host"
        || !["", "private"].contains(
            &before["HostConfig"]["PidMode"]
                .as_str()
                .unwrap_or("invalid"),
        )
    {
        bail!("existing MQTT-SN worker has unexpected network/process/configuration ownership");
    }
    // Read the private PID namespace as the worker's normal user. This includes
    // the supervisor's native children without requiring host /proc privileges.
    const SCRIPT: &str = r#"import json,pathlib,os
out=set();count=0
for proc in pathlib.Path('/proc').iterdir():
 if not proc.name.isdigit():continue
 try:
  for fd in (proc/'fd').iterdir():
   count+=1
   if count>4096:raise RuntimeError('worker fd inspection budget exceeded')
   try:target=os.readlink(fd)
   except FileNotFoundError:continue
   if target.startswith('socket:[') and target.endswith(']'):out.add(int(target[8:-1]))
 except FileNotFoundError:continue
print(json.dumps(sorted(out)))"#;
    let sockets: HashSet<u64> = serde_json::from_str(
        &crate::docker::cmd(&["exec", id, "python3", "-B", "-c", SCRIPT]).await?,
    )?;
    let after: Vec<Value> = serde_json::from_str(&crate::docker::cmd(&["inspect", id]).await?)?;
    let after = after
        .first()
        .context("existing MQTT-SN worker disappeared")?;
    if !crate::docker::running(after)
        || before["State"]["Pid"] != after["State"]["Pid"]
        || before["State"]["StartedAt"] != after["State"]["StartedAt"]
        || before["Id"] != after["Id"]
    {
        bail!("existing MQTT-SN worker changed during socket inspection");
    }
    Ok(sockets)
}
pub async fn preflight(
    config: &MqttSnConfig,
    own: Option<&MqttSnConfig>,
    own_id: Option<&str>,
) -> Result<()> {
    let own_sockets = if let (Some(old), Some(id)) = (own, own_id) {
        owned_socket_inodes(id, old)
            .await
            .context("could not identify existing MQTT-SN sockets before restart")?
    } else {
        HashSet::new()
    };
    for endpoint in config.endpoints() {
        check_endpoint(endpoint, &own_sockets)?;
    }
    let group: Ipv4Addr = config.discovery_group.parse()?;
    route_source(group, config.discovery_port)?;
    // Check membership/routing before removing the old gateway, on an ephemeral
    // receiver so a legitimate endpoint-role change is not blocked by its sockets.
    drop(
        receiver(group, 0)
            .context("config.discovery_group: multicast membership is unavailable")?,
    );
    Ok(())
}
fn check_endpoint(endpoint: Endpoint, own_sockets: &HashSet<u64>) -> Result<()> {
    let listeners = listener_inodes(endpoint)?;
    let foreign = listeners.difference(own_sockets).next().is_some();
    let has_owned = listeners.intersection(own_sockets).next().is_some();
    if foreign && !endpoint.shared {
        bail!(
            "config.{}: another {} listener conflicts with {}:{}",
            endpoint.role,
            endpoint.transport,
            endpoint.ip,
            endpoint.port
        );
    }
    if !foreign && has_owned {
        return Ok(());
    }
    let result = if endpoint.transport == "TCP" {
        std::net::TcpListener::bind((endpoint.ip, endpoint.port)).map(drop)
    } else {
        socket(endpoint.ip, endpoint.port, endpoint.shared)
            .map(drop)
            .map_err(|e| std::io::Error::other(e.to_string()))
    };
    result.with_context(|| {
        format!(
            "config.{}: {} {}:{} is unavailable",
            endpoint.role, endpoint.transport, endpoint.ip, endpoint.port
        )
    })?;
    Ok(())
}

pub fn schema() -> Value {
    json!({"protocol_id":"mqtt-sn","type":"object","additionalProperties":false,"implementation":"Eclipse Paho MQTT-SN Gateway 1.5.1 + project capacity guard; private Mosquitto 2.0.18","default":MqttSnConfig::default(),"validated_qos":[1],"properties":{"bind_ip":{"const":"0.0.0.0","type":"string"},"port":{"type":"integer","minimum":1,"maximum":65535},"discovery_group":{"type":"string","format":"ipv4"},"discovery_port":{"type":"integer","minimum":1,"maximum":65535},"gateway_id":{"type":"integer","minimum":1,"maximum":255},"broker_host":{"const":"127.0.0.1","type":"string"},"broker_port":{"type":"integer","minimum":1,"maximum":65535},"predefined_topics":{"type":"array","minItems":1,"maxItems":16,"items":{"type":"object","additionalProperties":false,"properties":{"topic_id":{"type":"integer","minimum":1,"maximum":65534},"topic":{"type":"string","minLength":1,"maxLength":128}},"required":["topic_id","topic"]}}},"required":["bind_ip","port","discovery_group","discovery_port","gateway_id","broker_host","broker_port","predefined_topics"],"notes":["Host networking; exclusive gateway UDP, shared multicast discovery UDP, loopback-only private broker TCP","UDP ports differ; predefined IDs and names are unique","Predefined topics use visible ASCII excluding comma and wildcards, cannot start with $, and cannot use reserved plab/test or descendants","Tests validate QoS1 real broker delivery, discovery and same-ID reconnect; other native QoS modes are not accepted by this phase","Two fixed client IDs are reserved by tests; native client-table capacity is not a maximum concurrent connection setting","Gateway and private broker are supervised inside one container, independent of the public MQTT workspace"]})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_configuration_and_reserved_topics_match_native_csv_limits() {
        let c = MqttSnConfig::default();
        c.validate().unwrap();
        for name in [
            "",
            "has space",
            "has,comma",
            "wild/+",
            "wild/#",
            "中文",
            "plab/test",
            "plab/test/child",
            "$SYS/review",
            "$ordinary",
        ] {
            let mut bad = c.clone();
            bad.predefined_topics[0].topic = name.into();
            assert!(bad.validate().is_err(), "{name}");
        }
        let mut embedded = c.clone();
        embedded.predefined_topics[0].topic = "ordinary$dollar".into();
        embedded.validate().unwrap();
        let mut boundary = c.clone();
        boundary.gateway_id = 255;
        boundary.predefined_topics[0] = PredefinedTopic {
            topic_id: 65534,
            topic: "x".repeat(128),
        };
        boundary.validate().unwrap();
        boundary.predefined_topics[0].topic_id = 65535;
        assert!(boundary.validate().is_err());
        let mut bad = c.clone();
        bad.predefined_topics.push(bad.predefined_topics[0].clone());
        assert!(bad.validate().is_err());
        let mut bad = c.clone();
        bad.discovery_port = bad.port;
        assert!(bad.validate().is_err());
        let mut v = serde_json::to_value(c).unwrap();
        v["predefined_topics"][0]["topic_id"] = json!(true);
        assert!(serde_json::from_value::<MqttSnConfig>(v).is_err());
    }
    #[test]
    fn shared_discovery_does_not_exempt_a_foreign_listener_when_becoming_primary() {
        let owned = socket(Ipv4Addr::UNSPECIFIED, 0, true).unwrap();
        let endpoint = Endpoint {
            role: "discovery",
            ip: Ipv4Addr::UNSPECIFIED,
            port: owned.local_addr().unwrap().port(),
            transport: "UDP",
            shared: true,
        };
        let owned_inodes = listener_inodes(endpoint).unwrap();
        assert_eq!(owned_inodes.len(), 1);
        check_endpoint(
            Endpoint {
                role: "gateway",
                shared: false,
                ..endpoint
            },
            &owned_inodes,
        )
        .unwrap();
        let foreign = socket(Ipv4Addr::UNSPECIFIED, endpoint.port, true).unwrap();
        assert_eq!(listener_inodes(endpoint).unwrap().len(), 2);
        check_endpoint(endpoint, &owned_inodes).unwrap();
        let error = check_endpoint(
            Endpoint {
                role: "gateway",
                shared: false,
                ..endpoint
            },
            &owned_inodes,
        )
        .unwrap_err();
        assert!(error.to_string().contains("another UDP listener"));
        drop(foreign);
        drop(owned);
    }
    #[test]
    fn linux_socket_addresses_include_ipv4_mapped_and_dual_stack_conflicts() {
        assert_eq!(
            proc_ip("0100007F", false).unwrap(),
            Some(Ipv4Addr::LOCALHOST)
        );
        assert_eq!(
            proc_ip("00000000000000000000000000000000", true).unwrap(),
            Some(Ipv4Addr::UNSPECIFIED)
        );
        assert_eq!(
            proc_ip("0000000000000000FFFF00000100007F", true).unwrap(),
            Some(Ipv4Addr::LOCALHOST)
        );
        assert_eq!(
            proc_ip("00000000000000000000000001000000", true).unwrap(),
            None
        );
    }
}
