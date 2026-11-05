use crate::{docker, manager::Shared, model::ProtocolConfig};
use anyhow::Context;
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
#[derive(Debug)]
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
        .route("/api/instances/{id}/runtime", get(runtime_info))
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
        let mut descriptor=json!({"id":protocol,"name":protocol.to_ascii_uppercase(),"implementation":match protocol {"igmp"=>"Persistent native Linux kernel IPv4 multicast member","custom-ethernet"=>"libpcap1.10.5 kernel-filtered Ethernet fixed responder","arp-client"=>"Persistent Ethernet/IPv4 ARP, RARP and InARP active requester","vxlan"=>"stdlib IPv4 unicast VXLAN Ethernet/ARP responder with eleven target scenarios","bfd"=>"stdlib IPv4 single-hop active BFD Control with explicit target fault scenarios","iec101"=>"lib60870-C 2.4.1 native unbalanced dual-channel slave via PTY/TCP","dlt645"=>"software DL/T645-2007 meter over TCP byte stream","rtcp"=>"stdlib RFC3550 RTCPv2 SR+SDES compound receiver","rtp"=>"stdlib RFC3550v2 structural receiver; opaque payload","dns"=>"dnsmasq 2.90","mqtt"=>"Mosquitto 2.0.18 + packet-size backports","telnet"=>"telnetlib3 4.0.3","iec104"=>"c104 2.2.1 + incremental TCP framing fix","mqtt-sn"=>"Eclipse Paho MQTT-SN Gateway 1.5.1 + project capacity guard; private Mosquitto 2.0.18",_=>"controlled responder"},"version":env!("CARGO_PKG_VERSION"),"available":d.config_error.is_none(),"image":m.settings.image_for(protocol),"workspace":workspace.map(|i|i.view()),"status":status,"error":error,"session_id":m.session_id});
        if protocol=="http" {descriptor["supported_methods"]=json!(crate::model::HTTP_METHODS);} else if protocol=="dns" {descriptor["supported_transports"]=json!(["UDP","TCP"]);} else if protocol=="mqtt" {descriptor["supported_transports"]=json!(["TCP"]);descriptor["supported_versions"]=json!(["3.1.1","5.0"]);descriptor["supported_qos"]=json!([0,1,2]);} else if protocol=="igmp" {descriptor["supported_transports"]=json!(["IGMP"]);descriptor["wire_profiles"]=json!(["linux-kernel-igmp-v2"]);descriptor["supported_features"]=json!(["persistent native kernel membership","actual General/Group Query verification","owned bridge, existing interface or owned kernel VXLAN"]);} else if protocol=="custom-ethernet" {descriptor["supported_transports"]=json!(["ETHERNET"]);descriptor["wire_profiles"]=json!(["ethernet-fixed-response"]);descriptor["supported_features"]=json!(["live libpcap cBPF kernel attach/readback","fixed payload or opaque raw response","single8021q VLAN/AUXDATA","persistent repeated response","owned software L2 or existing host interface"]);} else if protocol=="arp-client" {descriptor["supported_transports"]=json!(["ETHERNET"]);descriptor["supported_features"]=json!(["active ARP/RARP/InARP requester","four modes and fifteen legal scenario pairs","same-image inverse responder","owned software L2 or existing host interface"]);} else if protocol=="vxlan" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["wire_profiles"]=json!(["vxlan-ipv4-arp"]);descriptor["supported_features"]=json!(["Ethernet/IPv4 ARP Request-to-Reply","eleven configured target scenarios","fixed peer receive port","fresh causal receive/send observation"]);} else if protocol=="bfd" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["supported_features"]=json!(["single-hop TTL255/interface validation","Down/Init/Up","Poll/Final","normal/poll/quiet/wrong-your/ttl254/short target modes"]);} else if protocol=="iec101" {descriptor["supported_transports"]=json!(["TCP byte stream via software PTY"]);descriptor["supported_features"]=json!(["simultaneous single/double address channels","RESET/STATUS","CLASS2","GI ACT_CON/data/ACT_TERM","FCB duplicate handling"]);} else if protocol=="dlt645" {descriptor["supported_transports"]=json!(["TCP"]);descriptor["wire_profiles"]=json!(["dlt645-2007-tcp"]);descriptor["software_function_classes"]=json!(["11","13","14","15","16","08","17","18","19","1A","1C","1D","03 reject/fixture"]);descriptor["crypto_verified"]=json!(false);} else if protocol=="rtcp" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["packet_profiles"]=json!(["sr-sdes"]);descriptor["rtcp_reply_expected"]=json!(false);} else if protocol=="rtp" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["supported_features"]=json!(["RTPv2 header/CSRC/extension/padding","fresh receive observation"]);descriptor["rtp_reply_expected"]=json!(false);} else if protocol=="mqtt-sn" {descriptor["supported_transports"]=json!(["UDP"]);descriptor["validated_qos"]=json!([1]);descriptor["validated_features"]=json!(["CONNECT/reconnect","REGISTER/PUBLISH","predefined topics","multicast GWINFO","independent MQTT broker delivery"]);} else if protocol=="iec104" {descriptor["supported_transports"]=json!(["TCP"]);descriptor["supported_features"]=json!(["STARTDT","STOPDT","TESTFR","GI","READ","C_SC_NA_1 DIRECT"]);} else {descriptor["supported_transports"]=json!(["TCP"]);descriptor["supported_features"]=json!(["IAC","TTYPE","NAWS","TSPEED","XDISPLOC","NEW_ENVIRON"]);}
        descriptor
    })))
}
async fn schema(Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    match id.as_str() {
        "mqtt-sn" => Ok(Json(crate::mqtt_sn::schema())),
        "rtp" => Ok(Json(crate::rtp::schema())),
        "rtcp" => Ok(Json(crate::rtcp::schema())),
        "dlt645" => Ok(Json(crate::dlt645::schema())),
        "iec101" => Ok(Json(crate::iec101::schema())),
        "bfd" => Ok(Json(crate::bfd::schema())),
        "vxlan" => Ok(Json(crate::vxlan::schema())),
        "arp-client" => Ok(Json(crate::arp_client::schema())),
        "custom-ethernet" => Ok(Json(crate::custom_ethernet::schema())),
        "igmp" => Ok(Json(crate::igmp::schema())),
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
        ProtocolConfig::Igmp(_) => (
            crate::igmp::CASES.iter().map(|s| s.to_string()).collect(),
            vec![crate::igmp::PATH.into()],
        ),
        ProtocolConfig::CustomEthernet(_) => (
            crate::custom_ethernet::CASES
                .iter()
                .map(|s| s.to_string())
                .collect(),
            vec![crate::custom_ethernet::PATH.into()],
        ),
        ProtocolConfig::ArpClient(_) => (
            crate::arp_client::CASES
                .iter()
                .map(|s| s.to_string())
                .collect(),
            vec![crate::arp_client::PATH.into()],
        ),
        ProtocolConfig::Vxlan(_) => (
            crate::vxlan::CASES.iter().map(|s| s.to_string()).collect(),
            vec![crate::vxlan::PATH.into()],
        ),
        ProtocolConfig::Bfd(c) => (
            c.cases().iter().map(|s| s.to_string()).collect(),
            vec![crate::bfd::PATH.into()],
        ),
        ProtocolConfig::Iec101(_) => (
            crate::iec101::CASES.iter().map(|s| s.to_string()).collect(),
            crate::iec101::PATHS.iter().map(|s| s.to_string()).collect(),
        ),
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
    if let ProtocolConfig::Igmp(c) = config {
        result["case_labels"] = json!({"GENERAL_QUERY":"General Query：全部配置组（2轮）","GROUP_QUERY":"Group Query：首个配置组（2轮）","ALL":"两类查询（4组检查）"});
        result["path_label"] = "内核成员".into();
        result["test_budget"] = json!({"available":true,"budget":{"client_total_ms":crate::igmp::CLIENT_BUDGET_MS,"manager_total_ms":crate::igmp::MANAGER_BUDGET_MS,"manager_execution_ms":crate::igmp::EXECUTION_BUDGET_MS,"cleanup_reserve_ms":crate::igmp::CLEANUP_BUDGET_MS,"round_ms":12000,"rounds":c.rounds("ALL")?,"expected_general_reports":c.groups.len()*2,"expected_group_reports":2},"notes":["Actual runtime warmup and other references are checked before creating the peer","Query and Report counts differ with multiple groups"]});
    }
    if let ProtocolConfig::CustomEthernet(c) = config {
        result["case_labels"] = json!({"ROUNDTRIP":"固定帧往返（2组）","REPEAT":"持续重复收发（2组、6次交换）","ALL":"当前请求帧验证（4组、8次交换）"});
        result["path_label"] = "显式请求帧".into();
        result["test_budget"] = json!({"available":true,"budget":c.test_budget("ALL")?});
    }
    if let ProtocolConfig::ArpClient(c) = config {
        result["case_labels"] = json!({"OBSERVE_REQUEST":"实际主动请求","MAPPING":"映射或负请求拒绝","REJECT_REPLY":"错误应答拒绝","TIMEOUT":"真实请求超时","ALL":format!("当前 {}/{} 完整验证（8项）",c.mode.name(),c.request_scenario.mode())});
        result["path_label"] = "反向应答端".into();
        result["test_budget"] = match c.test_budget("ALL") {
            Ok(b) => json!({"available":true,"budget":b}),
            Err(e) => json!({"available":false,"reason":format!("{e:#}")}),
        };
    }
    if let ProtocolConfig::Vxlan(c) = config {
        result["case_labels"] = json!({"ARP":"合法 ARP 与精确应答","RESERVED_BITS":"忽略保留位","REQUEST_THA":"忽略请求目标 MAC","INVALID_REQUEST":"拒绝错误 VNI 与目标 IP","ALL":format!("当前 {} 场景完整验证（8项）",c.scenario.mode())});
        result["path_label"] = "内层请求".into();
    }
    if let ProtocolConfig::Bfd(c) = config {
        result["case_labels"] = json!({"NORMAL":"正常会话与周期收发","POLL":"目标 Poll 与真实 Final","QUIET":"目标静默、检测与恢复","WRONG_YOUR":"目标错误 Your 与恢复","TTL254":"目标实际 TTL254 与恢复","SHORT":"目标短报文与恢复","ALL":format!("当前 {} 场景完整验证（2轮）",c.scenario.mode())});
        result["path_label"] = "会话".into();
    }
    if matches!(config, ProtocolConfig::Iec101(_)) {
        result["case_labels"] = json!({"RESET_STATUS":"复位与链路状态","CLASS2":"实际遥信与地址","GI":"总召确认、遥信与结束","STREAM":"增量分帧与重复 FCB","ALL":"全部双通道测试"});
        result["path_label"] = "通道".into();
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
async fn runtime_info(
    State(m): State<Shared>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (deployment, i) = {
        let d = m.data.lock().await;
        let i = d
            .doc
            .instances
            .iter()
            .find(|i| i.id == id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "instance not found".into()))?
            .clone();
        (d.doc.deployment_id.clone(), i)
    };
    if !["bfd", "vxlan", "arp-client", "custom-ethernet", "igmp"].contains(&i.protocol_id.as_str())
    {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "runtime state not implemented for this protocol".into(),
        ));
    }
    let (Some(config), Some(cid)) = (i.applied_config.as_ref(), i.container_id.as_ref()) else {
        return Ok(Json(
            json!({"available":false,"reason":"workspace is not running"}),
        ));
    };
    let start = tokio::time::Instant::now();
    let observation = match config {
        ProtocolConfig::Igmp(c) => {
            crate::igmp_link::snapshot(&m.settings, &deployment, &id, cid, c).await
        }
        ProtocolConfig::ArpClient(c) => crate::l2::snapshot(&deployment, &id, cid, c).await,
        ProtocolConfig::CustomEthernet(c) => {
            crate::custom_l2::snapshot(&deployment, &id, cid, c).await
        }
        ProtocolConfig::Bfd(c) => crate::bfd::snapshot(&deployment, &id, cid, c).await,
        ProtocolConfig::Vxlan(c) => crate::vxlan::snapshot(&deployment, &id, cid, c).await,
        _ => unreachable!("validated protocol/config variant"),
    };
    Ok(Json(match observation {
        Ok(runtime) => {
            json!({"available":true,"source_container_id":cid,"runtime":runtime,"sample_age_ms":start.elapsed().as_millis() as u64})
        }
        Err(e) => json!({"available":false,"source_container_id":cid,"reason":format!("{e:#}")}),
    }))
}
fn igmp_connection(
    c: &crate::igmp::IgmpConfig,
    deployment: &str,
    instance: &str,
    image: &str,
) -> Result<Value, ApiError> {
    let mut external_peer = Value::Null;
    let mut peer_helper = Value::Null;
    if !c.link.is_bridge() {
        let mut argv = vec![
            "docker".to_string(),
            "run".into(),
            "--rm".into(),
            "--network".into(),
            "host".into(),
            "--user".into(),
            "0:0".into(),
            "--cap-drop".into(),
            "ALL".into(),
            "--cap-add".into(),
            "NET_RAW".into(),
            "--ipc".into(),
            "private".into(),
            "--entrypoint".into(),
            "python3".into(),
            "<exact-source-image-id>".into(),
            "/opt/protocol-target-lab/client.py".into(),
        ];
        argv.extend(crate::igmp::config_args(c)?);
        argv.extend([
            "--interface".into(),
            "<peer-interface>".into(),
            "--source-ip".into(),
            "<actual-peer-primary-ipv4>".into(),
            "--target-ip".into(),
            "<runtime.interface.primary_ipv4>".into(),
            "--target-mac".into(),
            "<runtime.interface.mac>".into(),
            "--observer-host".into(),
            "127.0.0.1".into(),
            "--observer-port".into(),
            crate::igmp::OBSERVER_PORT.to_string(),
            "--expected-boot-id".into(),
            "<runtime.boot_id>".into(),
            "--expected-runtime-id".into(),
            "<runtime.runtime_id>".into(),
            "--method".into(),
            "ALL".into(),
            "--path".into(),
            crate::igmp::PATH.into(),
        ]);
        external_peer = json!({"argv":argv,"observer_forward":["ssh","-N","-L","127.0.0.1:18088:127.0.0.1:18088","<target-ssh>"],"requires":["Record actual running source Image/CID/boot/runtime/interface using plabctl runtime igmp; use that immutable source image on the counterpart","Explicitly select the counterpart existing UP Ethernet interface with exactly one primary IPv4; never copy the target interface name implicitly","Replace every placeholder and establish only the private read-only observer forward","Peer must not IP_ADD_MEMBERSHIP on target groups; existing members/queriers can legitimately affect reports","Recheck original source identities after testing and stop only the task-owned forward"],"notes":["Manual command template; Web never SSH-executes commands on the counterpart","IGMP Queries and native Reports traverse the actual interface; only private observation uses the forward","90s global client budget includes conservative startup warmup and12s per query round; no transaction ID or unique causal claim"]});
        if matches!(c.link, crate::igmp::Link::OwnedVxlan { .. }) {
            let mut spec = c.helper_spec(deployment, instance, Some("peer0"))?;
            spec["link"]["outer_interface"] = "<peer-underlay-interface>".into();
            let argv = |action| {
                json!([
                    "sudo",
                    "plabctl",
                    "igmp",
                    "link",
                    action,
                    "--spec-json",
                    serde_json::to_string(&spec).expect("serializable helper spec")
                ])
            };
            peer_helper = json!({"spec":spec,"start_argv":argv("start"),"status_argv":argv("status"),"stop_argv":argv("stop"),"requires":["Replace peer-underlay-interface with the actual local counterpart underlay; target and counterpart names need not match","Verify actual local/remote underlay IPv4, free carrier UDP/VNI and non-overlapping inner prefix","Use returned ready helper interface as client peer-interface; no manual existing-device reuse","Stop client before helper stop; remove only matching project-owned device"],"notes":["Typed local root helper creates only a new owned kernel VXLAN device and its automatic routes","Carrier UDP is not an IGMP application port","Builtin verification needs a matching actual peer helper receipt on this same host; otherwise run the external template"]});
        }
    }
    Ok(
        json!({"transport":"IGMP","role":"persistent-linux-kernel-member","link_mode":c.link.mode(),"link":c.link,"groups":c.groups,"query_profile":c.query_profile,"external_peer":external_peer,"peer_helper":peer_helper,"image":image,"commands":["plabctl runtime igmp","plabctl --timeout 150 tests run igmp --method ALL"],"client_execution":{"role":"query-sender/native-report-observer","bridge":"Distinct actual source and disposable peer endpoints on new owned internal Docker bridge","host":"Explicit different peer_interface required for builtin; null means external client","owned_vxlan":"Typed root helper for new project-owned devices; peer setup is explicit","observer":"Private18088, unpublished on bridge or loopback only on host"},"notes":["Real Linux kernel memberships persist until own socket close; wrapper never synthesizes Report or ACK","Host Linux kernel is shared; container network namespace is not a guest kernel","IGMP is IPv4 protocol2 with no application TCP/UDP endpoint","General Query checks all configured groups twice; Group Query checks first group twice; query/report/check counts are separate","Actual warmup upper bound, version compatibility and other references can make testing unavailable without changing runtime membership","Existing physical interfaces/global defaults/routes/firewalls are read-only; only new owned helper devices are configured"]}),
    )
}
fn custom_external_peer(
    config: &crate::custom_ethernet::CustomEthernetConfig,
) -> Result<Value, ApiError> {
    if config.link.is_bridge() {
        return Ok(Value::Null);
    }
    let mut argv = vec![
        "docker".to_string(),
        "run".into(),
        "--rm".into(),
        "--network".into(),
        "host".into(),
        "--user".into(),
        "0:0".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--cap-add".into(),
        "NET_RAW".into(),
        "--ipc".into(),
        "private".into(),
        "--pull".into(),
        "never".into(),
        "--entrypoint".into(),
        "python3".into(),
        "<exact-source-image-id>".into(),
        "-u".into(),
        "/opt/protocol-target-lab/client.py".into(),
        "--method".into(),
        "ALL".into(),
        "--path".into(),
        "frame".into(),
    ];
    argv.extend(crate::custom_ethernet::config_args(config)?);
    argv.extend([
        "--interface".into(),
        "<peer-interface>".into(),
        "--observer-host".into(),
        "127.0.0.1".into(),
        "--observer-port".into(),
        "18087".into(),
        "--expected-boot-id".into(),
        "<runtime.boot_id>".into(),
        "--expected-runtime-id".into(),
        "<runtime.runtime_id>".into(),
    ]);
    Ok(
        json!({"argv":argv,"observer_forward":["ssh","-N","-L","127.0.0.1:18087:127.0.0.1:18087","<target-ssh>"],"requires":["Read plabctl runtime custom-ethernet and record source CID/boot/runtime identity","Inspect actual immutable source image; import matching frozen assets and verify equivalent complete image contents on counterpart","Map peer-interface to the counterpart actual Ethernet NIC; filter, fixture and fixed response are independent manual fields","Replace every placeholder and establish explicit private read-only observer forwarding; target-ssh is the management destination","Run sender/receiver on the counterpart and recheck original source identity; clean only the owned forwarding process"],"notes":["Manual template only; application does not execute remote SSH","Only observer HTTP is forwarded; Ethernet data uses the actual link","Arbitrary BPF or raw fixture may not match; tests report actual failure without rewriting configuration","Raw submitted bytes and driver padding differ; no preamble/FCS/runt claim"]}),
    )
}
fn arp_external_peer(config: &crate::arp_client::ArpClientConfig) -> Result<Value, ApiError> {
    if config.link.is_bridge() {
        return Ok(Value::Null);
    }
    let argv = vec![
        "docker".to_string(),
        "run".into(),
        "--rm".into(),
        "--network".into(),
        "host".into(),
        "--user".into(),
        "0:0".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--cap-add".into(),
        "NET_RAW".into(),
        "--ipc".into(),
        "private".into(),
        "--pull".into(),
        "never".into(),
        "--entrypoint".into(),
        "python3".into(),
        "<exact-source-image-id>".into(),
        "-u".into(),
        "/opt/protocol-target-lab/client.py".into(),
        "--method".into(),
        "ALL".into(),
        "--path".into(),
        "peer".into(),
        "--config-json".into(),
        serde_json::to_string(config).map_err(anyhow::Error::from)?,
        "--interface".into(),
        "<peer-interface>".into(),
        "--observer-host".into(),
        "127.0.0.1".into(),
        "--observer-port".into(),
        crate::arp_client::OBSERVER_PORT.to_string(),
        "--expected-boot-id".into(),
        "<runtime.boot_id>".into(),
        "--expected-runtime-id".into(),
        "<runtime.runtime_id>".into(),
    ];
    Ok(
        json!({"argv":argv,"observer_forward":["ssh","-N","-L","127.0.0.1:18086:127.0.0.1:18086","<target-ssh>"],"requires":["Run plabctl runtime arp-client against the manager and record the actual source CID, boot_id and runtime_id","Inspect the actual source Image using the confirmed source CID on the manager host; import the matching frozen assets on the counterpart and replace exact-source-image-id with its verified equivalent immutable image, not an unverified configured tag","Map peer-interface to the counterpart actual NIC with server_mac","Replace every placeholder explicitly; target-ssh is the management SSH destination, never a simulated role IP","Establish the explicit private read-only observer forward; if its local port changes update --observer-port","Run the inverse peer on that counterpart; recheck the original source identity after the test and stop only the task-owned forward"],"notes":["Manual template only; the application does not run SSH or commands on another node","Only private observer HTTP is forwarded; Ethernet protocol traffic uses the actual L2 path","Existing kernel/external replies can legitimately make TIMEOUT fail; never alter host neighbor/sysctl to force silence"]}),
    )
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
    if let ProtocolConfig::Igmp(config) = c {
        return Ok(Json(igmp_connection(
            config,
            &d.doc.deployment_id,
            &id,
            m.settings.image_for("igmp"),
        )?));
    }
    if let ProtocolConfig::CustomEthernet(config) = c {
        return Ok(Json(
            json!({"transport":"ETHERNET","role":"passive-fixed-responder","link":config.link,"local_mac":config.local_mac,"peer_mac":config.peer_mac,"packet_filter":config.packet_filter,"response_mode":config.response.mode,"external_peer":custom_external_peer(config)?,"commands":["plabctl runtime custom-ethernet","plabctl tests run custom-ethernet --method ALL"],"client_execution":{"role":"active-sender-receiver","bridge":"Owned internal Docker L2 with distinct actual source and disposable peer veths","host":"Builtin needs unique different existing peer MAC interface; external client maps its own local NIC explicitly","observer":"Private18087 from immutable source/network, optional explicit loopback forwarding in host mode"},"notes":["No application TCP/UDP port or bind URL","BPF, request fixture and fixed response are independent; no silent rewrite","ALL tests current fixture with4 check groups and8 actual exchanges","Both raw/payload banks and disabled values persist; full config determines pending/applied identity","No generic carrier, protocol ACK or physical VLAN guarantee"]}),
        ));
    }
    if let ProtocolConfig::ArpClient(config) = c {
        let external_peer = arp_external_peer(config)?;
        return Ok(Json(
            json!({"transport":"ETHERNET","role":"active-requester","external_peer":external_peer,"link":config.link,"source_mac":config.source_mac,"source_ip":config.source_ip,"server_mac":config.server_mac,"server_ip":config.server_ip,"assigned_ip":config.assigned_ip,"mode":config.mode,"request_scenario":config.request_scenario,"commands":["plabctl runtime arp-client","plabctl tests run arp-client --method ALL"],"client_execution":{"role":"inverse-responder","bridge":"Owned internal Docker L2, actual different veth NICs; role IPs do not configure OS addresses","host":"Built-in requires a unique different actual interface with server_mac on manager host; external peer must map its own explicit --interface","observer":"Private18086 derived from exact source CID/network, or explicit read-only SSH loopback forward in host mode"},"notes":["No application UDP/TCP port or fake bind URL","Source running readiness differs from pending/mapping history; no wire transaction ID or response ACK","ALL checks current applied mode/scenario; fifteen-configuration coverage is explicit","Host TIMEOUT can fail due actual external responders; no host neighbor/sysctl modifications"]}),
        ));
    }
    let endpoint = c
        .ip_endpoint()
        .context("config.transport: IP endpoint required")?;
    let host = if endpoint.bind_ip == "0.0.0.0" {
        "<target-ip>"
    } else {
        endpoint.bind_ip
    };
    if let ProtocolConfig::Vxlan(config) = c {
        return Ok(Json(
            json!({"base_url":format!("vxlan://{}:{}",config.bind_ip,config.port),"host":config.bind_ip,"port":config.port,"peer_ip":config.peer_ip,"peer_port":config.peer_port,"source_port":config.source_port,"vni":config.vni,"scenario":config.scenario,"commands":["plabctl runtime vxlan","plabctl tests run vxlan --method ALL"],"client_execution":{"receiver_ip":config.peer_ip,"receiver_port":config.peer_port,"observer":"Private target loopback18085; external full verification requires explicit read-only SSH forwarding and validated source identities"},"notes":["Finite IPv4 VXLAN ARP responder; no general L2 forwarding or IPv4/ICMP service","Response uses fixed peer_port, never the Request source port","ALL verifies the current applied target mode with8checks; eleven-mode coverage requires eleven explicit configurations","Built-in client executes on manager host; peer_ip must already be local and peer_port free","Readiness proves local socket and event-loop health, not a connected tunnel"]}),
        ));
    }
    if let ProtocolConfig::Bfd(config) = c {
        return Ok(Json(
            json!({"base_url":format!("bfd://{}:{}",config.bind_ip,crate::bfd::PORT),"host":config.bind_ip,"port":crate::bfd::PORT,"peer_ip":config.peer_ip,"target_interface":config.interface,"source_port":config.source_port,"scenario":config.scenario,"commands":["plabctl runtime bfd".to_string(),"plabctl --timeout 150 tests run bfd --method ALL".to_string()],"client_execution":{"receiver_ip":config.peer_ip,"receiver_port":crate::bfd::PORT,"interface":"Use the actual counterpart interface; target_interface is not the remote client interface","observer":"Private target loopback18084. External complete verification requires an explicit task-owned read-only tunnel and validated boot/runtime identities; no application auto-SSH"},"notes":["Process running readiness and actual BFD peer Up are separate states","ALL verifies the currently applied target scenario twice; six-mode coverage requires six explicit configurations","Built-in tests require peer_ip to belong to the manager host and an idle peer; existing BFD peers are not evicted","IPv4 single-hop Control with actual incoming TTL255/interface checks; no Echo, authentication, Demand, multihop or routing SLA claim"]}),
        ));
    }
    if let ProtocolConfig::Iec101(config) = c {
        return Ok(Json(
            json!({"host":host,"endpoints":{"single":format!("tcp://{host}:{}",config.single.port),"double":format!("tcp://{host}:{}",config.double.port)},"ports":{"single":config.single.port,"double":config.double.port},"serial":config.serial,"channel_widths":{"single":{"link":1,"cot":1,"ca":1,"ioa":1,"originator_encoded":false},"double":{"link":2,"cot":2,"ca":2,"ioa":3,"originator_encoded":true}},"test_host_serial_paths":["/run/protocol-target-lab/serial/iec101-a","/run/protocol-target-lab/serial/iec101-b"],"commands":["plabctl tests run iec101 --method ALL --path dual".to_string(),format!("sudo plabctl serial start --host {host} --single-port {} --double-port {}",config.single.port,config.double.port),"sudo plabctl serial status".to_string(),"sudo plabctl serial stop".to_string()],"notes":["Both channels are simultaneously available; each accepts one active master","Serial helper runs on the test host and exposes stable software PTYs to dialout users; no physical serial timing claim","Stop serial helper before built-in tests; after target restart run serial start again to reconnect disconnected channels","Single-channel originator address is not encoded with one-byte COT; fixed serial settings describe software termios"]}),
        ));
    }
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
    let url = format!("http://{host}:{}", endpoint.port);
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

#[cfg(test)]
mod bfd_input_tests {
    use super::*;
    #[test]
    fn custom_manual_peer_is_portless_and_preserves_exact_config() {
        let c = crate::custom_ethernet::CustomEthernetConfig::default();
        assert!(custom_external_peer(&c).unwrap().is_null());
        let c = c
            .patch(json!({"link":{"mode":"host-interface","interface":"eth0"}}))
            .unwrap();
        let help = custom_external_peer(&c).unwrap();
        let args = help["argv"].as_array().unwrap();
        let i = args.iter().position(|a| a == "--config-json").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(args[i + 1].as_str().unwrap()).unwrap(),
            serde_json::to_value(&c).unwrap()
        );
        assert!(args.iter().any(|a| a == "<exact-source-image-id>"));
        assert!(args.iter().any(|a| a == "--observer-host"));
        assert!(!args.iter().any(|a| a == "--host" || a == "--port"));
        assert!(
            help["observer_forward"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a == "127.0.0.1:18087:127.0.0.1:18087")
        );
    }

    #[test]
    fn arp_host_peer_template_is_explicit_and_bridge_has_no_fake_external_path() {
        let c = crate::arp_client::ArpClientConfig::default();
        assert!(arp_external_peer(&c).unwrap().is_null());
        let c = c
            .patch(json!({"link":{"mode":"host-interface","interface":"eth0"}}))
            .unwrap();
        let v = arp_external_peer(&c).unwrap();
        let args = v["argv"].as_array().unwrap();
        let index = args.iter().position(|a| a == "--config-json").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(args[index + 1].as_str().unwrap()).unwrap(),
            serde_json::to_value(c).unwrap()
        );
        assert!(args.iter().any(|v| v == "<exact-source-image-id>"));
        assert!(args.iter().any(|v| v == "<peer-interface>"));
        assert!(args.iter().any(|v| v == "<runtime.boot_id>"));
        assert_eq!(v["observer_forward"][4], "<target-ssh>");
    }
    #[test]
    fn arp_input_errors_are422_with_no_port_facade() {
        for patch in [
            json!({"port":1}),
            json!({"source_ip":"0.0.0.0"}),
            json!({"source_mac":"01:00:00:00:00:01"}),
            json!({"mode":"inarp","request_scenario":{"mode":"nonzero-whois-tha"}}),
            json!({"link":{"mode":"docker-bridge","interface":"eth0"}}),
            json!({"timeout_ms":9}),
            json!({"request_scenario":null}),
        ] {
            let error = crate::arp_client::ArpClientConfig::default()
                .patch(patch.clone())
                .unwrap_err();
            let mapped = ApiError::from(error);
            assert_eq!(
                mapped.0,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{patch}: {}",
                mapped.1
            );
        }
    }
    #[test]
    fn vxlan_input_errors_are422_not_internal_failure() {
        for patch in [
            json!({"port":0}),
            json!({"peer_ip":"127.0.0.1"}),
            json!({"vni":16777216}),
            json!({"bind_ip":"0.0.0.0"}),
            json!({"inner_ip":"198.18.0.10"}),
            json!({"inner_mac":"01:00:00:00:00:20"}),
            json!({"scenario":{"mode":"normal","duration_ms":1}}),
        ] {
            let error = crate::vxlan::VxlanConfig::default()
                .patch(patch.clone())
                .unwrap_err();
            let mapped = ApiError::from(error);
            assert_eq!(
                mapped.0,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{patch}: {}",
                mapped.1
            );
        }
    }
    #[test]
    fn invalid_tagged_bfd_patch_is_an_input_rejection_not_server_failure() {
        for patch in [
            json!({"scenario":{"mode":"normal","duration_ms":1}}),
            json!({"scenario":{"mode":"poll"}}),
            json!({"scenario":{"mode":"bogus"}}),
            json!({"detect_mult":"3"}),
        ] {
            let error = crate::bfd::BfdConfig::default().patch(patch).unwrap_err();
            let response: ApiError = error.into();
            assert_eq!(response.0, StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
}
