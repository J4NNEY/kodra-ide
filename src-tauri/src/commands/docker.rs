use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInfo {
    pub available: bool,
    pub version: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerLogs {
    pub id: String,
    pub text: String,
}

async fn docker(args: &[&str]) -> Result<String, String> {
    let output = tokio::process::Command::new("docker")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("docker is not installed or not on PATH: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("docker {} failed", args.join(" "))
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_json_lines(raw: &str) -> Vec<Value> {
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .collect()
}

#[tauri::command]
pub async fn docker_info() -> Result<DockerInfo, String> {
    match docker(&["version", "--format", "{{.Server.Version}}"]).await {
        Ok(version) => Ok(DockerInfo {
            available: true,
            version: version.trim().to_string(),
            error: None,
        }),
        Err(err) => Ok(DockerInfo {
            available: false,
            version: String::new(),
            error: Some(err),
        }),
    }
}

#[tauri::command]
pub async fn docker_containers(all: Option<bool>) -> Result<Vec<Value>, String> {
    let args = if all.unwrap_or(true) {
        vec!["ps", "-a", "--format", "{{json .}}"]
    } else {
        vec!["ps", "--format", "{{json .}}"]
    };
    let raw = docker(&args).await?;
    Ok(parse_json_lines(&raw))
}

#[tauri::command]
pub async fn docker_images() -> Result<Vec<Value>, String> {
    let raw = docker(&["images", "--format", "{{json .}}"]).await?;
    Ok(parse_json_lines(&raw))
}

#[tauri::command]
pub async fn docker_action(id: String, action: String) -> Result<String, String> {
    let allowed = ["start", "stop", "restart", "pause", "unpause", "rm", "kill"];
    if !allowed.contains(&action.as_str()) {
        return Err(format!("unsupported docker action `{action}`"));
    }
    let mut args = vec![action.as_str(), id.as_str()];
    if action == "rm" {
        args.push("-f");
    }
    docker(&args).await
}

#[tauri::command]
pub async fn docker_logs(id: String, tail: Option<u32>) -> Result<DockerLogs, String> {
    let tail = tail.unwrap_or(400).to_string();
    let text = docker(&["logs", "--tail", &tail, &id]).await?;
    Ok(DockerLogs { id, text })
}

#[tauri::command]
pub async fn docker_run_image(
    image: String,
    name: Option<String>,
    ports: Option<Vec<String>>,
) -> Result<String, String> {
    if image.trim().is_empty() {
        return Err("image is required".into());
    }
    let mut args: Vec<String> = vec!["run".into(), "-d".into()];
    if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
        args.push("--name".into());
        args.push(name);
    }
    for port in ports.unwrap_or_default() {
        if !port.trim().is_empty() {
            args.push("-p".into());
            args.push(port);
        }
    }
    args.push(image);
    let borrowed: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    docker(&borrowed).await
}
