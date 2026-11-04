mod api;
mod cli;
mod dns;
mod docker;
mod manager;
mod model;
mod mqtt;
mod storage;
mod telnet;
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
fn cleanup_deployment(settings: &Settings) -> Result<Option<String>> {
    // A first startup can fail at bind before any ownership state is written.
    // Uninstall must succeed in that case, without guessing container ownership.
    if !settings.config.try_exists()? && !settings.data.join("deployment-id").try_exists()? {
        return Ok(None);
    }
    match read_document(settings) {
        Ok(doc) => Ok(Some(doc.deployment_id)),
        Err(e) => {
            eprintln!(
                "Configuration unavailable ({e:#}); using persistent deployment ownership marker for bounded cleanup"
            );
            let id = std::fs::read_to_string(settings.data.join("deployment-id"))?;
            uuid::Uuid::parse_str(id.trim())?;
            Ok(Some(id.trim().to_owned()))
        }
    }
}

async fn stop_all(settings: &Settings) -> Result<()> {
    let _administration = settings.lock("administration.lock")?;
    systemctl("stop").await?;
    let _manager = settings.lock("manager.lock")?;
    let _control = settings.lock("control.lock")?;
    let Some(deployment) = cleanup_deployment(settings)? else {
        println!("No initialized deployment; no owned resources to stop.");
        return Ok(());
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
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let invoked_as_ctl = std::env::args().next().is_some_and(|p| {
        std::path::Path::new(&p)
            .file_name()
            .is_some_and(|n| n == "plabctl")
    });
    if invoked_as_ctl && args.is_empty() {
        println!("{}", cli::HELP);
        return Ok(());
    }
    if let Some(code) = cli::dispatch(&args).await {
        std::process::exit(code);
    }
    let settings = Settings::env()?;
    let action = args.first().map(String::as_str).unwrap_or("serve");
    match action {
        "--version" | "-V" => {
            println!("protocol-target-lab {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        "--help" | "-h" | "help" => {
            println!("{}", cli::HELP);
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
                    &json!({"config_path":settings.config,"config_error":doc.as_ref().err().map(|e|format!("{e:#}")),"config":doc.ok(),"docker_version":docker_version.as_ref().ok(),"docker_error":docker_version.as_ref().err().map(|e|format!("{e:#}")),"resources":resources,"image":settings.image,"image_available":docker::image_id(&settings.image).await.is_ok(),"dns_image":settings.dns_image,"dns_image_available":docker::image_id(&settings.dns_image).await.is_ok(),"mqtt_image":settings.mqtt_image,"mqtt_image_available":docker::image_id(&settings.mqtt_image).await.is_ok(),"telnet_image":settings.telnet_image,"telnet_image_available":docker::image_id(&settings.telnet_image).await.is_ok()})
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

#[cfg(test)]
mod cleanup_tests {
    use super::*;
    #[test]
    fn absent_ownership_is_safe_but_partial_or_invalid_state_is_not_guessed() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("build/tests")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        let settings = Settings {
            config: root.join("instances.json"),
            data: root.clone(),
            listen: "127.0.0.1:0".into(),
            image: "unused".into(),
            dns_image: "unused".into(),
            mqtt_image: "unused".into(),
            telnet_image: "unused".into(),
        };
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root.clone());
        assert!(cleanup_deployment(&settings).unwrap().is_none());
        std::fs::write(&settings.config, b"broken").unwrap();
        assert!(cleanup_deployment(&settings).is_err());
        std::fs::remove_file(&settings.config).unwrap();
        std::fs::write(root.join("deployment-id"), b"broken").unwrap();
        assert!(cleanup_deployment(&settings).is_err());
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::write(root.join("deployment-id"), &id).unwrap();
        assert_eq!(cleanup_deployment(&settings).unwrap(), Some(id));
    }
}
