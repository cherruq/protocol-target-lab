use crate::{docker, manager::Shared, model::HttpConfig};
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
            axum::routing::put(save_config),
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
    let workspace = d.doc.instances.iter().find(|i| i.protocol_id == "http");
    // Runtime state comes from reconciliation, never from the enabled intent.
    let status = if d.config_error.is_some() {
        "unavailable"
    } else if d.docker_error.is_some() {
        "environment-unavailable"
    } else {
        workspace
            .map(|i| i.status.as_str())
            .unwrap_or("unavailable")
    };
    let error = d
        .config_error
        .as_deref()
        .or(d.docker_error.as_deref())
        .or_else(|| workspace.and_then(|i| i.runtime_error.as_deref().or(i.error.as_deref())));
    Json(
        json!([{"id":"http","name":"HTTP","implementation":"controlled responder",
        "version":env!("CARGO_PKG_VERSION"),"available":true,
        "supported_methods":crate::model::HTTP_METHODS,
        "workspace":workspace.map(|i| i.view()),"status":status,"error":error}]),
    )
}
async fn schema(Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    if id != "http" {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "protocol not implemented".into(),
        ));
    }
    Ok(Json(
        json!({"protocol_id":"http","type":"object","supported_methods":crate::model::HTTP_METHODS,"properties":{"bind_ip":{"type":"string","default":"0.0.0.0"},"port":{"type":"integer","minimum":1,"maximum":65535,"default":18090},"response_length":{"type":"integer","minimum":0,"maximum":crate::model::MAX_RESPONSE_LENGTH,"default":64},"response_mode":{"type":"string","enum":["fixed","random"],"default":"fixed"}},"required":["bind_ip","port","response_length","response_mode"]}),
    ))
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
    body: Result<Json<HttpConfig>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let config = decode(body)?;
    config.validate()?;
    Ok(Json(m.save_config(&id, config).await?))
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
        Json(json!({"operation_id":m.begin(&id,&action).await?})),
    ))
}
async fn tests(State(m): State<Shared>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let d = m.data.lock().await;
    if !d.doc.instances.iter().any(|i| i.id == id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "instance not found".into()));
    }
    let mut cases = crate::model::HTTP_METHODS.to_vec();
    cases.push("ALL");
    Ok(Json(
        json!({"cases":cases,"paths":crate::testing::PATHS,"current":d.tests.get(&id),"session_id":m.session_id}),
    ))
}
async fn start_test(
    State(m): State<Shared>,
    Path(id): Path<String>,
    body: Result<Json<crate::testing::TestRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let request = decode(body)?;
    request
        .validate()
        .map_err(|e| ApiError(StatusCode::UNPROCESSABLE_ENTITY, e.to_string()))?;
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
    Ok((StatusCode::ACCEPTED, Json(json!({"test_id":test_id}))))
}
async fn environment(State(m): State<Shared>) -> Json<Value> {
    let available = docker::image_id(&m.settings.image).await.is_ok();
    let d = m.data.lock().await;
    Json(
        json!({"docker_available":d.docker_error.is_none(),"docker_version":d.docker_version,"error":d.docker_error,"config_error":d.config_error,"kernel":std::fs::read_to_string("/proc/sys/kernel/osrelease").ok().map(|s|s.trim().to_owned()),"image":m.settings.image,"image_available":available,"config_path":m.settings.config,"deployment_id":d.doc.deployment_id}),
    )
}
async fn assets(State(m): State<Shared>) -> Json<Value> {
    let id = docker::image_id(&m.settings.image).await.ok();
    Json(json!({"image":m.settings.image,"available":id.is_some(),"image_id":id}))
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
    let host = if c.bind_ip == "0.0.0.0" {
        "<target-ip>"
    } else {
        &c.bind_ip
    };
    let url = format!("http://{host}:{}", c.port);
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
