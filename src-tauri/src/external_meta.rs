use std::{fs, path::PathBuf};

const SAFE_ERROR_PREFIX: &str = "METATFT_REFRESH_ERROR:";

fn collector_failure(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    text.lines()
        .find_map(|line| line.strip_prefix(SAFE_ERROR_PREFIX))
        .and_then(|line| line.split_once(':').map(|(_, message)| message.trim()))
        .filter(|message| !message.is_empty() && message.len() <= 600)
        .map(str::to_owned)
        .unwrap_or_else(|| "MetaTFT refresh unavailable · using last good snapshot".into())
}

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
            return Err(collector_failure(&result.stderr));
        }
        external_meta_snapshot()
    }).await.map_err(|_| "Collector task failed")?
}

#[cfg(test)]
mod tests {
    use super::collector_failure;

    #[test]
    fn surfaces_only_the_safe_collector_message() {
        let stderr = b"noise with request details\nMETATFT_REFRESH_ERROR:patch-mismatch:MetaTFT currently reports TFT 18.3; Strategist is validated for 18.2. Last good snapshot retained.\nmore noise";
        assert_eq!(
            collector_failure(stderr),
            "MetaTFT currently reports TFT 18.3; Strategist is validated for 18.2. Last good snapshot retained."
        );
    }

    #[test]
    fn uses_a_safe_fallback_for_unstructured_failures() {
        assert_eq!(
            collector_failure(b"cookie=secret"),
            "MetaTFT refresh unavailable · using last good snapshot"
        );
    }
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
