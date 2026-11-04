use crate::model::{HttpConfig, ProtocolConfig};
use anyhow::{Context, Result, bail};
use serde_json::Value;
use tokio::process::Command;

pub const OWNER: &str = "io.protocol-target-lab.deployment";
pub const INSTANCE: &str = "io.protocol-target-lab.instance";
pub const HASH: &str = "io.protocol-target-lab.config";

pub async fn command(args: &[String]) -> Result<String> {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        Command::new("docker")
            .arg("--host")
            .arg(format!(
                "unix://{}",
                std::env::var("PLAB_DOCKER_SOCKET")
                    .unwrap_or_else(|_| "/var/run/docker.sock".into())
            ))
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("Docker operation timed out")?
    .context("cannot execute Docker CLI")?;
    if !result.status.success() {
        bail!(
            "Docker: {}",
            String::from_utf8_lossy(&result.stderr)
                .chars()
                .take(2000)
                .collect::<String>()
                .trim()
        );
    }
    let mut output = String::from_utf8_lossy(&result.stdout).into_owned();
    // Docker logs routes worker stderr through the CLI stderr stream.
    if args.first().is_some_and(|v| v == "logs") {
        output.push_str(&String::from_utf8_lossy(&result.stderr));
    }
    Ok(output)
}
pub async fn cmd(args: &[&str]) -> Result<String> {
    command(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>()).await
}
pub async fn available() -> Result<String> {
    cmd(&["version", "--format", "{{.Server.Version}}"]).await
}
pub async fn image_id(image: &str) -> Result<String> {
    Ok(cmd(&["image", "inspect", "--format", "{{.Id}}", image])
        .await?
        .trim()
        .into())
}
pub async fn prepare_image(image: &str, config: &ProtocolConfig) -> Result<String> {
    let id = image_id(image).await?;
    if !matches!(config, ProtocolConfig::Http(_)) {
        let metadata: Vec<Value> = serde_json::from_str(&cmd(&["image", "inspect", &id]).await?)?;
        if metadata[0]["Config"]["Labels"][format!(
            "io.protocol-target-lab.{}-response-schema",
            config.protocol_id()
        )]
        .as_str()
            != Some("1")
        {
            bail!("Protocol image is incompatible; import matching assets");
        }
        if matches!(config, ProtocolConfig::Mqtt(_))
            && metadata[0]["Config"]["Labels"]["io.protocol-target-lab.mqtt-packet-size"].as_str()
                != Some("full-v1")
        {
            bail!(
                "MQTT image lacks full-packet size enforcement; import version 0.1.1 or newer with full-v1 capability"
            );
        }
        if matches!(config, ProtocolConfig::Iec104(_))
            && metadata[0]["Config"]["Labels"]["io.protocol-target-lab.iec104-stream-framing"]
                .as_str()
                != Some("incremental-v1")
        {
            bail!(
                "IEC104 image lacks incremental TCP framing; import version 0.1.1 or newer with incremental-v1 capability"
            );
        }
    } else if config.as_http().is_some_and(|c| c.legacy_body.is_none()) {
        let metadata: Vec<Value> = serde_json::from_str(&cmd(&["image", "inspect", &id]).await?)?;
        if metadata[0]["Config"]["Labels"]["io.protocol-target-lab.http-response-schema"].as_str()
            != Some("2")
        {
            bail!(
                "HTTP image does not support length/mode responses; import version 0.2.0 or newer and update PLAB_HTTP_IMAGE before applying configuration"
            );
        }
    }
    Ok(id)
}
pub fn worker_args(config: &HttpConfig) -> Vec<String> {
    if let Some(body) = &config.legacy_body {
        return vec![format!("--response-body={body}")];
    }
    vec![
        "--response-length".into(),
        config.response_length.to_string(),
        "--response-mode".into(),
        config.response_mode.as_str().into(),
    ]
}
pub async fn owned(deployment: &str, instance: Option<&str>) -> Result<Vec<Value>> {
    let mut args = vec![
        "ps".into(),
        "-aq".into(),
        "--filter".into(),
        format!("label={OWNER}={deployment}"),
        "--filter".into(),
        "label=io.protocol-target-lab.managed=true".into(),
    ];
    if let Some(id) = instance {
        args.extend(["--filter".into(), format!("label={INSTANCE}={id}")]);
    }
    let ids = command(&args).await?;
    if ids.trim().is_empty() {
        return Ok(vec![]);
    }
    let mut args = vec!["inspect".into()];
    args.extend(ids.split_whitespace().map(str::to_owned));
    Ok(serde_json::from_str(&command(&args).await?)?)
}
pub fn container_id(v: &Value) -> Result<String> {
    Ok(v["Id"]
        .as_str()
        .context("Docker inspect missing Id")?
        .to_owned())
}
pub fn running(v: &Value) -> bool {
    v["State"]["Running"].as_bool() == Some(true)
}
pub fn matches(v: &Value, config: &ProtocolConfig) -> bool {
    v["Config"]["Labels"][HASH].as_str() == Some(config.fingerprint().as_str())
        && (!matches!(config, ProtocolConfig::Mqtt(_))
            || v["Config"]["Labels"]["io.protocol-target-lab.mqtt-packet-size"].as_str()
                == Some("full-v1"))
        && (!matches!(config, ProtocolConfig::Iec104(_))
            || v["Config"]["Labels"]["io.protocol-target-lab.iec104-stream-framing"].as_str()
                == Some("incremental-v1"))
}
pub async fn remove(v: &Value, deployment: &str, instance: &str) -> Result<()> {
    let id = container_id(v)?;
    // Inspect exact ID again before a destructive call; names alone are never ownership.
    let current: Vec<Value> = serde_json::from_str(&cmd(&["inspect", &id]).await?)?;
    let labels = &current[0]["Config"]["Labels"];
    if labels[OWNER].as_str() != Some(deployment)
        || labels[INSTANCE].as_str() != Some(instance)
        || labels["io.protocol-target-lab.managed"].as_str() != Some("true")
    {
        bail!("refusing to remove resource with mismatched ownership");
    }
    if running(&current[0]) {
        cmd(&["stop", "--time", "5", &id]).await?;
    }
    cmd(&["rm", &id]).await?;
    Ok(())
}
pub async fn start(
    deployment: &str,
    id: &str,
    config: &ProtocolConfig,
    image: &str,
) -> Result<String> {
    let immutable_image = image_id(image).await?;
    let name = format!("plab-{}-{id}", &deployment[..8]);
    let mut args = vec![
        "create".into(),
        "--name".into(),
        name,
        "--network".into(),
        if matches!(config, ProtocolConfig::Http(_)) {
            "host".into()
        } else {
            "bridge".into()
        },
        "--restart".into(),
        "no".into(),
        "--pull".into(),
        "never".into(),
        "--log-driver".into(),
        "json-file".into(),
        "--log-opt".into(),
        "max-size=5m".into(),
        "--log-opt".into(),
        "max-file=2".into(),
        "--label".into(),
        "io.protocol-target-lab.managed=true".into(),
        "--label".into(),
        format!("{OWNER}={deployment}"),
        "--label".into(),
        format!("{INSTANCE}={id}"),
        "--label".into(),
        format!("{HASH}={}", config.fingerprint()),
    ];
    match config {
        ProtocolConfig::Http(c) => {
            args.extend([
                immutable_image,
                "--bind-ip".into(),
                c.bind_ip.clone(),
                "--port".into(),
                c.port.to_string(),
            ]);
            args.extend(worker_args(c));
        }
        _ => {
            for transport in config.transports() {
                args.extend([
                    "--publish".into(),
                    format!(
                        "{}:{}:{}/{}",
                        config.bind_ip(),
                        config.port(),
                        config.internal_port(),
                        transport.to_ascii_lowercase()
                    ),
                ]);
            }
            args.extend([
                immutable_image,
                "--config-json".into(),
                serde_json::to_string(config)?,
            ]);
        }
    }

    let container = command(&args).await?.trim().to_owned();
    if let Err(e) = cmd(&["start", &container]).await {
        let _ = cmd(&["rm", &container]).await;
        return Err(e);
    }
    Ok(container)
}
pub async fn probe(config: &ProtocolConfig) -> Result<()> {
    let config = match config {
        ProtocolConfig::Dns(c) => return crate::dns::probe(c).await,
        ProtocolConfig::Mqtt(c) => return crate::mqtt::probe(c).await,
        ProtocolConfig::Telnet(c) => return crate::telnet::probe(c).await,
        ProtocolConfig::Iec104(c) => return crate::iec104::probe(c).await,
        ProtocolConfig::Http(c) => c,
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(2))
        .build()?;
    let response = client
        .get(format!("http://{}:{}/ok", config.probe_ip(), config.port))
        .send()
        .await?;
    if response.status() != 200 {
        bail!("HTTP /ok did not return 200");
    }
    let body = response.bytes().await?;
    if body.len() != config.response_length as usize {
        bail!("HTTP /ok response length did not match configuration");
    }
    if let Some(expected) = config.expected_body()
        && body.as_ref() != expected
    {
        bail!("HTTP /ok fixed response content did not match configuration");
    }
    Ok(())
}
pub async fn check_port(config: &HttpConfig) -> Result<()> {
    let socket =
        std::net::TcpListener::bind((config.bind_ip.as_str(), config.port)).with_context(|| {
            format!(
                "config.bind_ip/config.port: {}:{} is unavailable",
                config.bind_ip, config.port
            )
        })?;
    drop(socket);
    Ok(())
}
async fn preflight_http(config: &HttpConfig, own: Option<&HttpConfig>) -> Result<()> {
    // Even when the current wildcard listener owns this port, validate that a
    // requested specific address exists before stopping the old service.
    let address_check = std::net::TcpListener::bind((config.bind_ip.as_str(), 0))
        .context("config.bind_ip: address is not available on this host")?;
    drop(address_check);
    let overlap = own.is_some_and(|c| {
        c.port == config.port
            && (c.bind_ip == config.bind_ip
                || c.bind_ip == "0.0.0.0"
                || config.bind_ip == "0.0.0.0")
    });
    if !overlap {
        return check_port(config).await;
    }
    // A wildcard transition may conflict with listeners on another local IP.
    // Exclude only the exact endpoint of our inspected, owned container.
    let own = own.unwrap();
    for line in std::fs::read_to_string("/proc/net/tcp")?.lines().skip(1) {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() < 4 || fields[3] != "0A" {
            continue;
        }
        let Some((address, port)) = fields[1].split_once(':') else {
            continue;
        };
        let port = u16::from_str_radix(port, 16)?;
        if port != config.port {
            continue;
        }
        let ip =
            std::net::Ipv4Addr::from(u32::from_str_radix(address, 16)?.to_le_bytes()).to_string();
        if ip == own.bind_ip && port == own.port {
            continue;
        }
        if config.bind_ip == "0.0.0.0" || ip == "0.0.0.0" || ip == config.bind_ip {
            bail!("config.port: another listener conflicts with requested endpoint");
        }
    }
    let tcp6 = match std::fs::read_to_string("/proc/net/tcp6") {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e).context("cannot inspect IPv6 listeners"),
    };
    for line in tcp6.lines().skip(1) {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() < 4 || fields[3] != "0A" {
            continue;
        }
        if let Some((address, port)) = fields[1].split_once(':')
            && address == "00000000000000000000000000000000"
            && u16::from_str_radix(port, 16)? == config.port
        {
            bail!("config.port: wildcard IPv6 listener may conflict");
        }
    }
    Ok(())
}

/// Check every requested transport before stopping a recognized existing worker.
pub async fn preflight_port(
    config: &ProtocolConfig,
    own: Option<&ProtocolConfig>,
    own_id: Option<&str>,
) -> Result<()> {
    let transports = config.transports();
    let overlap = |a: &str, b: &str| a == b || a == "0.0.0.0" || b == "0.0.0.0";
    // Docker may publish through NAT without a userland listening socket.
    let ids = cmd(&["ps", "-q"]).await?;
    if !ids.trim().is_empty() {
        let mut args = vec!["inspect".into()];
        args.extend(ids.split_whitespace().map(str::to_owned));
        let containers: Vec<Value> = serde_json::from_str(&command(&args).await?)?;
        for container in containers {
            if container["Id"].as_str() == own_id {
                continue;
            }
            if let Some(ports) = container["NetworkSettings"]["Ports"].as_object() {
                for (key, bindings) in ports {
                    let protocol = key.split('/').nth(1).unwrap_or("").to_ascii_uppercase();
                    if !transports.contains(&protocol.as_str()) {
                        continue;
                    }
                    if let Some(bindings) = bindings.as_array() {
                        for binding in bindings {
                            if binding["HostPort"].as_str()
                                == Some(config.port().to_string().as_str())
                                && (binding["HostIp"].as_str() == Some("::")
                                    || binding["HostIp"]
                                        .as_str()
                                        .is_some_and(|ip| overlap(ip, config.bind_ip())))
                            {
                                bail!(
                                    "config.port: another Docker {protocol} publication conflicts with requested endpoint"
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    if let ProtocolConfig::Http(c) = config {
        return preflight_http(c, own.and_then(ProtocolConfig::as_http)).await;
    }
    let c = config;
    let address_check = std::net::TcpListener::bind((c.bind_ip(), 0))
        .context("config.bind_ip: address is not available on this host")?;
    drop(address_check);
    for transport in c.transports() {
        let own_endpoint = own.filter(|old| {
            old.protocol_id() == c.protocol_id()
                && old.port() == c.port()
                && old.transports().contains(&transport)
                && overlap(old.bind_ip(), c.bind_ip())
        });
        if own_endpoint.is_none() {
            if transport == "TCP" {
                drop(
                    std::net::TcpListener::bind((c.bind_ip(), c.port())).with_context(|| {
                        format!(
                            "config.port: TCP {}:{} is unavailable",
                            c.bind_ip(),
                            c.port()
                        )
                    })?,
                );
            } else {
                drop(
                    std::net::UdpSocket::bind((c.bind_ip(), c.port())).with_context(|| {
                        format!(
                            "config.port: UDP {}:{} is unavailable",
                            c.bind_ip(),
                            c.port()
                        )
                    })?,
                );
            }
            continue;
        }
        let old = own_endpoint.unwrap();
        let proto = transport.to_ascii_lowercase();
        for suffix in ["", "6"] {
            let text = match std::fs::read_to_string(format!("/proc/net/{proto}{suffix}")) {
                Ok(v) => v,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
                Err(e) => return Err(e.into()),
            };
            for line in text.lines().skip(1) {
                let fields = line.split_whitespace().collect::<Vec<_>>();
                if fields.len() < 4 || (transport == "TCP" && fields[3] != "0A") {
                    continue;
                }
                let Some((address, port)) = fields[1].split_once(':') else {
                    continue;
                };
                if u16::from_str_radix(port, 16)? != c.port() {
                    continue;
                }
                if suffix == "6" {
                    if address == "00000000000000000000000000000000" {
                        bail!("config.port: wildcard IPv6 {transport} listener may conflict");
                    }
                    continue;
                }
                let ip = std::net::Ipv4Addr::from(u32::from_str_radix(address, 16)?.to_le_bytes())
                    .to_string();
                if ip == old.bind_ip() {
                    continue;
                }
                if overlap(&ip, c.bind_ip()) {
                    bail!(
                        "config.port: another {transport} listener conflicts with requested endpoint"
                    );
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn iec104_adoption_requires_incremental_stream_capability() {
        let config: ProtocolConfig = crate::iec104::Iec104Config::default().into();
        let mut container = json!({"Config":{"Labels":{}}});
        container["Config"]["Labels"][HASH] = config.fingerprint().into();
        assert!(!matches(&container, &config));
        container["Config"]["Labels"]["io.protocol-target-lab.iec104-stream-framing"] =
            "incremental-v1".into();
        assert!(matches(&container, &config));
        for legacy in [
            ProtocolConfig::Http(HttpConfig::default()),
            ProtocolConfig::Dns(crate::dns::DnsConfig::default()),
            ProtocolConfig::Mqtt(crate::mqtt::MqttConfig::default()),
            ProtocolConfig::Telnet(crate::telnet::TelnetConfig::default()),
        ] {
            container["Config"]["Labels"] =
                json!({"io.protocol-target-lab.mqtt-packet-size":"full-v1"});
            container["Config"]["Labels"][HASH] = legacy.fingerprint().into();
            assert!(matches(&container, &legacy));
        }
    }
    #[test]
    fn mqtt_adoption_requires_full_packet_capability_without_changing_legacy_hashes() {
        let mqtt: ProtocolConfig = crate::mqtt::MqttConfig::default().into();
        let mut container = json!({"Config":{"Labels":{}}});
        container["Config"]["Labels"][HASH] = mqtt.fingerprint().into();
        assert!(!matches(&container, &mqtt));
        container["Config"]["Labels"]["io.protocol-target-lab.mqtt-packet-size"] = "full-v1".into();
        assert!(matches(&container, &mqtt));
        for config in [
            ProtocolConfig::Http(HttpConfig::default()),
            ProtocolConfig::Dns(crate::dns::DnsConfig::default()),
        ] {
            container["Config"]["Labels"] = json!({});
            container["Config"]["Labels"][HASH] = config.fingerprint().into();
            assert!(matches(&container, &config));
        }
    }
}
