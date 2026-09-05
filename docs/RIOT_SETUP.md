# Riot / opponent setup

M1 has no live credential reader or authenticated provider. `RIOT_API_KEY` was absent from the task environment. No key values were searched for in files, printed or embedded. No environment variables are required by the app.

1. Request appropriate access via [Riot's Developer Portal](https://developer.riotgames.com/docs/tft).
2. Implement `RiotProvider` at a native/backend boundary. Resolve account routing/platform deliberately. Keep credentials out of `VITE_*`, browser storage, logs, query strings and checked-in files. Document an eventual native environment or OS credential-store reader with that adapter.
3. Normalize completed matches, preserving original match ID, set, patch, PUUID and completion time. Verify new-engine unit-ID joins against real fixtures.
4. Verify official current-game discovery for the target region/client. The contract returns unsupported/not-in-game/unavailable; manual participants are the fallback. Do not substitute protected-process access.
5. Add actual Riot rate-limit pacing, header-driven backoff, cancellation and bounded retries. Three-worker concurrency alone is not a production rate limiter.

## Existing service

`scanLobby` accepts up to seven supplied opponents, targets 15 recent games (10–20 configurable), uses three workers, caches recent indexes for five minutes, globally deduplicates shared matches, and caches immutable match payloads. It enforces a timeout even for a non-cooperative provider and returns partial results.

Profiles exclude other sets, use exponential recency weighting and reduced older-patch weight, and retain source match IDs/versioned derivation. Unit/family/style frequency and family placement are supported. Family/style labels must come from a future classifier or fixtures; the scanner does not invent them. Cold/warm cache, deduplication and timeouts are tested using synthetic fixtures.

The visible lobby panel remains Unavailable until a verified provider is connected. No opponent or personal outcomes are fabricated.

## Storage and next acceptance

SQLite tables establish account, completed-match, recent-index, opponent/personal profile, selected-plan and snapshot shapes. The fixture scanner currently uses the generic repository; route high-volume history to dedicated tables when the native adapter lands.

Next acceptance: verified API fixtures; correct unit-criticality contest weighting; rate-limit and expiry tests; no secret logging; warm-profile display during refresh; measured cold/warm latency at 10 and 20 relevant games; partial output by deadline. Historical tendencies never prove a player's next choice.
