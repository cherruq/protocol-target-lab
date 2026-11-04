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
    Json(json!(["http","dns"].map(|protocol| {
        let workspace=d.doc.instances.iter().find(|i|i.protocol_id==protocol);
        let status=if d.config_error.is_some() {"unavailable"} else if d.docker_error.is_some() {"environment-unavailable"} else {workspace.map(|i|i.status.as_str()).unwrap_or("unavailable")};
        let error=d.config_error.as_deref().or(d.docker_error.as_deref()).or_else(||workspace.and_then(|i|i.runtime_error.as_deref().or(i.error.as_deref())));
        let mut descriptor=json!({"id":protocol,"name":protocol.to_ascii_uppercase(),"implementation":if protocol=="dns" {"dnsmasq 2.90"} else {"controlled responder"},"version":env!("CARGO_PKG_VERSION"),"available":d.config_error.is_none(),"image":m.settings.image_for(protocol),"workspace":workspace.map(|i|i.view()),"status":status,"error":error,"session_id":m.session_id});
        if protocol=="http" {descriptor["supported_methods"]=json!(crate::model::HTTP_METHODS);} else {descriptor["supported_transports"]=json!(["UDP","TCP"]);}
        descriptor
    })))
}
async fn schema(Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    match id.as_str() {
        "http" => Ok(Json(
            json!({"protocol_id":"http","type":"object","supported_methods":crate::model::HTTP_METHODS,"properties":{"bind_ip":{"type":"string","default":"0.0.0.0"},"port":{"type":"integer","minimum":1,"maximum":65535,"default":18090},"response_length":{"type":"integer","minimum":0,"maximum":crate::model::MAX_RESPONSE_LENGTH,"default":64},"response_mode":{"type":"string","enum":["fixed","random"],"default":"fixed"}},"required":["bind_ip","port","response_length","response_mode"]}),
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
    Ok(Json(
        json!({"cases":cases,"paths":paths,"current":d.tests.get(&id),"session_id":m.session_id}),
    ))
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
    for protocol in ["http", "dns"] {
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
