use std::{fs, path::PathBuf};

fn snapshot_path() -> Result<PathBuf, String> {
    let root = std::env::var_os("LOCALAPPDATA").ok_or("Local application storage unavailable")?;
    Ok(PathBuf::from(root).join("TFT Strategist/external-data/metatft/current.json"))
}

#[tauri::command]
pub fn external_meta_snapshot() -> Result<String, String> {
    let path = snapshot_path()?;
    if fs::metadata(&path)
        .map_err(|_| "No external snapshot")?
        .len()
        > 10_000_000
    {
        return Err("External snapshot exceeds size limit".into());
    }
    fs::read_to_string(path).map_err(|_| "External snapshot unavailable".into())
}

#[tauri::command]
pub async fn refresh_external_meta() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Project directory unavailable")?
            .to_path_buf();
        if !project.join("scripts/metatft-refresh.ts").is_file() {
            return Err("Collector installation unavailable; run Refresh MetaTFT Data.cmd in the project folder".into());
        }
        let mut command = std::process::Command::new("cmd.exe");
        command.args(["/d", "/c", "npm.cmd run metatft:refresh"]).current_dir(project);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let result = command.output().map_err(|_| "Collector could not start")?;
        if !result.status.success() {
            return Err("Public collection failed; last good snapshot retained. See external-data/metatft/diagnostics in local application storage.".into());
        }
        external_meta_snapshot()
    }).await.map_err(|_| "Collector task failed")?
}

#[tauri::command]
pub fn external_meta_history() -> Result<String, String> {
    let path = snapshot_path()?.with_file_name("history.json");
    if fs::metadata(&path)
        .map_err(|_| "No external history")?
        .len()
        > 10_000_000
    {
        return Err("External history exceeds size limit".into());
    }
    fs::read_to_string(path).map_err(|_| "External history unavailable".into())
}
