//! JSON API client for automated callers. Resource mutations stay in the manager.
use crate::model::{ProtocolConfig, valid_id};
use reqwest::{Client, Method, Url};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::AsyncReadExt;

pub const HELP: &str = r#"Protocol Target Lab CLI (JSON output for API commands)

  plabctl [--url http://127.0.0.1:18000] [--timeout 120] [--json] COMMAND
  health | protocols | environment | assets list
  schema PROTOCOL | show PROTOCOL | status PROTOCOL
  config get PROTOCOL [--applied]
  config set PROTOCOL --file FILE|- | --data JSON
  config set PROTOCOL [--bind-ip IP] [--port N] [--response-length N] [--response-mode fixed|random]
  config set dns [--bind-ip IP] [--port N] [--udp-enabled true|false] [--tcp-enabled true|false] [--records-json JSON]
  config set mqtt [--bind-ip IP] [--port N] [--max-connections N] [--max-packet-size N]
  config set arp-client [--link-json JSON] [--source-mac MAC] [--source-ip IP] [--server-mac MAC] [--server-ip IP] [--assigned-ip IP] [--mode whois|response-fuzz|rarp|inarp] [--request-scenario-json JSON] [--interval-ms N] [--timeout-ms N] [--retries N]
  config set vxlan [--bind-ip IP] [--port N] [--peer-ip IP] [--peer-port N] [--source-port N] [--vni N] [--inner-ip IP] [--inner-mac MAC] [--requester-ip IP] [--requester-mac MAC] [--reply-padding 0|18] [--scenario-json JSON]
  config set bfd [--bind-ip IP] [--peer-ip IP] [--interface IFACE] [--source-port N] [--local-discriminator N] [--min-tx-us N] [--min-rx-us N] [--detect-mult N] [--scenario-json JSON]
  config set iec101 [--bind-ip IP] [--single-port N] [--double-port N] [--single-json JSON] [--double-json JSON] [--serial-json JSON]
  config set dlt645 [--port N] [--meter-address DIGITS] [--energy-hundredths N] [--period-minutes N] [--programming-key-enabled true|false] [--security-json JSON]
  config set rtcp [--bind-ip IP] [--port N] [--max-packet-size N] [--packet-profile sr-sdes]
  config set rtp [--bind-ip IP] [--port N] [--max-packet-size N]
  config set mqtt-sn [--port N] [--discovery-group IP] [--discovery-port N] [--gateway-id N] [--broker-port N] [--predefined-topics-json JSON]
  config set iec104 [--bind-ip IP] [--port N] [--max-connections N] [--points-json JSON]
  config set telnet [--bind-ip IP] [--port N] [--banner TEXT] [--max-connections N] [--max-line-bytes N]
  start PROTOCOL | stop PROTOCOL | restart PROTOCOL [--wait | --no-wait]
  connection-info PROTOCOL | runtime bfd|vxlan|arp-client
  logs PROTOCOL [--follow]
  tests list PROTOCOL
  tests run PROTOCOL [--method ALL] [--path /ok | --name DNS_NAME] (DNS defaults to ALL) [--wait | --no-wait]
  tests result PROTOCOL [--id TEST_ID] [--wait | --no-wait]

API mutations wait for their exact operation/test by default; config set only saves.
JSON is the default. --follow emits JSON Lines; Ctrl-C stops following.
PLAB_URL supplies the URL when --url is absent. Total timeout is 1..3600 seconds (BFD test commands default to150).
Exit codes: 0 success, 1 operation/test failure, 2 usage/input, 3 transport/invalid
reply, 4 API rejection, 5 timeout, 6 interrupted/replaced operation or test.
Timeout/interruption does not cancel an already accepted manager operation.

Local administrative commands (retain existing behavior; may require root):
  protocol-target-lab serve
  plabctl start                 start the management service
  plabctl stop-all              stop manager and owned resources
  plabctl status | doctor       local persisted state and Docker diagnostics
  plabctl serial start --host IPv4 --single-port N --double-port N
  plabctl serial status | stop   local root-owned dual PTY helper
  plabctl assets import DIR     local image import from a checked manifest
Settings: PLAB_LISTEN, PLAB_CONFIG_FILE, PLAB_DATA_DIR, PLAB_HTTP_IMAGE, PLAB_DNS_IMAGE, PLAB_MQTT_IMAGE, PLAB_TELNET_IMAGE, PLAB_IEC104_IMAGE, PLAB_MQTTSN_IMAGE, PLAB_RTP_IMAGE, PLAB_RTCP_IMAGE, PLAB_DLT645_IMAGE, PLAB_IEC101_IMAGE, PLAB_BFD_IMAGE, PLAB_VXLAN_IMAGE, PLAB_ARP_CLIENT_IMAGE, PLAB_DOCKER_SOCKET
"#;
const LIMIT: usize = 8 * 1024 * 1024;
type Result<T> = std::result::Result<T, Failure>;
#[derive(Debug)]
struct Failure {
    exit: i32,
    code: &'static str,
    message: String,
    data: Value,
}
impl Failure {
    fn new(exit: i32, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            exit,
            code,
            message: message.into(),
            data: Value::Null,
        }
    }
    fn usage(message: impl Into<String>) -> Self {
        Self::new(2, "invalid_arguments", message)
    }
    fn transport(error: impl std::fmt::Display) -> Self {
        Self::new(3, "transport_error", error.to_string())
    }
    fn reply(message: impl Into<String>) -> Self {
        Self::new(3, "invalid_reply", message)
    }
    fn with_data(mut self, data: Value) -> Self {
        self.data = data;
        self
    }
}
#[derive(Debug)]
enum Command {
    Get(&'static str),
    Schema(String),
    Show(String),
    ConfigGet(String, bool),
    ConfigSet(String, ConfigInput),
    Action(String, &'static str, bool),
    Connection(String),
    Runtime(String),
    Logs(String, bool),
    TestsList(String),
    TestRun(String, String, String, bool),
    TestResult(String, Option<String>, bool),
}
impl Command {
    fn name(&self) -> &'static str {
        match self {
            Self::Get(path) => match *path {
                "/healthz" => "health",
                "/api/protocols" => "protocols",
                "/api/assets" => "assets.list",
                _ => "environment",
            },
            Self::Schema(_) => "schema",
            Self::Show(_) => "show",
            Self::ConfigGet(..) => "config.get",
            Self::ConfigSet(..) => "config.set",
            Self::Action(_, kind, _) => kind,
            Self::Connection(_) => "connection-info",
            Self::Runtime(_) => "runtime",
            Self::Logs(..) => "logs",
            Self::TestsList(_) => "tests.list",
            Self::TestRun(..) => "tests.run",
            Self::TestResult(..) => "tests.result",
        }
    }
}
#[derive(Debug)]
enum ConfigInput {
    File(String),
    Data(String),
    Fields(BTreeMap<String, String>),
}
struct Options {
    url: Url,
    timeout: u64,
    command: Command,
}

const VALUE_OPTIONS: &[&str] = &[
    "--url",
    "--timeout",
    "--file",
    "--data",
    "--bind-ip",
    "--port",
    "--response-length",
    "--response-mode",
    "--method",
    "--path",
    "--id",
    "--name",
    "--udp-enabled",
    "--tcp-enabled",
    "--records-json",
    "--points-json",
    "--predefined-topics-json",
    "--broker-port",
    "--broker-host",
    "--gateway-id",
    "--discovery-port",
    "--discovery-group",
    "--max-connections",
    "--max-packet-size",
    "--packet-profile",
    "--wire-profile",
    "--peer-ip",
    "--link-json",
    "--source-mac",
    "--source-ip",
    "--server-mac",
    "--server-ip",
    "--assigned-ip",
    "--mode",
    "--request-scenario-json",
    "--interval-ms",
    "--timeout-ms",
    "--retries",
    "--peer-port",
    "--vni",
    "--inner-ip",
    "--inner-mac",
    "--requester-ip",
    "--requester-mac",
    "--reply-padding",
    "--interface",
    "--source-port",
    "--local-discriminator",
    "--min-tx-us",
    "--min-rx-us",
    "--detect-mult",
    "--scenario-json",
    "--meter-address",
    "--energy-hundredths",
    "--period-minutes",
    "--programming-key-enabled",
    "--security-json",
    "--single-port",
    "--double-port",
    "--single-json",
    "--double-json",
    "--serial-json",
    "--banner",
    "--max-line-bytes",
];
fn wants_help(args: &[String]) -> bool {
    if args.len() == 1 && args[0] == "help" {
        return true;
    }
    let mut tokens = args.iter();
    while let Some(token) = tokens.next() {
        if VALUE_OPTIONS.contains(&token.as_str()) {
            tokens.next();
        } else if matches!(token.as_str(), "--help" | "-h") {
            return true;
        }
    }
    false
}
fn valid_local_command(args: &[String]) -> bool {
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        [] | ["serve" | "stop-all" | "doctor" | "--version" | "-V" | "start" | "status"] => true,
        ["assets", "import", directory] => !directory.starts_with('-'),
        _ => false,
    }
}
fn is_api_command(args: &[String]) -> bool {
    if args
        .iter()
        .any(|a| matches!(a.as_str(), "--url" | "--timeout" | "--json"))
    {
        return true;
    }
    match args.first().map(String::as_str) {
        None | Some("serve" | "stop-all" | "doctor" | "--version" | "-V") => false,
        Some("start" | "status") if args.len() == 1 => false,
        Some("assets") if args.get(1).map(String::as_str) == Some("import") => false,
        _ => true,
    }
}

fn parse(args: &[String]) -> Result<Options> {
    let mut positional = vec![];
    let mut values = BTreeMap::new();
    let mut flags = BTreeSet::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            option if VALUE_OPTIONS.contains(&option) => {
                let value = iter
                    .next()
                    .ok_or_else(|| Failure::usage(format!("{arg} requires a value")))?;
                if values.insert(arg.clone(), value.clone()).is_some() {
                    return Err(Failure::usage(format!("duplicate {arg}")));
                }
            }
            "--json" | "--wait" | "--no-wait" | "--applied" | "--follow" => {
                if !flags.insert(arg.clone()) {
                    return Err(Failure::usage(format!("duplicate {arg}")));
                }
            }
            other if other.starts_with('-') => {
                return Err(Failure::usage(format!("unknown option {other}")));
            }
            _ => positional.push(arg.as_str()),
        }
    }
    flags.remove("--json");
    let url = values
        .remove("--url")
        .or_else(|| std::env::var("PLAB_URL").ok())
        .unwrap_or_else(|| "http://127.0.0.1:18000".into());
    let url = Url::parse(&url).map_err(|_| Failure::usage("--url must be an absolute HTTP URL"))?;
    if url.scheme() != "http"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Failure::usage(
            "--url must be http://HOST:PORT without credentials, path, query or fragment",
        ));
    }
    let default_timeout = if matches!(positional.as_slice(), ["tests", "run" | "result", "bfd"]) {
        "150"
    } else {
        "120"
    };
    let timeout = values
        .remove("--timeout")
        .unwrap_or_else(|| default_timeout.into())
        .parse::<u64>()
        .map_err(|_| Failure::usage("--timeout must be an integer in 1..3600"))?;
    if !(1..=3600).contains(&timeout) {
        return Err(Failure::usage("--timeout must be in 1..3600 seconds"));
    }
    fn protocol(s: &str) -> Result<String> {
        if valid_id(s) {
            Ok(s.into())
        } else {
            Err(Failure::usage("invalid protocol identifier"))
        }
    }
    fn waiting(flags: &mut BTreeSet<String>, default: bool) -> Result<bool> {
        let yes = flags.remove("--wait");
        let no = flags.remove("--no-wait");
        if yes && no {
            return Err(Failure::usage(
                "--wait and --no-wait are mutually exclusive",
            ));
        }
        Ok(yes || (default && !no))
    }
    let command = match positional.as_slice() {
        ["health"] => Command::Get("/healthz"),
        ["protocols"] => Command::Get("/api/protocols"),
        ["environment"] => Command::Get("/api/environment"),
        ["assets"] | ["assets", "list"] => Command::Get("/api/assets"),
        ["schema", p] => Command::Schema(protocol(p)?),
        ["show", p] | ["status", p] => Command::Show(protocol(p)?),
        ["config", "get", p] => Command::ConfigGet(protocol(p)?, flags.remove("--applied")),
        ["config", "set", p] => {
            let file = values.remove("--file");
            let data = values.remove("--data");
            let mut fields = BTreeMap::new();
            for name in [
                "--bind-ip",
                "--port",
                "--response-length",
                "--response-mode",
                "--udp-enabled",
                "--tcp-enabled",
                "--records-json",
                "--points-json",
                "--predefined-topics-json",
                "--broker-port",
                "--broker-host",
                "--gateway-id",
                "--discovery-port",
                "--discovery-group",
                "--max-connections",
                "--max-packet-size",
                "--packet-profile",
                "--wire-profile",
                "--peer-ip",
                "--link-json",
                "--source-mac",
                "--source-ip",
                "--server-mac",
                "--server-ip",
                "--assigned-ip",
                "--mode",
                "--request-scenario-json",
                "--interval-ms",
                "--timeout-ms",
                "--retries",
                "--peer-port",
                "--vni",
                "--inner-ip",
                "--inner-mac",
                "--requester-ip",
                "--requester-mac",
                "--reply-padding",
                "--interface",
                "--source-port",
                "--local-discriminator",
                "--min-tx-us",
                "--min-rx-us",
                "--detect-mult",
                "--scenario-json",
                "--meter-address",
                "--energy-hundredths",
                "--period-minutes",
                "--programming-key-enabled",
                "--security-json",
                "--single-port",
                "--double-port",
                "--single-json",
                "--double-json",
                "--serial-json",
                "--banner",
                "--max-line-bytes",
            ] {
                if let Some(value) = values.remove(name) {
                    fields.insert(name.into(), value);
                }
            }
            let input = match (file, data, fields.is_empty()) {
                (Some(file), None, true) => ConfigInput::File(file),
                (None, Some(data), true) => ConfigInput::Data(data),
                (None, None, false) => ConfigInput::Fields(fields),
                _ => {
                    return Err(Failure::usage(
                        "config set requires exactly one of --file, --data, or configuration field options",
                    ));
                }
            };
            Command::ConfigSet(protocol(p)?, input)
        }
        [kind @ ("start" | "stop" | "restart"), p] => Command::Action(
            protocol(p)?,
            match *kind {
                "start" => "start",
                "stop" => "stop",
                _ => "restart",
            },
            waiting(&mut flags, true)?,
        ),
        ["connection-info", p] => Command::Connection(protocol(p)?),
        ["runtime", p] => Command::Runtime(protocol(p)?),
        ["logs", p] => Command::Logs(protocol(p)?, flags.remove("--follow")),
        ["tests", "list", p] => Command::TestsList(protocol(p)?),
        ["tests", "run", p] => Command::TestRun(
            protocol(p)?,
            values
                .remove("--method")
                .unwrap_or_else(|| "ALL".into())
                .to_ascii_uppercase(),
            {
                let path = values.remove("--path");
                let name = values.remove("--name");
                if path.is_some() && name.is_some() {
                    return Err(Failure::usage("--name and --path are mutually exclusive"));
                }
                if name.is_some() && *p != "dns" {
                    return Err(Failure::usage("--name applies to DNS tests"));
                }
                path.or(name).unwrap_or_else(|| {
                    if *p == "arp-client" {
                        crate::arp_client::PATH.into()
                    } else if *p == "vxlan" {
                        crate::vxlan::PATH.into()
                    } else if *p == "bfd" {
                        crate::bfd::PATH.into()
                    } else if *p == "iec101" {
                        "dual".into()
                    } else if *p == "dns" {
                        "ALL".into()
                    } else if *p == "mqtt" {
                        crate::mqtt::TEST_TOPIC.into()
                    } else if *p == "dlt645" {
                        crate::dlt645::PATH.into()
                    } else if *p == "rtcp" {
                        crate::rtcp::PATH.into()
                    } else if *p == "rtp" {
                        crate::rtp::PATH.into()
                    } else if *p == "mqtt-sn" {
                        crate::mqtt_sn::PATH.into()
                    } else if *p == "iec104" {
                        crate::iec104::PATH.into()
                    } else if *p == "telnet" {
                        crate::telnet::PATH.into()
                    } else {
                        "/ok".into()
                    }
                })
            },
            waiting(&mut flags, true)?,
        ),
        ["tests", "result", p] => Command::TestResult(
            protocol(p)?,
            values.remove("--id"),
            waiting(&mut flags, false)?,
        ),
        _ => {
            return Err(Failure::usage(
                "unknown command or missing protocol; use plabctl --help",
            ));
        }
    };
    if !values.is_empty() || !flags.is_empty() {
        return Err(Failure::usage(format!(
            "options do not apply to this command: {}",
            values
                .keys()
                .chain(flags.iter())
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    Ok(Options {
        url,
        timeout,
        command,
    })
}
fn emit(value: &Value) -> Result<()> {
    let mut out = std::io::stdout().lock();
    serde_json::to_writer(&mut out, value).map_err(Failure::transport)?;
    out.write_all(b"\n")
        .and_then(|_| out.flush())
        .map_err(Failure::transport)
}
struct Api {
    base: Url,
    client: Client,
    progress: Arc<Mutex<Value>>,
}
impl Api {
    fn context(&self, value: Value) {
        *self.progress.lock().expect("CLI context") = value;
    }
    async fn response(
        &self,
        method: Method,
        path: &str,
        data: Option<Value>,
    ) -> Result<reqwest::Response> {
        let mut request = self
            .client
            .request(method, self.base.join(path).map_err(Failure::transport)?);
        if let Some(data) = data {
            request = request.json(&data);
        }
        tokio::time::timeout(Duration::from_secs(10), request.send())
            .await
            .map_err(|_| Failure::transport("API request timed out after 10 seconds"))?
            .map_err(Failure::transport)
    }
    async fn request(&self, method: Method, path: &str, data: Option<Value>) -> Result<Value> {
        tokio::time::timeout(
            Duration::from_secs(10),
            self.request_json(method, path, data),
        )
        .await
        .map_err(|_| Failure::transport("API response timed out after 10 seconds"))?
    }
    async fn request_json(&self, method: Method, path: &str, data: Option<Value>) -> Result<Value> {
        let mut response = self.response(method, path, data).await?;
        let status = response.status();
        let mut bytes = vec![];
        while let Some(chunk) = response.chunk().await.map_err(Failure::transport)? {
            if bytes.len() + chunk.len() > LIMIT {
                return Err(Failure::reply("API response exceeded 8 MiB"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            let message = value["error"]["message"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("API returned HTTP {}", status.as_u16()));
            return Err(Failure::new(4, "api_rejected", message)
                .with_data(json!({"http_status":status.as_u16(),"response":value})));
        }
        serde_json::from_slice(&bytes).map_err(|_| Failure::reply("API did not return valid JSON"))
    }
    async fn get(&self, path: &str) -> Result<Value> {
        self.request(Method::GET, path, None).await
    }
    async fn descriptor(&self, protocol: &str) -> Result<Value> {
        let catalog = self.get("/api/protocols").await?;
        let list = catalog
            .as_array()
            .ok_or_else(|| Failure::reply("protocol catalog is not an array"))?;
        list.iter()
            .find(|item| item["id"] == protocol)
            .cloned()
            .ok_or_else(|| {
                Failure::new(
                    4,
                    "protocol_not_found",
                    format!("protocol {protocol} is not implemented"),
                )
            })
    }
    async fn target(&self, protocol: &str) -> Result<(String, Value)> {
        let descriptor = self.descriptor(protocol).await?;
        let id = descriptor["workspace"]["id"]
            .as_str()
            .filter(|id| valid_id(id))
            .ok_or_else(|| {
                Failure::new(
                    4,
                    "workspace_unavailable",
                    descriptor["error"]
                        .as_str()
                        .unwrap_or("protocol workspace is unavailable"),
                )
                .with_data(descriptor.clone())
            })?
            .to_owned();
        self.context(json!({"protocol":protocol,"instance_id":id}));
        Ok((id, descriptor))
    }
    async fn wait_action(
        &self,
        protocol: &str,
        id: &str,
        operation: &str,
        session: &str,
    ) -> Result<Value> {
        loop {
            let descriptor = self.descriptor(protocol).await?;
            if descriptor["session_id"] != session || descriptor["workspace"]["id"] != id {
                return Err(Failure::new(
                    6,
                    "interrupted",
                    "manager session or workspace changed while waiting",
                )
                .with_data(descriptor));
            }
            let w = &descriptor["workspace"];
            if w["last_result"]["operation_id"] == operation {
                return if w["last_result"]["success"] == true {
                    Ok(descriptor)
                } else {
                    Err(Failure::new(
                        1,
                        "operation_failed",
                        w["last_result"]["error"]
                            .as_str()
                            .unwrap_or("operation failed"),
                    )
                    .with_data(descriptor))
                };
            }
            if descriptor["status"] == "unavailable" {
                return Err(Failure::new(
                    1,
                    "manager_unavailable",
                    descriptor["error"]
                        .as_str()
                        .unwrap_or("manager cannot persist or verify operation"),
                )
                .with_data(descriptor));
            }
            if w["current_operation"]["id"] != operation {
                return Err(Failure::new(
                    6,
                    "superseded",
                    "operation result was replaced or is no longer available",
                )
                .with_data(descriptor));
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }
    async fn wait_test(&self, id: &str, test: &str, session: &str) -> Result<Value> {
        loop {
            let snapshot = self.get(&format!("/api/instances/{id}/tests")).await?;
            let run = &snapshot["current"];
            if snapshot["session_id"] != session || run["id"] != test || run["instance_id"] != id {
                return Err(Failure::new(
                    6,
                    "interrupted",
                    "test was replaced, lost, or belongs to another manager session",
                )
                .with_data(snapshot));
            }
            if run["status"] != "running" {
                if run["status"] != "passed" || run["report"]["passed"] != true {
                    return Err(Failure::new(
                        1,
                        "test_failed",
                        run["error"]
                            .as_str()
                            .or(run["report"]["error"].as_str())
                            .unwrap_or("client test failed"),
                    )
                    .with_data(snapshot));
                }
                if run["cleanup_complete"] == true {
                    return Ok(snapshot);
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }
    async fn logs(&self, protocol: &str, id: &str, follow: bool) -> Result<Value> {
        let mut response = self
            .response(Method::GET, &format!("/api/instances/{id}/logs"), None)
            .await?;
        if !response.status().is_success() {
            return Err(Failure::new(
                4,
                "api_rejected",
                format!("logs API returned HTTP {}", response.status().as_u16()),
            ));
        }
        let mut buffer = vec![];
        let mut previous = None;
        while let Some(chunk) = response.chunk().await.map_err(Failure::transport)? {
            buffer.extend_from_slice(&chunk);
            if buffer.len() > LIMIT {
                return Err(Failure::reply("log event exceeded 8 MiB"));
            }
            // Accept both standard LF and CRLF event boundaries; keepalive
            // frames carry no data. Bytes remain buffered across network chunks.
            while let Some((end, delimiter)) = buffer
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|p| (p, 2))
                .into_iter()
                .chain(
                    buffer
                        .windows(4)
                        .position(|w| w == b"\r\n\r\n")
                        .map(|p| (p, 4)),
                )
                .min_by_key(|(position, _)| *position)
            {
                let frame = String::from_utf8(buffer.drain(..end + delimiter).collect())
                    .map_err(|_| Failure::reply("invalid UTF-8 log event"))?;
                let data = frame
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() {
                    continue;
                }
                let value: Value = serde_json::from_str(&data)
                    .map_err(|_| Failure::reply("invalid JSON log event"))?;
                if !value["lines"].is_array() {
                    return Err(Failure::reply("invalid log snapshot"));
                }
                if !follow {
                    return Ok(value);
                }
                if previous.as_ref() != Some(&value) {
                    emit(
                        &json!({"schema_version":1,"ok":true,"command":"logs","context":{"protocol":protocol,"instance_id":id},"data":value}),
                    )?;
                    previous = Some(value);
                }
            }
        }
        Err(Failure::new(
            3,
            "stream_closed",
            "log stream ended; reconnect explicitly",
        ))
    }
}
fn config_patch(fields: BTreeMap<String, String>) -> Result<Value> {
    let mut patch = serde_json::Map::new();
    for channel in ["single", "double"] {
        if fields.contains_key(&format!("--{channel}-port"))
            && fields.contains_key(&format!("--{channel}-json"))
        {
            return Err(Failure::usage(format!(
                "--{channel}-port and --{channel}-json overlap"
            )));
        }
    }
    for (key, value) in fields {
        if matches!(key.as_str(), "--single-port" | "--double-port") {
            let port = value
                .parse::<u16>()
                .map_err(|_| Failure::usage(format!("{key} must be1..65535")))?;
            if port == 0 {
                return Err(Failure::usage(format!("{key} must be1..65535")));
            }
            patch.insert(
                key.trim_start_matches("--")
                    .trim_end_matches("-port")
                    .into(),
                json!({"port":port}),
            );
            continue;
        }
        let value = match key.as_str() {
            "--interval-ms"
            | "--timeout-ms"
            | "--retries"
            | "--peer-port"
            | "--vni"
            | "--reply-padding"
            | "--source-port"
            | "--local-discriminator"
            | "--min-tx-us"
            | "--min-rx-us"
            | "--detect-mult"
            | "--port"
            | "--response-length"
            | "--max-connections"
            | "--max-packet-size"
            | "--max-line-bytes"
            | "--discovery-port"
            | "--gateway-id"
            | "--broker-port"
            | "--energy-hundredths"
            | "--period-minutes" => json!(
                value
                    .parse::<u32>()
                    .map_err(|_| Failure::usage(format!("{key} must be a nonnegative integer")))?
            ),
            "--udp-enabled" | "--tcp-enabled" | "--programming-key-enabled" => Value::Bool(
                value
                    .parse::<bool>()
                    .map_err(|_| Failure::usage(format!("{key} must be true or false")))?,
            ),
            "--link-json"
            | "--request-scenario-json"
            | "--scenario-json"
            | "--records-json"
            | "--points-json"
            | "--predefined-topics-json"
            | "--security-json"
            | "--single-json"
            | "--double-json"
            | "--serial-json" => serde_json::from_str(&value)
                .map_err(|e| Failure::usage(format!("invalid configuration JSON: {e}")))?,
            _ => Value::String(value),
        };
        patch.insert(
            if key == "--link-json" {
                "link".into()
            } else if key == "--request-scenario-json" {
                "request_scenario".into()
            } else if key == "--scenario-json" {
                "scenario".into()
            } else if matches!(
                key.as_str(),
                "--single-json" | "--double-json" | "--serial-json"
            ) {
                key.trim_start_matches("--")
                    .trim_end_matches("-json")
                    .into()
            } else if key == "--security-json" {
                "security".into()
            } else if key == "--records-json" {
                "records".into()
            } else if key == "--predefined-topics-json" {
                "predefined_topics".into()
            } else if key == "--points-json" {
                "points".into()
            } else {
                key.trim_start_matches("--").replace('-', "_")
            },
            value,
        );
    }
    Ok(Value::Object(patch))
}

async fn configuration(input: ConfigInput, current: Value) -> Result<ProtocolConfig> {
    let config = match input {
        ConfigInput::File(path) => {
            let mut bytes = vec![];
            if path == "-" {
                tokio::io::stdin()
                    .take(512 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .await
                    .map_err(|e| Failure::usage(e.to_string()))?;
            } else {
                tokio::fs::File::open(path)
                    .await
                    .map_err(|e| Failure::usage(e.to_string()))?
                    .take(512 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .await
                    .map_err(|e| Failure::usage(e.to_string()))?;
            }
            if bytes.len() > 512 * 1024 {
                return Err(Failure::usage("configuration input exceeds 512 KiB"));
            }
            serde_json::from_slice(&bytes)
                .map_err(|e| Failure::usage(format!("invalid configuration JSON: {e}")))?
        }
        ConfigInput::Data(data) => {
            if data.len() > 512 * 1024 {
                return Err(Failure::usage("configuration input exceeds 512 KiB"));
            }
            serde_json::from_str(&data)
                .map_err(|e| Failure::usage(format!("invalid configuration JSON: {e}")))?
        }
        ConfigInput::Fields(fields) => {
            let config: ProtocolConfig = serde_json::from_value(current)
                .map_err(|_| Failure::reply("invalid saved protocol configuration"))?;
            config
                .patch(config_patch(fields)?)
                .map_err(|e| Failure::usage(e.to_string()))?
        }
    };
    config
        .validate()
        .map_err(|e| Failure::usage(e.to_string()))?;
    Ok(config)
}
fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value[name]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            Failure::reply(format!(
                "missing {name}; manager may be too old for reliable CLI waiting"
            ))
        })
}
async fn execute(api: &Api, command: Command) -> Result<Value> {
    match command {
        Command::Get(path) => api.get(path).await,
        Command::Schema(p) => api.get(&format!("/api/protocols/{p}/schema")).await,
        Command::Show(p) => api.descriptor(&p).await,
        Command::ConfigGet(p, applied) => {
            let (_, d) = api.target(&p).await?;
            Ok(d["workspace"][if applied { "applied_config" } else { "config" }].clone())
        }
        Command::ConfigSet(p, input) => {
            let (id, d) = api.target(&p).await?;
            if let ConfigInput::Fields(fields) = input {
                let patch = config_patch(fields)?;
                let current: ProtocolConfig =
                    serde_json::from_value(d["workspace"]["config"].clone())
                        .map_err(|_| Failure::reply("invalid saved protocol configuration"))?;
                current
                    .patch(patch.clone())
                    .map_err(|e| Failure::usage(e.to_string()))?;
                // Never turn a field edit into a stale full-document PUT. Older
                // managers reject PATCH rather than silently losing an update.
                return api
                    .request(
                        Method::PATCH,
                        &format!("/api/instances/{id}/config"),
                        Some(serde_json::to_value(patch).map_err(Failure::transport)?),
                    )
                    .await;
            }
            let c = configuration(input, d["workspace"]["config"].clone()).await?;
            if c.protocol_id() != p {
                return Err(Failure::usage("configuration does not match protocol"));
            }
            api.request(
                Method::PUT,
                &format!("/api/instances/{id}/config"),
                Some(serde_json::to_value(c).map_err(Failure::transport)?),
            )
            .await
        }
        Command::Action(p, kind, wait) => {
            let (id, descriptor) = api.target(&p).await?;
            if wait {
                field(&descriptor, "session_id")?;
            }
            let accepted = api
                .request(Method::POST, &format!("/api/instances/{id}/{kind}"), None)
                .await?;
            api.context(json!({"protocol":p,"instance_id":id,"accepted":accepted}));
            if !wait {
                return Ok(json!({"accepted":true,"operation":accepted}));
            }
            api.wait_action(
                &p,
                &id,
                field(&accepted, "operation_id")?,
                field(&accepted, "session_id")?,
            )
            .await
        }
        Command::Runtime(p) => {
            let (id, _) = api.target(&p).await?;
            api.get(&format!("/api/instances/{id}/runtime")).await
        }
        Command::Connection(p) => {
            let (id, _) = api.target(&p).await?;
            api.get(&format!("/api/instances/{id}/connection-info"))
                .await
        }
        Command::Logs(p, follow) => {
            let (id, _) = api.target(&p).await?;
            api.logs(&p, &id, follow).await
        }
        Command::TestsList(p) => {
            let (id, _) = api.target(&p).await?;
            api.get(&format!("/api/instances/{id}/tests")).await
        }
        Command::TestRun(p, method, path, wait) => {
            let (id, descriptor) = api.target(&p).await?;
            if wait {
                field(&descriptor, "session_id")?;
            }
            let accepted = api
                .request(
                    Method::POST,
                    &format!("/api/instances/{id}/tests"),
                    Some(json!({"method":method,"path":path})),
                )
                .await?;
            api.context(json!({"protocol":p,"instance_id":id,"accepted":accepted}));
            if !wait {
                return Ok(json!({"accepted":true,"test":accepted}));
            }
            api.wait_test(
                &id,
                field(&accepted, "test_id")?,
                field(&accepted, "session_id")?,
            )
            .await
        }
        Command::TestResult(p, id, wait) => {
            let (instance, _) = api.target(&p).await?;
            let snapshot = api.get(&format!("/api/instances/{instance}/tests")).await?;
            let test = id.or_else(|| snapshot["current"]["id"].as_str().map(str::to_owned));
            if let Some(test) = test {
                if snapshot["current"]["id"] != test {
                    return Err(Failure::new(
                        6,
                        "interrupted",
                        "requested test is no longer the retained result",
                    )
                    .with_data(snapshot));
                }
                if wait {
                    api.context(json!({"protocol":p,"instance_id":instance,"test_id":test}));
                    return api
                        .wait_test(&instance, &test, field(&snapshot, "session_id")?)
                        .await;
                }
            } else if wait {
                return Err(Failure::new(
                    4,
                    "no_test_result",
                    "no test result is available to wait for",
                ));
            }
            Ok(snapshot)
        }
    }
}

pub async fn dispatch(args: &[String]) -> Option<i32> {
    if wants_help(args) {
        println!("{HELP}");
        return Some(0);
    }
    if !is_api_command(args) {
        if valid_local_command(args) {
            return None;
        }
        let _ = emit(
            &json!({"schema_version":1,"ok":false,"error":{"code":"invalid_arguments","message":"unexpected arguments for local administration; use plabctl --help"}}),
        );
        return Some(2);
    }
    let options = match parse(args) {
        Ok(o) => o,
        Err(e) => {
            let _ = emit(
                &json!({"schema_version":1,"ok":false,"error":{"code":e.code,"message":e.message}}),
            );
            return Some(e.exit);
        }
    };
    let name = options.command.name();
    let progress = Arc::new(Mutex::new(json!({})));
    let client = match Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = emit(
                &json!({"schema_version":1,"ok":false,"error":{"code":"transport_error","message":e.to_string()}}),
            );
            return Some(3);
        }
    };
    let api = Api {
        base: options.url,
        client,
        progress: progress.clone(),
    };
    let result = tokio::select! {
        result=tokio::time::timeout(Duration::from_secs(options.timeout),execute(&api,options.command))=>result.unwrap_or_else(|_|Err(Failure::new(5,"timeout","CLI deadline exceeded; an accepted operation may still be running. Query its ID before retrying."))),
        _=tokio::signal::ctrl_c()=>Err(Failure::new(6,"interrupted","CLI interrupted; accepted manager work was not cancelled")),
    };
    let context = progress.lock().expect("CLI context").clone();
    match result {
        Ok(data) => match emit(
            &json!({"schema_version":1,"ok":true,"command":name,"context":context,"data":data}),
        ) {
            Ok(()) => Some(0),
            Err(_) => Some(3),
        },
        Err(e) => {
            let _ = emit(
                &json!({"schema_version":1,"ok":false,"command":name,"context":context,"error":{"code":e.code,"message":e.message},"data":e.data}),
            );
            Some(e.exit)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ResponseMode;
    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_owned).collect()
    }
    #[test]
    fn arp_cli_is_portless_and_preserves_whole_role_configuration() {
        let opts = parse(&args("tests run arp-client")).unwrap();
        assert!(
            matches!(opts.command,Command::TestRun(p,m,path,true) if p=="arp-client"&&m=="ALL"&&path=="peer")
        );
        let p = config_patch(BTreeMap::from([
            ("--mode".into(), "rarp".into()),
            (
                "--request-scenario-json".into(),
                r#"{"mode":"nonzero-rarp-proto"}"#.into(),
            ),
            (
                "--link-json".into(),
                r#"{"mode":"host-interface","interface":"eth0"}"#.into(),
            ),
            ("--source-mac".into(), "02:AA:BB:CC:DD:10".into()),
            ("--timeout-ms".into(), "1000".into()),
            ("--interval-ms".into(), "500".into()),
            ("--retries".into(), "10".into()),
        ]))
        .unwrap();
        let c: ProtocolConfig = crate::arp_client::ArpClientConfig::default().into();
        let changed = c.patch(p).unwrap();
        assert!(changed.ip_endpoint().is_none());
        if let ProtocolConfig::ArpClient(c) = changed {
            assert_eq!(c.mode, crate::arp_client::Mode::Rarp);
            assert_eq!(c.source_mac, "02:aa:bb:cc:dd:10");
            assert_eq!(c.retries, 10);
            assert_eq!(c.test_budget("ALL").unwrap().total_ms, 26200);
        } else {
            panic!("active ARP shape lost");
        }
        assert!(
            parse(&args(
                "config set arp-client --mode rarp --interval-ms 500 --timeout-ms 1000 --retries 0"
            ))
            .is_ok()
        );
    }
    #[test]
    fn vxlan_cli_types_ports_modes_and_uses_arp_path() {
        let opts = parse(&args("tests run vxlan")).unwrap();
        assert_eq!(opts.timeout, 120);
        assert!(
            matches!(opts.command,Command::TestRun(p,m,path,true) if p=="vxlan"&&m=="ALL"&&path=="arp")
        );
        let p = config_patch(BTreeMap::from([
            ("--peer-port".into(), "4790".into()),
            ("--vni".into(), "16777215".into()),
            ("--reply-padding".into(), "18".into()),
            ("--inner-mac".into(), "02:AA:BB:CC:DD:20".into()),
            ("--scenario-json".into(), r#"{"mode":"short-arp"}"#.into()),
        ]))
        .unwrap();
        let c: ProtocolConfig = crate::vxlan::VxlanConfig::default().into();
        if let ProtocolConfig::Vxlan(changed) = c.patch(p).unwrap() {
            assert_eq!(changed.vni, 16777215);
            assert_eq!(changed.peer_port, 4790);
            assert_eq!(changed.reply_padding, 18);
            assert_eq!(changed.inner_mac, "02:aa:bb:cc:dd:20");
            assert_eq!(changed.scenario.mode(), "short-arp");
        } else {
            panic!("VXLAN shape lost");
        }
        assert!(
            matches!(parse(&args("runtime vxlan")).unwrap().command,Command::Runtime(p) if p=="vxlan")
        );
        assert!(parse(&args("config set vxlan --vni 0 --peer-port 4789")).is_ok());
    }
    #[test]
    fn bfd_cli_uses_complete_scenarios_and_a_bounded_longer_wait() {
        let p = config_patch(BTreeMap::from([
            (
                "--scenario-json".into(),
                r#"{"mode":"ttl254","after_up_ms":1000,"duration_ms":4000}"#.into(),
            ),
            ("--local-discriminator".into(), "4294967295".into()),
        ]))
        .unwrap();
        let c: ProtocolConfig = crate::bfd::BfdConfig::default().into();
        let changed = c.patch(p).unwrap();
        if let ProtocolConfig::Bfd(c) = changed {
            assert_eq!(c.cases(), ["TTL254", "ALL"]);
            assert_eq!(c.local_discriminator, u32::MAX);
        } else {
            panic!("BFD shape lost");
        }
        let opts = parse(&args("tests run bfd")).unwrap();
        assert_eq!(opts.timeout, 150);
        assert!(matches!(opts.command,Command::TestRun(_,_,p,true) if p=="session"));
        assert_eq!(parse(&args("tests run http")).unwrap().timeout, 120);
        assert!(
            matches!(parse(&args("runtime bfd")).unwrap().command,Command::Runtime(p) if p=="bfd")
        );
    }
    #[test]
    fn iec101_nested_ports_preserve_other_channel_and_reject_overlap() {
        let c: ProtocolConfig = crate::iec101::Iec101Config::default().into();
        let patch = config_patch(BTreeMap::from([
            ("--single-port".into(), "24751".into()),
            (
                "--double-json".into(),
                r#"{"point":{"value":false}}"#.into(),
            ),
        ]))
        .unwrap();
        let changed = c.patch(patch).unwrap();
        if let ProtocolConfig::Iec101(v) = changed {
            assert_eq!(v.single.port, 24751);
            assert_eq!(
                v.single.point,
                crate::iec101::Iec101Config::default().single.point
            );
            assert!(!v.double.point.value);
            assert_eq!(v.double.port, 24742);
        } else {
            panic!("wrong variant");
        }
        assert!(
            config_patch(BTreeMap::from([
                ("--single-port".into(), "24751".into()),
                ("--single-json".into(), "{}".into())
            ]))
            .is_err()
        );
    }
    #[test]
    fn parser_rejects_conflicts_unknown_or_irrelevant_options() {
        for input in [
            "start http --wait --no-wait",
            "config set http --file x --port 12",
            "config set http",
            "show http --method GET",
            "show http --timeout 0",
            "show http --url https://host",
            "show http --url http://host/path",
            "show http --url http://user:pass@host",
            "show http --url http://host?q=1",
            "show http --port 1 --port 2",
            "show ../bad",
        ] {
            assert!(parse(&args(input)).is_err(), "{input}");
        }
        assert!(matches!(
            parse(&args("--json --timeout 5 start http"))
                .unwrap()
                .command,
            Command::Action(_, "start", true)
        ));
        assert!(matches!(
            parse(&args("tests run http --no-wait")).unwrap().command,
            Command::TestRun(_, _, _, false)
        ));
        assert!(!is_api_command(&args("start")));
        assert!(!is_api_command(&args("status")));
        assert!(!is_api_command(&args("assets import directory")));
    }
    #[tokio::test]
    async fn field_edits_preserve_legacy_until_generation_is_explicit() {
        let old = json!({"bind_ip":"127.0.0.1","port":18090,"response_body":"旧正文"});
        let c = configuration(
            ConfigInput::Fields(BTreeMap::from([("--port".into(), "18091".into())])),
            old.clone(),
        )
        .await
        .unwrap();
        assert_eq!(c.as_http().unwrap().legacy_body.as_deref(), Some("旧正文"));
        let c = configuration(
            ConfigInput::Fields(BTreeMap::from([(
                "--response-mode".into(),
                "random".into(),
            )])),
            old,
        )
        .await
        .unwrap();
        assert!(c.as_http().unwrap().legacy_body.is_none());
        assert_eq!(c.as_http().unwrap().response_length, 9);
        assert_eq!(c.as_http().unwrap().response_mode, ResponseMode::Random);
    }
    #[tokio::test]
    async fn dns_parser_and_config_follow_protocol_contract() {
        let options = parse(&args("tests run dns --method tcp --name device.test")).unwrap();
        assert!(
            matches!(options.command,Command::TestRun(ref p,ref method,ref name,true) if p=="dns" && method=="TCP" && name=="device.test")
        );
        assert!(parse(&args("tests run dns --name device.test --path ALL")).is_err());
        assert!(parse(&args("tests run http --name device.test")).is_err());
        let c = configuration(
            ConfigInput::Fields(BTreeMap::from([
                ("--udp-enabled".into(), "false".into()),
                ("--port".into(), "15453".into()),
            ])),
            serde_json::to_value(crate::dns::DnsConfig::default()).unwrap(),
        )
        .await
        .unwrap();
        let ProtocolConfig::Dns(c) = c else {
            panic!("DNS variant lost")
        };
        assert!(!c.udp_enabled);
        assert!(c.tcp_enabled);
        assert_eq!(c.port, 15453);
        assert!(config_patch(BTreeMap::from([("--tcp-enabled".into(), "yes".into())])).is_err());
    }
    #[tokio::test]
    async fn mqtt_defaults_and_limit_patches_match_the_api() {
        let options = parse(&args("tests run mqtt")).unwrap();
        assert!(
            matches!(options.command,Command::TestRun(ref p,ref method,ref path,true) if p=="mqtt" && method=="ALL" && path==crate::mqtt::TEST_TOPIC)
        );
        let config = configuration(
            ConfigInput::Fields(BTreeMap::from([
                ("--max-connections".into(), "2".into()),
                ("--max-packet-size".into(), "128".into()),
            ])),
            serde_json::to_value(crate::mqtt::MqttConfig::default()).unwrap(),
        )
        .await
        .unwrap();
        let ProtocolConfig::Mqtt(config) = config else {
            panic!("MQTT variant lost")
        };
        assert_eq!(config.port, 18883);
        assert_eq!(config.max_connections, 2);
        assert_eq!(config.max_packet_size, 128);
        let full: ProtocolConfig = config.into();
        for patch in [
            json!({}),
            json!({"max_connections":null}),
            json!({"records":[]}),
            json!({"max_packet_size":127}),
        ] {
            assert!(full.patch(patch).is_err());
        }
    }
    #[test]
    fn dlt645_cli_partial_flags_are_typed_and_core_defaults_use_meter_path() {
        let o = parse(&args("tests run dlt645")).unwrap();
        assert!(
            matches!(o.command,Command::TestRun(ref p,ref m,ref path,true) if p=="dlt645" && m=="ALL" && path==crate::dlt645::PATH)
        );
        let p = config_patch(BTreeMap::from([
            ("--period-minutes".into(), "31".into()),
            ("--programming-key-enabled".into(), "true".into()),
            ("--security-json".into(), r#"{"mode":"reject"}"#.into()),
        ]))
        .unwrap();
        let c: ProtocolConfig = crate::dlt645::Dlt645Config::default().into();
        let c = c.patch(p).unwrap();
        let v = serde_json::to_value(c).unwrap();
        assert_eq!(v["period_minutes"], 31);
        assert_eq!(v["programming_key_enabled"], true);
        assert_eq!(v["security"], serde_json::json!({"mode":"reject"}));
        assert_eq!(v["energy_hundredths"], 12345678);
    }
    #[test]
    fn rtcp_cli_preserves_profile_and_uses_session_path() {
        let o = parse(&args("tests run rtcp")).unwrap();
        assert!(
            matches!(o.command,Command::TestRun(ref p,ref m,ref path,true) if p=="rtcp" && m=="ALL" && path==crate::rtcp::PATH)
        );
        let patch = config_patch(BTreeMap::from([
            ("--packet-profile".into(), "sr-sdes".into()),
            ("--port".into(), "15005".into()),
        ]))
        .unwrap();
        let c: ProtocolConfig = crate::rtcp::RtcpConfig::default().into();
        let c = c.patch(patch).unwrap();
        assert_eq!(c.ip_endpoint().unwrap().port, 15005);
        assert_eq!(
            serde_json::to_value(c).unwrap()["packet_profile"],
            "sr-sdes"
        );
    }
    #[test]
    fn rtp_cli_defaults_and_partial_capacity_are_protocol_specific() {
        let o = parse(&args("tests run rtp")).unwrap();
        assert!(
            matches!(o.command,Command::TestRun(ref p,ref m,ref path,true) if p=="rtp" && m=="ALL" && path==crate::rtp::PATH)
        );
        let p = config_patch(BTreeMap::from([("--max-packet-size".into(), "64".into())])).unwrap();
        let c: ProtocolConfig = crate::rtp::RtpConfig::default().into();
        let edited = c.patch(p).unwrap();
        assert_eq!(edited.ip_endpoint().unwrap().port, 5004);
        assert_eq!(serde_json::to_value(edited).unwrap()["max_packet_size"], 64);
        assert!(c.patch(serde_json::json!({"max_connections":1})).is_err());
    }
    #[tokio::test]
    async fn mqtt_sn_defaults_and_partial_topic_updates_preserve_other_endpoints() {
        let options = parse(&args("tests run mqtt-sn")).unwrap();
        assert!(
            matches!(options.command,Command::TestRun(ref p,ref method,ref path,true) if p=="mqtt-sn" && method=="ALL" && path==crate::mqtt_sn::PATH)
        );
        let patch = config_patch(BTreeMap::from([
            (
                "--predefined-topics-json".into(),
                r#"[{"topic_id":65534,"topic":"lab/data"}]"#.into(),
            ),
            ("--gateway-id".into(), "255".into()),
            ("--discovery-port".into(), "1985".into()),
        ]))
        .unwrap();
        let base: ProtocolConfig = crate::mqtt_sn::MqttSnConfig::default().into();
        let result = base.patch(patch).unwrap();
        let ProtocolConfig::MqttSn(c) = result else {
            panic!("MQTT-SN variant lost")
        };
        assert_eq!(c.port, 1884);
        assert_eq!(c.broker_port, 28897);
        assert_eq!(c.gateway_id, 255);
        assert_eq!(c.discovery_port, 1985);
        assert_eq!(c.predefined_topics[0].topic_id, 65534);
        for patch in [
            json!({"predefined_topics":[]}),
            json!({"broker_host":"0.0.0.0"}),
            json!({"bind_ip":"127.0.0.1"}),
            json!({"max_connections":1}),
            json!({"gateway_id":256}),
            json!({}),
        ] {
            assert!(base.patch(patch).is_err());
        }
    }
    #[tokio::test]
    async fn iec104_case_defaults_and_point_table_patch_are_typed() {
        let options = parse(&args("tests run iec104")).unwrap();
        assert!(
            matches!(options.command,Command::TestRun(ref p,ref method,ref path,true) if p=="iec104" && method=="ALL" && path==crate::iec104::PATH)
        );
        let mut points = crate::iec104::Iec104Config::default().points;
        points.single.ioa = 16777215;
        points.single.value = true;
        let patch = config_patch(BTreeMap::from([
            (
                "--points-json".into(),
                serde_json::to_string(&points).unwrap(),
            ),
            ("--max-connections".into(), "1".into()),
        ]))
        .unwrap();
        let base: ProtocolConfig = crate::iec104::Iec104Config::default().into();
        let updated = base.patch(patch).unwrap();
        assert_eq!(updated.ip_endpoint().unwrap().port, 2404);
        let ProtocolConfig::Iec104(c) = updated else {
            panic!("IEC104 variant lost")
        };
        assert_eq!(c.max_connections, 1);
        assert_eq!(c.points, points);
        for patch in [
            json!({"points":{"single":{}}}),
            json!({"points":null}),
            json!({"banner":"x"}),
            json!({"max_connections":65}),
            json!({}),
        ] {
            assert!(base.patch(patch).is_err());
        }
    }
    #[tokio::test]
    async fn telnet_defaults_banner_values_and_atomic_line_patch_are_strict() {
        let options = parse(&args("tests run telnet")).unwrap();
        assert!(
            matches!(options.command,Command::TestRun(ref p,ref method,ref path,true) if p=="telnet" && method=="ALL" && path==crate::telnet::PATH)
        );
        assert!(!wants_help(&args("config set telnet --banner --help")));
        let config = configuration(
            ConfigInput::Fields(BTreeMap::from([
                ("--banner".into(), "--help".into()),
                ("--max-line-bytes".into(), "64".into()),
            ])),
            serde_json::to_value(crate::telnet::TelnetConfig::default()).unwrap(),
        )
        .await
        .unwrap();
        let ProtocolConfig::Telnet(config) = config else {
            panic!("Telnet variant lost")
        };
        assert_eq!(config.banner, "--help");
        assert_eq!(config.max_line_bytes, 64);
        assert_eq!(config.port, 2323);
        let config: ProtocolConfig = config.into();
        for patch in [
            json!({}),
            json!({"banner":null}),
            json!({"max_packet_size":128}),
            json!({"max_line_bytes":63}),
            json!({"banner":"bad\nline"}),
        ] {
            assert!(config.patch(patch).is_err());
        }
    }
    #[test]
    fn help_flags_are_not_taken_from_values_and_local_commands_are_exact() {
        for input in [
            "config set http --data --help",
            "tests run http --method --help",
            "show http --url --help",
        ] {
            assert!(!wants_help(&args(input)), "{input}");
        }
        assert!(wants_help(&args("tests run http --help")));
        assert!(wants_help(&args("help")));
        for input in [
            "stop-all --typo",
            "stop-all --url=http://example.test",
            "stop-all http",
            "serve --no-wait",
            "doctor http",
            "--version extra",
            "assets import dir extra",
        ] {
            assert!(!valid_local_command(&args(input)), "{input}");
        }
        for input in [
            "stop-all",
            "serve",
            "doctor",
            "--version",
            "assets import dir",
        ] {
            assert!(valid_local_command(&args(input)));
        }
    }
    struct Fixture {
        api: Api,
        task: tokio::task::JoinHandle<()>,
        requests: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.task.abort();
        }
    }
    async fn fixture(replies: Vec<Value>) -> Fixture {
        let replies = Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::from(
            replies,
        )));
        let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = requests.clone();
        let router = axum::Router::new().fallback(axum::routing::get(move || {
            let replies = replies.clone();
            let count = count.clone();
            async move {
                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut replies = replies.lock().await;
                axum::Json(if replies.len() > 1 {
                    replies.pop_front().unwrap()
                } else {
                    replies[0].clone()
                })
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Fixture {
            api: Api {
                base: Url::parse(&format!("http://{address}")).unwrap(),
                client: Client::builder().no_proxy().build().unwrap(),
                progress: Arc::new(Mutex::new(json!({}))),
            },
            task,
            requests,
        }
    }
    #[tokio::test]
    async fn operation_wait_rejects_other_ids_restarts_and_failure_despite_running() {
        for (operation, session, success, exit) in [
            ("other", "old", true, 6),
            ("wanted", "new", true, 6),
            ("wanted", "old", false, 1),
        ] {
            let f = fixture(vec![json!([{"id":"http","session_id":session,"status":"running","workspace":{"id":"retained","current_operation":null,"last_result":{"operation_id":operation,"success":success,"error":"failed restart"}}}])]).await;
            let error = tokio::time::timeout(
                Duration::from_secs(1),
                f.api.wait_action("http", "retained", "wanted", "old"),
            )
            .await
            .unwrap()
            .unwrap_err();
            assert_eq!(error.exit, exit);
        }
    }
    #[tokio::test]
    async fn passing_test_waits_for_cleanup_instead_of_returning_early() {
        let current = json!({"id":"wanted","instance_id":"retained","status":"passed","report":{"passed":true},"cleanup_complete":false});
        let mut cleaned = current.clone();
        cleaned["cleanup_complete"] = true.into();
        let f = fixture(vec![
            json!({"session_id":"old","current":current}),
            json!({"session_id":"old","current":cleaned}),
        ])
        .await;
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            f.api.wait_test("retained", "wanted", "old"),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result["current"]["cleanup_complete"], true);
        assert!(f.requests.load(std::sync::atomic::Ordering::SeqCst) >= 2);
    }
    #[tokio::test]
    async fn test_wait_never_accepts_a_different_test_target_or_session() {
        for (id, instance, session) in [
            ("other", "retained", "old"),
            ("wanted", "other", "old"),
            ("wanted", "retained", "new"),
        ] {
            let f = fixture(vec![json!({"session_id":session,"current":{"id":id,"instance_id":instance,"status":"passed","report":{"passed":true},"cleanup_complete":true}})]).await;
            let error = tokio::time::timeout(
                Duration::from_secs(1),
                f.api.wait_test("retained", "wanted", "old"),
            )
            .await
            .unwrap()
            .unwrap_err();
            assert_eq!(error.exit, 6);
        }
    }
}
