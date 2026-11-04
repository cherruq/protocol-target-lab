use crate::model::HttpConfig;
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
pub fn matches(v: &Value, config: &HttpConfig) -> bool {
    v["Config"]["Labels"][HASH].as_str() == Some(config.fingerprint().as_str())
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
pub async fn start(deployment: &str, id: &str, config: &HttpConfig, image: &str) -> Result<String> {
    let immutable_image = image_id(image).await?;
    let name = format!("plab-{}-{id}", &deployment[..8]);
    let args = vec![
        "create".into(),
        "--name".into(),
        name,
        "--network".into(),
        "host".into(),
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
        immutable_image,
        "--bind-ip".into(),
        config.bind_ip.clone(),
        "--port".into(),
        config.port.to_string(),
        format!("--response-body={}", config.response_body),
    ];
    let container = command(&args).await?.trim().to_owned();
    if let Err(e) = cmd(&["start", &container]).await {
        let _ = cmd(&["rm", &container]).await;
        return Err(e);
    }
    Ok(container)
}
pub async fn probe(config: &HttpConfig) -> Result<()> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(2))
        .build()?;
    let response = client
        .get(format!("http://{}:{}/ok", config.probe_ip(), config.port))
        .send()
        .await?;
    if response.status() != 200
        || response.bytes().await?.as_ref() != config.response_body.as_bytes()
    {
        bail!("HTTP /ok response did not match configured body");
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
pub async fn preflight_port(config: &HttpConfig, own: Option<&HttpConfig>) -> Result<()> {
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
