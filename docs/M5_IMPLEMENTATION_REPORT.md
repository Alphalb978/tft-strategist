# M5 Implementation Report — Measured Meta Calibration

Date: 2026-09-06  
Branch: `codex/m5-measured-meta-calibration`

## Outcome

M5 expands the legal Set 18 candidate library from four to 13 distinct source-attributed families and implements the complete deterministic aggregate-evidence path: documented Riot ladder acquisition, identifier resolution, immutable-match cache reuse, global shared-match deduplication, current-set filtering, conservative retrospective classification, uncertainty-aware family statistics, quality-gated recommendation calibration, and a searchable/sortable Comp Library.

A temporary Riot development key was used for the bounded validation described below. Live EUW1 Challenger data completed the acquisition, Set 18 filtering, deterministic classification, aggregate-statistics, application-load, shared-match deduplication, and warm-cache path. The sample is intentionally too small to clear the recommendation quality gate, so the shipped UI correctly keeps the visible neutral outcome fallback rather than promoting insufficient evidence.

## Public sources and endpoints

### Curated comp definitions

- Existing four source guides remain attributed to their individual current Mobalytics guide URLs in `data/playbooks/set18.json`.
- Nine additional final-board definitions and roll-style labels were transcribed from the publicly inspectable [TFTactics Set 18 team-comps page](https://tftactics.gg/tierlist/team-comps/), observed as Set 18 patch 18.1d on 2026-09-06.
- Current-set IDs, board eligibility, capacities, special-unit rules, and trait calculations continue to come from the audited CommunityDragon Set 18 snapshot and versioned M2 rules.

The added families are Apex Predator, Consuming Flora, Flora Executioners, Invoker Spellweavers, Unrivaled, Elderwood Rapidfire, Blackthorn Sprykin, Blossom Executioners, and Coven Invokers. Their full final rosters and source-labeled Fast 8/Fast 9/Slow Roll style are stored. Classifier anchors are explicitly curated from those sourced rosters. Roles, item plans, opening boards, and specific augment details are left unavailable where the page did not support them; no filler facts were invented.

### Riot outcome acquisition

The native boundary uses only documented/public endpoint families:

- `GET /tft/league/v1/challenger?queue=RANKED_TFT`
- `GET /tft/league/v1/grandmaster?queue=RANKED_TFT`
- `GET /tft/league/v1/master?queue=RANKED_TFT`
- `GET /tft/summoner/v1/summoners/{encryptedSummonerId}` (legacy fallback only; not needed by the validated ladder response)
- `GET /tft/match/v1/matches/by-puuid/{puuid}/ids?start={start}&count={count}`
- `GET /tft/match/v1/matches/{matchId}`

The product path keeps the API key in the Rust/native process, reuses the M3 rate-limit/retry/deadline implementation, returns safe error codes, and never logs raw bodies, headers, identifiers, or secrets. Riot's current Challenger DTO provides PUUID directly. The collector now consumes that documented identifier rather than requiring a secondary summoner lookup; the legacy summoner lookup remains a bounded provider fallback with regression coverage. The bounded development default is EUW1/EUROPE, Challenger, three cohort players, and three recent match IDs per player. The final standalone `npm run m5:live-smoke` validation sampled two Challenger players and four recent IDs per player, selected by public ladder position after a bounded index-only overlap probe. This is a regional sample, never “global meta.”

## LIVE VALIDATION

Status: **passed with a bounded real Riot sample**.

Final acceptance run: 2026-09-06 at `2026-09-06T11:00:08.664Z` using EUW1 platform routing, EUROPE regional routing, `RANKED_TFT`, and the Challenger cohort. The current ladder response contained PUUID directly, so no secondary identifier-resolution request was necessary. A compatibility inspection observed 28 ladder entries. An index-only probe considered 12 players without fetching match payloads and selected ladder positions 3 and 5 because their first four recent IDs included one shared match. The final collector itself considered and sampled those two players.

### Final sample

| Field                                        | Live result                                                         |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Platform / regional route                    | EUW1 / EUROPE                                                       |
| Queue / rank cohort                          | `RANKED_TFT` / Challenger                                           |
| Ladder players considered / actually sampled | 2 / 2                                                               |
| Recent ID references                         | 8 (2 players × 4)                                                   |
| Unique match IDs discovered                  | 7                                                                   |
| Shared match references deduplicated         | 1                                                                   |
| Unique match payloads fetched cold           | 7                                                                   |
| Current Set 18 matches retained              | 7 of 7 fetched                                                      |
| Current Set 18 boards retained               | 56                                                                  |
| Match window                                 | `2026-09-05T21:46:40.875Z` to `2026-09-06T10:26:41.406Z`            |
| Classified / ambiguous / unclassified boards | 18 / 5 / 33                                                         |
| Classification coverage                      | 32.14% classified                                                   |
| Classifier smoke observation                 | Classified as `adaptor-reroll`; score 1.000, runner-up margin 0.727 |
| Dataset state / errors                       | complete / none                                                     |
| Patch relevance                              | unavailable, intentionally not inferred                             |

The 18 classified observations produced these real aggregate family statistics:

| Family               | Games | Average placement | Top-four rate | Win rate | Confidence | Quality      |
| -------------------- | ----: | ----------------: | ------------: | -------: | ---------: | ------------ |
| Elderwood Cap        |     1 |             3.000 |         1.000 |    0.000 |      0.509 | insufficient |
| Adaptor Reroll       |     2 |             3.500 |         0.500 |    0.500 |      0.510 | insufficient |
| AP Summoners         |     2 |             4.000 |         0.500 |    0.500 |      0.486 | insufficient |
| Coven Invokers       |     2 |             4.000 |         0.500 |    0.000 |      0.500 | insufficient |
| Solar Elderwood      |     8 |             5.250 |         0.500 |    0.125 |      0.585 | insufficient |
| Invoker Spellweavers |     3 |             6.667 |         0.000 |    0.000 |      0.533 | insufficient |

`createRecommendations` accepted the live-derived dataset as compatible, loaded all six family-stat records, and retained them as measured evidence. Zero recommendation components became eligible because every family remained below the conservative 20-classified-game gate. This is the expected quality-gated behavior; no classification or recommendation score was forced.

### Cold and warm telemetry

| Metric                         | Cold/live run | Warm rerun |
| ------------------------------ | ------------: | ---------: |
| Requests attempted             |            10 |          3 |
| Retries                        |             0 |          0 |
| Rate-limit waits               |             0 |          0 |
| Rate-limit wait time           |          0 ms |       0 ms |
| Immutable match-detail fetches |             7 |          0 |
| Immutable match cache hits     |             0 |          7 |
| Shared references deduplicated |             1 |          1 |
| Elapsed time                   |    2411.18 ms |  414.68 ms |

The cold request total is one ladder request, two match-index requests, and seven unique detail requests. The warm run repeats only the mutable ladder and two index requests, reuses all seven immutable cached payloads, performs no detail requests, and is 82.8% faster.

Before the final acceptance run, bounded diagnostics used 47 additional requests: the original incompatible identifier attempt and response-shape check, a 2×2 successful sample, a 3×3 successful sample, and the 12-player index-only overlap probe. Across those diagnostics and the final run there were no retries or rate-limit waits. No crawl was extended beyond 12 index-only players or nine detail payloads in any run.

### Temporary-key handling

The temporary key was assembled only in process memory, assigned to `RIOT_API_KEY` for each command, sent only in the `X-Riot-Token` header, and removed from the environment in a `finally` block. The live provider emitted aggregate counts and telemetry only. It did not print response bodies, PUUIDs, summoner IDs, match IDs, headers, or URLs containing credentials. The smoke used in-memory history and repository implementations, so it wrote no SQLite rows or metadata. No live fixture, report artifact, screenshot, or application log was created from raw Riot payloads. A post-run repository scan found no fragment of the temporary credential in tracked or untracked project files.

### Bounded correctness fix

The first live attempt found that the current TFT league response uses `puuid` directly and no longer supplies the assumed `summonerId`. The mismatch caused both sampled identities to fail before match collection. The bounded fix updates the ladder DTO/domain contract and meta collector to use the supplied PUUID directly, preserves the optional legacy lookup method, and adds regression coverage proving that aggregate collection makes no legacy identifier request when PUUID is present. Targeted typechecking and 29 M5/Riot/application tests passed before the successful rerun.

## Fixture validation (not live evidence)

Deterministic fixtures additionally verify:

- documented ladder PUUID handling, the optional legacy summoner bridge command, and bounded league-point ordering;
- two cohort players sharing two match IDs produce four raw ID references, two unique matches, and two deduplicated references;
- one Set 18 and one Set 17 match yield one current-set match and two current-set boards;
- cold acquisition fetches two immutable details; the warm rerun has two cache hits and zero detail fetches;
- real normalized Set 18 IDs classify into a family or remain explicit ambiguous/unclassified;
- derived family statistics and all stored observations carry version/fingerprint metadata.

Synthetic placements are test data only and are never loaded into the user-facing application as meta evidence.

## Classifier

Version: `set18-family-classifier-v1`.

For normalized unique current-set final-board units:

`score = 0.45 × coreRecall + 0.35 × boardJaccard + 0.15 × rolePresence + 0.05 × sizeFit`

Where:

- `coreRecall = matched classifier anchors / family anchors`;
- `boardJaccard = intersection / union` of observed and target unit IDs;
- `rolePresence = matched sourced role IDs / sourced role IDs`; when no roles are sourced it falls back to core recall and therefore adds no unsupported role fact;
- `sizeFit = 1 - |observedSize - targetSize| / max(observedSize, targetSize)`.

A family must score at least 0.62 and reach at least 0.50 core recall. If the best and runner-up scores differ by less than 0.08, the result is `ambiguous`; if the threshold/core gate fails, it is `unclassified`. Only `classified` observations receive a family ID. Score, runner-up, margin, components, and classifier version are retained. Ties are deterministic by stable family ID. This is retrospective categorization only and never predicts an opponent’s next comp.

Fixtures cover exact clear match, no match, partial board, an ambiguous common board, and two structurally similar families. Exact AP Summoners/Flora Executioners and Consuming Flora/Blackthorn structures may conservatively remain ambiguous when margins are too small; that is intentional fail-safe behavior.

## Statistical model and uncertainty

Version: `set18-meta-statistics-v1`.

- Recency weight: `exp(-ln(2) × ageDays / 14)` (14-day half-life).
- Effective sample: Kish effective N, `(Σw)^2 / Σ(w^2)`.
- Raw average placement and recency-weighted average placement remain visible.
- Placement shrinkage: weighted family mean toward sample-wide mean with prior strength 12.
- Placement uncertainty: weighted standard deviation divided by `sqrt(effectiveN)`.
- Top-4, win, and bot-4 raw rates retain 95% Wilson intervals.
- Binomial shrinkage: `(successes + sampleBaseline × 16) / (games + 16)`.
- Confidence: `0.50 × n/(n+30) + 0.25 × exp(-ageDays/21) + 0.25 × classifierQuality`.
- Classifier quality: `0.65 × averageScore + 0.35 × clamp(averageMargin/0.25)`.

Measured recommendation strength is risk-adjusted from shrunk placement, top-4, and win evidence with an explicit uncertainty penalty. Floor uses shrunk top-4 and inverse bot-4; ceiling uses shrunk first-place performance relative to the sample baseline. A family is recommendation-eligible only with at least 20 classified games, confidence at least 0.45, and freshest evidence no older than 21 days. A one-game 100% raw win-rate fixture shrinks below 20%, remains insufficient, and does not outrank the mature fixture.

## Recommendation calibration and portfolio behavior

`meta`, `floor`, and `ceiling` are no longer read from seeded playbook numbers when compatible measured evidence is absent or insufficient. Those three inputs become `unavailable`, contribute an explicit neutral value, and are labeled as such. When a family clears the quality gate, they are replaced with measured strength/floor/ceiling and labeled `measured` (or `fixture` in deterministic tests).

Curated item flexibility, augment flexibility, transition, tempo, availability, and fragility remain separate and retain seeded/curated provenance. M4 lobby pressure remains a distinct `lobby` component. Aggregate play frequency is not fed into M4 pressure and is not double-counted as current-lobby contest.

Tests prove that mature measured outcomes can reorder otherwise equal candidates; a separately supplied M4 pressure changes the score without altering the measured component. Portfolio optimization remains combinatorial and rewards opening/item/style diversity while penalizing shared cores and redundant pressured-unit exposure; it is not a top-three win-rate sort.

## UI

- “Playbook library” is renamed “Comps,” with a Comp Library page.
- Search indexes family name, subtitle, final-board unit names, and traits.
- Evidence and roll-style filters are available.
- Sorting supports measured strength, shrunk average placement, top-4, win rate, confidence, and sample size. Missing measurements sort last and remain labeled unavailable.
- Recommendation cards visually separate aggregate meta evidence, M4 historical lobby contest, confidence, and curated score drivers.
- Comp detail includes an aggregate-evidence block and source/provenance limits.
- Missing splash art now renders as a full-card gradient fallback without overflow.

Rendered inspection covered 1440, 1000, and 860 px. Search/filter/sort remained usable, the control grid reduced to two columns at narrower desktop widths, recommendation and detail evidence remained legible, no document/main horizontal overflow occurred, and Playwright recorded no application page errors. Screenshots are in the local `artifacts/` directory and are not source evidence.

## Storage and invalidation

Completed matches remain immutable and keyed by match ID. The aggregate dataset persisted under `aggregate-meta` includes:

- raw versioned classification observations;
- derived family statistics;
- classifier and statistics versions;
- family-definition fingerprint;
- static-source version;
- sample-definition fingerprint;
- combined derivation fingerprint;
- platform, route, rank cohort, collection window, players, matches, boards, coverage, state, errors, and telemetry.

Changing classifier configuration, family anchors/boards/roles, static source, cohort definition, or statistical configuration changes the derivation fingerprint. Incompatible stored evidence is ignored with an application notice and recomputed from immutable cached matches rather than silently reused.

## Benchmarks

Fixture timings from this workstation (one run; not live-network truth):

| Benchmark                        | Result                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| M3 1 × 10 cold                   | 18.30 ms, 11 requests, 10 details                                             |
| M3 7 × 20 cold                   | 11.33 ms, 27 requests, 20 details, 120 shared references deduped              |
| M3 7 × 20 warm immutable matches | 6.73 ms, 7 requests, 20 cache hits, zero details                              |
| M3 7 × 20 warm profile/index     | 5.22 ms, zero requests, 27 cache hits                                         |
| M3 bounded partial timeout       | 37.32 ms, 43% coverage                                                        |
| M4 warm profile + pressure       | 13.22 ms derivation; 18.37 ms recommendation/portfolio; zero network requests |
| M5 8,000-board classification    | 137.60 ms against 13 family definitions                                       |
| M5 aggregate statistics          | 9.80 ms                                                                       |
| M5 total                         | 147.40 ms                                                                     |
| M5 fixture aggregate cold load   | 2.50 ms, 10 immutable details fetched                                         |
| M5 fixture aggregate warm load   | 0.87 ms, 10 cache hits, zero detail fetches                                   |

## Validation results

| Command/check                                               | Result                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                         | passed                                                                                       |
| `npm run lint`                                              | passed                                                                                       |
| `npm run format:check`                                      | passed                                                                                       |
| `npm test`                                                  | passed: 85 tests                                                                             |
| `npm run build`                                             | passed; Vite production bundle built                                                         |
| `npm run m5:live-smoke`                                     | passed; bounded EUW1 Challenger cold/warm validation with real Riot data                     |
| `npm run test:ui`                                           | passed: 15 Playwright tests                                                                  |
| `npm run benchmark:m3`                                      | passed                                                                                       |
| `npm run benchmark:m4`                                      | passed                                                                                       |
| `npm run benchmark:m5`                                      | passed                                                                                       |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | passed using isolated toolchain and D: target/temp policy                                    |
| `cargo test --manifest-path src-tauri/Cargo.toml`           | passed: 5 native tests                                                                       |
| `cargo check --manifest-path src-tauri/Cargo.toml`          | passed                                                                                       |
| `npm run tauri build -- --debug --no-bundle`                | passed; executable at `D:\CodexBuildCache\tft-strategist-m1\target\debug\tft-strategist.exe` |
| `git diff --check`                                          | passed                                                                                       |
| Temporary-key repository/environment audit                  | passed: zero credential-fragment files, no database files, environment removed               |

The Vite build emitted two third-party Rollup annotation warnings from Zod source comments; they are not application console errors and did not fail the build.

## Limitations and risks

- The live sample is only seven matches from two EUW1 Challenger players. Its family statistics demonstrate the pipeline but are not production-scale meta evidence and correctly remain below the 20-game recommendation gate.
- The newly added public page supports final rosters and styles, not all roles/items/openers; unsupported metadata stays unavailable.
- Classifier anchors are curated structural anchors from source boards, not claims that every anchor is an in-game carry or mandatory unit.
- Patch relevance remains unavailable because no Riot-client-build to TFT-content-patch mapping was invented.
- No optimizer variants, named opponent-comp prediction, behavior prediction expansion, runtime LLM truth, Team Planner encoding, or protected-process access was added.

## Acceptance status

M5 implementation and its bounded live Riot validation are complete. No production-scale collection was attempted, no live-derived family was promoted past its evidence gate, and no merge, push, or commit was performed.
