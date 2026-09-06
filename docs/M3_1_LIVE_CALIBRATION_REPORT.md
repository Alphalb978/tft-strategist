# M3.1 live calibration report

Completed: 2026-09-06  
Branch: `codex/m3-1-live-calibration`

## Outcome

M3.1 removes the invalid Riot-build/TFT-content-patch comparison, recalibrates opponent evidence confidence around information the pipeline actually has, and makes manual self-entry an explicit ignored state. M3 routing, native credential isolation, rate limiting, match ingestion, 10/15/20 targets, the 60-ID horizon, deduplication, immutable caching, partial deadlines, manual fallback, and the spectator boundary are unchanged.

No M4 comp classification, opponent prediction, recommendation scoring, Team Planner work, or general UI redesign was added.

## Root cause

M3 parsed the first `major.minor` pair from Riot `info.game_version`, stored it as `CompletedMatch.patch`, and compared it directly with `data.version.patch = 18.1`.

That combined two different concepts:

- Riot documents `info.game_version` as the **game client version**. A live-shaped value is `Version 16.18.702.1234 (...) [PUBLIC]`.
- `data.version.patch` is the product's **TFT content patch** label, sourced from Riot's Teamfight Tactics 18.1 patch notes.

The comparison made every live match appear off-patch. It then penalized the same mismatch twice: once by multiplying every match's evidence weight by 0.25 and again through a 0.4 patch-quality confidence factor.

## Evidence and decision

Reviewed on 2026-09-06:

- [Riot tft-match-v1 reference](https://developer.riotgames.com/apis#tft-match-v1) describes `game_version` only as “Game client version.”
- [Riot TFT developer documentation](https://developer.riotgames.com/docs/tft) states that static-data versions are not always equivalent to the client version used by a region.
- [Riot's Teamfight Tactics 18.1 notes](https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-patch-18-1/) establish 18.1 as the Enchanted Wilds content-patch label used by the repository.
- [RiotGames/developer-relations issue #820](https://github.com/RiotGames/developer-relations/issues/820) records that `game_version` did not change for a TFT B-patch, so it could not identify the content hotfix.

No reviewed public source provides a complete, reliable mapping from current Riot game-client builds to TFT content patches, including B-patches. M3.1 therefore does not invent one.

Normalized live matches now keep:

- `riotGameVersion`: the exact raw API string;
- `tftContentPatch`: `null` unless an explicit verified mapping supplies it;
- `tftContentPatchSource`: `unavailable`, `verified-mapping`, or `fixture`.

Opponent patch relevance is `same`, `mixed`, `different`, or `unavailable`, with the comparable-game count and an explanatory note. Normal Riot matches currently produce `unavailable`. Fixture tests can provide a content patch explicitly to cover the comparable path.

M3 immutable matches are upgraded on cache read: the raw legacy `gameVersion` is retained, while the regex-derived `patch` is discarded. The opponent derivation version moved from `opponent-evidence-v2` to `opponent-evidence-v3`, preventing reuse of distorted cached profiles.

## Confidence behavior before and after

Confidence is now inspectable as:

`sample coverage × recency quality × mode quality × (patch quality when comparable, otherwise 1)`

Patch unavailability is neutral. A known, explicitly sourced different content patch can still reduce patch quality and evidence weight. Confidence remains evidence quality, not a probability of the opponent's future behavior.

For the deterministic regression sample of 15 matches spaced one day apart, all with a Riot 16.18-style client build and no TFT patch mapping:

| Case | Before | After |
| --- | ---: | ---: |
| Supported mode | 6.36% | 63.58% |
| Unverified mode | 4.77% | 47.69% |

The before value applied the false 0.25 match weight and the false 0.4 patch-quality factor. The after value has 100% sample coverage, 63.58% recency quality, and unavailable/neutral patch quality; mode quality remains a separate 100% or 75% factor.

An 11/15 sample remains partial with 73.33% coverage. Missing patch mapping no longer turns it into false zero-same-patch evidence.

## Self-entry behavior

After manual identity resolution, an identity matching the resolved own-account PUUID is changed from `resolved`/`cached` to `ignored-self`. It is excluded before `scanLobby`, the UI labels it `your account — ignored`, and a self-only submission reports that no opponent history requests were started. Mixed submissions continue scanning the other resolved opponents.

## Regression coverage

Added deterministic coverage for:

- Riot `game_version` in the 16.18 client-build namespace while the product content patch is 18.1;
- normalization preserving the raw build and marking TFT content patch unavailable;
- explicit comparable-patch fixture behavior;
- 15 recent unmapped games retaining recency-driven confidence above 60% for supported modes;
- 11/15 remaining partial;
- M3 cached-match upgrade discarding the invalid parsed patch;
- resolved own-account entry becoming `ignored-self` and never being offered for history fetching;
- rendered self-only messaging and absence of a scouting result.

Existing M3 provider, route, malformed-payload, secret-redaction, auth, 429, rate-header, retry, cache, shared-match, warm-profile, and deadline tests remain green.

## Checks performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm test -- --run` | passed: 63 tests |
| `npm run format:check` | passed |
| `npm run build` | passed |
| `npm run test:ui` | passed: 11 tests |
| `npm run benchmark:m3` | passed; caching/dedup/partial behavior retained |
| `cargo test --manifest-path src-tauri/Cargo.toml` using the documented D: cache/target paths | passed: 4 tests |
| `git diff --check` | passed |

No native/Rust source changed, so the task packet did not require another native rebuild. Rust tests were still run to preserve the live-proven limiter/security behavior.

Rendered inspection exercised both M3.1 paths in the local fixture application. The self-only flow showed the ignored row and no-history message without a result panel. The seven-opponent flow remained complete at 7/7 profiles and 105/105 relevant games, displayed `patch relevance unavailable`, showed the four confidence factors, and produced no browser warnings/errors.

## Live-validation status

`RIOT_API_KEY` was not present, so no new live API test was performed.

The following remain prior September 6 EUN1 observations rather than newly revalidated claims: native key detection, Riot ID resolution, live match-index/detail fetching, real rate-limit waits/retries, bounded partial output, the 11/15 sample in about 4.7 seconds, and the 15/15 sample in about 2.3 seconds. The incorrect `0 same patch` interpretation from those runs is superseded by `patch relevance unavailable`; the raw match/build evidence remains usable.

## Remaining blockers for M4

- Patch-specific weighting must remain unavailable until a versioned, public, reliable build-to-TFT-content-patch mapping exists. Set membership and recency remain usable now.
- Queue/mode quality is still conservative when Riot evidence does not establish support; unverified modes retain their explicit 0.75 quality factor.
- A bounded live smoke should re-check normalized raw build fields, v3 confidence, and a real SQLite cache read when a key and approved test identity are available.
- M4 must supply its own documented classifier/evidence thresholds before interpreting final boards as comp families or behavior. M3.1 deliberately provides no such labels.

## Changed modules

- Domain/normalization: `src/domain/models.ts`, `src/providers/riot.ts`.
- Derivation/cache: `src/services/scouting.ts`, `src/storage/history.ts`, `src/strategy/postGame.ts`.
- Minimal UI/fixtures: `src/features/RiotScouting.tsx`, `src/providers/riotPreview.ts`, `src/test/fixtures.ts`, `scripts/benchmark-scouting.ts`.
- Tests: `src/test/riot.test.ts`, `src/test/scouting.test.ts`, `src/test/storage.test.ts`, `e2e/app.spec.ts`.
- Evidence/setup: `docs/M3_RIOT_API_EVIDENCE.md`, `docs/RIOT_SETUP.md`, this report.
