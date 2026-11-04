//! JSON API client for automated callers. Resource mutations stay in the manager.
use crate::model::{HttpConfig, HttpConfigPatch, valid_id};
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
  start PROTOCOL | stop PROTOCOL | restart PROTOCOL [--wait | --no-wait]
  connection-info PROTOCOL
  logs PROTOCOL [--follow]
  tests list PROTOCOL
  tests run PROTOCOL [--method ALL] [--path /ok] [--wait | --no-wait]
  tests result PROTOCOL [--id TEST_ID] [--wait | --no-wait]

API mutations wait for their exact operation/test by default; config set only saves.
JSON is the default. --follow emits JSON Lines; Ctrl-C stops following.
PLAB_URL supplies the URL when --url is absent. Total timeout is 1..3600 seconds.
Exit codes: 0 success, 1 operation/test failure, 2 usage/input, 3 transport/invalid
reply, 4 API rejection, 5 timeout, 6 interrupted/replaced operation or test.
Timeout/interruption does not cancel an already accepted manager operation.

Local administrative commands (retain existing behavior; may require root):
  protocol-target-lab serve
  plabctl start                 start the management service
  plabctl stop-all              stop manager and owned resources
  plabctl status | doctor       local persisted state and Docker diagnostics
  plabctl assets import DIR     local image import from a checked manifest
Settings: PLAB_LISTEN, PLAB_CONFIG_FILE, PLAB_DATA_DIR, PLAB_HTTP_IMAGE, PLAB_DOCKER_SOCKET
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
    let timeout = values
        .remove("--timeout")
        .unwrap_or_else(|| "120".into())
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
        ["logs", p] => Command::Logs(protocol(p)?, flags.remove("--follow")),
        ["tests", "list", p] => Command::TestsList(protocol(p)?),
        ["tests", "run", p] => Command::TestRun(
            protocol(p)?,
            values
                .remove("--method")
                .unwrap_or_else(|| "ALL".into())
                .to_ascii_uppercase(),
            values.remove("--path").unwrap_or_else(|| "/ok".into()),
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
fn config_patch(fields: BTreeMap<String, String>) -> Result<HttpConfigPatch> {
    let mut patch = serde_json::Map::new();
    for (key, value) in fields {
        let value = match key.as_str() {
            "--port" | "--response-length" => json!(
                value
                    .parse::<u32>()
                    .map_err(|_| Failure::usage(format!("{key} must be a nonnegative integer")))?
            ),
            _ => Value::String(value),
        };
        patch.insert(key.trim_start_matches("--").replace('-', "_"), value);
    }
    let patch: HttpConfigPatch = serde_json::from_value(Value::Object(patch))
        .map_err(|e| Failure::usage(format!("invalid configuration fields: {e}")))?;
    patch
        .clone()
        .apply(HttpConfig::default())
        .map_err(|e| Failure::usage(e.to_string()))?;
    Ok(patch)
}
async fn configuration(input: ConfigInput, current: Value) -> Result<HttpConfig> {
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
            let config: HttpConfig = serde_json::from_value(current)
                .map_err(|_| Failure::reply("invalid saved HTTP configuration"))?;
            config_patch(fields)?
                .apply(config)
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
        assert_eq!(c.legacy_body.as_deref(), Some("旧正文"));
        let c = configuration(
            ConfigInput::Fields(BTreeMap::from([(
                "--response-mode".into(),
                "random".into(),
            )])),
            old,
        )
        .await
        .unwrap();
        assert!(c.legacy_body.is_none());
        assert_eq!(c.response_length, 9);
        assert_eq!(c.response_mode, ResponseMode::Random);
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
