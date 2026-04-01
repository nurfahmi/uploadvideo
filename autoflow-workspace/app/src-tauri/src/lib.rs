use std::fs;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::Emitter;

fn resolve_flows_dir() -> Result<std::path::PathBuf, String> {
    let candidates = vec![
        std::path::PathBuf::from("../flows"),
        std::path::PathBuf::from("../../flows"),
    ];
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    for p in &candidates {
        let full = cwd.join(p);
        if full.exists() {
            return full.canonicalize().map_err(|e| e.to_string());
        }
    }
    Err("Flows directory not found".to_string())
}

fn resolve_project_root() -> Result<std::path::PathBuf, String> {
    let flows = resolve_flows_dir()?;
    flows.parent().map(|p| p.to_path_buf()).ok_or("Cannot resolve project root".to_string())
}

#[tauri::command]
fn get_available_flows() -> Result<Vec<String>, String> {
    let flows_dir = resolve_flows_dir()?;
    let mut names: Vec<String> = Vec::new();
    for entry in fs::read_dir(&flows_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_dir() && entry.path().join("flow.json").exists() {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
fn get_flow_details(flow_name: String) -> Result<serde_json::Value, String> {
    let flows_dir = resolve_flows_dir()?;
    let path = flows_dir.join(&flow_name).join("flow.json");
    if !path.exists() {
        return Err(format!("flow.json not found for '{}'", flow_name));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_flow(flow_name: String, content: String) -> Result<(), String> {
    let flows_dir = resolve_flows_dir()?;
    let dir_path = flows_dir.join(&flow_name);
    if !dir_path.exists() {
        fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
    }
    let path = dir_path.join("flow.json");
    // Validate JSON before saving
    let _: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn capture_screen(device_id: String, flow_name: String) -> Result<String, String> {
    let flows_dir = resolve_flows_dir()?;
    let flow_dir = flows_dir.join(&flow_name);
    if !flow_dir.exists() {
        fs::create_dir_all(&flow_dir).map_err(|e| e.to_string())?;
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let filename = format!("screenshot_{}.png", ts);
    let output_path = flow_dir.join(&filename);

    let result = Command::new("adb")
        .arg("-s").arg(&device_id)
        .arg("exec-out")
        .arg("screencap").arg("-p")
        .stdout(Stdio::piped())
        .output()
        .map_err(|e| format!("adb failed: {}", e))?;

    if result.stdout.is_empty() {
        return Err("Screenshot empty — is the device connected?".to_string());
    }

    fs::write(&output_path, &result.stdout).map_err(|e| e.to_string())?;
    Ok(filename)
}

#[tauri::command]
fn list_flow_images(flow_name: String) -> Result<Vec<String>, String> {
    let flows_dir = resolve_flows_dir()?;
    let flow_dir = flows_dir.join(&flow_name);
    if !flow_dir.exists() { return Ok(vec![]); }

    let mut images: Vec<String> = Vec::new();
    for entry in fs::read_dir(&flow_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".png") || name.ends_with(".jpg") {
            images.push(name);
        }
    }
    images.sort();
    Ok(images)
}

#[tauri::command]
fn list_devices() -> Result<Vec<Vec<String>>, String> {
    let output = Command::new("adb")
        .arg("devices")
        .arg("-l")
        .output()
        .map_err(|e| format!("adb not found: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut devices: Vec<Vec<String>> = Vec::new();

    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() { continue; }
        let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
        if parts.len() < 2 { continue; }
        let id = parts[0].trim().to_string();
        let rest = parts[1].trim();
        // Skip offline/unauthorized
        if rest.starts_with("offline") || rest.starts_with("unauthorized") { continue; }
        // Try to extract model name from "device ... model:XXX"
        let model = rest.split_whitespace()
            .find(|s| s.starts_with("model:"))
            .map(|s| s.trim_start_matches("model:").to_string())
            .unwrap_or_else(|| id.clone());
        devices.push(vec![id, model]);
    }
    Ok(devices)
}

#[tauri::command]
fn start_automation(
    device_ids: Vec<String>,
    flow_name: String,
    vars: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let root = resolve_project_root()?;
    let flow_path = root.join("flows").join(&flow_name);
    let engine_path = root.join("engine").join("engine.py");

    if !flow_path.exists() { return Err(format!("Flow '{}' not found", flow_name)); }
    if !engine_path.exists() { return Err(format!("engine.py not found")); }

    let flow_str = flow_path.to_str().ok_or("Invalid path")?.to_string();
    let engine_str = engine_path.to_str().ok_or("Invalid path")?.to_string();
    let count = device_ids.len();

    let _ = app_handle.emit("engine-log",
        format!("[SYSTEM] Starting automation on {} device(s)...", count));

    for device_id in device_ids {
        let app = app_handle.clone();
        let engine = engine_str.clone();
        let flow = flow_str.clone();
        let v = vars.clone();
        let dev = device_id.clone();
        let short = if dev.len() > 8 { dev[dev.len()-6..].to_string() } else { dev.clone() };

        std::thread::spawn(move || {
            let _ = app.emit("engine-log",
                format!("[{}] Spawning engine...", short));

            let child = Command::new("python3")
                .arg(&engine)
                .arg("--device").arg(&dev)
                .arg("--flow_path").arg(&flow)
                .arg("--vars").arg(&v)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();

            match child {
                Ok(mut process) => {
                    if let Some(stdout) = process.stdout.take() {
                        let reader = BufReader::new(stdout);
                        for line in reader.lines().map_while(Result::ok) {
                            let tagged = format!("[{}] {}", short, line);
                            let _ = app.emit("engine-log", &tagged);
                        }
                    }
                    match process.wait() {
                        Ok(s) => {
                            let msg = if s.success() {
                                format!("[{}] ✅ Engine finished successfully", short)
                            } else {
                                format!("[{}] ❌ Engine exited with code: {}", short, s)
                            };
                            let _ = app.emit("engine-log", &msg);
                        }
                        Err(e) => { let _ = app.emit("engine-log", format!("[{}] ERROR: {}", short, e)); }
                    }
                }
                Err(e) => { let _ = app.emit("engine-log", format!("[{}] ERROR: Spawn failed: {}", short, e)); }
            }
        });
    }

    Ok(format!("{} engine(s) started", count))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_available_flows,
            get_flow_details,
            save_flow,
            capture_screen,
            list_flow_images,
            list_devices,
            start_automation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
