use reqwest::{redirect::Policy, Client, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::HashSet,
    error::Error,
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const GAMEFLOW_PATH: &str = "/lol-gameflow/v1/session";
const SUMMONER_PATH_PREFIX: &str = "/lol-summoner/v1/summoners/";
const MAX_LOCKFILE_BYTES: u64 = 4_096;
const MAX_RESPONSE_BYTES: usize = 1_048_576;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeLeagueClientError {
    code: &'static str,
    status: Option<u16>,
    message: &'static str,
}

impl SafeLeagueClientError {
    fn new(code: &'static str, status: Option<u16>) -> Self {
        let message = match code {
            "no-session" => "League Client is connected, but no gameflow session is available.",
            "malformed-response" => "League Client returned an unexpected gameflow response.",
            "lockfile-unavailable" => "The League Client lockfile is unavailable.",
            "tls-failure" => "The local League Client HTTPS connection failed during TLS.",
            "summoner-resolution-failed" => {
                "The League Client summoner identity could not be resolved."
            }
            _ => "The local League Client connection is unavailable.",
        };
        Self {
            code,
            status,
            message,
        }
    }
}

struct LockfileConnection {
    pid: u32,
    port: u16,
    password: SecretString,
}

struct RunningClientProcess {
    name: String,
    pid: u32,
    executable_path: Option<PathBuf>,
}

fn prioritized_lockfiles(processes: Vec<RunningClientProcess>) -> (Vec<PathBuf>, HashSet<u32>) {
    let mut supported: Vec<_> = processes
        .into_iter()
        .filter(|process| {
            process.name.eq_ignore_ascii_case("LeagueClientUx.exe")
                || process.name.eq_ignore_ascii_case("LeagueClient.exe")
        })
        .collect();
    supported.sort_by_key(|process| {
        if process.name.eq_ignore_ascii_case("LeagueClientUx.exe") {
            0
        } else {
            1
        }
    });
    let pids = supported.iter().map(|process| process.pid).collect();
    let mut paths = Vec::new();
    for process in supported {
        if let Some(directory) = process
            .executable_path
            .as_deref()
            .and_then(|path| path.parent())
        {
            let lockfile = directory.join("lockfile");
            if !paths.contains(&lockfile) {
                paths.push(lockfile);
            }
        }
    }
    (paths, pids)
}

fn parse_lockfile(value: &str) -> Result<LockfileConnection, SafeLeagueClientError> {
    let fields: Vec<_> = value.trim().split(':').collect();
    if fields.len() != 5
        || !fields[0].starts_with("LeagueClient")
        || fields[4] != "https"
        || fields[3].is_empty()
    {
        return Err(SafeLeagueClientError::new("client-unavailable", None));
    }
    let pid = fields[1]
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| SafeLeagueClientError::new("client-unavailable", None))?;
    let port = fields[2]
        .parse::<u16>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| SafeLeagueClientError::new("client-unavailable", None))?;
    Ok(LockfileConnection {
        pid,
        port,
        password: SecretString::from(fields[3].to_owned()),
    })
}

#[cfg(target_os = "windows")]
fn running_client_lockfiles() -> (Vec<PathBuf>, HashSet<u32>) {
    use std::{mem::size_of, os::windows::ffi::OsStringExt};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return (Vec::new(), HashSet::new());
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut processes = Vec::new();
    let mut available = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while available {
        let end = entry
            .szExeFile
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(entry.szExeFile.len());
        let executable = String::from_utf16_lossy(&entry.szExeFile[..end]);
        if executable.eq_ignore_ascii_case("LeagueClientUx.exe")
            || executable.eq_ignore_ascii_case("LeagueClient.exe")
        {
            let mut executable_path = None;
            let process =
                unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
            if !process.is_null() {
                let mut buffer = vec![0u16; 32_768];
                let mut length = buffer.len() as u32;
                if unsafe {
                    QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length)
                } != 0
                {
                    executable_path = Some(PathBuf::from(std::ffi::OsString::from_wide(
                        &buffer[..length as usize],
                    )));
                }
                unsafe { CloseHandle(process) };
            }
            processes.push(RunningClientProcess {
                name: executable,
                pid: entry.th32ProcessID,
                executable_path,
            });
        }
        available = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    prioritized_lockfiles(processes)
}

#[cfg(not(target_os = "windows"))]
fn running_client_lockfiles() -> (Vec<PathBuf>, HashSet<u32>) {
    (Vec::new(), HashSet::new())
}

fn locate_connection() -> Result<LockfileConnection, SafeLeagueClientError> {
    let (paths, running_pids) = running_client_lockfiles();
    for path in paths.into_iter().take(4) {
        let metadata = match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() && metadata.len() <= MAX_LOCKFILE_BYTES => metadata,
            _ => continue,
        };
        let _ = metadata;
        let raw = match fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let connection = match parse_lockfile(&raw) {
            Ok(connection) => connection,
            Err(_) => continue,
        };
        if running_pids.contains(&connection.pid) {
            return Ok(connection);
        }
    }
    Err(SafeLeagueClientError::new("lockfile-unavailable", None))
}

fn copy_allowed_fields(value: &Value, allowed: &[&str]) -> Value {
    let Some(source) = value.as_object() else {
        return value.clone();
    };
    let mut safe = Map::new();
    for key in allowed {
        if let Some(value) = source.get(*key) {
            if value.is_string() || value.is_number() || value.is_null() {
                safe.insert((*key).to_owned(), value.clone());
            }
        }
    }
    Value::Object(safe)
}

fn sanitize_participants(value: Option<&Value>) -> Value {
    const FIELDS: [&str; 8] = [
        "puuid",
        "riotId",
        "riotIdGameName",
        "riotIdTagLine",
        "gameName",
        "tagLine",
        "summonerId",
        "summonerName",
    ];
    Value::Array(
        value
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|participant| copy_allowed_fields(participant, &FIELDS))
            .collect(),
    )
}

fn sanitize_gameflow(value: &Value) -> Result<Value, SafeLeagueClientError> {
    const MARKER_FIELDS: [&str; 9] = [
        "id",
        "queueId",
        "type",
        "gameMode",
        "gameType",
        "mapId",
        "map",
        "description",
        "name",
    ];
    let game_data = value
        .get("gameData")
        .and_then(Value::as_object)
        .ok_or_else(|| SafeLeagueClientError::new("malformed-response", Some(200)))?;
    let mut safe = json!({
        "gameData": {
            "queue": game_data.get("queue").map(|value| copy_allowed_fields(value, &MARKER_FIELDS)).unwrap_or(Value::Null),
            "map": game_data.get("map").map(|value| copy_allowed_fields(value, &MARKER_FIELDS)).unwrap_or(Value::Null),
            "teamOne": sanitize_participants(game_data.get("teamOne")),
            "teamTwo": sanitize_participants(game_data.get("teamTwo")),
        }
    });
    if let Some(phase) = value.get("phase").and_then(Value::as_str) {
        safe["phase"] = Value::String(phase.to_owned());
    }
    Ok(safe)
}

fn sanitize_summoner(value: &Value) -> Result<Value, SafeLeagueClientError> {
    let source = value
        .as_object()
        .ok_or_else(|| SafeLeagueClientError::new("malformed-response", Some(200)))?;
    Ok(copy_allowed_fields(
        &Value::Object(source.clone()),
        &["gameName", "tagLine"],
    ))
}

fn remaining(deadline_epoch_ms: u64) -> Result<Duration, SafeLeagueClientError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if deadline_epoch_ms <= now {
        return Err(SafeLeagueClientError::new("client-unavailable", None));
    }
    Ok(Duration::from_millis(deadline_epoch_ms - now).min(Duration::from_secs(3)))
}

fn loopback_gameflow_url(host: &str, port: u16) -> Result<String, SafeLeagueClientError> {
    if host != "127.0.0.1" || port == 0 {
        return Err(SafeLeagueClientError::new("client-unavailable", None));
    }
    Ok(format!("https://{host}:{port}{GAMEFLOW_PATH}"))
}

fn loopback_summoner_url(
    host: &str,
    port: u16,
    summoner_id: &str,
) -> Result<String, SafeLeagueClientError> {
    let summoner_id = summoner_id.trim();
    if host != "127.0.0.1" || port == 0 || summoner_id.is_empty() || summoner_id.len() > 256 {
        return Err(SafeLeagueClientError::new(
            "summoner-resolution-failed",
            None,
        ));
    }
    Ok(format!(
        "https://{host}:{port}{SUMMONER_PATH_PREFIX}{}",
        urlencoding::encode(summoner_id)
    ))
}

fn dedicated_lcu_client(timeout: Duration) -> Result<Client, SafeLeagueClientError> {
    Client::builder()
        .https_only(true)
        // League LCU uses a local self-signed certificate. This exception belongs only to this
        // dedicated loopback client; RiotState's public-API client keeps normal TLS validation.
        .danger_accept_invalid_certs(true)
        .redirect(Policy::none())
        .no_proxy()
        .timeout(timeout)
        .build()
        .map_err(|_| SafeLeagueClientError::new("client-unavailable", None))
}

fn classify_send_error(error: &reqwest::Error) -> SafeLeagueClientError {
    let mut source = error.source();
    while let Some(cause) = source {
        let message = cause.to_string().to_ascii_lowercase();
        if message.contains("certificate") || message.contains("tls") || message.contains("ssl") {
            return SafeLeagueClientError::new("tls-failure", None);
        }
        source = cause.source();
    }
    SafeLeagueClientError::new("client-unavailable", None)
}

async fn authenticated_lcu_json(
    url: String,
    connection: &LockfileConnection,
    timeout: Duration,
    status_error: &'static str,
    not_found_error: &'static str,
) -> Result<Value, SafeLeagueClientError> {
    let client = dedicated_lcu_client(timeout)?;
    let response = client
        .get(url)
        .basic_auth("riot", Some(connection.password.expose_secret()))
        .send()
        .await
        .map_err(|error| classify_send_error(&error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(SafeLeagueClientError::new(
            if status == StatusCode::NOT_FOUND {
                not_found_error
            } else {
                status_error
            },
            Some(status.as_u16()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size as usize > MAX_RESPONSE_BYTES)
    {
        return Err(SafeLeagueClientError::new(
            "malformed-response",
            Some(status.as_u16()),
        ));
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| SafeLeagueClientError::new(status_error, Some(200)))?;
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(SafeLeagueClientError::new("malformed-response", Some(200)));
    }
    serde_json::from_slice::<Value>(&body)
        .map_err(|_| SafeLeagueClientError::new("malformed-response", Some(200)))
}

#[tauri::command]
pub async fn league_client_gameflow(
    deadline_epoch_ms: u64,
) -> Result<Value, SafeLeagueClientError> {
    let connection = locate_connection()?;
    let timeout = remaining(deadline_epoch_ms)?;
    let url = loopback_gameflow_url("127.0.0.1", connection.port)?;
    let payload = authenticated_lcu_json(
        url,
        &connection,
        timeout,
        "client-unavailable",
        "no-session",
    )
    .await?;
    sanitize_gameflow(&payload)
}

#[tauri::command]
pub async fn league_client_summoner(
    summoner_id: String,
    deadline_epoch_ms: u64,
) -> Result<Value, SafeLeagueClientError> {
    let connection = locate_connection()?;
    let timeout = remaining(deadline_epoch_ms)?;
    let url = loopback_summoner_url("127.0.0.1", connection.port, &summoner_id)?;
    let payload = authenticated_lcu_json(
        url,
        &connection,
        timeout,
        "summoner-resolution-failed",
        "summoner-resolution-failed",
    )
    .await?;
    sanitize_summoner(&payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::generate_simple_self_signed;
    use std::sync::Arc;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    use tokio_rustls::{
        rustls::{pki_types::PrivatePkcs8KeyDer, ServerConfig},
        TlsAcceptor,
    };

    async fn self_signed_server() -> u16 {
        let certificate = generate_simple_self_signed(vec!["127.0.0.1".to_owned()]).unwrap();
        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![certificate.cert.der().clone()],
                PrivatePkcs8KeyDer::from(certificate.key_pair.serialize_der()).into(),
            )
            .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let acceptor = TlsAcceptor::from(Arc::new(config));
            if let Ok(mut stream) = acceptor.accept(stream).await {
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request).await;
                let body = br#"{"phase":"InProgress","gameData":{"queue":{"id":1100,"type":"RANKED_TFT"},"teamOne":[],"teamTwo":[]}}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.write_all(body).await.unwrap();
            }
        });
        port
    }

    #[test]
    fn parses_standard_lockfile_without_serializing_password() {
        let connection = parse_lockfile("LeagueClientUx:1234:5678:fixture-token:https").unwrap();
        assert_eq!(connection.pid, 1234);
        assert_eq!(connection.port, 5678);
        let error =
            serde_json::to_string(&SafeLeagueClientError::new("client-unavailable", Some(401)))
                .unwrap();
        assert!(!error.contains("fixture-token"));
        assert!(!error.contains("lockfile"));
    }

    #[test]
    fn prioritizes_live_league_client_ux_path_and_ignores_riot_client_lockfile() {
        let (paths, pids) = prioritized_lockfiles(vec![
            RunningClientProcess {
                name: "RiotClientServices.exe".to_owned(),
                pid: 9,
                executable_path: Some(PathBuf::from(
                    r"C:\Users\K\AppData\Local\Riot Games\Riot Client\RiotClientServices.exe",
                )),
            },
            RunningClientProcess {
                name: "LeagueClient.exe".to_owned(),
                pid: 10,
                executable_path: Some(PathBuf::from(r"D:\League\LeagueClient.exe")),
            },
            RunningClientProcess {
                name: "LeagueClientUx.exe".to_owned(),
                pid: 11,
                executable_path: Some(PathBuf::from(
                    r"C:\Riot\League of Legends\LeagueClientUx.exe",
                )),
            },
        ]);
        assert_eq!(
            paths,
            vec![
                PathBuf::from(r"C:\Riot\League of Legends\lockfile"),
                PathBuf::from(r"D:\League\lockfile"),
            ]
        );
        assert_eq!(pids, HashSet::from([10, 11]));
        assert!(paths
            .iter()
            .all(|path| !path.to_string_lossy().contains("Riot Client")));
    }

    #[test]
    fn gameflow_url_rejects_every_non_loopback_host() {
        assert_eq!(
            loopback_gameflow_url("127.0.0.1", 1234).unwrap(),
            "https://127.0.0.1:1234/lol-gameflow/v1/session"
        );
        for host in ["localhost", "0.0.0.0", "127.0.0.2", "example.com", "::1"] {
            assert!(loopback_gameflow_url(host, 1234).is_err());
        }
    }

    #[test]
    fn summoner_url_is_fixed_to_loopback_and_encodes_the_identifier_as_one_segment() {
        assert_eq!(
            loopback_summoner_url("127.0.0.1", 1234, "sum/id").unwrap(),
            "https://127.0.0.1:1234/lol-summoner/v1/summoners/sum%2Fid"
        );
        assert!(loopback_summoner_url("example.com", 1234, "summoner-1").is_err());
        assert!(loopback_summoner_url("127.0.0.1", 1234, "").is_err());
    }

    #[test]
    fn summoner_sanitizer_requires_explicit_riot_id_parts_and_drops_local_identifiers() {
        let safe = sanitize_summoner(&json!({
            "gameName": "Canonical Name",
            "tagLine": "TFT",
            "displayName": "must-not-be-used",
            "puuid": "local-value-must-not-cross",
            "futureUnknownField": true
        }))
        .unwrap();
        assert_eq!(
            safe,
            json!({"gameName": "Canonical Name", "tagLine": "TFT"})
        );
        assert!(!safe.to_string().contains("local-value-must-not-cross"));
    }

    #[tokio::test]
    async fn dedicated_lcu_client_accepts_only_its_local_self_signed_tls_exception() {
        let port = self_signed_server().await;
        let response = dedicated_lcu_client(Duration::from_secs(2))
            .unwrap()
            .get(loopback_gameflow_url("127.0.0.1", port).unwrap())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let default_port = self_signed_server().await;
        let default_client = Client::builder()
            .https_only(true)
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        assert!(default_client
            .get(loopback_gameflow_url("127.0.0.1", default_port).unwrap())
            .send()
            .await
            .is_err());
    }

    #[test]
    fn gameflow_sanitizer_accepts_exact_live_participants_and_keeps_only_discovery_fields() {
        let participants: Vec<Value> = (0..8)
            .map(|index| {
                json!({
                    "championId": 0,
                    "lastSelectedSkinIndex": 0,
                    "profileIconId": 1,
                    "puuid": format!("p{index}"),
                    "selectedPosition": "",
                    "selectedRole": "",
                    "summonerId": format!("summoner-{index}"),
                    "summonerInternalName": format!("internal-{index}"),
                    "summonerName": "",
                    "teamOwner": false,
                    "teamParticipantId": index + 1,
                    "futureUnknownField": {"tolerated": true}
                })
            })
            .collect();
        let safe = sanitize_gameflow(&json!({
            "phase": "InProgress",
            "gameClient": {"unrelated": true},
            "map": {},
            "authToken": "must-not-cross-boundary",
            "gameData": {
                "queue": {"id": 1100, "type": "RANKED_TFT", "secret": "no"},
                "teamOne": participants,
                "teamTwo": [],
                "password": "no"
            }
        }))
        .unwrap();
        let serialized = safe.to_string();
        assert_eq!(safe["gameData"]["teamOne"].as_array().unwrap().len(), 8);
        assert_eq!(safe["gameData"]["teamTwo"].as_array().unwrap().len(), 0);
        assert_eq!(safe["gameData"]["teamOne"][0]["puuid"], "p0");
        assert_eq!(safe["gameData"]["teamOne"][0]["summonerName"], "");
        assert!(!serialized.contains("must-not-cross-boundary"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("championId"));
        assert!(!serialized.contains("futureUnknownField"));
    }

    #[test]
    fn rejects_malformed_lockfiles_and_gameflow() {
        assert!(parse_lockfile("LeagueClientUx:1:2:token:http").is_err());
        assert!(sanitize_gameflow(&json!({"phase": "None"})).is_err());
    }
}
