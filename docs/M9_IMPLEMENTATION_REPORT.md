# M9 Implementation Report — Post-Game Reconciliation & Personal Learning

Date: 2026-09-06  
Branch: `codex/m9-postgame-personal-learning`

## Outcome

M9 adds a bounded, explicit post-game workflow over M8's immutable session history. The app reconstructs switch chains, checks up to five recent completed matches through the existing Riot provider/cache, conservatively ranks plausible account/set/mode/time candidates, auto-links only a unique high-confidence result, and requires explicit confirmation when evidence is ambiguous. Match, review and personal-model records live outside the M8 lock snapshot.

Matched games produce a concise deterministic review using the existing M5 family classifier and M6 canonical-board/similarity primitives. Personal learning activates only when the terminal route is confidently attributed and a compatible eligible lock-time M5 family baseline exists. Its recommendation contribution is intentionally smaller than the authority ceiling.

The new Post-game route shows recent logical sessions, reconciliation state, switch chain, explicit check/confirm/reject/unlink controls, placement/final-family review, evidence boundaries, current-set personal sample/confidence, stale review state and old-set exclusion. No broad product redesign was performed.

## Schema and storage

Versions:

- reconciliation schema 1; model `postgame-reconciliation-v1`;
- review schema 1; model `postgame-review-v1`;
- personal schema 1; model `personal-residual-v1`;
- native migration 4 in `schema_m9.sql`.

`postgame_reconciliations` is keyed by logical `chain_id`, with unique `terminal_session_id` and nullable unique `match_id`. State is `unmatched | candidate | matched | ambiguous | rejected`. The payload retains ranked candidates, evidence components, PUUID/platform context, decision source and the complete `checked | auto-matched | confirmed | rejected | unlinked` audit trail.

`postgame_reviews` is keyed by chain with a unique match ID and derivation fingerprint. The existing `personal_profiles` table stores one current derived profile per set. Browser local storage and memory repositories implement the same one-to-one and no-silent-relink checks. A matched link must be explicitly unlinked before another match can be chosen.

The terminal M8 session may receive only the outer `reconciliation.matchId`. If it was active, explicit matched reconciliation ends it with the backward-compatible `completed` end reason. The immutable `snapshot`, snapshot fingerprint, selected family, frozen portfolio, M4/M5/M6 evidence and manual path are never rewritten. Already-ended `replaced` and `ended-without-result` records retain their historical end semantics.

## Session chains and attribution

A chain begins at a session whose `replacesSessionId` is absent/unresolved and follows `replacedBySessionId` until the final successor. The full ordered chain remains visible. The final successor is the terminal selected route.

Review comparison and personal attribution use only the terminal snapshot. An abandoned predecessor is never penalized for a terminal board. If the final board confidently classifies as the terminal family it is `same-family`; a final family reachable through a frozen terminal-plan pivot edge is `pivot-destination`; another confidently classified family is `other-family`; ambiguous/unclassified evidence remains `unknown`. Personal attribution is withheld for unknown, mismatched or fail-closed canonical boards.

## Riot timestamp semantics and reconciliation formula

The inspected official TFT match reference documents `info.game_datetime` only as a Unix timestamp and `info.game_length` as game length in seconds; it does not define `game_datetime` as game start or game end. The previous normalizer copied that value into `gameTimestamp` and the legacy `completedAt` alias. M9 now additionally preserves:

- `gameTimestampSemantics = riot-game-datetime-unspecified` for native Riot payloads;
- documented `game_length` as nullable `gameDurationSeconds`;
- `fixture-completed-at` only for explicit deterministic fixtures.

M9 does not relabel the Riot timestamp as a proven completion time. Timing compares the chain lock/end against both possible interpretations: anchor-as-start and anchor-as-end. With duration `d`, lock delta is the smaller of `|anchor-lock|` and `|anchor-d-lock|`; end delta is the smaller of `|anchor-end|` and `|anchor+d-end|`. A candidate is timing-plausible only when lock delta is at most 90 minutes and, if the session ended, end delta is at most 100 minutes.

Candidate score:

`0.40 account + 0.20 set + 0.20 timing + 0.10 mode + 0.10 platform`

where:

- exact PUUID participation, exact set and non-unsupported mode are mandatory gates;
- timing is `0.75 × exp(-lockDelta/35m) + 0.25 × endTerm`;
- `endTerm = 0.5` for an active terminal or `exp(-endDelta/45m)` otherwise;
- supported mode scores 1; unverified mode scores 0.55;
- matching match-ID platform prefix scores 1; unavailable platform evidence scores 0.35.

Candidates below 0.72 are discarded. Automatic linking requires one candidate at least 0.86 and a margin of at least 0.12 over the runner-up. Multiple plausible candidates are `ambiguous`; a lone lower-confidence candidate is `candidate`. Neither state writes a match link until the user confirms. Family similarity, placement and selected comp never participate in candidate ranking.

The explicit check horizon is five recent IDs. A recent five-minute index and every immutable match detail are reused from the existing M3 cache. The review render path makes no network request.

## Review evidence and invalidation

Each review retains:

- chain/session/terminal/match IDs;
- review, classifier, canonical and similarity versions;
- immutable match fingerprint, saved static fingerprint and selected-target fingerprint;
- final participant placement, level, units/stars, validated item/augment availability state;
- final canonical board and classifier evidence;
- selected target versus final similarity, core present/missing, added final units and capacity/size;
- compatible M5 baseline identity, sample, confidence, expected placement/top-four and placement residual;
- deterministic summary, at most one evidence-bounded adjustment, attribution gate and evidence gaps.

Review compatibility is checked against model versions, terminal snapshot, target and saved static fingerprint. Stale derivations remain visible and are excluded from personal learning until an explicit local rebuild from the immutable match cache.

Item and augment output is descriptive only when IDs validate against the saved static snapshot. Empty normalized arrays are a valid observation but are never penalized because acquisition opportunity is unknown. There is no BIS score.

An M5 baseline is available only when the terminal lock snapshot contains the classified family's statistic, the aggregate dataset identity exists, match/set is compatible and the statistic passed M5's `eligible` quality gate. Residual is `shrunk expected family placement - observed placement`, so positive is better than baseline. No raw-placement skill signal is learned when baseline is unavailable.

## Causality and unavailable boundaries

Review text may describe placement, terminal route, switch sequence, structural family relation, selected core presence, target/final similarity and compatible aggregate-baseline residual. It does not claim why the user won or lost.

The review explicitly states that completed-match data does not establish shop decisions, bench state, exact economy, round-by-round positioning, acquisition opportunities, HP trajectory or roll timing. It never emits “lost because,” “rolled too late,” “this item caused the loss,” or positioning prescriptions from end-state evidence. `No evidence-backed adjustment identified` is a supported result.

## Personal model

Eligibility requires all of:

- matched reconciliation and unique match ID;
- current active set;
- final board confidently classified as the terminal family;
- canonical target/final similarity evidence;
- attribution confidence at least 0.65;
- compatible eligible M5 baseline and non-null placement residual.

Attribution confidence is:

`0.45 × classifier score + 0.25 × min(1, classifier margin / 0.20) + 0.30 × board similarity`

For eligible family game `i`:

- winsorized residual `r_i = clamp((baselineExpectedPlacement - placement) / 3, -1, 1)`;
- recency `q_i = 0.5^(ageDays / 45)`;
- evidence weight `w_i = q_i × attributionConfidence × baselineConfidence`;
- weighted family residual `R = Σ(w_i r_i) / Σw_i`;
- shrunk residual `R_s = R × n_eff / (n_eff + 20)`;
- confidence `C = n_eff / (n_eff + 25)`.

Fewer than five raw attributed family games force adjustment and confidence to zero. Family affinity is `clamp(R_s, -0.35, 0.35)`. Match IDs are deduplicated before derivation. Old-set, ambiguous, unclassified, wrong-family, stale-review, baseline-unavailable and unreconciled sessions contribute nothing. There is no cross-set transfer. One first or eighth therefore remains exactly neutral, and even a mature run stays strongly shrunk.

Strength/weakness text appears only at 10 games, confidence at least 0.20 and absolute affinity at least 0.04. It reports only above/below-baseline family evidence with sample/confidence; no psychological or causal labels are generated.

## Recommendation influence

The existing personal component is now populated from `personal-residual-v1`; M4 lobby, M5 meta, M6 discovery, M7 strategy and portfolio optimization are unchanged and independently testable.

Configured weight remains clamped to 0.05–0.10 with 0.05 default. Same-patch contribution is:

`personal score points = configuredWeight × 50 × familyAffinity`

Exact maximum absolute influence is therefore:

- default 5%: `0.05 × 50 × 0.35 = 0.875` score points;
- normal maximum 10%: `0.10 × 50 × 0.35 = 1.75` score points.

A same-set patch mismatch applies an additional 0.25 relevance multiplier. Missing/insufficient evidence is a visible neutral component with family games and confidence. Tests show mature evidence can nudge a close score but cannot overwhelm materially stronger meta/lobby inputs.

## Live versus fixture evidence

`RIOT_API_KEY` was absent during the final M9 run, and no existing app SQLite database/session was found at the expected application-data path. Consequently no new live Riot request or real user-session reconciliation was performed, and this report does not claim one.

The native acquisition path remains the same M3–M6 provider, credential boundary, rate-limit handling and immutable match cache previously live-validated. M9 adds normalization for documented `game_length` and explicit unspecified timestamp semantics. Deterministic fixture evidence exercises cold index/detail acquisition, warm immutable detail reuse, exact PUUID participation, candidate ranking, unique auto-match, two-candidate ambiguity/manual confirmation, active-session completion and review rebuild. No fake M8 session was written to persistent user storage; browser fixtures are isolated Playwright contexts and unit fixtures use in-memory repositories.

Credential audit: no API key, auth header or secret field is accepted by reconciliation/review/personal schemas or persisted tables. Existing native error redaction tests remain green.

## Validation

Completed checks:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test -- --run`: passed, 135 tests in 13 files, including 12 M9 tests.
- `npm run build`: passed; existing third-party Zod annotation and bundle-size warnings only.
- `npm run test:ui`: passed, 27 Playwright tests including the complete M9 flow at 1440, 1000 and 860 px.
- native `cargo fmt -- --check`: passed with the repository-local isolated toolchain.
- native `cargo test`: passed, 5 tests.
- native `cargo check`: passed.
- `npm run tauri build -- --debug --no-bundle`: passed; executable at `D:\CodexBuildCache\tft-strategist-m1\target\debug\tft-strategist.exe`.
- `git diff --check`: passed (Git emitted only expected LF→CRLF working-copy notices).

Regression benchmarks:

| Benchmark | Result |
| --- | ---: |
| M3 1×10 cold | 9.03 ms |
| M3 7×20 cold / warm immutable / warm profile | 4.35 / 3.50 / 3.82 ms |
| M3 partial timeout | 36.73 ms, 43% coverage |
| M4 warm acquisition / profile+pressure / candidate+portfolio | 3.06 / 11.71 / 67.87 ms |
| M5 8,000 classification / statistics | 128.19 / 7.82 ms |
| M5 aggregate cold / warm | 1.96 / 0.81 ms |
| M6 canonicalize 20,000 / similarity 100,000 | 423.69 / 366.68 ms |
| M6 cluster 1,000 / 8,000 / 20,000 | 142.95 / 497.77 / 937.53 ms |
| M7 load / validate all | 36.6924 / 37.4433 ms/op |
| M7 Decision Map / pivot graph / board fingerprint | 0.0011 / 0.0220 / 0.0038 ms/op |
| M8 lock / persist / resume / manual / switch | 20.38 / 12.83 / 1.94 / 1.92 / 31.77 ms |
| M9 rank 2,000 candidate batches | 10.02 ms |
| M9 derive 500 reviews | 1,403.92 ms |
| M9 rebuild 20 / 100 / 500 games ×100 | 4.60 / 16.49 / 114.43 ms |
| M9 score 5,000 candidates with personal evidence | 12.13 ms |
| M9 warm history/review load ×100 | 475.36 ms |

## Rendered inspection

Playwright and direct screenshot inspection covered 1440, 1000 and 860 px. Exercised states:

- unreconciled saved chain and explicit `Check completed match`;
- successful matched review;
- ambiguous two-candidate state and manual confirmation;
- two-plan switch chain with terminal attribution label;
- insufficient personal evidence;
- mature 20-review fixture personal evidence;
- old-set session excluded from learning;
- explicit unlink/reject controls;
- no document/main horizontal overflow and no page errors.

Reviewed captures include `artifacts/m9-matched-1440.png`, `artifacts/m9-ambiguous-1000.png` and `artifacts/m9-mature-stale-860.png`, with complete width/state variants beside them. The history surface remains compact, visually consistent with M8, and readable at the 860 px Tauri minimum.

## Remaining gaps and recommended M10 hardening

- Perform fixture-assisted live M9 acquisition when a temporary key is available, or genuine reconciliation when a real M8 session exists. Do not manufacture persistent history.
- Riot's public TFT DTO still does not define `game_datetime` start/end semantics. Keep the dual-interpretation tolerance and manual ambiguity path unless stronger official evidence appears.
- Queue IDs and game-type values remain evidence-bounded by the existing normalizer; M9 rejects explicitly unsupported modes and discounts unverified ones rather than inventing a queue map.
- The browser repository cannot provide cross-tab transactions comparable to SQLite; shipped Tauri uniqueness is database-enforced.
- Team Planner remains unverified/disabled under the existing M8 gate.

Recommended M10 scope: final release hardening, real-user workflow validation, packaging/startup checks, accessibility polish, review-copy usability feedback and a bounded live M9 smoke run when credentials/session evidence are available. Do not expand into live telemetry, causal coaching or broad strategy research.
