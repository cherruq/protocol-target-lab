use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
pub const CASES: [&str; 5] = ["RESET_STATUS", "CLASS2", "GI", "STREAM", "ALL"];
pub const PATHS: [&str; 3] = ["dual", "single", "double"];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WireProfile {
    #[serde(rename = "iec101-unbalanced-dual")]
    Dual,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Serial {
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub ioa: u32,
    pub value: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Channel {
    pub port: u16,
    pub link_address: u16,
    pub originator_address: u8,
    pub common_address: u16,
    pub single_char_ack: bool,
    pub point: Point,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Iec101Config {
    pub wire_profile: WireProfile,
    pub bind_ip: String,
    pub serial: Serial,
    pub single: Channel,
    pub double: Channel,
}
impl Default for Iec101Config {
    fn default() -> Self {
        Self {
            wire_profile: WireProfile::Dual,
            bind_ip: "0.0.0.0".into(),
            serial: Serial {
                baud_rate: 9600,
                data_bits: 8,
                parity: "N".into(),
                stop_bits: 1,
            },
            single: Channel {
                port: 24741,
                link_address: 1,
                originator_address: 0,
                common_address: 1,
                single_char_ack: false,
                point: Point {
                    ioa: 1,
                    value: true,
                },
            },
            double: Channel {
                port: 24742,
                link_address: 4660,
                originator_address: 7,
                common_address: 513,
                single_char_ack: false,
                point: Point {
                    ioa: 1,
                    value: true,
                },
            },
        }
    }
}
impl Iec101Config {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .map_err(|_| anyhow::anyhow!("config.bind_ip: expected IPv4"))?;
        if ip.is_multicast() || ip.is_broadcast() {
            bail!("config.bind_ip: expected unicast/wildcard");
        }
        if self.serial
            != (Serial {
                baud_rate: 9600,
                data_bits: 8,
                parity: "N".into(),
                stop_bits: 1,
            })
        {
            bail!("config.serial: this software PTY profile requires9600/8/N/1");
        }
        for (name, c, max, ioa_max) in [
            ("single", &self.single, 254, 255),
            ("double", &self.double, 65534, 16777215),
        ] {
            if c.port == 0 {
                bail!("config.{name}.port: must be1..65535");
            }
            if !(1..=max).contains(&c.link_address) || !(1..=max).contains(&c.common_address) {
                bail!(
                    "config.{name}.link_address/common_address: must be1..{max} for this finite profile"
                );
            }
            if !(1..=ioa_max).contains(&c.point.ioa) {
                bail!("config.{name}.point.ioa: must be1..{ioa_max}");
            }
        }
        if self.single.originator_address != 0 {
            bail!(
                "config.single.originator_address: must be0; OA is not encoded with one-byte COT"
            );
        }
        if self.single.port == self.double.port {
            bail!("config.double.port: must differ from single.port");
        }
        Ok(())
    }
    pub fn patch(&self, patch: Value) -> Result<Self> {
        fn merge(target: &mut Value, patch: Value, fields: &[&str], path: &str) -> Result<()> {
            let p = patch
                .as_object()
                .ok_or_else(|| anyhow::anyhow!("config.{path}: expected partial object"))?;
            if p.is_empty() {
                bail!("config.{path}: empty partial object");
            }
            for (k, v) in p {
                if !fields.contains(&k.as_str()) || v.is_null() {
                    bail!("config.{path}: unknown or null field {k}");
                }
                let nested: Option<&[&str]> = match k.as_str() {
                    "single" | "double" => Some(&[
                        "port",
                        "link_address",
                        "originator_address",
                        "common_address",
                        "single_char_ack",
                        "point",
                    ]),
                    "point" => Some(&["ioa", "value"]),
                    "serial" => Some(&["baud_rate", "data_bits", "parity", "stop_bits"]),
                    _ => None,
                };
                if let Some(keys) = nested {
                    merge(&mut target[k], v.clone(), keys, &format!("{path}.{k}"))?;
                } else {
                    target[k] = v.clone();
                }
            }
            Ok(())
        }
        let mut v = serde_json::to_value(self)?;
        merge(
            &mut v,
            patch,
            &["wire_profile", "bind_ip", "serial", "single", "double"],
            "patch",
        )?;
        let c: Self = serde_json::from_value(v)?;
        c.validate()?;
        Ok(c)
    }
}
pub fn schema() -> Value {
    let point = |max| json!({"type":"object","additionalProperties":false,"required":["ioa","value"],"properties":{"ioa":{"type":"integer","minimum":1,"maximum":max},"value":{"type":"boolean"}}});
    let channel = |max, ioa, oa| json!({"type":"object","additionalProperties":false,"required":["port","link_address","originator_address","common_address","single_char_ack","point"],"properties":{"port":{"type":"integer","minimum":1,"maximum":65535},"link_address":{"type":"integer","minimum":1,"maximum":max},"common_address":{"type":"integer","minimum":1,"maximum":max},"originator_address":{"type":"integer","minimum":0,"maximum":oa},"single_char_ack":{"type":"boolean"},"point":point(ioa)}});
    json!({"protocol_id":"iec101","type":"object","additionalProperties":false,"default":Iec101Config::default(),"required":["wire_profile","bind_ip","serial","single","double"],"properties":{"wire_profile":{"const":"iec101-unbalanced-dual"},"bind_ip":{"type":"string","format":"ipv4"},"serial":{"type":"object","additionalProperties":false,"required":["baud_rate","data_bits","parity","stop_bits"],"properties":{"baud_rate":{"const":9600},"data_bits":{"const":8},"parity":{"const":"N"},"stop_bits":{"const":1}}},"single":channel(254,255,0),"double":channel(65534,16777215,255)},"channel_widths":{"single":{"link":1,"cot":1,"ca":1,"ioa":1,"originator_encoded":false},"double":{"link":2,"cot":2,"ca":2,"ioa":3,"originator_encoded":true}},"notes":["Both channels are mandatory and simultaneously available; ports must differ","Actual lib60870 IEC101 unbalanced slave via software PTY/TCP; no physical serial timing claim","Single OA is not encoded on wire; fixed serial values are software termios configuration"]})
}
fn fixed(control: u8, address: u16, width: usize) -> Vec<u8> {
    let mut v = vec![0x10, control];
    v.extend_from_slice(&address.to_le_bytes()[..width]);
    let cs = v[1..].iter().fold(0u8, |s, b| s.wrapping_add(*b));
    v.extend_from_slice(&[cs, 0x16]);
    v
}
fn check_frame(v: &[u8], address: u16, width: usize) -> Result<(Option<u8>, Vec<u8>)> {
    if v == [0xe5] {
        return Ok((None, vec![]));
    }
    let body = if v.first() == Some(&0x10) && v.len() == 4 + width {
        &v[1..v.len() - 2]
    } else if v.len() >= 6
        && v[0] == 0x68
        && v[1] == v[2]
        && v[3] == 0x68
        && v.len() == v[1] as usize + 6
    {
        &v[4..v.len() - 2]
    } else {
        bail!("IEC101 invalid native FT1.2 response shape");
    };
    if body.len() < 1 + width
        || v[v.len() - 1] != 0x16
        || body.iter().fold(0u8, |s, b| s.wrapping_add(*b)) != v[v.len() - 2]
    {
        bail!("IEC101 invalid native FT1.2 checksum/length/end");
    }
    let la = if width == 1 {
        body[1] as u16
    } else {
        u16::from_le_bytes([body[1], body[2]])
    };
    if la != address || body[0] & 0x40 != 0 || body[0] & 0x10 != 0 {
        bail!("IEC101 native reply address/secondary control or DFC mismatch");
    }
    Ok((Some(body[0] & 15), body[1 + width..].to_vec()))
}
async fn receive(s: &mut tokio::net::TcpStream, width: usize) -> Result<Vec<u8>> {
    let mut v = vec![0; 1];
    s.read_exact(&mut v).await?;
    match v[0] {
        0xe5 => {}
        0x10 => {
            v.resize(4 + width, 0);
            s.read_exact(&mut v[1..]).await?;
        }
        0x68 => {
            v.resize(4, 0);
            s.read_exact(&mut v[1..]).await?;
            let n = v[1] as usize + 6;
            if !(6..=261).contains(&n) {
                bail!("IEC101 response frame size invalid");
            }
            v.resize(n, 0);
            s.read_exact(&mut v[4..]).await?;
        }
        _ => bail!("IEC101 unexpected native response prefix"),
    };
    Ok(v)
}
fn little(b: &[u8]) -> u32 {
    b.iter()
        .enumerate()
        .fold(0, |n, (i, v)| n | ((*v as u32) << (8 * i)))
}
async fn channel_probe(host: &str, c: &Channel, double: bool) -> Result<()> {
    let width = if double { 2 } else { 1 };
    let mut s = tokio::net::TcpStream::connect((host, c.port)).await?;
    s.write_all(&fixed(0x40, c.link_address, width)).await?;
    let ack = receive(&mut s, width).await?;
    let (fc, p) = check_frame(&ack, c.link_address, width)?;
    if !p.is_empty() || (fc != Some(0) && !(fc.is_none() && c.single_char_ack)) {
        bail!("IEC101 reset did not return native ACK");
    }
    s.write_all(&fixed(0x49, c.link_address, width)).await?;
    let (fc, p) = check_frame(&receive(&mut s, width).await?, c.link_address, width)?;
    if fc != Some(11) || !p.is_empty() {
        bail!("IEC101 status did not return secondary FC11");
    }
    s.write_all(&fixed(0x7b, c.link_address, width)).await?;
    let (fc, a) = check_frame(&receive(&mut s, width).await?, c.link_address, width)?;
    let cot = if double { 2 } else { 1 };
    let ca = width;
    let ioa = if double { 3 } else { 1 };
    let hdr = 2 + cot + ca;
    if fc != Some(8) || a.len() != hdr + ioa + 1 || a[0] != 1 || a[1] != 1 || a[2] != 3 {
        bail!("IEC101 class2 lacks actual startup single-point ASDU/COT3");
    }
    if (double && a[3] != c.originator_address)
        || little(&a[2 + cot..hdr]) != c.common_address as u32
        || little(&a[hdr..hdr + ioa]) != c.point.ioa
        || a[hdr + ioa] != u8::from(c.point.value)
    {
        bail!("IEC101 actual ASDU address/width/value/quality mismatch");
    }
    s.shutdown().await?;
    let mut extra = [0u8; 1];
    if s.read(&mut extra).await? != 0 {
        bail!("IEC101 unsolicited response after health requests");
    }
    Ok(())
}
pub async fn probe(c: &Iec101Config) -> Result<()> {
    let host = if c.bind_ip == "0.0.0.0" {
        "127.0.0.1"
    } else {
        &c.bind_ip
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    tokio::time::timeout_at(deadline, async {
        tokio::try_join!(
            channel_probe(host, &c.single, false),
            channel_probe(host, &c.double, true)
        )?;
        Result::<()>::Ok(())
    })
    .await
    .map_err(|_| {
        anyhow::anyhow!("IEC101 dual-channel readiness exceeded absolute3-second deadline")
    })??;
    if tokio::time::Instant::now() >= deadline {
        bail!("IEC101 dual-channel readiness exceeded absolute3-second deadline");
    }
    Ok(())
}
fn overlaps(a: &str, b: &str) -> bool {
    a == b || a == "0.0.0.0" || b == "0.0.0.0"
}
fn proc_ip(text: &str) -> Result<std::net::IpAddr> {
    if text.len() == 8 {
        return Ok(std::net::Ipv4Addr::from(u32::from_str_radix(text, 16)?.to_le_bytes()).into());
    }
    if text.len() != 32 {
        bail!("invalid /proc TCP address");
    }
    let mut bytes = [0u8; 16];
    for i in 0..4 {
        bytes[i * 4..i * 4 + 4]
            .copy_from_slice(&u32::from_str_radix(&text[i * 8..i * 8 + 8], 16)?.to_le_bytes());
    }
    let ip = std::net::Ipv6Addr::from(bytes);
    Ok(ip
        .to_ipv4_mapped()
        .map(std::net::IpAddr::V4)
        .unwrap_or(std::net::IpAddr::V6(ip)))
}
fn read_tcp_table(path: &str) -> Result<String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(e) if path == "/proc/net/tcp6" && e.kind() == std::io::ErrorKind::NotFound => {
            Ok(String::new())
        }
        Err(e) => Err(e).with_context(|| format!("cannot inspect TCP listeners: {path}")),
    }
}
pub async fn preflight(
    c: &Iec101Config,
    old: Option<&Iec101Config>,
    own_id: Option<&str>,
) -> Result<()> {
    drop(
        std::net::TcpListener::bind((c.bind_ip.as_str(), 0))
            .context("config.bind_ip: address unavailable")?,
    );
    let ids = crate::docker::cmd(&["ps", "-q"]).await?;
    let mut all = vec![];
    if !ids.trim().is_empty() {
        let mut args = vec!["inspect".to_string()];
        args.extend(ids.split_whitespace().map(str::to_owned));
        all = serde_json::from_str::<Vec<Value>>(&crate::docker::command(&args).await?)?;
    }
    for (name, port) in [("single", c.single.port), ("double", c.double.port)] {
        for v in &all {
            if v["Id"].as_str() == own_id {
                continue;
            }
            if let Some(p) = v["NetworkSettings"]["Ports"].as_object() {
                for (k, bs) in p {
                    if !k.ends_with("/tcp") {
                        continue;
                    }
                    if let Some(bs) = bs.as_array() {
                        for b in bs {
                            if b["HostPort"].as_str() != Some(port.to_string().as_str()) {
                                continue;
                            }
                            let host = b["HostIp"].as_str().unwrap_or("");
                            let ip = host.parse::<std::net::IpAddr>().ok();
                            let conflict=host=="::"||overlaps(host,&c.bind_ip)||ip.is_some_and(|i|matches!(i,std::net::IpAddr::V6(v6) if v6.to_ipv4_mapped().is_some_and(|v4| overlaps(&v4.to_string(),&c.bind_ip))));
                            if conflict {
                                bail!(
                                    "config.{name}.port: another Docker TCP publication conflicts"
                                );
                            }
                        }
                    }
                }
            }
        }
        let own_bind = old
            .filter(|o| {
                [o.single.port, o.double.port].contains(&port) && overlaps(&o.bind_ip, &c.bind_ip)
            })
            .map(|o| o.bind_ip.as_str());
        if own_bind.is_none() {
            drop(
                std::net::TcpListener::bind((c.bind_ip.as_str(), port))
                    .with_context(|| format!("config.{name}.port: TCP endpoint is unavailable"))?,
            );
            continue;
        }
        for file in ["/proc/net/tcp", "/proc/net/tcp6"] {
            for line in read_tcp_table(file)?.lines().skip(1) {
                let f = line.split_whitespace().collect::<Vec<_>>();
                if f.len() < 4 || f[3] != "0A" {
                    continue;
                }
                let Some((a, p)) = f[1].split_once(':') else {
                    continue;
                };
                if u16::from_str_radix(p, 16)? != port {
                    continue;
                }
                match proc_ip(a)? {
                    std::net::IpAddr::V4(ip) => {
                        let ip = ip.to_string();
                        if Some(ip.as_str()) != own_bind && overlaps(&ip, &c.bind_ip) {
                            bail!("config.{name}.port: foreign TCP listener conflicts");
                        }
                    }
                    std::net::IpAddr::V6(ip) if ip.is_unspecified() => {
                        bail!("config.{name}.port: wildcard IPv6 TCP listener may conflict")
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ipv6_disabled_hosts_can_inspect_tcp_without_hiding_other_io_errors() {
        let table = read_tcp_table("/proc/net/tcp6").unwrap();
        if !std::path::Path::new("/proc/net/tcp6").exists() {
            assert!(table.is_empty());
        }
        assert!(read_tcp_table("/proc/net/protocol-target-lab-nonexistent-table").is_err());
    }
    #[test]
    fn dual_config_patch_is_atomic_and_preserves_other_channel_fields() {
        let c = Iec101Config::default();
        let p = c
            .patch(json!({"single":{"port":18641,"point":{"value":false}}}))
            .unwrap();
        assert_eq!(p.double, c.double);
        assert_eq!(p.single.link_address, c.single.link_address);
        assert!(!p.single.point.value);
        assert_eq!(p.single.point.ioa, 1);
        for v in [
            json!({}),
            json!({"single":{}}),
            json!({"single":{"enabled":false}}),
            json!({"single":{"point":{"ioa":256}}}),
            json!({"single":{"point":{"value":null}}}),
            json!({"double":{"port":24741}}),
            json!({"single":{"originator_address":1}}),
            json!({"serial":{"baud_rate":4800}}),
            json!({"double":{"link_address":65535}}),
        ] {
            assert!(c.patch(v.clone()).is_err(), "{v}");
        }
        assert!(c.patch(json!({"double":{"common_address":65534,"originator_address":255,"point":{"ioa":16777215,"value":false}}})).is_ok());
    }
    #[test]
    fn fixed_reference_vectors_and_software_proc_addresses_are_exact() {
        let c = Iec101Config::default();
        assert_eq!(fixed(0x40, 1, 1), [0x10, 0x40, 1, 0x41, 0x16]);
        assert_eq!(fixed(0x7b, 4660, 2), [0x10, 0x7b, 0x34, 0x12, 0xc1, 0x16]);
        assert_eq!(check_frame(&[0xe5], 1, 1).unwrap().0, None);
        assert_eq!(
            proc_ip("0100007F").unwrap(),
            "127.0.0.1".parse::<std::net::IpAddr>().unwrap()
        );
        assert_eq!(
            proc_ip("0000000000000000FFFF00000100007F").unwrap(),
            "127.0.0.1".parse::<std::net::IpAddr>().unwrap()
        );
        assert!(c.validate().is_ok());
    }
}
