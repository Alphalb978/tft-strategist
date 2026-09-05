use reqwest::{header::HeaderMap, Client, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const RETRYABLE_STATUS: [StatusCode; 4] = [
    StatusCode::INTERNAL_SERVER_ERROR,
    StatusCode::BAD_GATEWAY,
    StatusCode::SERVICE_UNAVAILABLE,
    StatusCode::GATEWAY_TIMEOUT,
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeRiotError {
    code: &'static str,
    status: Option<u16>,
    retryable: bool,
    message: &'static str,
}

impl SafeRiotError {
    fn new(code: &'static str, status: Option<u16>, retryable: bool) -> Self {
        let message = match code {
            "missing-key" => "Riot API access is unavailable in the native process.",
            "invalid-route" => "The selected Riot route is unsupported.",
            "not-found" => "Riot could not find that resource.",
            "auth" => "Riot rejected the native API credential.",
            "rate-limited" => "Riot is rate limiting requests.",
            "transient" => "Riot is temporarily unavailable.",
            "deadline" => "The scouting time budget was reached.",
            "cancelled" => "The Riot request was cancelled.",
            "malformed-response" => "Riot returned an unexpected response shape.",
            _ => "The Riot request is unavailable.",
        };
        Self {
            code,
            status,
            retryable,
            message,
        }
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiotMetrics {
    requests_attempted: u64,
    retries: u64,
    rate_limit_waits: u64,
    rate_limit_wait_ms: u64,
}

#[derive(Clone)]
struct LimitWindow {
    limit: u64,
    count: u64,
    reset_at: Instant,
}

#[derive(Default)]
struct LimiterState {
    app: Vec<LimitWindow>,
    methods: HashMap<String, Vec<LimitWindow>>,
    blocked_until: Option<Instant>,
    method_blocked_until: HashMap<String, Instant>,
    metrics: RiotMetrics,
}

pub struct RiotState {
    client: Client,
    key: Option<SecretString>,
    limiter: Mutex<LimiterState>,
    cancellations: Mutex<HashMap<String, CancellationToken>>,
}

impl RiotState {
    pub fn from_environment() -> Self {
        let key = std::env::var("RIOT_API_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(SecretString::from);
        Self {
            client: Client::builder()
                .https_only(true)
                .build()
                .expect("native HTTPS client should initialize"),
            key,
            limiter: Mutex::new(LimiterState::default()),
            cancellations: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    fn for_test() -> Self {
        Self {
            client: Client::new(),
            key: Some(SecretString::from("RGAPI-test-secret")),
            limiter: Mutex::new(LimiterState::default()),
            cancellations: Mutex::new(HashMap::new()),
        }
    }

    async fn cancel(&self, request_id: &str) {
        if let Some(token) = self.cancellations.lock().await.get(request_id) {
            token.cancel();
        }
    }

    async fn sleep_bounded(
        &self,
        duration: Duration,
        deadline_epoch_ms: u64,
        token: &CancellationToken,
    ) -> Result<(), SafeRiotError> {
        let remaining = remaining(deadline_epoch_ms)?;
        if duration >= remaining {
            return Err(SafeRiotError::new("deadline", None, true));
        }
        tokio::select! {
            _ = token.cancelled() => Err(SafeRiotError::new("cancelled", None, false)),
            _ = tokio::time::sleep(duration) => Ok(()),
        }
    }

    async fn wait_for_budget(
        &self,
        method: &str,
        deadline_epoch_ms: u64,
        token: &CancellationToken,
    ) -> Result<(), SafeRiotError> {
        loop {
            let wait = {
                let now = Instant::now();
                let mut limiter = self.limiter.lock().await;
                limiter.app.retain(|window| window.reset_at > now);
                if let Some(windows) = limiter.methods.get_mut(method) {
                    windows.retain(|window| window.reset_at > now);
                }
                limiter.method_blocked_until.retain(|_, until| *until > now);
                let blocked = limiter
                    .blocked_until
                    .filter(|until| *until > now)
                    .map(|until| until.duration_since(now));
                let method_blocked = limiter
                    .method_blocked_until
                    .get(method)
                    .filter(|until| **until > now)
                    .map(|until| until.duration_since(now));
                let saturated = limiter
                    .app
                    .iter()
                    .chain(limiter.methods.get(method).into_iter().flatten())
                    .filter(|window| window.count >= window.limit)
                    .map(|window| window.reset_at.duration_since(now))
                    .max();
                blocked
                    .into_iter()
                    .chain(method_blocked)
                    .chain(saturated)
                    .max()
            };
            match wait {
                Some(duration) if !duration.is_zero() => {
                    {
                        let mut limiter = self.limiter.lock().await;
                        limiter.metrics.rate_limit_waits += 1;
                        limiter.metrics.rate_limit_wait_ms += duration.as_millis() as u64;
                    }
                    self.sleep_bounded(duration, deadline_epoch_ms, token)
                        .await?;
                }
                _ => return Ok(()),
            }
        }
    }

    async fn observe_headers(&self, method: &str, headers: &HeaderMap) {
        let now = Instant::now();
        let app = parse_limit_headers(headers, "x-app-rate-limit", "x-app-rate-limit-count", now);
        let method_limits = parse_limit_headers(
            headers,
            "x-method-rate-limit",
            "x-method-rate-limit-count",
            now,
        );
        let mut limiter = self.limiter.lock().await;
        if let Some(windows) = app {
            limiter.app = windows;
        }
        if let Some(windows) = method_limits {
            limiter.methods.insert(method.to_owned(), windows);
        }
    }

    async fn get_json(
        &self,
        request_id: String,
        deadline_epoch_ms: u64,
        method: &str,
        url: String,
    ) -> Result<Value, SafeRiotError> {
        let key = self
            .key
            .as_ref()
            .ok_or_else(|| SafeRiotError::new("missing-key", None, false))?;
        let token = CancellationToken::new();
        self.cancellations
            .lock()
            .await
            .insert(request_id.clone(), token.clone());
        let result = async {
            for attempt in 0..3u32 {
                self.wait_for_budget(method, deadline_epoch_ms, &token)
                    .await?;
                {
                    let mut limiter = self.limiter.lock().await;
                    limiter.metrics.requests_attempted += 1;
                    limiter.app.iter_mut().for_each(|window| window.count += 1);
                    if let Some(windows) = limiter.methods.get_mut(method) {
                        windows.iter_mut().for_each(|window| window.count += 1);
                    }
                }
                let send = self
                    .client
                    .get(&url)
                    .header("X-Riot-Token", key.expose_secret())
                    .send();
                let response = tokio::select! {
                    _ = token.cancelled() => return Err(SafeRiotError::new("cancelled", None, false)),
                    value = tokio::time::timeout(remaining(deadline_epoch_ms)?, send) => {
                        match value {
                            Ok(Ok(response)) => response,
                            Ok(Err(_)) => {
                                if attempt < 2 {
                                    self.record_retry().await;
                                    self.retry_backoff(attempt, deadline_epoch_ms, &token).await?;
                                    continue;
                                }
                                return Err(SafeRiotError::new("transient", None, true));
                            }
                            Err(_) => return Err(SafeRiotError::new("deadline", None, true)),
                        }
                    }
                };
                self.observe_headers(method, response.headers()).await;
                let status = response.status();
                if status.is_success() {
                    let body = tokio::select! {
                        _ = token.cancelled() => return Err(SafeRiotError::new("cancelled", None, false)),
                        value = tokio::time::timeout(remaining(deadline_epoch_ms)?, response.bytes()) => {
                            match value {
                                Ok(Ok(bytes)) => bytes,
                                Ok(Err(_)) => return Err(SafeRiotError::new("transient", Some(status.as_u16()), true)),
                                Err(_) => return Err(SafeRiotError::new("deadline", None, true)),
                            }
                        }
                    };
                    return serde_json::from_slice::<Value>(&body).map_err(|_| {
                        SafeRiotError::new("malformed-response", Some(status.as_u16()), false)
                    });
                }
                if status == StatusCode::TOO_MANY_REQUESTS {
                    let wait = retry_after(response.headers()).unwrap_or(Duration::from_secs(1));
                    let method_limited = response
                        .headers()
                        .get("x-rate-limit-type")
                        .and_then(|value| value.to_str().ok())
                        .is_some_and(|value| value.eq_ignore_ascii_case("method"));
                    let mut limiter = self.limiter.lock().await;
                    if method_limited {
                        limiter
                            .method_blocked_until
                            .insert(method.to_owned(), Instant::now() + wait);
                    } else {
                        limiter.blocked_until = Some(Instant::now() + wait);
                    }
                    drop(limiter);
                    if attempt < 2 {
                        self.record_retry().await;
                        continue;
                    }
                    return Err(SafeRiotError::new("rate-limited", Some(429), true));
                }
                if RETRYABLE_STATUS.contains(&status) {
                    if attempt < 2 {
                        self.record_retry().await;
                        self.retry_backoff(attempt, deadline_epoch_ms, &token).await?;
                        continue;
                    }
                    return Err(SafeRiotError::new(
                        "transient",
                        Some(status.as_u16()),
                        true,
                    ));
                }
                return Err(classify_status(status));
            }
            Err(SafeRiotError::new("unavailable", None, false))
        }
        .await;
        self.cancellations.lock().await.remove(&request_id);
        result
    }

    async fn record_retry(&self) {
        self.limiter.lock().await.metrics.retries += 1;
    }

    async fn retry_backoff(
        &self,
        attempt: u32,
        deadline_epoch_ms: u64,
        token: &CancellationToken,
    ) -> Result<(), SafeRiotError> {
        let base_ms = (250u64 * 2u64.pow(attempt)).min(2_000);
        let jitter_ms = fastrand::u64(0..=base_ms / 4);
        self.sleep_bounded(
            Duration::from_millis(base_ms + jitter_ms),
            deadline_epoch_ms,
            token,
        )
        .await
    }
}

fn remaining(deadline_epoch_ms: u64) -> Result<Duration, SafeRiotError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SafeRiotError::new("deadline", None, true))?
        .as_millis() as u64;
    if deadline_epoch_ms <= now {
        return Err(SafeRiotError::new("deadline", None, true));
    }
    Ok(Duration::from_millis(deadline_epoch_ms - now))
}

fn parse_pairs(value: &str) -> Vec<(u64, u64)> {
    value
        .split(',')
        .filter_map(|part| {
            let (first, second) = part.trim().split_once(':')?;
            Some((first.parse().ok()?, second.parse().ok()?))
        })
        .collect()
}

fn parse_limit_headers(
    headers: &HeaderMap,
    limit_name: &str,
    count_name: &str,
    now: Instant,
) -> Option<Vec<LimitWindow>> {
    let limits = parse_pairs(headers.get(limit_name)?.to_str().ok()?);
    let counts = parse_pairs(headers.get(count_name)?.to_str().ok()?);
    if limits.is_empty() {
        return None;
    }
    Some(
        limits
            .into_iter()
            .map(|(limit, seconds)| LimitWindow {
                limit,
                count: counts
                    .iter()
                    .find(|(_, count_seconds)| *count_seconds == seconds)
                    .map(|(count, _)| *count)
                    .unwrap_or(0),
                reset_at: now + Duration::from_secs(seconds),
            })
            .collect(),
    )
}

fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    headers
        .get("retry-after")?
        .to_str()
        .ok()?
        .parse::<f64>()
        .ok()
        .filter(|seconds| *seconds >= 0.0)
        .map(Duration::from_secs_f64)
}

fn classify_status(status: StatusCode) -> SafeRiotError {
    match status {
        StatusCode::NOT_FOUND => SafeRiotError::new("not-found", Some(404), false),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            SafeRiotError::new("auth", Some(status.as_u16()), false)
        }
        StatusCode::BAD_REQUEST
        | StatusCode::METHOD_NOT_ALLOWED
        | StatusCode::UNSUPPORTED_MEDIA_TYPE => {
            SafeRiotError::new("unavailable", Some(status.as_u16()), false)
        }
        _ => SafeRiotError::new("unavailable", Some(status.as_u16()), false),
    }
}

fn regional_host(route: &str) -> Result<&'static str, SafeRiotError> {
    match route {
        "AMERICAS" => Ok("americas.api.riotgames.com"),
        "ASIA" => Ok("asia.api.riotgames.com"),
        "EUROPE" => Ok("europe.api.riotgames.com"),
        "SEA" => Ok("sea.api.riotgames.com"),
        _ => Err(SafeRiotError::new("invalid-route", None, false)),
    }
}

fn platform_host(platform: &str) -> Result<String, SafeRiotError> {
    const PLATFORMS: [&str; 15] = [
        "BR1", "EUN1", "EUW1", "JP1", "KR", "LA1", "LA2", "ME1", "NA1", "OC1", "RU", "SG2", "TR1",
        "TW2", "VN2",
    ];
    if !PLATFORMS.contains(&platform) {
        return Err(SafeRiotError::new("invalid-route", None, false));
    }
    Ok(format!("{}.api.riotgames.com", platform.to_lowercase()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    key_detected: bool,
    source: &'static str,
}

#[tauri::command]
pub fn riot_connection_status(state: tauri::State<'_, RiotState>) -> ConnectionStatus {
    ConnectionStatus {
        key_detected: state.key.is_some(),
        source: if state.key.is_some() {
            "native-environment"
        } else {
            "unavailable"
        },
    }
}

#[tauri::command]
pub async fn riot_metrics(
    state: tauri::State<'_, RiotState>,
) -> Result<RiotMetrics, SafeRiotError> {
    Ok(state.limiter.lock().await.metrics.clone())
}

#[tauri::command]
pub async fn riot_cancel_request(
    state: tauri::State<'_, RiotState>,
    request_id: String,
) -> Result<(), SafeRiotError> {
    state.cancel(&request_id).await;
    Ok(())
}

#[tauri::command]
pub async fn riot_resolve_account(
    state: tauri::State<'_, RiotState>,
    game_name: String,
    tag_line: String,
    regional_route: String,
    request_id: String,
    deadline_epoch_ms: u64,
) -> Result<Value, SafeRiotError> {
    let host = regional_host(&regional_route)?;
    let url = format!(
        "https://{host}/riot/account/v1/accounts/by-riot-id/{}/{}",
        urlencoding::encode(&game_name),
        urlencoding::encode(&tag_line)
    );
    state
        .get_json(request_id, deadline_epoch_ms, "account.by-riot-id", url)
        .await
}

#[tauri::command]
pub async fn riot_account_by_puuid(
    state: tauri::State<'_, RiotState>,
    puuid: String,
    regional_route: String,
    request_id: String,
    deadline_epoch_ms: u64,
) -> Result<Value, SafeRiotError> {
    let host = regional_host(&regional_route)?;
    let url = format!(
        "https://{host}/riot/account/v1/accounts/by-puuid/{}",
        urlencoding::encode(&puuid)
    );
    state
        .get_json(request_id, deadline_epoch_ms, "account.by-puuid", url)
        .await
}

#[tauri::command]
pub async fn riot_recent_match_ids(
    state: tauri::State<'_, RiotState>,
    puuid: String,
    regional_route: String,
    start: u32,
    count: u32,
    request_id: String,
    deadline_epoch_ms: u64,
) -> Result<Value, SafeRiotError> {
    let host = regional_host(&regional_route)?;
    let count = count.clamp(1, 100);
    let url = format!(
        "https://{host}/tft/match/v1/matches/by-puuid/{}/ids?start={start}&count={count}",
        urlencoding::encode(&puuid)
    );
    state
        .get_json(request_id, deadline_epoch_ms, "tft-match.ids", url)
        .await
}

#[tauri::command]
pub async fn riot_completed_match(
    state: tauri::State<'_, RiotState>,
    match_id: String,
    regional_route: String,
    request_id: String,
    deadline_epoch_ms: u64,
) -> Result<Value, SafeRiotError> {
    let host = regional_host(&regional_route)?;
    let url = format!(
        "https://{host}/tft/match/v1/matches/{}",
        urlencoding::encode(&match_id)
    );
    state
        .get_json(request_id, deadline_epoch_ms, "tft-match.detail", url)
        .await
}

#[tauri::command]
pub async fn riot_current_game(
    state: tauri::State<'_, RiotState>,
    puuid: String,
    platform: String,
    request_id: String,
    deadline_epoch_ms: u64,
) -> Result<Value, SafeRiotError> {
    let host = platform_host(&platform)?;
    let url = format!(
        "https://{host}/lol/spectator/tft/v5/active-games/by-puuid/{}",
        urlencoding::encode(&puuid)
    );
    state
        .get_json(request_id, deadline_epoch_ms, "spectator-tft.current", url)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn deadline() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + 5_000
    }

    async fn server(responses: Vec<&'static str>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request).await;
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        format!("http://{address}/test")
    }

    #[test]
    fn errors_serialize_without_secret_or_raw_body() {
        let serialized =
            serde_json::to_string(&SafeRiotError::new("auth", Some(401), false)).unwrap();
        assert!(!serialized.contains("RGAPI-test-secret"));
        assert!(!serialized.contains("response body"));
        assert!(serialized.contains("\"code\":\"auth\""));
    }

    #[test]
    fn parses_application_and_method_windows() {
        let mut headers = HeaderMap::new();
        headers.insert("x-app-rate-limit", "20:1,100:120".parse().unwrap());
        headers.insert("x-app-rate-limit-count", "4:1,44:120".parse().unwrap());
        let windows = parse_limit_headers(
            &headers,
            "x-app-rate-limit",
            "x-app-rate-limit-count",
            Instant::now(),
        )
        .unwrap();
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].limit, 20);
        assert_eq!(windows[1].count, 44);
    }

    #[tokio::test]
    async fn retries_429_and_transient_then_succeeds() {
        let url = server(vec![
            "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 0\r\nX-Rate-Limit-Type: method\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}",
        ])
        .await;
        let state = RiotState::for_test();
        let value = state
            .get_json("retry".into(), deadline(), "test", url)
            .await
            .unwrap();
        assert_eq!(value["ok"], true);
        let metrics = state.limiter.lock().await.metrics.clone();
        assert_eq!(metrics.requests_attempted, 3);
        assert_eq!(metrics.retries, 2);
    }

    #[tokio::test]
    async fn retry_exhaustion_is_bounded_and_safe() {
        let url = server(vec![
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n",
        ])
        .await;
        let state = RiotState::for_test();
        let error = state
            .get_json("exhaust".into(), deadline(), "test", url)
            .await
            .unwrap_err();
        assert_eq!(error.code, "transient");
        assert_eq!(state.limiter.lock().await.metrics.requests_attempted, 3);
    }
}
