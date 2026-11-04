mod api;
mod docker;
mod manager;
mod model;
mod storage;
mod testing;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc};
use storage::Settings;

async fn systemctl(action: &str) -> Result<()> {
    let result = tokio::process::Command::new("systemctl")
        .args([action, "protocol-target-lab.service"])
        .kill_on_drop(true)
        .status()
        .await?;
    if !result.success() {
        bail!("systemctl {action} failed");
    }
    Ok(())
}
fn read_document(settings: &Settings) -> Result<model::Document> {
    let d: model::Document = serde_json::from_slice(
        &std::fs::read(&settings.config)
            .with_context(|| format!("cannot read {}", settings.config.display()))?,
    )?;
    d.validate()?;
    if std::fs::read_to_string(settings.data.join("deployment-id"))?.trim() != d.deployment_id {
        bail!("deployment ownership marker mismatch");
    }
    Ok(d)
}
async fn stop_all(settings: &Settings) -> Result<()> {
    let _administration = settings.lock("administration.lock")?;
    systemctl("stop").await?;
    let _manager = settings.lock("manager.lock")?;
    let _control = settings.lock("control.lock")?;
    let deployment = match read_document(settings) {
        Ok(doc) => doc.deployment_id,
        Err(e) => {
            eprintln!(
                "Configuration unavailable ({e:#}); using persistent deployment ownership marker for bounded cleanup"
            );
            let id = std::fs::read_to_string(settings.data.join("deployment-id"))?;
            uuid::Uuid::parse_str(id.trim())?;
            id.trim().to_owned()
        }
    };
    testing::cleanup_tests(&deployment, None).await?;
    for v in docker::owned(&deployment, None).await? {
        let id = v["Config"]["Labels"][docker::INSTANCE]
            .as_str()
            .context("owned container missing instance label")?;
        if !model::valid_id(id) {
            bail!("invalid instance label; refusing cleanup");
        }
        docker::remove(&v, &deployment, id).await?;
    }
    println!("Stopped owned resources; configuration and enabled intent preserved.");
    Ok(())
}
async fn import_assets(directory: &Path) -> Result<()> {
    let directory = directory.canonicalize()?;
    let manifest: Value = serde_json::from_slice(&std::fs::read(directory.join("manifest.json"))?)?;
    if manifest["schema_version"] != 1 {
        bail!("unsupported asset manifest schema");
    }
    let images = manifest["images"]
        .as_array()
        .context("manifest images must be an array")?;
    let mut validated = vec![];
    for image in images {
        let name = image["file"].as_str().context("missing image file")?;
        if name.contains('/') || name.contains('\\') || !name.ends_with(".tar") {
            bail!("image file must be a .tar basename");
        }
        let path = directory.join(name).canonicalize()?;
        if !path.starts_with(&directory) {
            bail!("asset path escapes source directory");
        }
        let digest = format!("{:x}", Sha256::digest(std::fs::read(&path)?));
        if image["sha256"].as_str() != Some(&digest) {
            bail!("SHA256 mismatch: {name}");
        }
        validated.push((
            path,
            image["image"]
                .as_str()
                .context("missing image reference")?
                .to_owned(),
        ));
    }
    for (path, image) in validated {
        println!("Importing {}", path.display());
        docker::cmd(&[
            "load",
            "--input",
            path.to_str().context("non-UTF8 asset path")?,
        ])
        .await?;
        println!("{} {}", image, docker::image_id(&image).await?);
    }
    Ok(())
}
#[tokio::main]
async fn main() -> Result<()> {
    let settings = Settings::env()?;
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let action = args.first().map(String::as_str).unwrap_or("serve");
    match action {
        "--version" | "-V" => {
            println!("protocol-target-lab {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        "--help" | "-h" | "help" => {
            println!(
                "protocol-target-lab serve\nplabctl start | stop-all | status | doctor | assets import <directory>\nSettings: PLAB_LISTEN, PLAB_CONFIG_FILE, PLAB_DATA_DIR, PLAB_HTTP_IMAGE, PLAB_DOCKER_SOCKET"
            );
            return Ok(());
        }
        "start" => {
            let _lock = settings.lock("administration.lock")?;
            return systemctl("start").await;
        }
        "stop-all" => return stop_all(&settings).await,
        "status" | "doctor" => {
            let doc = read_document(&settings);
            let docker_version = docker::available().await;
            let resources = if let Ok(d) = &doc {
                docker::owned(&d.deployment_id, None).await.ok()
            } else {
                None
            };
            println!(
                "{}",
                serde_json::to_string_pretty(
                    &json!({"config_path":settings.config,"config_error":doc.as_ref().err().map(|e|format!("{e:#}")),"config":doc.ok(),"docker_version":docker_version.as_ref().ok(),"docker_error":docker_version.as_ref().err().map(|e|format!("{e:#}")),"resources":resources,"image":settings.image,"image_available":docker::image_id(&settings.image).await.is_ok()})
                )?
            );
            return Ok(());
        }
        "assets" if args.len() == 3 && args[1] == "import" => {
            return import_assets(Path::new(&args[2])).await;
        }
        "serve" => {}
        _ => bail!("unknown command; use --help"),
    }
    let _manager = settings.lock("manager.lock")?;
    let listener = tokio::net::TcpListener::bind(&settings.listen)
        .await
        .with_context(|| format!("cannot listen on {}", settings.listen))?;
    let manager = Arc::new(manager::Manager::new(settings));
    let monitor = tokio::spawn(manager.clone().monitor());
    println!(
        "{}",
        json!({"event":"manager_ready","listen":listener.local_addr()?.to_string()})
    );
    let shutdown = async {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("signal handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    };
    // Stopping the manager deliberately leaves worker containers running.
    // SSE clients can remain connected indefinitely. Drop manager HTTP streams
    // on termination so service restarts cannot wait forever for log viewers.
    use std::future::IntoFuture;
    let result = tokio::select! {
        result = axum::serve(listener, api::router(manager)).into_future() => result,
        _ = shutdown => Ok(()),
    };
    monitor.abort();
    result?;
    Ok(())
}
