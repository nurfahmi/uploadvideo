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
    // Tauri 2 places resources in the resource_dir root
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let python_bin = if cfg!(target_os = "windows") {
            resource_dir.join("resources").join("python").join("python.exe")
        } else {
            resource_dir.join("resources").join("python").join("bin").join("python3")
        };
        let adb_bin = if cfg!(target_os = "windows") {
            resource_dir.join("resources").join("adb").join("adb.exe")
        } else {
            resource_dir.join("resources").join("adb").join("adb")
        };
        let engine_script = resource_dir.join("resources").join("engine").join("engine.py");

        if python_bin.exists() && engine_script.exists() {
            // Production: flows + config in app_data_dir (writable)
            let data_dir = app_handle.path().app_data_dir()
                .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
            let flows_dir = data_dir.join("flows");

            // First launch: create flows dir + copy templates from bundle
            if !flows_dir.exists() {
                fs::create_dir_all(&flows_dir).map_err(|e| e.to_string())?;
                let bundled_flows = resource_dir.join("resources").join("flows");
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
            // Dev mode: prefer venv python if available
            let venv_python = data_dir.join(".venv").join("bin").join("python3");
            let python_bin = if venv_python.exists() {
                venv_python
            } else {
                PathBuf::from("python3")
            };
            return Ok(AppPaths {
                python_bin,
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

// ── Recorder commands (Sprint 1) ──────────────────────────

#[tauri::command]
fn recorder_screenshot(device_id: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let t0 = std::time::Instant::now();
    let paths = resolve_paths(&app_handle)?;
    let result = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("exec-out").arg("screencap").arg("-p")
        .stdout(Stdio::piped())
        .output()
        .map_err(|e| format!("adb failed: {}", e))?;
    let adb_ms = t0.elapsed().as_millis();
    if result.stdout.is_empty() {
        return Err("Screenshot empty — device connected?".to_string());
    }
    let png_size = result.stdout.len();
    let t1 = std::time::Instant::now();
    use base64::Engine as _;
    use image::ImageReader;
    use std::io::Cursor;
    let img = ImageReader::new(Cursor::new(&result.stdout))
        .with_guessed_format()
        .map_err(|e| format!("decode format: {}", e))?
        .decode()
        .map_err(|e| format!("decode image: {}", e))?;
    let rgb = img.to_rgb8();
    let mut jpeg_bytes: Vec<u8> = Vec::with_capacity(rgb.len() / 8);
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, 70);
    encoder
        .encode(&rgb, img.width(), img.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("jpeg encode: {}", e))?;
    let jpeg_size = jpeg_bytes.len();
    let encode_ms = t1.elapsed().as_millis();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
    if adb_ms > 400 || encode_ms > 100 {
        let _ = app_handle.emit("recorder:log",
            format!("[rust] screenshot adb={}ms encode={}ms png={}KB jpeg={}KB",
                adb_ms, encode_ms, png_size / 1024, jpeg_size / 1024));
    }
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
fn recorder_open_mirror_window(
    device_id: String,
    width: f64,
    height: f64,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::WebviewUrl;
    let label = "mirror";
    // Always destroy any existing "mirror" window first to avoid stale refs
    if let Some(w) = app_handle.get_webview_window(label) {
        let _ = w.destroy();
        // small delay so Tauri cleans up fully before recreating
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    let url = format!("mirror.html?device={}", device_id);
    let builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        label,
        WebviewUrl::App(url.into()),
    )
    .title("Device Mirror")
    .inner_size(width, height)
    .min_inner_size(200.0, 400.0)
    .resizable(true)
    .always_on_top(true);
    builder.build().map_err(|e| format!("window create: {}", e))?;
    Ok(())
}

#[tauri::command]
fn recorder_type_text(
    device_id: String,
    selector: serde_json::Value,
    text: String,
    clear: Option<bool>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use std::io::Write;
    let paths = resolve_paths(&app_handle)?;
    let helper = paths.engine_script.parent()
        .ok_or("engine dir missing")?
        .join("recorder_helper.py");
    if !helper.exists() {
        return Err("recorder_helper.py not found".to_string());
    }
    let mut child = Command::new(&paths.python_bin)
        .arg(&helper).arg("type")
        .arg(&device_id)
        .arg(paths.adb_bin.to_str().unwrap_or("adb"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn python: {}", e))?;
    let payload = serde_json::json!({
        "selector": selector,
        "text": text,
        "clear": clear.unwrap_or(true),
    });
    if let Some(stdin) = child.stdin.take() {
        let mut stdin = stdin;
        stdin.write_all(payload.to_string().as_bytes())
            .map_err(|e| format!("write stdin: {}", e))?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("helper failed: stdout={} stderr={}", stdout.trim(), stderr.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|e| format!("parse: {} — output: {}", e, stdout))
}

/// Run pre-flight checks (battery, storage, video, URL, limits) before engine starts.
/// Returns structured JSON that UI renders as check-list.
#[tauri::command]
fn prerun_check(
    device_id: String,
    item: serde_json::Value,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let helper = paths.engine_script.parent()
        .ok_or("engine dir missing")?
        .join("prerun_check.py");
    if !helper.exists() {
        return Err("prerun_check.py not found".to_string());
    }
    let out = Command::new(&paths.python_bin)
        .arg(&helper)
        .arg(&device_id)
        .arg(paths.adb_bin.to_str().unwrap_or("adb"))
        .arg(item.to_string())
        .output()
        .map_err(|e| format!("spawn: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str(stdout.trim()).map_err(|e| format!("parse: {} — {}", e, stdout))
}

/// Update template health metadata (success/failure counter + last run timestamp).
/// Called from frontend after engine finishes.
#[tauri::command]
fn template_record_health(
    template_name: String,
    success: bool,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let dir = templates_dir(&app_handle)?;
    let path = dir.join(format!("{}.json", template_name));
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut doc: serde_json::Value = serde_json::from_str(&s).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let health = doc.get("health").cloned().unwrap_or(serde_json::json!({
        "runs": 0, "success": 0, "last_run": 0, "last_failure": 0
    }));
    let mut h = health.as_object().cloned().unwrap_or_default();
    let runs = h.get("runs").and_then(|v| v.as_u64()).unwrap_or(0) + 1;
    let succ = h.get("success").and_then(|v| v.as_u64()).unwrap_or(0)
        + if success { 1 } else { 0 };
    h.insert("runs".into(), serde_json::json!(runs));
    h.insert("success".into(), serde_json::json!(succ));
    h.insert("last_run".into(), serde_json::json!(now));
    if !success {
        h.insert("last_failure".into(), serde_json::json!(now));
    }
    doc.as_object_mut().ok_or("not object")?
        .insert("health".into(), serde_json::Value::Object(h));
    fs::write(&path, serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Detect device profile for smart template matching. Queries ADB for
/// brand/model/OS version and Shopee app version in a single call.
#[tauri::command]
fn device_detect_profile(device_id: String, app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let prop = |key: &str| -> String {
        Command::new(&paths.adb_bin)
            .args(["-s", &device_id, "shell", "getprop", key])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };
    let brand = prop("ro.product.brand");
    let model = prop("ro.product.model");
    let os_version = prop("ro.build.version.release");
    let sdk = prop("ro.build.version.sdk");
    let (width, height) = fetch_wm_size(&paths.adb_bin, &device_id).unwrap_or((0, 0));

    // Shopee app version via dumpsys package
    let app_version = Command::new(&paths.adb_bin)
        .args(["-s", &device_id, "shell", "dumpsys", "package", "com.shopee.id"])
        .output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.lines()
            .find(|l| l.trim_start().starts_with("versionName="))
            .map(|l| l.trim_start().trim_start_matches("versionName=").trim().to_string()))
        .unwrap_or_default();

    Ok(serde_json::json!({
        "brand": brand,
        "model": model,
        "os_version": os_version,
        "sdk": sdk,
        "resolution": { "width": width, "height": height },
        "shopee_version": app_version,
    }))
}

#[tauri::command]
fn engine_send_signal(signal: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let sig_file = data_dir.join("engine_control.txt");
    let allowed = ["resume", "skip", "abort"];
    let s = signal.trim().to_lowercase();
    if !allowed.contains(&s.as_str()) {
        return Err(format!("signal must be one of: {:?}", allowed));
    }
    fs::write(&sig_file, &s).map_err(|e| e.to_string())
}

#[tauri::command]
fn recorder_screen_info(device_id: String, app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let out = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("shell").arg("wm").arg("size")
        .output()
        .map_err(|e| format!("adb failed: {}", e))?;
    let s = String::from_utf8_lossy(&out.stdout);
    // Parse "Physical size: 720x1612"
    for line in s.lines() {
        if let Some(idx) = line.find(':') {
            let val = line[idx + 1..].trim();
            if let Some((w, h)) = val.split_once('x') {
                if let (Ok(w), Ok(h)) = (w.trim().parse::<i32>(), h.trim().parse::<i32>()) {
                    return Ok(serde_json::json!({ "width": w, "height": h }));
                }
            }
        }
    }
    Err(format!("could not parse wm size output: {}", s))
}

#[tauri::command]
fn recorder_close_mirror_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app_handle.get_webview_window("mirror") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn recorder_tap_and_capture(
    device_id: String,
    x: i32,
    y: i32,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let helper = paths.engine_script.parent()
        .ok_or("engine dir missing")?
        .join("recorder_helper.py");
    if !helper.exists() {
        return Err(format!("recorder_helper.py not found at {}", helper.display()));
    }
    let output = Command::new(&paths.python_bin)
        .arg(&helper)
        .arg("tap")
        .arg(&device_id)
        .arg(x.to_string())
        .arg(y.to_string())
        .arg(paths.adb_bin.to_str().unwrap_or("adb"))
        .output()
        .map_err(|e| format!("python helper failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("helper exit non-zero: {}", stderr));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<serde_json::Value>(stdout.trim())
        .map_err(|e| format!("parse helper output: {} — stdout: {}", e, stdout))
}

fn templates_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = data_dir.join("templates");
    if !dir.exists() { fs::create_dir_all(&dir).map_err(|e| e.to_string())?; }
    Ok(dir)
}

#[tauri::command]
fn recorder_save_template(
    name: String,
    data: serde_json::Value,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let dir = templates_dir(&app_handle)?;
    let safe_name = name.trim().chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
        .collect::<String>();
    let path = dir.join(format!("{}.json", safe_name));
    let s = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, s).map_err(|e| e.to_string())
}

#[tauri::command]
fn recorder_list_templates(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = templates_dir(&app_handle)?;
    let mut names: Vec<String> = Vec::new();
    if !dir.exists() { return Ok(names); }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    Ok(names)
}

#[tauri::command]
fn recorder_get_template(name: String, app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = templates_dir(&app_handle)?;
    let path = dir.join(format!("{}.json", name));
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

#[tauri::command]
fn recorder_delete_template(name: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = templates_dir(&app_handle)?;
    let path = dir.join(format!("{}.json", name));
    if !path.exists() { return Err(format!("not found: {}", name)); }
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Run an arbitrary `adb shell` command on a device. Used by the recorder
/// to force-stop and re-launch the target app before recording starts — far
/// cheaper than spawning a Python helper just for kill+launch (no u2
/// initialization overhead, ~150ms vs ~2s).
#[tauri::command]
fn adb_shell(
    device_id: String,
    command: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let paths = resolve_paths(&app_handle)?;
    let output = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("shell").arg(&command)
        .output()
        .map_err(|e| format!("adb shell failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("exit {}: {}", output.status, stderr.trim()));
    }
    Ok(stdout)
}

/// Suggest the next available "_copy" slot name for a template (used by
/// Duplicate). Checks for `_copy`, `_copy2`, `_copy3` … so the caller knows
/// what safe filename to pass back into `recorder_save_template`.
#[tauri::command]
fn recorder_next_copy_name(
    source_name: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let dir = templates_dir(&app_handle)?;
    let src = dir.join(format!("{}.json", source_name));
    if !src.exists() { return Err(format!("source not found: {}", source_name)); }
    let mut candidate = format!("{}_copy", source_name);
    let mut n = 2;
    while dir.join(format!("{}.json", candidate)).exists() {
        candidate = format!("{}_copy{}", source_name, n);
        n += 1;
        if n > 100 { return Err("too many copies".to_string()); }
    }
    Ok(candidate)
}

/// Rename a template file on disk. Also updates the `name` field inside the
/// JSON so the template stays internally consistent. Rejects if target name
/// already exists.
///
/// Uses `fs::rename` + in-place write (instead of write-then-delete) to avoid
/// data loss on case-insensitive filesystems (macOS APFS default): a case-only
/// change like "foo" → "Foo" points to the same underlying file, and a naive
/// write-then-delete sequence ends up deleting the just-written data.
#[tauri::command]
fn recorder_rename_template(
    old_name: String,
    new_name: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let dir = templates_dir(&app_handle)?;
    // Allow alphanumeric, space, dash, underscore, and dot. Trim outer whitespace
    // so "  Itel Baru  " becomes "Itel Baru" (avoids invisible-trim bugs).
    let safe_new = new_name.trim().chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
        .collect::<String>();
    if safe_new.is_empty() { return Err("new name is empty".to_string()); }
    if safe_new == old_name { return Ok(()); }
    let src = dir.join(format!("{}.json", old_name));
    let dst = dir.join(format!("{}.json", safe_new));
    if !src.exists() { return Err(format!("not found: {}", old_name)); }

    // Detect case-only change: on case-insensitive filesystems, dst.exists() is
    // true but both names refer to the same file. Compare canonicalized paths
    // to distinguish a genuine conflict from a case-only rename.
    let case_only = old_name.to_lowercase() == safe_new.to_lowercase();
    if dst.exists() && !case_only {
        return Err(format!("already exists: {}", safe_new));
    }

    // Atomic rename (same FS, preserves/updates case correctly on APFS)
    fs::rename(&src, &dst).map_err(|e| format!("rename: {}", e))?;

    // Now update the internal `name` field in-place on the renamed file
    let content = fs::read_to_string(&dst).map_err(|e| format!("read: {}", e))?;
    let mut v: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("parse: {}", e))?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert("name".into(), serde_json::Value::String(safe_new.clone()));
    }
    let updated = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(&dst, updated).map_err(|e| format!("write: {}", e))?;
    Ok(())
}

/// Writes arbitrary text content to a user-chosen path. Used by CSV template
/// export from the Job page — after the user picks a location via save dialog.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("create parent: {}", e))?;
        }
    }
    fs::write(&p, content).map_err(|e| format!("write file: {}", e))
}

/// Reads text content from a user-chosen path. Used by template JSON import
/// after the user picks a .json file via open dialog.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    fs::read_to_string(&p).map_err(|e| format!("read file: {}", e))
}

/// Returns a recommended default path for saving exported files. Goes to
/// ~/Documents/AutoFlow/<filename> (creates the folder if missing).
#[tauri::command]
fn default_export_path(filename: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let home = app_handle.path().home_dir().map_err(|e| e.to_string())?;
    let dir = home.join("Documents").join("AutoFlow");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    Ok(dir.join(filename).to_string_lossy().to_string())
}

fn fetch_wm_size(adb_bin: &PathBuf, device_id: &str) -> Option<(i32, i32)> {
    let out = Command::new(adb_bin)
        .arg("-s").arg(device_id)
        .arg("shell").arg("wm").arg("size")
        .output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    for line in s.lines() {
        if let Some(idx) = line.find(':') {
            let val = line[idx + 1..].trim();
            if let Some((w, h)) = val.split_once('x') {
                if let (Ok(w), Ok(h)) = (w.trim().parse::<i32>(), h.trim().parse::<i32>()) {
                    return Some((w, h));
                }
            }
        }
    }
    None
}

#[tauri::command]
fn recorder_convert_template_to_flow(
    template_name: String,
    flow_name: String,
    device_id: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let tdir = templates_dir(&app_handle)?;
    let tpath = tdir.join(format!("{}.json", template_name));
    if !tpath.exists() {
        return Err(format!("template not found: {}", template_name));
    }
    let helper = paths.engine_script.parent()
        .ok_or("engine dir missing")?
        .join("template_converter.py");
    if !helper.exists() {
        return Err(format!("template_converter.py not found at {}", helper.display()));
    }
    let safe_flow = flow_name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let flow_dir = paths.flows_dir.join(&safe_flow);
    let mut cmd = Command::new(&paths.python_bin);
    cmd.arg(&helper).arg(&tpath).arg(&flow_dir);
    // If device_id given, fetch wm size and append as target args — enables
    // smart scaling per target device at convert time.
    if let Some(ref did) = device_id {
        if let Some((w, h)) = fetch_wm_size(&paths.adb_bin, did) {
            cmd.arg(w.to_string()).arg(h.to_string());
        }
    }
    let output = cmd.output().map_err(|e| format!("spawn converter: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("converter failed: {}", stderr));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse converter output: {} — {}", e, stdout))?;
    let mut r = result.as_object().cloned().unwrap_or_default();
    r.insert("flow_name".into(), serde_json::Value::String(safe_flow));
    Ok(serde_json::Value::Object(r))
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
fn get_queue(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_paths(&app_handle)?;
    let path = paths.data_dir.join("queue.json");
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_queue(items: Vec<serde_json::Value>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let paths = resolve_paths(&app_handle)?;
    if !paths.data_dir.exists() {
        fs::create_dir_all(&paths.data_dir).map_err(|e| e.to_string())?;
    }
    let path = paths.data_dir.join("queue.json");
    let content = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_history(app_handle: tauri::AppHandle) -> Result<(), String> {
    let paths = resolve_paths(&app_handle)?;
    let path = paths.data_dir.join("history.json");
    fs::write(&path, "[]").map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_history_record(record_id: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let paths = resolve_paths(&app_handle)?;
    let path = paths.data_dir.join("history.json");
    if !path.exists() { return Ok(()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut history: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap_or_default();
    history.retain(|h| h.get("id").and_then(|v| v.as_str()) != Some(&record_id));
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

    // Network info: wifi SSID + signal + IP
    let wifi_ssid: Option<String> = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("shell").arg("dumpsys wifi | grep 'mWifiInfo'")
        .output()
        .ok()
        .and_then(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            // Extract SSID from mWifiInfo line
            stdout.find("SSID: ").map(|pos| {
                let after = &stdout[pos + 6..];
                after.split(',').next().unwrap_or("").trim().trim_matches('"').to_string()
            })
        })
        .filter(|s| !s.is_empty() && s != "<unknown ssid>");

    let wifi_ip: Option<String> = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("shell").arg("ip route | grep wlan0 | grep src")
        .output()
        .ok()
        .and_then(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            stdout.split_whitespace()
                .skip_while(|w| *w != "src")
                .nth(1)
                .map(|s| s.to_string())
        })
        .filter(|s| !s.is_empty());

    // Mobile data type (LTE/5G/3G)
    let network_type: Option<String> = Command::new(&paths.adb_bin)
        .arg("-s").arg(&device_id)
        .arg("shell").arg("getprop gsm.network.type")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    let sim_operator: Option<String> = getprop("gsm.sim.operator.alpha");

    Ok(serde_json::json!({
        "connected": connected,
        "battery": battery,
        "brand": brand,
        "model": model,
        "android_version": android_version,
        "screen_resolution": screen_resolution,
        "wifi_ssid": wifi_ssid,
        "wifi_ip": wifi_ip,
        "network_type": network_type,
        "sim_operator": sim_operator
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

    // Signal file for engine↔UI control (Sprint 4c interruption)
    let signal_file = paths.data_dir.join("engine_control.txt");
    let signal_str = signal_file.to_str().unwrap_or("").to_string();
    // Clean any stale signal
    let _ = fs::remove_file(&signal_file);

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
        let sig = signal_str.clone();
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
                .arg("--signal_file").arg(&sig)
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

/// Build a pro-macOS-style menu bar (File / Edit / View / Window / Help).
/// Most items use `PredefinedMenuItem` so system shortcuts (Cmd+C, Cmd+V,
/// Cmd+Q, Cmd+M, Cmd+W, etc.) work out of the box. Custom items emit events
/// back to the JS layer for navigation (e.g. File → New Template → navigate
/// to recorder).
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, AboutMetadata};

    // Embed the bundle icon at compile time so About dialog shows the brand
    // instead of the generic folder icon. Any PNG in src-tauri/icons works;
    // 128x128@2x is a good compromise between resolution and binary size.
    let icon_bytes = include_bytes!("../icons/128x128@2x.png");
    let icon = tauri::image::Image::from_bytes(icon_bytes).ok();
    let about_meta = AboutMetadata {
        name: Some("AUV".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        copyright: Some("© 2026 indosofthouse".into()),
        icon,
        ..Default::default()
    };

    // Application menu (macOS: appears as "AUV" to the left of File)
    let app_submenu = Submenu::with_items(app, "AUV", true, &[
        &PredefinedMenuItem::about(app, Some("Tentang AUV"), Some(about_meta))?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "menu_settings", "Pengaturan…", true, Some("CmdOrCtrl+,"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::services(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, None)?,
        &PredefinedMenuItem::hide_others(app, None)?,
        &PredefinedMenuItem::show_all(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::quit(app, None)?,
    ])?;

    // File
    let file_submenu = Submenu::with_items(app, "File", true, &[
        &MenuItem::with_id(app, "menu_new_template", "Template Baru", true, Some("CmdOrCtrl+N"))?,
        &MenuItem::with_id(app, "menu_import_csv",   "Impor CSV…",    true, Some("CmdOrCtrl+O"))?,
        &MenuItem::with_id(app, "menu_export_csv",   "Unduh Template CSV", true, Some("CmdOrCtrl+Shift+S"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::close_window(app, None)?,
    ])?;

    // Edit (all native shortcuts — no custom)
    let edit_submenu = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;

    // View — page navigation + native fullscreen
    let view_submenu = Submenu::with_items(app, "View", true, &[
        &MenuItem::with_id(app, "menu_view_devices",  "Perangkat",  true, Some("CmdOrCtrl+1"))?,
        &MenuItem::with_id(app, "menu_view_queue",    "Job",        true, Some("CmdOrCtrl+2"))?,
        &MenuItem::with_id(app, "menu_view_settings", "Pengaturan", true, Some("CmdOrCtrl+3"))?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "menu_toggle_console", "Toggle Konsol", true, Some("CmdOrCtrl+`"))?,
        &MenuItem::with_id(app, "menu_reload",         "Muat Ulang",    true, Some("CmdOrCtrl+R"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::fullscreen(app, None)?,
    ])?;

    // Window
    let window_submenu = Submenu::with_items(app, "Window", true, &[
        &PredefinedMenuItem::minimize(app, None)?,
        &PredefinedMenuItem::maximize(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::close_window(app, None)?,
    ])?;

    // Help
    let help_submenu = Submenu::with_items(app, "Help", true, &[
        &MenuItem::with_id(app, "menu_help_guide",  "Panduan Setup HP",       true, None::<&str>)?,
        &MenuItem::with_id(app, "menu_help_github", "Laporkan Bug di GitHub", true, None::<&str>)?,
    ])?;

    Menu::with_items(app, &[&app_submenu, &file_submenu, &edit_submenu, &view_submenu, &window_submenu, &help_submenu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle();
            let menu = build_app_menu(handle)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // Forward menu clicks to the webview so JS can navigate / run actions
            let _ = app.emit("menu-event", event.id().0.as_str());
        })
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
            stop_automation,
            clear_history,
            delete_history_record,
            get_queue,
            save_queue,
            recorder_screenshot,
            recorder_tap_and_capture,
            recorder_save_template,
            recorder_list_templates,
            recorder_get_template,
            recorder_open_mirror_window,
            recorder_close_mirror_window,
            recorder_screen_info,
            recorder_type_text,
            recorder_convert_template_to_flow,
            engine_send_signal,
            device_detect_profile,
            prerun_check,
            template_record_health,
            recorder_delete_template,
            recorder_rename_template,
            recorder_next_copy_name,
            adb_shell,
            write_text_file,
            read_text_file,
            default_export_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
