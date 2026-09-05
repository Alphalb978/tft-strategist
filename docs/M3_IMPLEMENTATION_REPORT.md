# M3 implementation report

Completed: 2026-09-06  
Branch: `codex/m3-riot-scouting`

## Outcome

M3 now has a production-shaped, read-only Riot identity/history/scouting pipeline behind the native Tauri boundary. It resolves Riot IDs, routes account/match/spectator traffic explicitly, validates and normalizes completed TFT matches, schedules all authenticated traffic through one header-aware limiter, persists high-volume history in dedicated SQLite tables, reuses shared matches globally, and returns warm or partial evidence without inventing strategic classifications.

The React application never receives the Riot key. `RIOT_API_KEY` is read once by Rust from the native process environment and held as a secret value. Requests use the `X-Riot-Token` header; URLs, payload bodies, raw provider errors, and secret values do not cross the Tauri boundary.

## Implemented work

### Native provider and safety

- Added native commands for connection status, Riot ID/PUUID lookup, paged match IDs, completed match details, official current-game lookup, cancellation, and safe metrics.
- Added a single application/session request scheduler with observed application and method windows, method-specific blocking, `Retry-After`, rate-limit type, bounded transient retries, exponential backoff with jitter, and deadline/cancellation handling through response-body reads.
- Fixed error serialization to known codes/messages with optional status and retryability only. Tests prove a sample secret and raw response body cannot appear.
- Kept spectator discovery limited to the current official spectator-tft-v5 platform list. Manual identities remain the fallback.

### Provider, routing, and normalization

- Added explicit platform-to-account and platform-to-match routing. SEA account resolution uses ASIA; match history uses SEA. Unknown platforms fail safely.
- Added Unicode-tolerant `gameName#tagLine` parsing, whitespace and delimiter handling, duplicate removal, per-entry errors, and the seven-opponent cap.
- Added strict Zod validation for the current match-v1 envelope and participant/unit/trait fields.
- Retained match metadata, queue/game type, participant placement, unit IDs/tiers/items, traits, and augments. Unknown IDs remain unresolved evidence.
- Did not create comp family, meta tier, playstyle, reroll, leveling, AD/AP, or contest-probability labels.

### Scouting and persistence

- Added bounded paged acquisition toward 10/15/20 relevant current-set games within a 60-ID horizon.
- Added global detail-fetch deduplication across opponents and immutable completed-match cache reuse.
- Added five-minute match-index caching, longer-lived identity caching, derivation-versioned opponent profiles, scan snapshots, and safe telemetry.
- Added recency/patch-weighted evidence profiles with unit/trait/augment frequency, placement summary, repeated-unit candidates, source match IDs, and confidence based on sample/patch/mode quality.
- Added hard deadline racing so a non-cooperative request cannot suppress a partial result.
- Preserved valid warm profiles during refresh and replaces them only after a validated newer result.
- Added a safe migration 2 with new `riot_*` tables; no existing table or M1/M2 data is altered or deleted.

### UI

- Added own-account Riot ID, platform, route, key-state, resolution, and last-refresh information to Data & settings.
- Added manual paste/resolve/scan for up to seven opponents and optional official spectator discovery on supported platforms.
- Added compact complete/partial/unavailable state, requested/resolved/profile counts, relevant-game coverage, fresh/cached split, latency, request/cache/dedup/retry/wait metrics, per-entry resolution failures, and per-opponent evidence cards.
- Added an explicit Riot policy warning and no claims about protected-process state.
- Left the recommendation portfolio and score inputs unchanged; M3 evidence is displayed and available for later calibrated work but grants no score bonus.

## Deterministic benchmark

Command: `npm run benchmark:m3`

These are fixture/in-memory pipeline timings on this workstation. They measure orchestration, caching, deduplication, and deadline behavior; they are not a claim about live Riot latency or production/development-key throughput.

| Scenario | Elapsed | Provider requests | Cache hits | Unique details fetched | Shared references deduplicated | Retries | Limit waits | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 opponent × 10, cold | 8.90 ms | 11 | 0 | 10 | 0 | 0 | 0 | 100% |
| 7 opponents × 10, cold | 2.07 ms | 17 | 0 | 10 | 60 | 0 | 0 | 100% |
| 7 opponents × 20, cold | 3.85 ms | 27 | 0 | 20 | 120 | 0 | 0 | 100% |
| 7 opponents × 20, warm immutable matches | 3.93 ms | 7 | 20 | 0 | 120 | 0 | 0 | 100% |
| 7 opponents × 20, warm profile/index | 2.42 ms | 0 | 27 | 0 | 120 | 0 | 0 | 100% |
| 7 opponents × 10, timeout/partial | 35.84 ms | 0 | 10 | 0 | 20 | 0 | 0 | 43% |

## Validation performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm test -- --run` | passed: 59 tests |
| `npm run format:check` | passed |
| `npm run build` | passed |
| `npm run test:ui` | passed: 10 tests |
| `npm run benchmark:m3` | passed; results above |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | passed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | passed: 4 native tests |
| `cargo check --manifest-path src-tauri/Cargo.toml` | passed |
| `npm run tauri build -- --debug --no-bundle` with documented D: target/temp/tool caches | passed; debug executable produced |
| `git diff --check` | passed |

Native tests cover application/method header parsing, a 429 carrying Retry-After and rate-limit type followed by transient 5xx then success, bounded retry exhaustion, and secret-safe serialized errors. TypeScript tests cover missing key, malformed identity, unknown route, 404, 401/403 classification, 429, unexpected payloads, unresolved IDs, individual opponent failures, duplicates, shared matches, stale index, immutable match reuse, warm profiles, partial deadlines, and non-cooperative providers.

Rendered inspection covered:

- fixture flow at 1440 px, 1000 px, and 860 px;
- seven Unicode/manual identities resolving independently;
- a completed 7/7 profile, 105/105 relevant-game result with 100% coverage and 120 shared references reused;
- compact evidence cards and safe telemetry;
- no-key state with no credential value in the rendered DOM;
- responsive stacking without horizontal overflow or clipped controls;
- zero browser console warnings/errors during the exercised M3 flow.

The built native executable was launched without a key as a smoke check. Interactive rendered inspection used the local application browser and Playwright captures because the available computer-control surface did not expose native windows.

## Live validation and remaining limits

`live validation not performed`: `RIOT_API_KEY` was not present. No real account, match ID, completed match, spectator response, or SQLite round-trip against live Riot data was exercised. All acceptance behavior remains testable through fixture providers and mocked native HTTP.

Other explicit limits:

- PH2/TH2 appear in Riot's generic TFT route table but not the current spectator-tft-v5 platform reference; match history routes to SEA and current-game discovery is unsupported there.
- Riot policy applicability to opponent-history display around gameplay/loading is ambiguous. The product warns rather than claims compliance; manual input and official identity discovery do not remove the need for a product/legal review before distribution.
- Fixture benchmark timings exclude real HTTPS, Riot pacing, and SQLite I/O latency.
- Queue/mode support remains conservative when official response evidence is insufficient; uncertain modes lower confidence instead of being asserted as supported.
- M2's bundled combat values remain `known-stale` for the documented hotfix gap. M3 does not reinterpret them as current truth.
- Opponent profiles are historical evidence only and do not predict the next board or alter recommendations.

## Changed modules

- Native: `src-tauri/src/riot.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
- Provider/domain: `src/providers/riot.ts`, `src/providers/riotId.ts`, `src/providers/riotRouting.ts`, `src/providers/riotPreview.ts`, `src/domain/models.ts`.
- Scouting/storage: `src/services/scouting.ts`, `src/services/application.ts`, `src/storage/history.ts`, `src/storage/schema_m3.sql`, `src/storage/repository.ts`.
- UI: `src/features/RiotScouting.tsx`, `src/features/DataSettings.tsx`, `src/features/Home.tsx`, `src/app/App.tsx`, `src/styles/app.css`.
- Tests/benchmark: `src/test/riot.test.ts`, `src/test/scouting.test.ts`, `src/test/storage.test.ts`, existing affected test fixtures/suites, `e2e/app.spec.ts`, `scripts/benchmark-scouting.ts`, `package.json`.
- Documentation: `docs/RIOT_SETUP.md`, `docs/M3_RIOT_API_EVIDENCE.md`, this report.
