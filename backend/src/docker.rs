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
        if matches!(config, ProtocolConfig::Mpls(_))
            && !crate::mpls::image_schemas_match(&metadata[0]["Config"]["Labels"])
        {
            bail!("MPLS image lacks required request/response/client/control/observer schemas");
        }
        if matches!(config, ProtocolConfig::Igmp(_))
            && !crate::igmp::image_schemas_match(&metadata[0]["Config"]["Labels"])
        {
            bail!("IGMP image lacks required membership/response/client/control/observer schemas");
        }
        if matches!(config, ProtocolConfig::CustomEthernet(_))
            && ["request", "client", "control", "observer", "compiler"]
                .iter()
                .any(|k| {
                    metadata[0]["Config"]["Labels"]
                        [format!("io.protocol-target-lab.custom-ethernet-{k}-schema")]
                        != "1"
                })
        {
            bail!("Custom Ethernet image lacks required live compiler/observer/client schemas")
        }
        if matches!(config, ProtocolConfig::ArpClient(_))
            && ["request", "control", "observer", "client"]
                .iter()
                .any(|k| {
                    metadata[0]["Config"]["Labels"]
                        [format!("io.protocol-target-lab.arp-client-{k}-schema")]
                        != "1"
                })
        {
            bail!("ARP-client image lacks active requester/observer/inverse-peer capability");
        }
        if matches!(config, ProtocolConfig::Bfd(_))
            && ["control", "observer", "client"].iter().any(|k| {
                metadata[0]["Config"]["Labels"][format!("io.protocol-target-lab.bfd-{k}-schema")]
                    != "1"
            })
        {
            bail!("BFD image lacks required control/observer/client capability");
        }
        if matches!(config, ProtocolConfig::Vxlan(_))
            && ["control", "observer", "client"].iter().any(|k| {
                metadata[0]["Config"]["Labels"][format!("io.protocol-target-lab.vxlan-{k}-schema")]
                    != "1"
            })
        {
            bail!("VXLAN image lacks required control/observer/client capability");
        }
        if matches!(config, ProtocolConfig::Iec101(_))
            && metadata[0]["Config"]["Labels"]["io.protocol-target-lab.iec101-dual-schema"] != "1"
        {
            bail!(
                "IEC101 image lacks simultaneous dual-channel capability; import matching assets"
            );
        }
        if matches!(config, ProtocolConfig::Rtp(_) | ProtocolConfig::Rtcp(_))
            && metadata[0]["Config"]["Labels"][format!(
                "io.protocol-target-lab.{}-observer-schema",
                config.protocol_id()
            )] != "1"
        {
            bail!(
                "Receiver image lacks the private receive observer schema; import matching assets"
            );
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
        if matches!(config, ProtocolConfig::MqttSn(_))
            && metadata[0]["Config"]["Labels"]["io.protocol-target-lab.mqtt-sn-register-capacity"]
                .as_str()
                != Some("bounded-v1")
        {
            bail!(
                "MQTT-SN image lacks safe registration capacity handling; import version0.1.1 or newer with bounded-v1 capability"
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
    if let ProtocolConfig::Igmp(c) = config
        && !crate::igmp_link::container_matches(v, c)
    {
        return false;
    }
    if let ProtocolConfig::CustomEthernet(c) = config
        && !crate::custom_l2::container_matches(v, c)
    {
        return false;
    }
    if let ProtocolConfig::Mpls(c) = config
        && !crate::mpls_l2::container_matches(v, c)
    {
        return false;
    }
    if let ProtocolConfig::ArpClient(c) = config
        && !crate::l2::container_matches(v, c)
    {
        return false;
    }
    if matches!(config, ProtocolConfig::Bfd(_)) && !crate::bfd::container_matches(v) {
        return false;
    }
    if matches!(config, ProtocolConfig::Vxlan(_)) && !crate::vxlan::container_matches(v) {
        return false;
    }
    if let ProtocolConfig::Iec101(c) = config
        && (v["HostConfig"]["NetworkMode"] != "bridge"
            || v["HostConfig"]["Privileged"] != false
            || v["Mounts"].as_array().is_none_or(|m| !m.is_empty())
            || v["HostConfig"]["Devices"]
                .as_array()
                .is_none_or(|m| !m.is_empty())
            || v["Config"]["Labels"]["io.protocol-target-lab.iec101-dual-schema"] != "1"
            || v["Config"]["Labels"]["io.protocol-target-lab.iec101-response-schema"] != "1"
            || v["HostConfig"]["PortBindings"]
                != serde_json::json!({"24741/tcp":[{"HostIp":c.bind_ip,"HostPort":c.single.port.to_string()}],"24742/tcp":[{"HostIp":c.bind_ip,"HostPort":c.double.port.to_string()}]}))
    {
        return false;
    }

    if matches!(config, ProtocolConfig::Rtp(_) | ProtocolConfig::Rtcp(_)) {
        let endpoint = config.ip_endpoint().expect("IP receiver variant");
        let p = &v["HostConfig"]["PortBindings"];
        if v["HostConfig"]["NetworkMode"] != "bridge"
            || v["Config"]["Labels"][format!(
                "io.protocol-target-lab.{}-response-schema",
                config.protocol_id()
            )] != "1"
            || v["Config"]["Labels"][format!(
                "io.protocol-target-lab.{}-observer-schema",
                config.protocol_id()
            )] != "1"
            || p.as_object().is_none_or(|p| p.len() != 1)
            || p[format!("{}/udp", endpoint.internal_port)]
                != serde_json::json!([{"HostIp":endpoint.bind_ip,"HostPort":endpoint.port.to_string()}])
        {
            return false;
        }
    }
    v["Config"]["Labels"][HASH].as_str() == Some(config.fingerprint().as_str())
        && (!matches!(config, ProtocolConfig::MqttSn(_))
            || (v["HostConfig"]["NetworkMode"] == "host"
                && v["HostConfig"]["IpcMode"] == "private"
                && ["", "private"]
                    .contains(&v["HostConfig"]["PidMode"].as_str().unwrap_or("invalid"))
                && v["Config"]["Labels"]["io.protocol-target-lab.mqtt-sn-register-capacity"]
                    == "bounded-v1"))
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
    compilation: Option<&crate::custom_l2::Compilation>,
    igmp_context: Option<&crate::igmp_link::SourceContext>,
) -> Result<String> {
    let immutable_image = image_id(image).await?;
    let arp_network = if let ProtocolConfig::Mpls(c) = config {
        Some(crate::mpls_l2::network_for_start(deployment, id, c).await?)
    } else if let ProtocolConfig::CustomEthernet(c) = config {
        Some(crate::custom_l2::network_for_start(deployment, id, c).await?)
    } else if let ProtocolConfig::ArpClient(c) = config {
        Some(crate::l2::network_for_start(deployment, id, c).await?)
    } else {
        None
    };
    let name = format!("plab-{}-{id}", &deployment[..8]);
    let mut args = vec![
        "create".into(),
        "--name".into(),
        name,
        "--network".into(),
        if let Some(ctx) = igmp_context {
            if matches!(config, ProtocolConfig::Igmp(c) if c.link.is_bridge()) {
                format!(
                    "name={},driver-opt=com.docker.network.endpoint.sysctls=net.ipv4.conf.IFNAME.force_igmp_version=2",
                    ctx.network_mode
                )
            } else {
                ctx.network_mode.clone()
            }
        } else if let Some(network) = arp_network {
            network
        } else if matches!(
            config,
            ProtocolConfig::Http(_)
                | ProtocolConfig::MqttSn(_)
                | ProtocolConfig::Bfd(_)
                | ProtocolConfig::Vxlan(_)
        ) {
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
        ProtocolConfig::Igmp(c) => {
            let ctx =
                igmp_context.context("IGMP source requires successful typed link preparation")?;
            let nonce = uuid::Uuid::new_v4().simple().to_string();
            args.extend([
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_RAW".into(),
                "--ipc".into(),
                "private".into(),
                "--label".into(),
                format!("{}={nonce}", crate::igmp::RUNTIME_LABEL),
                "--env".into(),
                format!("PLAB_RUNTIME_ID={nonce}"),
                immutable_image,
            ]);
            args.extend(crate::igmp::config_args(c)?);
            if let Some(ip) = &ctx.interface_ip {
                args.extend([
                    "--interface".into(),
                    ctx.interface.clone(),
                    "--interface-ip".into(),
                    ip.clone(),
                ]);
            }
        }
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
        ProtocolConfig::CustomEthernet(c) => {
            let prepared = compilation.context(
                "custom Ethernet start requires successful before-stop compiler preflight",
            )?;
            if prepared.image != immutable_image {
                bail!("candidate immutable image changed after compile preflight")
            }
            let nonce = uuid::Uuid::new_v4().simple().to_string();
            args.extend([
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_RAW".into(),
                "--ipc".into(),
                "private".into(),
                "--label".into(),
                format!("{}={nonce}", crate::custom_ethernet::RUNTIME_LABEL),
                "--label".into(),
                format!(
                    "{}={}",
                    crate::custom_ethernet::FILTER_LABEL,
                    prepared.filter_hash
                ),
                "--label".into(),
                format!(
                    "{}={}",
                    crate::custom_ethernet::LIBRARY_LABEL,
                    prepared.library_hash
                ),
                "--label".into(),
                format!(
                    "io.protocol-target-lab.custom-ethernet-library-version={}",
                    prepared.library_version
                ),
                "--env".into(),
                format!("PLAB_RUNTIME_ID={nonce}"),
            ]);
            if c.link.is_bridge() {
                args.extend(["--mac-address".into(), c.local_mac.clone()]);
            }
            args.push(immutable_image);
            args.extend(crate::custom_ethernet::config_args(c)?);
            args.extend([
                "--expected-filter-sha256".into(),
                prepared.filter_hash.clone(),
            ]);
        }
        ProtocolConfig::Mpls(c) => {
            let nonce = uuid::Uuid::new_v4().simple().to_string();
            args.extend([
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_RAW".into(),
                "--ipc".into(),
                "private".into(),
                "--label".into(),
                format!("{}={nonce}", crate::mpls::RUNTIME_LABEL),
                "--env".into(),
                format!("PLAB_RUNTIME_ID={nonce}"),
            ]);
            if c.link.is_bridge() {
                args.extend(["--mac-address".into(), c.source_mac.clone()]);
            }
            args.extend([
                immutable_image,
                "--config-json".into(),
                serde_json::to_string(config)?,
            ]);
        }
        ProtocolConfig::ArpClient(c) => {
            let nonce = uuid::Uuid::new_v4().simple().to_string();
            args.extend([
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_RAW".into(),
                "--ipc".into(),
                "private".into(),
                "--label".into(),
                format!("{}={nonce}", crate::arp_client::RUNTIME_LABEL),
                "--env".into(),
                format!("PLAB_RUNTIME_ID={nonce}"),
            ]);
            if c.link.is_bridge() {
                args.extend(["--mac-address".into(), c.source_mac.clone()]);
            }
            args.extend([
                immutable_image,
                "--config-json".into(),
                serde_json::to_string(config)?,
            ]);
        }
        ProtocolConfig::Bfd(_) => {
            let nonce = uuid::Uuid::new_v4().simple().to_string();
            args.extend([
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_RAW".into(),
                "--ipc".into(),
                "private".into(),
                "--label".into(),
                format!("{}={nonce}", crate::bfd::RUNTIME_LABEL),
                "--env".into(),
                format!("PLAB_RUNTIME_ID={nonce}"),
                immutable_image,
                "--config-json".into(),
                serde_json::to_string(config)?,
            ]);
        }
        ProtocolConfig::Vxlan(_) => {
            let nonce = uuid::Uuid::new_v4().simple().to_string();
            args.extend([
                "--user".into(),
                "0:0".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--cap-add".into(),
                "NET_BIND_SERVICE".into(),
                "--ipc".into(),
                "private".into(),
                "--label".into(),
                format!("{}={nonce}", crate::vxlan::RUNTIME_LABEL),
                "--env".into(),
                format!("PLAB_RUNTIME_ID={nonce}"),
                immutable_image,
                "--config-json".into(),
                serde_json::to_string(config)?,
            ]);
        }
        ProtocolConfig::Iec101(c) => {
            for (host, inner) in [(c.single.port, 24741), (c.double.port, 24742)] {
                args.extend([
                    "--publish".into(),
                    format!("{}:{host}:{inner}/tcp", c.bind_ip),
                ]);
            }
            args.extend([
                immutable_image,
                "--config-json".into(),
                serde_json::to_string(config)?,
            ]);
        }
        ProtocolConfig::MqttSn(_) => {
            args.extend([
                "--ipc".into(),
                "private".into(),
                immutable_image,
                "--config-json".into(),
                serde_json::to_string(config)?,
            ]);
        }
        _ => {
            let endpoint = config
                .ip_endpoint()
                .context("config.transport: IP endpoint required")?;
            for transport in config.transports() {
                args.extend([
                    "--publish".into(),
                    format!(
                        "{}:{}:{}/{}",
                        endpoint.bind_ip,
                        endpoint.port,
                        endpoint.internal_port,
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
pub async fn probe_owned(
    settings: &crate::storage::Settings,
    deployment: &str,
    instance: &str,
    source_id: &str,
    config: &ProtocolConfig,
) -> Result<()> {
    if let ProtocolConfig::Igmp(c) = config {
        crate::igmp_link::snapshot(settings, deployment, instance, source_id, c).await?;
        return Ok(());
    }
    if let ProtocolConfig::CustomEthernet(c) = config {
        crate::custom_l2::snapshot(deployment, instance, source_id, c).await?;
        return Ok(());
    }
    if let ProtocolConfig::Mpls(c) = config {
        crate::mpls_l2::snapshot(deployment, instance, source_id, c).await?;
        return Ok(());
    }
    if let ProtocolConfig::ArpClient(c) = config {
        crate::l2::snapshot(deployment, instance, source_id, c).await?;
        return Ok(());
    }
    if let ProtocolConfig::Bfd(c) = config {
        crate::bfd::snapshot(deployment, instance, source_id, c).await?;
        return Ok(());
    }
    if let ProtocolConfig::Vxlan(c) = config {
        crate::vxlan::snapshot(deployment, instance, source_id, c).await?;
        return Ok(());
    }
    if let ProtocolConfig::Iec101(c) = config {
        let before = owned(deployment, Some(instance)).await?;
        if before.len() != 1
            || container_id(&before[0])? != source_id
            || !running(&before[0])
            || !matches(&before[0], config)
        {
            bail!("IEC101 readiness target changed");
        }
        crate::iec101::probe(c).await?;
        let after = owned(deployment, Some(instance)).await?;
        if after.len() != 1
            || container_id(&after[0])? != source_id
            || !running(&after[0])
            || !matches(&after[0], config)
            || before[0]["State"]["Pid"] != after[0]["State"]["Pid"]
            || before[0]["State"]["StartedAt"] != after[0]["State"]["StartedAt"]
        {
            bail!("IEC101 readiness target changed during observation");
        }
        return Ok(());
    }
    if matches!(config, ProtocolConfig::Rtp(_) | ProtocolConfig::Rtcp(_)) {
        let before = owned(deployment, Some(instance)).await?;
        if before.len() != 1 || container_id(&before[0])? != source_id {
            bail!("RTP readiness target changed");
        }
        let host = crate::receiver::observer_host(&before[0], deployment, instance, config)?;
        match config {
            ProtocolConfig::Rtp(c) => crate::rtp::probe(c, &host).await?,
            ProtocolConfig::Rtcp(c) => crate::rtcp::probe(c, &host).await?,
            _ => unreachable!(),
        }
        let after = owned(deployment, Some(instance)).await?;
        if after.len() != 1
            || container_id(&after[0])? != source_id
            || !running(&after[0])
            || !matches(&after[0], config)
            || before[0]["State"]["Pid"] != after[0]["State"]["Pid"]
            || before[0]["State"]["StartedAt"] != after[0]["State"]["StartedAt"]
        {
            bail!("RTP readiness target changed during observation");
        }
        return Ok(());
    }
    probe(config).await
}
pub async fn probe(config: &ProtocolConfig) -> Result<()> {
    let config = match config {
        ProtocolConfig::Igmp(_) => bail!(
            "IGMP readiness requires exact source, actual native membership and owned link identity"
        ),
        ProtocolConfig::CustomEthernet(_) => {
            bail!("Custom Ethernet readiness requires exact source/network/filter identity")
        }
        ProtocolConfig::Mpls(_) => {
            bail!("MPLS readiness requires exact owned source/network/filter identity")
        }
        ProtocolConfig::ArpClient(_) => {
            bail!("ARP readiness requires exact owned source/network and private state")
        }
        ProtocolConfig::Bfd(_) => {
            bail!("BFD readiness requires exact owned source and private state")
        }
        ProtocolConfig::Vxlan(_) => {
            bail!("VXLAN readiness requires exact owned source and private state")
        }
        ProtocolConfig::Dlt645(c) => return crate::dlt645::probe(c).await,
        ProtocolConfig::Iec101(c) => return crate::iec101::probe(c).await,
        ProtocolConfig::Rtcp(_) => bail!("RTCP readiness requires exact owned container observer"),
        ProtocolConfig::Rtp(_) => bail!("RTP readiness requires exact owned container observer"),
        ProtocolConfig::Dns(c) => return crate::dns::probe(c).await,
        ProtocolConfig::Mqtt(c) => return crate::mqtt::probe(c).await,
        ProtocolConfig::Telnet(c) => return crate::telnet::probe(c).await,
        ProtocolConfig::Iec104(c) => return crate::iec104::probe(c).await,
        ProtocolConfig::MqttSn(c) => return crate::mqtt_sn::probe(c).await,
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
    deployment: &str,
    instance: &str,
) -> Result<()> {
    if let ProtocolConfig::ArpClient(c) = config {
        let old = own.and_then(|o| {
            if let ProtocolConfig::ArpClient(c) = o {
                Some(c)
            } else {
                None
            }
        });
        return crate::l2::preflight(deployment, instance, c, old, own_id).await;
    }
    let endpoint = config
        .ip_endpoint()
        .context("config.transport: IP endpoint required")?;
    if let ProtocolConfig::Bfd(c) = config {
        let old = own.and_then(|o| {
            if let ProtocolConfig::Bfd(c) = o {
                Some(c)
            } else {
                None
            }
        });
        return crate::bfd::preflight(c, old, own_id).await;
    }
    if let ProtocolConfig::Vxlan(c) = config {
        let old = own.and_then(|o| {
            if let ProtocolConfig::Vxlan(c) = o {
                Some(c)
            } else {
                None
            }
        });
        return crate::vxlan::preflight(c, old, own_id).await;
    }
    if let ProtocolConfig::Iec101(c) = config {
        let old = own.and_then(|o| {
            if let ProtocolConfig::Iec101(o) = o {
                Some(o)
            } else {
                None
            }
        });
        return crate::iec101::preflight(c, old, own_id).await;
    }
    let endpoints = if let ProtocolConfig::MqttSn(c) = config {
        c.endpoints()
            .iter()
            .map(|e| (e.ip.to_string(), e.port, e.transport))
            .collect::<Vec<_>>()
    } else {
        config
            .transports()
            .into_iter()
            .map(|t| (endpoint.bind_ip.to_string(), endpoint.port, t))
            .collect::<Vec<_>>()
    };
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
                    if let Some(bindings) = bindings.as_array() {
                        for binding in bindings {
                            if endpoints.iter().any(|(ip, port, transport)| {
                                *transport == protocol
                                    && binding["HostPort"].as_str()
                                        == Some(port.to_string().as_str())
                                    && (binding["HostIp"].as_str() == Some("::")
                                        || binding["HostIp"]
                                            .as_str()
                                            .is_some_and(|bound| overlap(bound, ip)))
                            }) {
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
    if let ProtocolConfig::MqttSn(c) = config {
        let old = own.and_then(|c| {
            if let ProtocolConfig::MqttSn(c) = c {
                Some(c)
            } else {
                None
            }
        });
        return crate::mqtt_sn::preflight(c, old, own_id).await;
    }
    let c = config;
    let address_check = std::net::TcpListener::bind((endpoint.bind_ip, 0))
        .context("config.bind_ip: address is not available on this host")?;
    drop(address_check);
    for transport in c.transports() {
        let own_endpoint = own.filter(|old| {
            old.protocol_id() == c.protocol_id()
                && old.ip_endpoint().is_some_and(|e| e.port == endpoint.port)
                && old.transports().contains(&transport)
                && old
                    .ip_endpoint()
                    .is_some_and(|e| overlap(e.bind_ip, endpoint.bind_ip))
        });
        if own_endpoint.is_none() {
            if transport == "TCP" {
                drop(
                    std::net::TcpListener::bind((endpoint.bind_ip, endpoint.port)).with_context(
                        || {
                            format!(
                                "config.port: TCP {}:{} is unavailable",
                                endpoint.bind_ip, endpoint.port
                            )
                        },
                    )?,
                );
            } else {
                drop(
                    std::net::UdpSocket::bind((endpoint.bind_ip, endpoint.port)).with_context(
                        || {
                            format!(
                                "config.port: UDP {}:{} is unavailable",
                                endpoint.bind_ip, endpoint.port
                            )
                        },
                    )?,
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
                if u16::from_str_radix(port, 16)? != endpoint.port {
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
                if old.ip_endpoint().is_some_and(|e| ip == e.bind_ip) {
                    continue;
                }
                if overlap(&ip, endpoint.bind_ip) {
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
    fn mqtt_sn_adoption_requires_host_network_and_private_process_ipc_namespaces() {
        let config: ProtocolConfig = crate::mqtt_sn::MqttSnConfig::default().into();
        let mut v = json!({"Config":{"Labels":{}}});
        v["Config"]["Labels"][HASH] = config.fingerprint().into();
        assert!(!matches(&v, &config));
        v["HostConfig"] = json!({"NetworkMode":"host","IpcMode":"private","PidMode":""});
        assert!(!matches(&v, &config));
        v["Config"]["Labels"]["io.protocol-target-lab.mqtt-sn-register-capacity"] =
            json!("bounded-v1");
        assert!(matches(&v, &config));
        for (key, value) in [
            ("NetworkMode", "bridge"),
            ("IpcMode", "host"),
            ("PidMode", "host"),
        ] {
            let mut bad = v.clone();
            bad["HostConfig"][key] = json!(value);
            assert!(!matches(&bad, &config));
        }
    }
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
