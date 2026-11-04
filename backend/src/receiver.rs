use anyhow::{Result, bail};
use serde_json::Value;
pub const OBSERVER_PORT: u16 = 18081;

/// The address comes only from the exact, already owned Docker target.
pub fn observer_host(
    v: &Value,
    deployment: &str,
    instance: &str,
    config: &crate::model::ProtocolConfig,
) -> Result<String> {
    let l = &v["Config"]["Labels"];
    if l[crate::docker::OWNER] != deployment
        || l[crate::docker::INSTANCE] != instance
        || l["io.protocol-target-lab.managed"] != "true"
        || !crate::docker::running(v)
        || !crate::docker::matches(v, config)
    {
        bail!("receiver observer target has mismatched ownership, state or configuration");
    }
    let networks = v["NetworkSettings"]["Networks"]
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("receiver target has no bridge network"))?;
    if networks.len() != 1 || !networks.contains_key("bridge") {
        bail!("receiver observer requires its private Docker bridge address");
    }
    let ip: std::net::Ipv4Addr = networks["bridge"]["IPAddress"]
        .as_str()
        .unwrap_or("")
        .parse()?;
    if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() || ip.is_broadcast() {
        bail!("invalid receiver bridge address");
    }
    Ok(ip.to_string())
}
pub async fn observer_get(client: &reqwest::Client, host: &str, path: &str) -> Result<Value> {
    let mut response = client
        .get(format!("http://{host}:{OBSERVER_PORT}{path}"))
        .send()
        .await?;
    if response.status() != 200 {
        bail!("receiver observer returned {}", response.status());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > 65536 {
            bail!("receiver observer response exceeded 64 KiB");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}
