# M3 — Native Riot History & Opponent Scouting

## Goal
Turn the M2 rules/data foundation into a trustworthy **read-only Riot history and opponent-scouting pipeline** for the private desktop app.

This milestone is about **identity resolution, completed-match ingestion, caching, rate-limit behavior, participant discovery where officially available, opponent-history profiles, partial-confidence output, and measured scan performance**.

It is **not** the milestone for meta ranking, comp discovery, final recommendation calibration, Team Planner enablement, post-game coaching, broad UI redesign, or any protected-process access.

Read `AGENTS.md` and all governing authority it references before changing code. Treat this task packet as the highest project authority for M3.

## M2 baseline
M2 established:
- audited Set 18 / Enchanted Wilds / patch 18.1 rule fixtures;
- explicit `known-stale` combat parity for the August 29 CommunityDragon export versus Riot's later 18.1 hotfixes;
- deterministic board capacity, occupied-slot, trait-count, breakpoint, special-unit, item-recipe, shop/pool/XP/interest/star-copy and selected set-mechanic rules;
- four legal but still Experimental source playbooks;
- existing `RiotProvider`, synthetic fixture provider, `scanLobby`, cache/deduplication/time-budget behavior, and SQLite schema placeholders.

Preserve all M2 truth boundaries. Do not use stale combat values as current strategy evidence.

## Current official API surface to verify at task start
Verify the current Riot Developer Portal/API reference before implementation. The expected official surfaces are:
- `account-v1` for Riot ID ↔ PUUID resolution;
- `tft-match-v1` for match IDs and completed TFT match details;
- `spectator-tft-v5` for current-game discovery where available;
- regional routing for account/match endpoints and platform routing where the endpoint requires it.

Do not rely on remembered endpoint paths or DTO shapes. Record the exact current endpoint paths, routing requirements, and relevant response/rate-limit headers in M3 documentation.

If official current-game discovery cannot be verified or does not expose what the product needs, preserve `unsupported` and use manual participant identities as the required fallback. Do not replace it with LCU/private-process/network interception.

## Security and credential boundary
The Riot API key must remain outside the React/Vite frontend and outside checked-in files.

Required behavior:
- create a native/backend Riot HTTP boundary;
- accept a local native secret source such as `RIOT_API_KEY` from the native process environment or an equivalent OS-native secret abstraction;
- never use `VITE_RIOT_API_KEY` or any frontend-exposed variable;
- never persist the key to localStorage, SQLite application data, logs, telemetry, error bodies, screenshots, test fixtures, or Git;
- never put the key in query strings when an authenticated header is supported;
- sanitize HTTP errors before they cross the native/frontend boundary;
- add explicit tests proving secret values do not appear in serialized errors/loggable objects.

Do not ask for or hard-code a real user key. The milestone must be fully testable without credentials. If a live key is present in the task environment, use it only for bounded acceptance checks and never print it.

## Required user flows
Implement enough UI and application plumbing to exercise the real pipeline without redesigning the product.

### A. Own-account configuration
Allow the user to configure:
- Riot ID as `gameName#tagLine`;
- platform/region selection needed for correct routing;
- history target: existing 10 / 15 / 20 games setting.

Display only safe connection state, e.g.:
- API key detected / unavailable;
- account resolved / unresolved;
- selected platform and derived regional route;
- last successful history refresh.

Do not expose the key itself.

### B. Manual opponent identities — required fallback
Provide a compact way to enter/paste up to seven opponent Riot IDs and resolve them to PUUIDs.

Requirements:
- tolerate whitespace and duplicates;
- validate `gameName#tagLine` input without over-restricting legitimate Unicode names;
- resolve opponents concurrently but through the shared rate limiter;
- partial resolution is valid: failed opponents must not discard successful ones;
- show useful per-entry errors without leaking raw authenticated response details.

### C. Official current-game discovery — only if verified
If current `spectator-tft-v5` officially supports current-game lookup for the user's PUUID/platform and exposes participant PUUIDs, implement it behind the existing provider contract.

Requirements:
- use only the documented Riot endpoint;
- normalize `not-in-game`, `unsupported`, auth/rate-limit, and transient-unavailable states;
- exclude the user's own PUUID from opponents;
- cap to seven opponents;
- manual identities remain available even when discovery exists;
- do not infer shop/board/bench/gold/augment state;
- do not implement adaptive in-game prescriptions.

If policy applicability is ambiguous, document the ambiguity; do not claim compliance beyond what the official source actually says.

## Riot routing
Implement and test an explicit routing model rather than string concatenation scattered through providers.

At minimum support all currently documented TFT platform routes and their correct regional clusters where needed. Test representative examples such as EUW1/EUN1 → EUROPE for account/match history, while preserving platform routing for platform-scoped endpoints.

Unknown routing values must fail safely with a user-visible configuration error.

## Native HTTP adapter
Implement a production-shaped `RiotProvider` adapter at the native/backend boundary.

It must support:
1. Riot ID → PUUID account resolution;
2. optional PUUID → Riot ID lookup where useful for participant display;
3. recent TFT match IDs for a PUUID;
4. completed TFT match detail retrieval;
5. official current-game participants only if verified as above.

The TypeScript domain/provider interface may be refined if necessary, but preserve provider → domain → service separation. Frontend code must not call Riot directly.

## Rate limiting, retries, cancellation
Three concurrent workers are not sufficient as a production rate limiter.

Implement one shared request scheduler for Riot traffic with:
- header-aware application and method limit tracking when Riot returns those headers;
- `429` handling using `Retry-After` and rate-limit-type information when provided;
- bounded retries for retryable transient failures;
- bounded exponential backoff with jitter;
- no automatic retry for ordinary validation/auth failures unless specifically justified;
- cancellation/deadline propagation;
- one global limiter per API key/session so account/history/match/spectator calls cannot independently exceed the same budget;
- inspectable safe metrics: requests attempted, cache hits, retries, rate-limit waits, elapsed time. Never include secrets.

Do not hard-code a production-rate allowance as truth. Defaults may be conservative, but observed Riot headers should control pacing when available.

## Match normalization
Create a strict adapter from the current official `tft-match-v1` DTO into the repository's `CompletedMatch` domain model.

Preserve at minimum:
- match ID;
- completion/game timestamp;
- game/set/patch/version metadata actually present;
- queue/game-type identifiers needed to distinguish standard relevant TFT from unsupported modes when evidence permits;
- participant PUUID and placement;
- champion/unit IDs and star/tier values;
- item IDs;
- traits and counts where supplied;
- augments where supplied.

Use M2 current-set stable IDs to validate joins. Unknown or newly changed Riot IDs must be retained as unresolved evidence rather than silently dropped or mapped by fuzzy display name.

Do not invent `familyId` or strategic style labels during normalization. Those belong to measured classification/calibration work after M3.

## Relevant-history acquisition
The user setting targets **10–20 relevant recent games per opponent**, not merely 10–20 raw IDs.

Implement a bounded acquisition strategy that:
- requests recent match IDs in reasonable pages/batches;
- stops when target relevant games are obtained or a documented maximum request/history horizon is reached;
- filters to the audited current set and supported TFT game types/modes when reliably identifiable;
- preserves same-patch versus older-patch metadata;
- deduplicates match IDs globally across all seven opponents before detail fetch;
- never refetches immutable completed matches already cached;
- supports partial samples when the deadline/rate limit prevents full coverage.

Do not turn missing current-patch games into fabricated full-confidence profiles.

## Persistent cache/storage
Route production history through dedicated SQLite-backed storage rather than leaving high-volume history solely in the generic key/value repository.

Required persistent concepts:
- resolved Riot accounts / identities with fetched-at timestamps;
- recent match-index records with target/count/fetched-at and a short TTL;
- immutable completed match payloads/domain records by match ID;
- opponent profiles keyed by derivation version, set/patch and PUUID;
- scan snapshots/telemetry sufficient to compare warm vs cold behavior.

Migrate safely. Existing M1/M2 local data must not be destroyed.

Recommended cache behavior:
- completed match: immutable/no routine expiry;
- recent index: short TTL, currently around five minutes unless evidence/testing supports a better value;
- account identity: longer TTL, refreshable;
- profile: versioned and recomputed when source matches/derivation version change.

## Opponent profile — M3 evidence only
Refine `OpponentProfile` so it can be derived from real completed matches without pretending to know comp families that have not yet been classified.

Reliable M3-level features may include, when directly derivable:
- relevant game count;
- effective recency/patch-weighted sample;
- unit frequency;
- trait frequency;
- augment frequency if the API supplies it;
- placement summaries over the sample;
- repeated core-unit pressure candidates;
- source match IDs and derivation version;
- confidence/coverage from sample quality.

Existing `familyFrequency`, `styleFrequency`, ForceIndex/FlexIndex or related fields may remain fixture-only, optional, or explicitly unavailable until a real classifier exists. Do not infer reroll/Fast 8/AD/AP tendencies from final boards unless a documented deterministic classifier is implemented with evidence and marked as inferred.

Historical tendencies are probabilistic context, never proof of the opponent's next choice.

## Lobby pressure output
M3 should return a production-shaped scouting result that later recommendation logic can consume.

At minimum include:
- requested/resolved opponent count;
- profiles completed;
- relevant games available versus target;
- global shared matches reused/deduplicated;
- coverage/confidence;
- fresh versus cached evidence;
- partial/complete/unavailable state;
- elapsed scan time;
- rate-limit/retry/cache telemetry;
- safe user-facing errors.

Do not yet convert these into seeded recommendation-score bonuses or claim calibrated contest probabilities.

A minimal UI may display scan state and raw/aggregated history evidence, but broad visual redesign is out of scope.

## Warm-result behavior
The product should remain useful while network refresh is happening.

If a valid cached profile exists:
- surface the warm profile immediately;
- refresh in the background/service flow;
- replace it only with a successfully validated newer result;
- clearly distinguish cached/stale/fresh evidence;
- never blank a useful cached profile because one refresh request failed.

## Performance benchmark
Measure actual behavior rather than promising impossible latency under a development key.

Benchmark at least:
- 1 opponent × 10 relevant games;
- 7 opponents × 10 relevant games;
- 7 opponents × 20 relevant games;
- cold cache;
- warm immutable-match cache;
- warm profile/index cache;
- timeout/partial case.

Record:
- elapsed time;
- network request count;
- cache hits;
- unique match details fetched;
- shared matches deduplicated;
- retries/rate-limit waits;
- resulting coverage.

Desired UX targets, when the active Riot limits permit:
- warm cached display: effectively immediate / sub-second target;
- mixed cache scan: roughly 1–3 seconds target;
- cold scan: roughly under 5 seconds is desirable but **not an acceptance requirement if Riot development-key limits make it impossible**.

The implementation must prefer correctness, caching and partial output over violating rate limits to hit a cosmetic target.

## Failure semantics to test
Add deterministic coverage for at least:
- missing native API key;
- malformed Riot ID;
- unknown route/platform;
- account 404/not found;
- auth 401/403;
- `429` with `Retry-After`;
- application/method rate-limit headers;
- transient 5xx then success;
- bounded retry exhaustion;
- match ID returned but detail 404;
- malformed/unexpected Riot payload;
- one opponent failing while others succeed;
- duplicate opponent identities;
- shared match across multiple opponents fetched once;
- stale recent-index cache;
- immutable match cache reuse;
- deadline reached with partial results;
- non-cooperative request still unable to block final partial output;
- unknown current-set unit/item/augment ID preserved as unresolved;
- secret redaction.

## Live validation gate
The milestone must pass without a real key using fixtures/mocked HTTP.

If a valid development key is available locally, perform a small bounded real-API smoke test:
- resolve one explicitly supplied test Riot ID;
- fetch a small number of match IDs;
- fetch at least one completed match;
- verify normalization and cache round-trip;
- optionally verify spectator behavior only if the account is currently in a TFT game and the endpoint is officially supported.

Never print the key. Do not include personal match payloads in committed fixtures unless explicitly sanitized and intentionally approved.

If no key is available, report `live validation not performed` rather than blocking the rest of M3.

## UI scope
Make only the UI required to operate and inspect M3:
- connection/account configuration;
- manual opponent entry;
- scan action/state;
- coverage/freshness/latency;
- compact opponent/history evidence.

Do **not** spend this milestone on:
- renaming Playbook Library to Comps;
- removing all AI-like microcopy;
- full comp browser redesign;
- positioning board UI;
- major typography/spacing polish.

Those are already accepted follow-up product work and should not dilute the scouting implementation.

## Out of scope / prohibited
Do not implement:
- process memory reading;
- DLL/process injection;
- packet capture/interception/TLS MITM;
- auth-token extraction from Riot/Blitz/MetaTFT clients;
- kernel/driver/Vanguard bypass techniques;
- automated gameplay input;
- live shop/board/bench/gold/augment reading;
- proprietary companion IPC reverse engineering;
- meta tier-list scraping/calibration;
- Team Planner codec enablement;
- comp discovery/experimental-board promotion;
- runtime LLM dependency.

## Required documentation
Create/update:
- `docs/M3_IMPLEMENTATION_REPORT.md` — exact work, checks, limits, live validation status, changed modules;
- `docs/RIOT_SETUP.md` — exact current routing/API setup and safe local key instructions;
- `docs/M3_RIOT_API_EVIDENCE.md` — official endpoint/routing/rate-limit evidence and review date;
- migration/storage notes where schemas change;
- benchmark table with cold/warm/partial results.

Document development-key expiration/limits as current Riot behavior if verified from official docs, without hard-coding those portal policies into application logic.

## Acceptance gates
At completion:
1. frontend cannot access or serialize the Riot key;
2. native/provider adapter is real and mockable;
3. routing is explicit and tested;
4. account + match-history endpoints are normalized from current documented DTOs;
5. rate-limit/backoff behavior is deterministic and tested;
6. persistent SQLite match/index/profile caching works;
7. shared match deduplication works across seven opponents;
8. manual opponent Riot IDs work as the reliable fallback path;
9. official spectator discovery is implemented only if verified, otherwise safely unsupported;
10. partial results survive individual failures/timeouts;
11. warm cached results remain visible during refresh;
12. M2 current-set joins are validated and unknown IDs remain explicit;
13. no family/meta labels are fabricated;
14. all existing M1/M2 tests still pass;
15. new focused provider/rate-limit/storage/scouting tests pass;
16. typecheck, lint, format, production build, UI tests and `git diff --check` pass;
17. if native/Rust/Tauri code changes, run the relevant native build/check using the documented D: target/temp paths on this workstation;
18. inspect the rendered M3 flow at normal desktop width and at existing responsive test widths;
19. finish with a concise implementation report listing anything not live-verified.

## Branch discipline
Work only on `codex/m3-riot-scouting`. Do not merge to main. Do not rewrite project authority to fit implementation convenience.
