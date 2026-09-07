# Riot API setup

M3 uses Riot only through the Tauri/Rust backend. The React application never receives, stores, or serializes the API key.

## Local key

1. Obtain an appropriate key from the [Riot Developer Portal](https://developer.riotgames.com/).
2. Set `RIOT_API_KEY` in the environment of the native process before starting TFT Strategist.
3. Start the native application from that same environment.

PowerShell example for the current terminal only:

```powershell
$env:RIOT_API_KEY = Read-Host -MaskInput "Riot API key"
npm run tauri dev
```

Do not put the key in `.env`, a `VITE_*` variable, a command-line argument, browser storage, SQLite, a URL, a screenshot, or a checked-in fixture. The UI reports only `API key detected` or `API key unavailable`. Native requests authenticate with the `X-Riot-Token` header, and errors are reduced to fixed safe codes before crossing the Tauri boundary.

Riot's portal currently describes development keys as temporary and expiring every 24 hours. That portal policy is not hard-coded; the app treats a missing or rejected key as an ordinary unavailable/auth state.

## Identity and routing

Enter the account as `gameName#tagLine` and select its platform. Unicode names are accepted, surrounding whitespace is removed, and the final `#` separates the name and tag.

Routing is explicit:

- account-v1 uses AMERICAS, ASIA, or EUROPE;
- tft-match-v1 uses AMERICAS, ASIA, EUROPE, or SEA;
- spectator-tft-v5 uses a supported platform host.

For SEA platforms, account lookup uses ASIA because account-v1 exposes only three regional clusters, while match history uses SEA. EUW1 and EUN1 use EUROPE for account and match history. PH2 and TH2 remain valid SEA match-history platforms but current-game discovery is shown as unsupported because the current spectator-tft-v5 reference does not list them. Unknown routes fail as configuration errors.

## Scouting workflow

Configure the user's Riot ID, platform, and a 10, 15, or 20 game target in Data & settings. Manual scouting accepts up to seven newline-, comma-, or semicolon-separated opponent Riot IDs. It is always available and is the reliable fallback.

Automatic discovery uses this fixed priority:

1. Riot `spectator-tft-v5` on a supported platform;
2. the locally running League Client's read-only gameflow session;
3. manual opponent input.

The native League Client fallback prefers the standard lockfile beside a running `LeagueClientUx.exe`, then `LeagueClient.exe`, validates that the lockfile PID is running, and never searches for a Riot Client lockfile. It performs only `GET /lol-gameflow/v1/session` and bounded `GET /lol-summoner/v1/summoners/{summonerId}` identity lookups against the fixed `https://127.0.0.1:<validated-port>` origin with Basic user `riot`, no proxy, no redirects, and a short timeout. A dedicated loopback-only HTTP client accepts the LCU's local self-signed certificate; the public Riot API client retains normal certificate validation. The password and local connection details remain native-process-only.

The live-verified Ranked TFT shape is phase `InProgress`, queue id `1100`, queue type `RANKED_TFT`, an empty/absent map, eight players in `teamOne`, and none in `teamTwo`. Queue id `1100` together with type `RANKED_TFT` is therefore sufficient TFT evidence without a map marker. Gameflow `puuid` values are treated as local identifiers and never sent to public Riot APIs. Each participant's `summonerId` resolves locally to explicit `gameName` and `tagLine`; Account-v1 by Riot ID then supplies the canonical public PUUID used by the existing history scanner. Self is removed by normalized Riot ID and again by canonical public PUUID. Failed bridges are omitted individually, so partial public-identity coverage remains usable without guessing.

The League Client API is an unsupported Riot surface and may change without notice. Riot asks products using it to be registered and reviewed for their endpoints before release. This fallback never reads the protected game process, uses private third-party APIs, writes to the client, accepts queues, or automates gameplay.

Spectator `404`, `403`, rate-limit, malformed-response, and success states remain distinct. Discovery supplies identities only: it does not expose or infer a live shop, board, bench, gold, or augments. Spectator PUUIDs are public Riot identifiers; LCU-local identifiers are never substituted when Account-v1 Riot-ID resolution fails.

The app requests history in pages until it obtains the requested number of relevant games or reaches the bounded history horizon. Completed matches are normalized once and cached immutably; recent indexes have a five-minute TTL. Shared lobby matches are fetched once, partial scans remain usable, and a cached profile is kept visible while refresh runs.

Riot's `info.game_version` is stored as the raw game-client build. It is not treated as the TFT content patch shown by the app. Until a public, verified mapping exists, scouting displays patch relevance as unavailable and does not penalize confidence for that missing mapping.

## Storage migration

Tauri migration 2 adds dedicated tables for Riot accounts, recent match indexes, immutable completed matches, versioned opponent profiles, and scan snapshots. It uses `CREATE TABLE IF NOT EXISTS` and does not modify or delete M1/M2 data. The API key is never stored in these tables.

## Validation without a key

The test and preview providers use deterministic fixtures and mocked native HTTP responses. Run:

```powershell
npm test
npm run test:ui
npm run benchmark:m3
```

Use `/?riot-fixture=1` only in the development preview to exercise a complete seven-opponent flow. It is visibly labeled fixture data and contains no real credential or personal history.
