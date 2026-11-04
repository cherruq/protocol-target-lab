use crate::{docker, manager::Shared, model::ProtocolConfig};
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State, rejection::JsonRejection},
    http::{StatusCode, Uri, header},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use futures_util::stream;
use serde_json::{Value, json};
use std::{convert::Infallible, time::Duration};

static WEB: include_dir::Dir<'_> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/frontend/dist");
pub struct ApiError(pub StatusCode, pub String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"error":{"code":self.0.as_u16(),"message":self.1}})),
        )
            .into_response()
    }
}
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        let text = format!("{e:#}");
        if text.contains("holds control.lock")
            || text.contains("another client test is already running")
        {
            return Self(
                StatusCode::CONFLICT,
                "已有客户端测试或实例操作正在执行，请等待完成后重试。".into(),
            );
        }
        let code = if text.contains("not found") {
            StatusCode::NOT_FOUND
        } else if text.contains("already")
            || text.contains("holds")
            || text.contains("must be disabled")
            || text.contains("still has")
        {
            StatusCode::CONFLICT
        } else if text.contains("config.") || text.contains("expected") || text.contains("invalid")
        {
            StatusCode::UNPROCESSABLE_ENTITY
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        Self(code, text)
    }
}
fn decode<T>(body: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    body.map(|Json(v)| v)
        .map_err(|e| ApiError(StatusCode::UNPROCESSABLE_ENTITY, e.body_text()))
}
pub fn router(manager: Shared) -> Router {
    Router::new()
        .route(
            "/healthz",
            get(|| async { Json(json!({"status":"ok","version":env!("CARGO_PKG_VERSION")})) }),
        )
        .route("/api/protocols", get(protocols))
        .route("/api/protocols/{id}/schema", get(schema))
        .route("/api/instances", get(list))
        .route("/api/instances/{id}", get(instance))
        .route(
            "/api/instances/{id}/config",
            axum::routing::put(save_config).patch(patch_config),
        )
        .route("/api/instances/{id}/logs", get(logs))
        .route("/api/instances/{id}/connection-info", get(connection_info))
        .route("/api/instances/{id}/tests", get(tests).post(start_test))
        .route("/api/instances/{id}/{action}", post(action))
        .route("/api/environment", get(environment))
        .route("/api/assets", get(assets))
        .fallback(static_file)
        .layer(axum::extract::DefaultBodyLimit::max(512 * 1024))
        .with_state(manager)
}
async fn protocols(State(m): State<Shared>) -> Json<Value> {
    let d = m.data.lock().await;
    Json(json!(crate::model::PROTOCOLS.map(|protocol| {
        let workspace=d.doc.instances.iter().find(|i|i.protocol_id==protocol);
        let status=if d.config_error.is_some() {"unavailable"} else if d.docker_error.is_some() {"environment-unavailable"} else {workspace.map(|i|i.status.as_str()).unwrap_or("unavailable")};
        let error=d.config_error.as_deref().or(d.docker_error.as_deref()).or_else(||workspace.and_then(|i|i.runtime_error.as_deref().or(i.error.as_deref())));
        let mut descriptor=json!({"id":protocol,"name":protocol.to_ascii_uppercase(),"implementation":match protocol {"dlt645"=>"software DL/T645-2007 meter over TCP byte stream","rtcp"=>"stdlib RFC3550 RTCPv2 SR+SDES compound receiver","rtp"=>"stdlib RFC3550v2 structural receiver; opaque payload","dns"=>"dnsmasq 2.90","mqtt"=>"Mosquitto 2.0.18 + packet-size backports","telnet"=>"telnetlib3 4.0.3","iec104"=>"c104 2.2.1 + incremental TCP framing fix","mqtt-sn"=>"Eclipse Paho MQTT-SN Gateway 1.5.1 + project capacity guard; private Mosquitto 2.0.18",_=>"controlled responder"},"version":env!("CARGO_PKG_VERSION"),"available":d.config_error.is_none(),"image":m.settings.image_for(protocol),"workspace":workspace.map(|i|i.view()),"status":status,"error":error,"session_id":m.session_id});
        if protocol=="http" {descriptor["supported_methods"]=json!(crate::model::HTTP_METHODS);} else if protocol=="dns" {descriptor["supported_transports"]=json!(["UDP","TCP"]);} else if protocol=="mqtt" {descriptor["supported_transports"]=json!(["TCP"]);descriptor["supported_versions"]=json!(["3.1.1","5.0"]);descriptor["supported_qos"]=json!([0,1,2]);} else if protocol=="dlt645" {descriptor["supported_transports"]=json!(["TCP"]);descriptor["wire_profiles"]=json!(["dlt645-2007-tcp"]);descriptor["software_function_classes"]=json!(["11","13","14","15","16","08","17","18","19","1A","1C","1D","03 reject/fixture"]);descriptor["crypto_verified"]=json!(false);} else if protocol=="rtcp" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["packet_profiles"]=json!(["sr-sdes"]);descriptor["rtcp_reply_expected"]=json!(false);} else if protocol=="rtp" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["supported_features"]=json!(["RTPv2 header/CSRC/extension/padding","fresh receive observation"]);descriptor["rtp_reply_expected"]=json!(false);} else if protocol=="mqtt-sn" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["validated_qos"]=json!([1]);descriptor["validated_features"]=json!(["CONNECT/reconnect","REGISTER/PUBLISH","predefined topics","multicast GWINFO","independent MQTT broker delivery"]);} else if protocol=="iec104" {descriptor["supported_transports"]=json!(["TCP"]);descriptor["supported_features"]=json!(["STARTDT","STOPDT","TESTFR","GI","READ","C_SC_NA_1 DIRECT"]);} else {descriptor["supported_transports"]=json!(["TCP"]);descriptor["supported_features"]=json!(["IAC","TTYPE","NAWS","TSPEED","XDISPLOC","NEW_ENVIRON"]);}
        descriptor
    })))
}
async fn schema(Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    match id.as_str() {
        "mqtt-sn" => Ok(Json(crate::mqtt_sn::schema())),
        "rtp" => Ok(Json(crate::rtp::schema())),
        "rtcp" => Ok(Json(crate::rtcp::schema())),
        "dlt645" => Ok(Json(crate::dlt645::schema())),
        "iec104" => Ok(Json(crate::iec104::schema())),
        "http" => Ok(Json(
            json!({"protocol_id":"http","type":"object","supported_methods":crate::model::HTTP_METHODS,"properties":{"bind_ip":{"type":"string","default":"0.0.0.0"},"port":{"type":"integer","minimum":1,"maximum":65535,"default":18090},"response_length":{"type":"integer","minimum":0,"maximum":crate::model::MAX_RESPONSE_LENGTH,"default":64},"response_mode":{"type":"string","enum":["fixed","random"],"default":"fixed"}},"required":["bind_ip","port","response_length","response_mode"]}),
        )),
        "telnet" => Ok(Json(
            json!({"protocol_id":"telnet","type":"object","additionalProperties":false,"implementation":"telnetlib3 4.0.3","default":crate::telnet::TelnetConfig::default(),"supported_features":["IAC","TTYPE","NAWS","TSPEED","XDISPLOC","NEW_ENVIRON"],"properties":{"bind_ip":{"type":"string","format":"ipv4","default":"0.0.0.0"},"port":{"type":"integer","minimum":1,"maximum":65535,"default":2323},"banner":{"type":"string","minLength":1,"maxUtf8Bytes":256,"default":"Protocol Target Lab Telnet"},"max_connections":{"type":"integer","minimum":1,"maximum":128,"default":16},"max_line_bytes":{"type":"integer","minimum":64,"maximum":65536,"default":4096}},"required":["bind_ip","port","banner","max_connections","max_line_bytes"],"notes":["Finite ECHO/INFO/CLOSE lab application; no system login or shell","Banner has no ASCII control characters; input line bytes exclude CRLF"]}),
        )),
        "mqtt" => Ok(Json(
            json!({"protocol_id":"mqtt","type":"object","additionalProperties":false,"implementation":"Mosquitto 2.0.18 + packet-size backports","supported_versions":["3.1.1","5.0"],"supported_qos":[0,1,2],"default":crate::mqtt::MqttConfig::default(),"properties":{"bind_ip":{"type":"string","format":"ipv4","default":"0.0.0.0"},"port":{"type":"integer","minimum":1,"maximum":65535,"default":18883},"max_connections":{"type":"integer","minimum":1,"maximum":128,"default":32},"max_packet_size":{"type":"integer","minimum":128,"maximum":1048576,"default":1048576}},"required":["bind_ip","port","max_connections","max_packet_size"]}),
        )),
        "dns" => Ok(Json(
            json!({"protocol_id":"dns","type":"object","additionalProperties":false,"implementation":"dnsmasq 2.90","supported_transports":["UDP","TCP"],"default":crate::dns::DnsConfig::default(),"properties":{"bind_ip":{"type":"string","format":"ipv4","default":"0.0.0.0"},"port":{"type":"integer","minimum":1,"maximum":65535,"default":15353},"udp_enabled":{"type":"boolean","default":true},"tcp_enabled":{"type":"boolean","default":true},"records":{"type":"array","minItems":1,"maxItems":32,"items":{"type":"object","additionalProperties":false,"properties":{"name":{"type":"string","maxLength":254},"record_type":{"enum":["A","AAAA"]},"value":{"type":"string"},"ttl":{"type":"integer","minimum":0,"maximum":86400}},"required":["name","record_type","value","ttl"]}}},"required":["bind_ip","port","udp_enabled","tcp_enabled","records"],"constraints":["Enable at least one transport","ASCII DNS hostname labels <=63; canonical name <=253","Each name/type RRset has <=16 addresses and consistent TTL","No duplicate name/type/address","Unknown names are negative; no public recursion"]}),
        )),
        _ => Err(ApiError(
            StatusCode::NOT_FOUND,
            "protocol not implemented".into(),
        )),
    }
}
async fn list(State(m): State<Shared>) -> Json<Value> {
    let d = m.data.lock().await;
    Json(json!(
        d.doc.instances.iter().map(|i| i.view()).collect::<Vec<_>>()
    ))
}
async fn instance(
    State(m): State<Shared>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let d = m.data.lock().await;
    Ok(Json(
        d.doc
            .instances
            .iter()
            .find(|i| i.id == id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "instance not found".into()))?
            .view(),
    ))
}
async fn save_config(
    State(m): State<Shared>,
    Path(id): Path<String>,
    body: Result<Json<ProtocolConfig>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let config = decode(body)?;
    config.validate()?;
    Ok(Json(m.save_config(&id, config).await?))
}
async fn patch_config(
    State(m): State<Shared>,
    Path(id): Path<String>,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(m.patch_config(&id, decode(body)?).await?))
}
async fn action(
    State(m): State<Shared>,
    Path((id, action)): Path<(String, String)>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if !["start", "stop", "restart"].contains(&action.as_str()) {
        return Err(ApiError(StatusCode::NOT_FOUND, "unknown action".into()));
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"operation_id":m.begin(&id,&action).await?,"session_id":m.session_id})),
    ))
}
async fn tests(State(m): State<Shared>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let d = m.data.lock().await;
    let instance = d
        .doc
        .instances
        .iter()
        .find(|i| i.id == id)
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "instance not found".into()))?;
    let config = instance.applied_config.as_ref().unwrap_or(&instance.config);
    let (cases, paths) = match config {
        ProtocolConfig::Http(_) => {
            let mut cases = crate::model::HTTP_METHODS
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>();
            cases.push("ALL".into());
            (
                cases,
                crate::testing::PATHS
                    .iter()
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>(),
            )
        }
        ProtocolConfig::Dlt645(c) => (
            c.cases().iter().map(|s| s.to_string()).collect(),
            vec![crate::dlt645::PATH.into()],
        ),
        ProtocolConfig::Rtcp(_) => (
            crate::rtcp::CASES.iter().map(|s| s.to_string()).collect(),
            vec![crate::rtcp::PATH.into()],
        ),
        ProtocolConfig::Rtp(_) => (
            crate::rtp::CASES.iter().map(|s| s.to_string()).collect(),
            vec![crate::rtp::PATH.into()],
        ),
        ProtocolConfig::MqttSn(_) => (
            crate::mqtt_sn::CASES
                .iter()
                .map(|s| s.to_string())
                .collect(),
            vec![crate::mqtt_sn::PATH.into()],
        ),
        ProtocolConfig::Iec104(_) => (
            crate::iec104::CASES.iter().map(|s| s.to_string()).collect(),
            vec![crate::iec104::PATH.into()],
        ),
        ProtocolConfig::Telnet(_) => (
            crate::telnet::CASES.iter().map(|s| s.to_string()).collect(),
            vec![crate::telnet::PATH.into()],
        ),
        ProtocolConfig::Mqtt(_) => (
            crate::mqtt::CASES.iter().map(|s| s.to_string()).collect(),
            vec![crate::mqtt::TEST_TOPIC.into()],
        ),
        ProtocolConfig::Dns(c) => {
            let mut cases = c
                .transports()
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>();
            cases.push("ALL".into());
            let mut paths = vec!["ALL".into()];
            paths.extend(c.names());
            (cases, paths)
        }
    };
    let mut result =
        json!({"cases":cases,"paths":paths,"current":d.tests.get(&id),"session_id":m.session_id});
    if matches!(config, ProtocolConfig::Mqtt(_)) {
        let labels = crate::mqtt::CASES
            .iter()
            .map(|case| {
                (
                    (*case).to_string(),
                    if *case == "ALL" {
                        "全部版本与 QoS".to_string()
                    } else {
                        format!(
                            "MQTT {} · QoS {}",
                            if case.starts_with("MQTT311") {
                                "3.1.1"
                            } else {
                                "5.0"
                            },
                            case.chars().last().unwrap()
                        )
                    }
                    .into(),
                )
            })
            .collect::<serde_json::Map<String, Value>>();
        result["case_labels"] = Value::Object(labels);
        result["path_label"] = "主题前缀".into();
    }
    if matches!(config, ProtocolConfig::Dlt645(_)) {
        result["case_labels"] = json!({"READ_ADDRESS":"当前表地址","READ_DATA":"当前数据与 BCD","STREAM":"增量分帧与唤醒","ERROR_RESPONSE":"异常应答与恢复","WRITE_PERIOD":"写周期并恢复当前值","SECURITY_FIXTURE":"固定 fixture 传输（非认证）","ALL":"全部只读核心测试"});
        result["path_label"] = "电表".into();
    }
    if matches!(config, ProtocolConfig::Rtcp(_)) {
        result["case_labels"] = json!({"SR_SDES":"发送报告与 CNAME","REPORT_BLOCKS":"报告块与原始字节","SDES_ITEMS":"SDES 项与未知类型","PADDING":"末子包填充","ALL":"全部测试"});
        result["path_label"] = "会话".into();
    }
    if matches!(config, ProtocolConfig::Rtp(_)) {
        result["case_labels"] = json!({"BASIC":"基本头与实际载荷","CSRC_EXTENSION":"CSRC 与扩展头","PADDING":"填充剥离","SEQUENCE":"序号回绕与重复接收","ALL":"全部测试"});
        result["path_label"] = "数据流".into();
    }
    if matches!(config, ProtocolConfig::MqttSn(_)) {
        result["case_labels"] = json!({"CONNECT":"连接与同 ID 重连","REGISTER_PUBLISH":"注册主题与 QoS1 实际交付","PREDEFINED_PUBLISH":"预定义主题与 QoS1 实际交付","DISCOVERY":"组播发现与网关身份","ALL":"全部测试"});
        result["path_label"] = "注册主题前缀".into();
    }
    if matches!(config, ProtocolConfig::Iec104(_)) {
        result["case_labels"] = json!({"CONNECT":"连接与 U 帧控制","GI":"总召与结束","READ":"读点与实际值","COMMAND":"模拟单点控制与恢复","ALL":"全部测试"});
        result["path_label"] = "站点".into();
    }
    if matches!(config, ProtocolConfig::Telnet(_)) {
        result["case_labels"] = json!({"CONNECT":"连接与欢迎","ECHO":"数据回显与 IAC 转义","OPTIONS":"原生协商与会话信息","UNKNOWN_OPTION":"不支持选项拒绝","ALL":"全部测试"});
        result["path_label"] = "会话".into();
    }
    Ok(Json(result))
}
async fn start_test(
    State(m): State<Shared>,
    Path(id): Path<String>,
    body: Result<Json<crate::testing::TestRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let request = decode(body)?;
    let test_id = crate::testing::begin(&m, &id, request).await.map_err(|e| {
        let message = format!("{e:#}");
        let message = if message.contains("holds control.lock")
            || message.contains("another client test is already running")
        {
            "已有客户端测试或实例操作正在执行，请等待完成后重试。".into()
        } else {
            message
        };
        ApiError(
            if message.contains("instance not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::CONFLICT
            },
            message,
        )
    })?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"test_id":test_id,"session_id":m.session_id})),
    ))
}
async fn image_inventory(m: &Shared) -> Value {
    let mut images = serde_json::Map::new();
    for protocol in crate::model::PROTOCOLS {
        let image = m.settings.image_for(protocol);
        let id = docker::image_id(image).await.ok();
        images.insert(
            protocol.into(),
            json!({"image":image,"available":id.is_some(),"image_id":id}),
        );
    }
    Value::Object(images)
}
async fn environment(State(m): State<Shared>) -> Json<Value> {
    let images = image_inventory(&m).await;
    let d = m.data.lock().await;
    Json(
        json!({"docker_available":d.docker_error.is_none(),"docker_version":d.docker_version,"error":d.docker_error,"config_error":d.config_error,"kernel":std::fs::read_to_string("/proc/sys/kernel/osrelease").ok().map(|s|s.trim().to_owned()),"image":m.settings.image,"image_available":images["http"]["available"],"images":images,"config_path":m.settings.config,"deployment_id":d.doc.deployment_id}),
    )
}
async fn assets(State(m): State<Shared>) -> Json<Value> {
    let images = image_inventory(&m).await;
    let mut result = images["http"].clone();
    result["protocols"] = images;
    Json(result)
}
async fn connection_info(
    State(m): State<Shared>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let d = m.data.lock().await;
    let i = d
        .doc
        .instances
        .iter()
        .find(|i| i.id == id)
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "instance not found".into()))?;
    let c = i.applied_config.as_ref().unwrap_or(&i.config);
    let host = if c.bind_ip() == "0.0.0.0" {
        "<target-ip>"
    } else {
        c.bind_ip()
    };
    if let ProtocolConfig::Dlt645(config) = c {
        return Ok(Json(
            json!({"base_url":format!("tcp://{host}:{}",config.port),"host":host,"port":config.port,"wire_profile":config.wire_profile,"startup_meter_address":config.meter_address,"commands":["plabctl tests run dlt645 --method ALL"],"notes":["DL/T645-2007 finite software meter carried as a TCP byte stream; no physical serial or ESAM claim","Startup address/energy/period can differ from current runtime after legitimate wire commands","ALL covers readonly core; optional WRITE_PERIOD restores its observed current value; irreversible state operations are outside ALL","Programming key is a simulated per-command condition; fixed public software passwords initialize to three zero bytes; security fixture is transport only"]}),
        ));
    }
    if let ProtocolConfig::Rtcp(config) = c {
        return Ok(Json(
            json!({"base_url":format!("rtcp://{host}:{}",config.port),"host":host,"port":config.port,"max_packet_size":config.max_packet_size,"packet_profile":config.packet_profile,"commands":["plabctl tests run rtcp --method ALL"],"rtcp_reply_expected":false,"notes":["Independent SR+SDES CNAME compound receiver; no RR or ACK; RTP workspace is not required","Tests require fresh real UDP received bytes via private observer","Sender-declared counters differ from actual receiver traffic; exact NTP64 represented as hex"]}),
        ));
    }
    if let ProtocolConfig::Rtp(config) = c {
        return Ok(Json(
            json!({"base_url":format!("rtp://{host}:{}",config.port),"host":host,"port":config.port,"max_packet_size":config.max_packet_size,"commands":["plabctl tests run rtp --method ALL"],"rtp_reply_expected":false,"notes":["RTPv2 UDP structural receiver with opaque payload; no media decoding or playback","No RTP reply is generated; tests verify fresh actual received bytes through a private read-only observer","Observer port is internal only; client tests send to the published host UDP endpoint"]}),
        ));
    }
    if let ProtocolConfig::MqttSn(config) = c {
        return Ok(Json(
            json!({"base_url":format!("mqtt-sn://{host}:{}",config.port),"host":host,"port":config.port,"discovery_group":config.discovery_group,"discovery_port":config.discovery_port,"gateway_id":config.gateway_id,"broker":{"host":config.broker_host,"port":config.broker_port,"scope":"private loopback on the target host"},"commands":["plabctl tests run mqtt-sn --method ALL"],"notes":["Gateway binds all IPv4 host interfaces; no bridge publication is used","Discovery replies are native multicast from the gateway UDP port, not unicast replies to the request socket","Client tests run on the manager host and independently observe real delivery at the private broker","Only QoS1 is validated by this phase; predefined topics are restricted to visible ASCII","plab-sn-normal and plab-sn-predef IDs and their short prefixes are reserved for tests"]}),
        ));
    }
    if let ProtocolConfig::Iec104(config) = c {
        return Ok(Json(
            json!({"base_url":format!("iec104://{host}:{}",config.port),"host":host,"port":config.port,"commands":["plabctl tests run iec104 --method ALL"],"points":config.points,"notes":["STARTDT/STOPDT/TESTFR, general interrogation, read, direct single command","Command point updates the configured single point in simulated memory only","Configuration values are startup settings; COMMAND tests restore the observed current value"]}),
        ));
    }
    if let ProtocolConfig::Telnet(config) = c {
        return Ok(Json(
            json!({"base_url":format!("telnet://{host}:{}",config.port),"host":host,"port":config.port,"commands":[format!("telnet {host} {}",config.port)],"notes":["Lab commands: ECHO <data>, INFO, CLOSE","Real telnetlib3 option negotiation; no system login or shell"]}),
        ));
    }
    if let ProtocolConfig::Mqtt(config) = c {
        let endpoint = format!("mqtt://{host}:{}", config.port);
        return Ok(Json(
            json!({"base_url":endpoint,"host":host,"port":config.port,"versions":["3.1.1","5.0"],"qos":[0,1,2],"commands":[format!("mosquitto_sub -h {host} -p {} -V mqttv311 -t 'plab/test/#' -q 2 -v",config.port),format!("mosquitto_pub -h {host} -p {} -V mqttv5 -t 'plab/test/manual' -q 2 -m 'sample'",config.port)],"notes":["Anonymous experimental TCP listener; no TLS or authentication","Use distinct client IDs; publisher/subscriber verification needs at least 2 allowed connections"]}),
        ));
    }
    if let ProtocolConfig::Dns(config) = c {
        let record = &config.records[0];
        let commands = config
            .transports()
            .into_iter()
            .map(|transport| {
                format!(
                    "dig @{host} -p {} {} {} +{}",
                    config.port,
                    crate::dns::canonical_name(&record.name),
                    record.record_type,
                    if transport == "TCP" { "tcp" } else { "notcp" }
                )
            })
            .collect::<Vec<_>>();
        return Ok(Json(
            json!({"host":host,"port":config.port,"transports":config.transports(),"records":config.records,"commands":commands,"base_url":format!("dns://{host}:{}",config.port)}),
        ));
    }
    let url = format!("http://{host}:{}", c.port());
    Ok(Json(
        json!({"base_url":url,"commands":[format!("curl --noproxy '*' '{url}/ok'"),format!("curl --noproxy '*' -I '{url}/ok'"),format!("curl --noproxy '*' '{url}/chunked'"),format!("curl --noproxy '*' '{url}/close'"),format!("curl --noproxy '*' --data-binary 'sample' '{url}/ok'"),format!("curl --noproxy '*' -X PUT --data-binary 'sample' '{url}/ok'"),format!("curl --noproxy '*' -X PATCH --data-binary 'sample' '{url}/ok'"),format!("curl --noproxy '*' -X DELETE '{url}/ok'"),format!("curl --noproxy '*' -X OPTIONS -i '{url}/ok'")]}),
    ))
}
async fn logs(
    State(m): State<Shared>,
    Path(id): Path<String>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    {
        let d = m.data.lock().await;
        if !d.doc.instances.iter().any(|i| i.id == id) {
            return Err(ApiError(StatusCode::NOT_FOUND, "instance not found".into()));
        }
    }
    let events = stream::unfold((m, id), |(m, id)| async move {
        let lines = m
            .logs(&id)
            .await
            .unwrap_or_else(|e| vec![format!("logs unavailable: {e:#}")]);
        let event = Event::default()
            .event("logs")
            .json_data(json!({"lines":lines,"source":"docker"}))
            .unwrap();
        tokio::time::sleep(Duration::from_secs(1)).await;
        Some((Ok(event), (m, id)))
    });
    Ok(Sse::new(events).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}
async fn static_file(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path == "api" || path.starts_with("api/") {
        return ApiError(StatusCode::NOT_FOUND, "API route not found".into()).into_response();
    }
    if let Some(file) = WEB.get_file(if path.is_empty() { "index.html" } else { path }) {
        return Response::builder()
            .header(
                header::CONTENT_TYPE,
                mime_guess::from_path(file.path())
                    .first_or_octet_stream()
                    .as_ref(),
            )
            .body(Body::from(file.contents()))
            .unwrap();
    }
    if !path.contains('.')
        && let Some(index) = WEB.get_file("index.html")
    {
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(index.contents()))
            .unwrap();
    }
    StatusCode::NOT_FOUND.into_response()
}
