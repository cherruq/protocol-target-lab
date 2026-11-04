use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub name: String,
    pub record_type: String,
    pub value: String,
    pub ttl: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DnsConfig {
    pub bind_ip: String,
    pub port: u16,
    pub udp_enabled: bool,
    pub tcp_enabled: bool,
    pub records: Vec<Record>,
}
pub fn canonical_name(name: &str) -> String {
    name.trim_end_matches('.').to_ascii_lowercase()
}
impl Default for DnsConfig {
    fn default() -> Self {
        Self {
            bind_ip: "0.0.0.0".into(),
            port: 15353,
            udp_enabled: true,
            tcp_enabled: true,
            records: vec![Record {
                name: "device.test".into(),
                record_type: "A".into(),
                value: "192.0.2.28".into(),
                ttl: 60,
            }],
        }
    }
}
impl DnsConfig {
    pub fn validate(&self) -> Result<()> {
        let ip: std::net::Ipv4Addr = self
            .bind_ip
            .parse()
            .context("config.bind_ip: expected IPv4 address")?;
        if ip.is_multicast() || ip.is_broadcast() || self.port == 0 {
            bail!("config.bind_ip/config.port: expected unicast/wildcard IPv4 and port 1..65535");
        }
        if !self.udp_enabled && !self.tcp_enabled {
            bail!("config.transports: enable UDP or TCP");
        }
        if self.records.is_empty() || self.records.len() > 32 {
            bail!("config.records: expected 1..32 records");
        }
        let mut unique = HashSet::new();
        let mut sets = HashMap::new();
        for record in &self.records {
            let name = canonical_name(&record.name);
            if record.name.ends_with("..")
                || name.is_empty()
                || name.len() > 253
                || !name.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && label.as_bytes()[0].is_ascii_alphanumeric()
                        && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                        && label
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                })
            {
                bail!(
                    "config.records.name: expected ASCII DNS hostname (labels 1..63, total <=253)"
                );
            }
            let value = match record.record_type.as_str() {
                "A" => record
                    .value
                    .parse::<std::net::Ipv4Addr>()
                    .context("config.records.value: expected IPv4 address")?
                    .to_string(),
                "AAAA" => record
                    .value
                    .parse::<std::net::Ipv6Addr>()
                    .context("config.records.value: expected IPv6 address")?
                    .to_string(),
                _ => bail!("config.records.record_type: expected A or AAAA"),
            };
            if record.ttl > 86400 {
                bail!("config.records.ttl: expected 0..86400");
            }
            if !unique.insert((name.clone(), record.record_type.clone(), value)) {
                bail!("config.records: duplicate name/type/address");
            }
            let (ttl, count) = sets
                .entry((name, &record.record_type))
                .or_insert((record.ttl, 0));
            *count += 1;
            if *ttl != record.ttl || *count > 16 {
                bail!("config.records: each RRset needs a consistent TTL and at most 16 addresses");
            }
        }
        Ok(())
    }
    pub fn transports(&self) -> Vec<&'static str> {
        [(self.udp_enabled, "UDP"), (self.tcp_enabled, "TCP")]
            .into_iter()
            .filter_map(|(on, name)| on.then_some(name))
            .collect()
    }
    pub fn names(&self) -> Vec<String> {
        self.records
            .iter()
            .map(|r| canonical_name(&r.name))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
}

fn u16_at(data: &[u8], at: usize) -> Result<u16> {
    Ok(u16::from_be_bytes(
        data.get(at..at + 2)
            .context("DNS truncated integer")?
            .try_into()?,
    ))
}
fn name_at(data: &[u8], at: &mut usize) -> Result<String> {
    let mut pos = *at;
    let mut end = None;
    let mut labels = Vec::new();
    let mut seen = HashSet::new();
    loop {
        if !seen.insert(pos) || seen.len() > 128 {
            bail!("DNS compression pointer cycle");
        }
        let size = *data.get(pos).context("DNS truncated name")? as usize;
        if size & 0xc0 == 0xc0 {
            let next = u16_at(data, pos)? as usize & 0x3fff;
            end.get_or_insert(pos + 2);
            pos = next;
        } else if size == 0 {
            *at = end.unwrap_or(pos + 1);
            break;
        } else {
            if size > 63 {
                bail!("DNS invalid label");
            }
            labels.push(
                std::str::from_utf8(
                    data.get(pos + 1..pos + 1 + size)
                        .context("DNS truncated label")?,
                )?
                .to_ascii_lowercase(),
            );
            pos += size + 1;
        }
    }
    let name = labels.join(".");
    if name.len() > 253 {
        bail!("DNS oversized name");
    }
    Ok(name)
}
fn verify(
    data: &[u8],
    id: u16,
    name: &str,
    qtype: u16,
    expected: &BTreeSet<(Vec<u8>, u32)>,
) -> Result<()> {
    let flags = u16_at(data, 2)?;
    if u16_at(data, 0)? != id || flags & 0x8000 == 0 || flags & 0x7a0f != 0 || u16_at(data, 4)? != 1
    {
        bail!("DNS ID, flags, rcode or question count mismatch");
    }
    let mut at = 12;
    if name_at(data, &mut at)? != name || u16_at(data, at)? != qtype || u16_at(data, at + 2)? != 1 {
        bail!("DNS question mismatch");
    }
    at += 4;
    let mut answers = BTreeSet::new();
    for _ in 0..u16_at(data, 6)? {
        let owner = name_at(data, &mut at)?;
        let kind = u16_at(data, at)?;
        let class = u16_at(data, at + 2)?;
        let ttl = u32::from_be_bytes(
            data.get(at + 4..at + 8)
                .context("DNS truncated TTL")?
                .try_into()?,
        );
        let length = u16_at(data, at + 8)? as usize;
        at += 10;
        let value = data.get(at..at + length).context("DNS truncated answer")?;
        if owner != name || kind != qtype || class != 1 {
            bail!("DNS unexpected answer");
        }
        answers.insert((value.to_vec(), ttl));
        at += length;
    }
    if &answers != expected {
        bail!("DNS answer RRset/TTL does not match applied configuration");
    }
    Ok(())
}
pub async fn probe(config: &DnsConfig) -> Result<()> {
    let first = &config.records[0];
    let name = canonical_name(&first.name);
    let qtype: u16 = if first.record_type == "A" { 1 } else { 28 };
    let expected = config
        .records
        .iter()
        .filter(|r| canonical_name(&r.name) == name && r.record_type == first.record_type)
        .map(|r| {
            let bytes = if qtype == 1 {
                r.value
                    .parse::<std::net::Ipv4Addr>()
                    .unwrap()
                    .octets()
                    .to_vec()
            } else {
                r.value
                    .parse::<std::net::Ipv6Addr>()
                    .unwrap()
                    .octets()
                    .to_vec()
            };
            (bytes, r.ttl)
        })
        .collect::<BTreeSet<_>>();
    for transport in config.transports() {
        let id = u16::from_be_bytes(uuid::Uuid::new_v4().as_bytes()[..2].try_into()?);
        let mut packet = vec![];
        for value in [id, 0x0100, 1, 0, 0, 1] {
            packet.extend_from_slice(&value.to_be_bytes());
        }
        for label in name.split('.') {
            packet.push(label.len() as u8);
            packet.extend_from_slice(label.as_bytes());
        }
        packet.push(0);
        packet.extend_from_slice(&qtype.to_be_bytes());
        packet.extend_from_slice(&1u16.to_be_bytes());
        packet.extend_from_slice(&[0, 0, 41, 4, 208, 0, 0, 0, 0, 0, 0]); // EDNS0, 1232 bytes.
        let host = if config.bind_ip == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &config.bind_ip
        };
        let response = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            if transport == "UDP" {
                let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
                socket.connect((host, config.port)).await?;
                socket.send(&packet).await?;
                let mut bytes = vec![0; 65535];
                let n = socket.recv(&mut bytes).await?;
                bytes.truncate(n);
                Ok::<_, anyhow::Error>(bytes)
            } else {
                let mut socket = tokio::net::TcpStream::connect((host, config.port)).await?;
                socket
                    .write_all(&(packet.len() as u16).to_be_bytes())
                    .await?;
                socket.write_all(&packet).await?;
                let n = socket.read_u16().await? as usize;
                let mut bytes = vec![0; n];
                socket.read_exact(&mut bytes).await?;
                Ok(bytes)
            }
        })
        .await
        .context("DNS readiness timed out")??;
        verify(&response, id, &name, qtype, &expected)
            .with_context(|| format!("DNS {transport} readiness"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_rejects_invalid_rrsets_and_transport_shapes() {
        let base = DnsConfig::default();
        assert!(base.validate().is_ok());
        let mut c = base.clone();
        c.udp_enabled = false;
        c.tcp_enabled = false;
        assert!(c.validate().is_err());
        for name in [
            "",
            "bad..test",
            "-bad.test",
            "bad_.test",
            "device.test..",
            "é.test",
        ] {
            let mut c = base.clone();
            c.records[0].name = name.into();
            assert!(c.validate().is_err(), "{name}");
        }
        let mut c = base.clone();
        c.records[0].name = "DEVICE.test.".into();
        assert!(c.validate().is_ok());
        c.records.push(base.records[0].clone());
        assert!(c.validate().is_err());
        c.records[1].value = "192.0.2.29".into();
        c.records[1].ttl = 61;
        assert!(c.validate().is_err());
        c.records[1].ttl = 60;
        assert!(c.validate().is_ok());
        c.records[1].record_type = "AAAA".into();
        c.records[1].value = "2001:db8::1".into();
        assert!(c.validate().is_ok());
        c.records[1].ttl = 86401;
        assert!(c.validate().is_err());
        let mut c = base.clone();
        c.records = (1..=17)
            .map(|n| Record {
                value: format!("192.0.2.{n}"),
                ..base.records[0].clone()
            })
            .collect();
        assert!(c.validate().is_err());
    }
    #[test]
    fn compression_and_truncation_fail_closed() {
        let mut at = 0;
        assert!(name_at(&[0xc0, 0], &mut at).is_err());
        let mut at = 0;
        assert!(name_at(&[5, b'a'], &mut at).is_err());
        assert!(verify(&[0; 11], 1, "device.test", 1, &BTreeSet::new()).is_err());
    }
}
