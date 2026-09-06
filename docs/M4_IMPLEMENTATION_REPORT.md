# M4 implementation report

Completed: 2026-09-06  
Branch: `codex/m4-lobby-unit-pressure`

## Outcome

M4 turns the live-proven M3/M3.1 completed-history pipeline into versioned, inspectable unit-history evidence. The default scan now targets 20 relevant games, exposes separate last-five trends and verified ordinary final-board copy evidence, aggregates seven-player lobby unit pressure, changes the explicit recommendation lobby-fit component, and penalizes redundant pressure exposure in the three-plan portfolio.

The implementation does not predict named opponent compositions, intent, or future choices. M3/M3.1 native routing, credentials, rate limiting, retries, deadlines, cancellation, immutable match caching, shared-match deduplication, patch-unavailable semantics, and partial/warm results are preserved. No native/Rust code changed.

## Changed modules

- Domain contracts: `src/domain/models.ts` adds opponent unit evidence, lobby unit pressure, candidate contest breakdown, and acquisition/derivation timing fields.
- Unit-history and lobby strategy: `src/strategy/lobbyPressure.ts` centralizes the M4 configuration, smooth recency, trend labels, lobby aggregation, and candidate contest formula.
- Scouting derivation: `src/services/scouting.ts` derives ranked unit evidence, verified copy signals, versioned profile keys, lobby pressure, and separate timing while retaining the M3 acquisition pipeline.
- Verified rule use: `src/rules/ruleSet.ts` exposes fail-closed ordinary 1/3/9 star-copy lookup from the audited M2 fixture.
- Recommendation and portfolio: `src/strategy/scoring.ts`, `src/strategy/portfolio.ts`, `src/app/App.tsx`, and `src/services/application.ts` integrate live lobby fit before enumeration, add redundant pressured-unit exposure, freeze the adjusted snapshot when a plan is locked, and reject pre-M4 stored portfolio snapshots.
- Settings/storage behavior: `src/storage/repository.ts` changes the default history target to 20 while retaining exactly 10, 15, and 20 as supported values. Existing SQLite profile storage is reused with a new deterministic derivation key; immutable matches are untouched.
- UI: `src/features/RiotScouting.tsx`, `src/components/LobbyPressureSummary.tsx`, `src/features/Home.tsx`, `src/features/Playbook.tsx`, `src/features/DataSettings.tsx`, and `src/styles/app.css` expose detailed opponent signals, lobby pressure, and pressured recommendation units without a broad redesign.
- Fixtures/tests/benchmarks: `src/providers/riotPreview.ts`, `src/test/m4.test.ts`, affected existing tests, `e2e/app.spec.ts`, `scripts/benchmark-m4.ts`, and `package.json`.

## Recency and trend model

Configuration/version: `M4_UNIT_MODEL`, `m4-unit-pressure-v1`, profile base `opponent-unit-evidence-v4`.

For relevant matches sorted newest first, with zero-based ordinal `i` and non-negative age in days `a`:

```text
ordinalWeight(i) = 2 ^ (-i / 10)
ageWeight(a)     = 2 ^ (-a / 14)
recencyWeight    = 0.60 * ordinalWeight + 0.40 * ageWeight
matchWeight      = recencyWeight * verifiedPatchFactor
```

An invalid/unavailable timestamp falls back to the ordinal weight. The verified patch factor remains M3.1 behavior: 1 when patch relevance is unavailable or the explicitly sourced TFT content patch matches, and 0.25 only for an explicitly comparable different TFT content patch. Riot client builds are never compared directly with the product's TFT content-patch label.

This convex half-life blend is monotonically decreasing as either rank or age increases. In the deterministic daily 20-game fixture, the average per-game weight for games 1–5 is more than twice games 16–20, while the newest game contributes less than 10% of total sample weight.

Per-unit evidence retains:

```text
rawPresence        = gamesAppeared / sampleGames
weightedPresence   = Σ(matchWeight * appeared) / Σ(matchWeight)
recentFiveRate     = appearances in games 1–5 / available games in that window
priorWindowRate    = appearances in games 6–20 / available prior games
trendDelta         = recentFiveRate - priorWindowRate
```

Trend labels use versioned product thresholds, not TFT truth: rising at `delta >= +0.20`, falling at `delta <= -0.20`, stable between those values, and unavailable when no prior window exists. Placement remains contextual evidence and is not converted into a choice probability.

The prior M3 confidence model remains evidence quality:

```text
sample coverage * recency quality * mode quality * comparable patch quality
```

Patch quality remains neutral when unavailable. Confidence is not a future-behavior probability.

## Historical star/copy evidence

M4 uses only M2's verified ordinary copy math: one-star = 1, two-star = 3, three-star = 9. Copy evidence is enabled only when the current static catalog marks the champion `boardEligible` and `shopStatus = pool`.

For one unit in one final board, ordinary copies from duplicate entries are summed and conservatively capped at nine. An unresolved unit, a non-pool/special unit, or a star tier outside 1–3 makes that game-unit copy observation unavailable. The profile retains copy-evidence game count and coverage rather than silently filling missing values.

```text
weightedAverageFinalCopies = Σ(matchWeight * supportedFinalCopies)
                             / Σ(matchWeight for supported appearances)

weightedHistoricalDemand  = Σ(matchWeight * supportedFinalCopies)
                             / Σ(matchWeight for every sampled game)
```

These fields describe historical final boards only. They do not include bench/shop holdings and do not predict what the opponent will buy next.

## Lobby unit-pressure formula

For opponent `o`, unit `u`, evidence confidence `C`, weighted presence `P`, positive trend delta `R`, and weighted copy demand `H`:

```text
baseEquivalentUsers(u) = Σo C(o) * P(o,u)
recentSpikeUsers(u)     = Σo C(o) * max(0, R(o,u))
copyExtraUsers(u)       = Σo C(o) * max(0, H(o,u) - P(o,u)) / 8

totalEquivalentUsers(u) = min(7,
  baseEquivalentUsers + 0.35 * recentSpikeUsers + 0.25 * copyExtraUsers)

normalizedPressure(u) = totalEquivalentUsers / 7
evidenceCoverage      = Σo C(o) / 7
```

Subtracting presence from copy demand isolates copies beyond a one-star presence; division by eight maps the verified one-to-nine ordinary range into a bounded extra-copy signal. A unit counts as having meaningful evidence from an opponent when either weighted presence or recent-five rate is at least 0.15. That threshold affects only the displayed opponent count, not the continuous pressure formula.

Every current board-eligible set champion receives a lobby-pressure record, including zero-pressure records. Source opponent IDs, confidence, presence, recent rate/delta, and copy demand remain inspectable. Pressure always uses a seven-opponent denominator, so a one- or three-profile partial scan cannot masquerade as complete lobby certainty.

## Candidate contest and recommendation integration

For each playbook unit with lobby pressure, M4 derives an inspectable contribution:

```text
unitContribution = normalizedPressure
                 * seededUnitCriticality
                 * roleFactor
                 * membershipFactor
                 * seededContestElasticity
                 * curatedRollStyleFactor
                 / 2
```

Configured role factors are carry 1.25, tank 1.05, support 0.60, and unassigned 0.75. Core membership is 1.15; flex membership is 0.55. Explicitly curated slow-roll styles use 1.15; other styles use 1.00. These are centralized product coefficients, not measured TFT win-rate truth.

```text
contestPenalty = clamp(Σ unitContribution, 0, 1)
lobbyFit       = 100 * clamp(0.50 + 0.50 * evidenceCoverage - contestPenalty, 0, 1)
```

Contest is Low below 0.20, Medium from 0.20, and High from 0.50. Full high-quality evidence with no overlap can produce a strong fit; partial evidence shrinks toward neutral. With no lobby evidence, the component is explicitly unavailable and contributes the existing neutral 50 × 0.10 = 5 points. Lobby fit remains its visible 10% recommendation component; other seeded meta/floor/ceiling inputs were not recalibrated.

The returned breakdown includes each pressured unit's stable ID, criticality, role, core/flex membership, equivalent historical users, normalized pressure, exact contribution, evidence coverage, contest elasticity, roll-style factor, state, and note.

## Portfolio integration

Candidates receive their M4 lobby fit before portfolio enumeration. The portfolio also adds:

```text
redundantExposure = Σu (Σ candidateUnitContribution(u) - max candidateUnitContribution(u))
interactionValue  = -24 * redundantExposure
```

Only the repeated portion of a pressured unit is penalized; the first/best exposure is retained. The interaction is displayed as `Redundant pressured-unit exposure`. Portfolio version is `portfolio-v2-m4-unit-pressure`.

## Persistence and invalidation

Completed matches remain immutable and are never deleted or refetched because a formula changes. Derived profiles are stored under a deterministic version containing:

- profile derivation base version;
- configured history target;
- static source version;
- fingerprint of the copy-eligible unit catalog;
- existing set and TFT content-patch storage key fields.

Source match IDs remain on the profile and their fingerprint remains stored with it. A new source/index refresh recomputes and replaces the derived profile; a stale valid profile can still surface immediately while refresh runs. Changing formulas, target, static source, or copy eligibility misses the old profile key and recomputes from cached match/index data without requiring Riot network requests.

Lobby pressure is included in the existing scan snapshot with `m4-unit-pressure-v1`; no additional migration or destructive cache operation was required.

## Targeted UI changes

- Opponent cards show the top three signals immediately and expand to the top 12 ranked unit signals with portrait/name, stable ID, weighted percentage, raw games, last-five count, trend/delta, and ordinary final-copy evidence where available.
- Scouting shows acquisition and M4 derivation timing separately.
- Lobby pressure appears as a compact portrait strip and expands to base equivalent users, recent-spike contribution, and copy contribution.
- Recommendation cards show historical contest state and the top three pressured critical units with equivalent historical users.
- Playbook explanation shows exact lobby fit and the top three unit contributions plus coverage, criticality provenance, elasticity, and roll-style factor.
- Partial identity resolution, self-entry, unresolved data, and unavailable evidence retain explicit non-fabricated states.

## Tests and benchmarks run

Final acceptance commands:

| Check | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm test -- --run` | passed: 74 tests in 8 files |
| `npm run format:check` | passed |
| `npm run build` | passed |
| `npm run test:ui` | passed: 12 Playwright tests |
| `npm run benchmark:m3` | passed |
| `npm run benchmark:m4` | passed |
| `git diff --check` | passed |

No Rust/native source changed, so the task packet did not require a Rust test/check or native rebuild. The M3/M3.1 TypeScript provider, cache, rate-limit-facing contracts, deadline, routing, normalization, and secret-redaction suites remain included in the 74 passing tests.

Focused deterministic M4 tests cover the 20-game default and 10/15 support, smooth newest-game weighting, recent spike and falling-history cases, raw versus weighted frequency, fail-closed copy evidence, seven-profile aggregation, confidence-proportional pressure, high-criticality versus flex overlap, no-lobby neutrality, candidate reordering, and redundant portfolio exposure.

### M3 fixture acquisition benchmark

These are in-memory fixture timings, not live Riot latency:

| Scenario | Elapsed | Requests | Cache hits | Details fetched | Shared refs reused | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 × 10 cold | 9.12 ms | 11 | 0 | 10 | 0 | 100% |
| 7 × 10 cold | 2.49 ms | 17 | 0 | 10 | 60 | 100% |
| 7 × 20 cold | 4.35 ms | 27 | 0 | 20 | 120 | 100% |
| 7 × 20 warm immutable matches | 3.88 ms | 7 | 20 | 0 | 120 | 100% |
| 7 × 20 warm profile/index | 2.81 ms | 0 | 27 | 0 | 120 | 100% |
| 7 × 10 timeout/partial | 33.75 ms | 0 | 10 | 0 | 20 | 43% |

Retries and rate-limit waits were zero in every fixture scenario.

### M4 warm derivation benchmark

The 7 × 20 cached fixture used zero network requests and 27 cache hits. Acquisition/persistence orchestration was 2.84 ms, opponent profiles plus lobby pressure were 9.83 ms, and candidate scoring plus portfolio optimization were 6.30 ms. It derived 12 active unit signals and three plans. This is a local fixture CPU/cache result, not Riot latency.

## Rendered inspection

The fixture M4 flow was run and inspected at 1440, 1000, and 860 px desktop widths. Playwright expanded both lobby pressure and a 12-unit opponent profile, asserted document/main-pane horizontal bounds, and captured the scouting, home, and playbook flows. Hands-on computer-use inspection separately exercised the scan, expanded opponent signals, pressure-adjusted portfolio, and the scrolled playbook contest explanation at 1440 and 860 px. The expanded profile grid was adjusted to top-align cards after visual review. No browser console warning/error remained.

Observed UI evidence included 7/7 profiles, 140/140 relevant games, explicit patch relevance unavailable, last-five rising/falling examples, ordinary copy evidence, lobby equivalent users, recommendation pressure tags, and per-unit candidate penalty contributions.

## Live versus fixture evidence

No new live Riot request was performed for M4. The UI and benchmark evidence above are deterministic fixture/in-memory results. M3.1's September 6 live EUN1 validation remains the latest live evidence for native key isolation, Riot ID resolution, match-v1 retrieval, real limit waits/retries, bounded partial output, and warm caching. M4 consumes the same normalized immutable completed matches and does not change native HTTP behavior.

No personal match payload or API credential was added to fixtures, logs, screenshots, storage, or documentation.

## Remaining risks and limitations

- Riot client-build to TFT content-patch relevance remains unavailable until a verified public mapping exists; M4 keeps it neutral.
- Pressure coefficients, trend thresholds, role/core factors, roll-style factor, and recommendation weights are deterministic seeded configuration, not outcome-calibrated statistics.
- Completed-match boards do not expose every bench/shop copy held during a game. Copy demand is conservative final-board history only.
- Non-pool, special, unresolved, and unsupported star-tier copy evidence is unavailable by design.
- Unit pressure does not predict a named composition or what any opponent will choose next.
- The current playbooks and meta/floor/ceiling values remain seeded/Experimental, and the bundled combat parity remains known stale as documented by M2.
- A future live smoke should confirm M4 profile recomputation from a real SQLite immutable-match cache and inspect real profile density; fixture performance cannot predict Riot latency.

## Recommended next milestone

Proceed to measured current meta/comp evidence and recommendation calibration while keeping M4 unit pressure as a separate inspectable input. Outcome evidence should calibrate the seeded score components and confidence before comp discovery, variants, promotion thresholds, or the broader Comps/UI polish pass.
