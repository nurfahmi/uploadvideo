use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// ── Process Tracking ──────────────────────────────────────

static RUNNING_PIDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

// ── Path Resolution ───────────────────────────────────────

struct AppPaths {
    python_bin: PathBuf,
    adb_bin: PathBuf,
    engine_script: PathBuf,
    flows_dir: PathBuf,
    data_dir: PathBuf, // writable dir for config, user data
}

fn resolve_paths(app_handle: &tauri::AppHandle) -> Result<AppPaths, String> {
    // Try bundled paths first (production mode)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let python_bin = if cfg!(target_os = "windows") {
            resource_dir.join("python").join("python.exe")
        } else {
            resource_dir.join("python").join("bin").join("python3")
        };
        let adb_bin = if cfg!(target_os = "windows") {
            resource_dir.join("adb").join("adb.exe")
        } else {
            resource_dir.join("adb").join("adb")
        };
        let engine_script = resource_dir.join("engine").join("engine.py");

        if python_bin.exists() && engine_script.exists() {
            // Production: flows + config in app_data_dir (writable)
            let data_dir = app_handle.path().app_data_dir()
                .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
            let flows_dir = data_dir.join("flows");

            // First launch: create flows dir + copy templates
            if !flows_dir.exists() {
                fs::create_dir_all(&flows_dir).map_err(|e| e.to_string())?;
                let bundled_flows = resource_dir.join("flows");
                if bundled_flows.exists() {
                    copy_dir_recursive(&bundled_flows, &flows_dir)?;
                }
            }

            return Ok(AppPaths {
                python_bin,
                adb_bin,
                engine_script,
                flows_dir,
                data_dir,
            });
        }
    }

    // Fallback: dev mode (CWD-relative, existing behavior)
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let candidates = vec![
        cwd.join("../flows"),
        cwd.join("../../flows"),
        cwd.join("../../../flows"),       // from target/debug/
        cwd.join("flows"),                 // if CWD is project root
    ];
    for p in &candidates {
        if p.exists() {
            let flows_dir = p.canonicalize().map_err(|e| e.to_string())?;
            let data_dir = flows_dir.parent()
                .ok_or("Cannot resolve project root")?
                .to_path_buf();
            return Ok(AppPaths {
                python_bin: PathBuf::from("python3"),
                adb_bin: PathBuf::from("adb"),
                engine_script: data_dir.join("engine").join("engine.py"),
                flows_dir,
                data_dir,
            });
        }
    }

    Err("Could not resolve app paths (neither bundled nor dev)".to_string())
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Commands ──────────────────────────────────────────────

#[tauri::command]
fn get_available_flows(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let paths = resolve_paths(&app_handle)?;
    let mut names: Vec<String> = Vec::new();
    if !paths.flows_dir.exists() { return Ok(names); }
    for entry in fs::read_dir(&paths.flows_dir).map_err(|e| e.to_string())? {
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
fn get_flow_details(flow_name: String, app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let path = paths.flows_dir.join(&flow_name).join("flow.json");
    if !path.exists() {
        return Err(format!("flow.json not found for '{}'", flow_name));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_flow(flow_name: String, content: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let paths = resolve_paths(&app_handle)?;
    let dir_path = paths.flows_dir.join(&flow_name);
    if !dir_path.exists() {
        fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
    }
    let path = dir_path.join("flow.json");
    let _: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn capture_screen(device_id: String, flow_name: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let paths = resolve_paths(&app_handle)?;
    let flow_dir = paths.flows_dir.join(&flow_name);
    if !flow_dir.exists() {
        fs::create_dir_all(&flow_dir).map_err(|e| e.to_string())?;
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let filename = format!("screenshot_{}.png", ts);
    let output_path = flow_dir.join(&filename);

    let result = Command::new(&paths.adb_bin)
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
fn list_flow_images(flow_name: String, app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let paths = resolve_paths(&app_handle)?;
    let flow_dir = paths.flows_dir.join(&flow_name);
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
fn get_config(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let path = paths.data_dir.join("config.json");
    if !path.exists() {
        return Ok(serde_json::json!({
            "onboarding_completed": false,
            "selected_platforms": []
        }));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: serde_json::Value, app_handle: tauri::AppHandle) -> Result<(), String> {
    let paths = resolve_paths(&app_handle)?;
    let config_path = paths.data_dir.join("config.json");
    if !paths.data_dir.exists() {
        fs::create_dir_all(&paths.data_dir).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_history(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let path = paths.data_dir.join("history.json");
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn append_history(records: Vec<serde_json::Value>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let paths = resolve_paths(&app_handle)?;
    let path = paths.data_dir.join("history.json");
    if !paths.data_dir.exists() {
        fs::create_dir_all(&paths.data_dir).map_err(|e| e.to_string())?;
    }
    let mut history: Vec<serde_json::Value> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    history.extend(records);
    let content = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn check_device_health(device_id: String, app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    // Check connection
    let state_output = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("get-state")
        .output()
        .map_err(|e| format!("adb failed: {}", e))?;
    let connected = String::from_utf8_lossy(&state_output.stdout).trim().contains("device");

    if !connected {
        return Ok(serde_json::json!({
            "connected": false,
            "battery": null,
            "brand": null,
            "model": null,
            "android_version": null,
            "screen_resolution": null
        }));
    }

    // Helper to run adb shell getprop
    let getprop = |prop: &str| -> Option<String> {
        Command::new(&paths.adb_bin)
            .arg("-s").arg(&device_id)
            .arg("shell").arg(format!("getprop {}", prop))
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    };

    // Battery level
    let battery: Option<i64> = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("shell").arg("dumpsys battery")
        .output()
        .ok()
        .and_then(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.lines()
                .find(|l| l.trim().starts_with("level:"))
                .and_then(|l| l.split(':').nth(1))
                .and_then(|v| v.trim().parse().ok())
        });

    // Device info via getprop
    let brand = getprop("ro.product.brand");
    let model = getprop("ro.product.model");
    let android_version = getprop("ro.build.version.release");

    // Screen resolution
    let screen_resolution: Option<String> = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("shell").arg("wm size")
        .output()
        .ok()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.trim().replace("Physical size: ", "").to_string()
        })
        .filter(|s| !s.is_empty());

    Ok(serde_json::json!({
        "connected": connected,
        "battery": battery,
        "brand": brand,
        "model": model,
        "android_version": android_version,
        "screen_resolution": screen_resolution
    }))
}

#[tauri::command]
fn list_devices(app_handle: tauri::AppHandle) -> Result<Vec<Vec<String>>, String> {
    let paths = resolve_paths(&app_handle)?;
    let output = Command::new(&paths.adb_bin)
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
        if rest.starts_with("offline") || rest.starts_with("unauthorized") { continue; }
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
    let paths = resolve_paths(&app_handle)?;
    let flow_path = paths.flows_dir.join(&flow_name);
    let engine_script = &paths.engine_script;

    if !flow_path.exists() { return Err(format!("Flow '{}' not found", flow_name)); }
    if !engine_script.exists() { return Err("engine.py not found".to_string()); }

    let flow_str = flow_path.to_str().ok_or("Invalid path")?.to_string();
    let engine_str = engine_script.to_str().ok_or("Invalid path")?.to_string();
    let python_str = paths.python_bin.to_str().ok_or("Invalid path")?.to_string();
    let adb_str = paths.adb_bin.to_str().ok_or("Invalid path")?.to_string();
    let count = device_ids.len();

    let _ = app_handle.emit("engine-log",
        format!("[SYSTEM] Starting automation on {} device(s)...", count));

    for device_id in device_ids {
        let app = app_handle.clone();
        let engine = engine_str.clone();
        let flow = flow_str.clone();
        let python = python_str.clone();
        let adb = adb_str.clone();
        let v = vars.clone();
        let dev = device_id.clone();
        let short = if dev.len() > 8 { dev[dev.len()-6..].to_string() } else { dev.clone() };

        std::thread::spawn(move || {
            let _ = app.emit("engine-log",
                format!("[{}] Spawning engine...", short));

            let child = Command::new(&python)
                .arg(&engine)
                .arg("--device").arg(&dev)
                .arg("--flow_path").arg(&flow)
                .arg("--vars").arg(&v)
                .arg("--adb_path").arg(&adb)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();

            match child {
                Ok(mut process) => {
                    let pid = process.id();
                    if let Ok(mut pids) = RUNNING_PIDS.lock() { pids.push(pid); }

                    if let Some(stdout) = process.stdout.take() {
                        let reader = BufReader::new(stdout);
                        for line in reader.lines().map_while(Result::ok) {
                            let tagged = format!("[{}] {}", short, line);
                            let _ = app.emit("engine-log", &tagged);
                        }
                    }
                    match process.wait() {
                        Ok(s) => {
                            if let Ok(mut pids) = RUNNING_PIDS.lock() { pids.retain(|&p| p != pid); }
                            let msg = if s.success() {
                                format!("[{}] Engine finished successfully", short)
                            } else {
                                format!("[{}] Engine exited with code: {}", short, s)
                            };
                            let _ = app.emit("engine-log", &msg);
                        }
                        Err(e) => {
                            if let Ok(mut pids) = RUNNING_PIDS.lock() { pids.retain(|&p| p != pid); }
                            let _ = app.emit("engine-log", format!("[{}] ERROR: {}", short, e));
                        }
                    }
                }
                Err(e) => { let _ = app.emit("engine-log", format!("[{}] ERROR: Spawn failed: {}", short, e)); }
            }
        });
    }

    Ok(format!("{} engine(s) started", count))
}

#[tauri::command]
fn stop_automation(app_handle: tauri::AppHandle) -> Result<String, String> {
    let pids = if let Ok(mut pids) = RUNNING_PIDS.lock() {
        let snapshot = pids.clone();
        pids.clear();
        snapshot
    } else {
        return Err("Could not access process list".to_string());
    };

    if pids.is_empty() {
        return Ok("No running engines".to_string());
    }

    let count = pids.len();
    for pid in &pids {
        // Kill process tree: kill the python process and its children
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(*pid as i32, libc::SIGTERM);
            }
            // Also kill process group to catch child ADB processes
            unsafe {
                libc::kill(-(*pid as i32), libc::SIGTERM);
            }
        }
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(&["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
    }

    let _ = app_handle.emit("engine-log",
        format!("[SYSTEM] Stopped {} engine(s)", count));
    let _ = app_handle.emit("engine-stopped", count);

    Ok(format!("{} engine(s) stopped", count))
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
            start_automation,
            get_config,
            save_config,
            get_history,
            append_history,
            check_device_health,
            stop_automation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
