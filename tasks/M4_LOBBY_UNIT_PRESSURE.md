# M4 — Smart Unit-History Scouting, Lobby Pressure & Recommendation Fit

## Goal
Turn the live-proven M3/M3.1 Riot history pipeline into useful, inspectable **unit-centric lobby intelligence** that improves the three-plan recommendation portfolio without pretending to know what composition an opponent will play next.

M4 should answer:

> Which champions have these opponents repeatedly used recently, how strong/recent is that historical signal, which units are currently under the most lobby pressure, and how exposed is each candidate playbook to that pressure?

This milestone is intentionally **evidence-first and unit-centric**. Do not make comp-family prediction the core of M4.

Read `AGENTS.md` and all governing authority it references before changing code. Treat this task packet as highest authority for this milestone.

## Baseline
M3/M3.1 already provide:
- native-only Riot credentials and HTTP;
- live-proven Riot ID resolution and `tft-match-v1` history retrieval;
- explicit routing, rate-limit handling, retries, deadlines, cancellation;
- persistent SQLite identity/index/match/profile/snapshot caches;
- shared-match deduplication;
- up to seven opponents;
- 10/15/20 relevant-game targets and a 60 raw-ID horizon;
- completed-match units, star tiers, traits, augments and placement evidence;
- recency-aware evidence confidence;
- explicit `patch relevance unavailable` when no verified TFT-content-patch mapping exists;
- no fake opponent comp/style classification;
- current recommendation code with seeded playbook `unitCriticality`, `contestElasticity`, and a basic lobby/contest component.

M3.1 live validation observed a real 20/20 cached profile with patch relevance unavailable, inspectable confidence factors and a warm scan completing with zero network requests. Preserve those guarantees.

## Product decision locked for M4

### 1. Default history target becomes 20 relevant games
Use **20** as the default scouting target. Keep 10 and 15 available as lower-cost options if the existing setting supports them.

Do not increase the raw history horizon without evidence that the current 60-ID bound is insufficient. A partial result remains valid when fewer than 20 relevant games exist.

### 2. Recent games matter more
The newest games must influence unit-history evidence more than older games.

Use a deterministic, versioned recency model that combines:
- ordinal recency within the relevant sample; and
- actual age/time recency when available.

The exact coefficients are model configuration, not TFT truth. Keep them inspectable and centralized. Requirements:
- weight must decrease monotonically as games become older / farther back;
- games 1–5 should have materially more influence per game than games 16–20;
- no single game should dominate the whole 20-game sample;
- the existing M3.1 confidence model remains evidence-quality confidence and must not be reused as a prediction probability;
- patch relevance remains neutral/unavailable unless a verified mapping exists.

A sensible starting point may use a smooth half-life style decay rather than hard buckets. If you choose a concrete formula, document it and add deterministic tests.

### 3. Expose a separate recent-five trend signal
In addition to weighted 20-game frequency, compute a simple, inspectable **last-5** signal per unit.

For each unit that appears in the sample, retain at least:
- raw games appeared / sample games;
- weighted presence frequency over the full sample;
- last-5 appearances and rate;
- prior-window rate (games 6–20 when available);
- trend delta = last-5 rate minus prior-window rate;
- optional rising / stable / falling label from versioned thresholds.

Do not infer intent. A rising signal means only that the unit appeared more often in the newest games.

### 4. Historical unit demand signal may use star-copy evidence
M2 verified ordinary star-copy math (1 / 3 / 9 copies). Completed matches contain unit star tier.

Use this only as **historical final-board demand evidence**, not as a prediction that the opponent will buy the same number next game.

For each unit/opponent, it is acceptable and encouraged to derive an inspectable field such as:
- weighted average final copies when the unit appeared;
- weighted historical copy-demand signal = presence × observed final copy count;

Label it as historical evidence. Preserve unknown/special-unit cases safely; do not generalize unsupported special rules.

## Opponent unit profile
Upgrade the M3 opponent profile so the UI and strategy layer can inspect more than the current top-three repeated units.

For each opponent, retain a ranked unit-evidence list with enough data to show roughly the top 10–15 meaningful units, including:
- champion stable ID / current display name;
- weighted presence;
- raw appearance count;
- recent-5 count/rate;
- trend delta/label;
- historical copy-demand evidence when supported;
- opponent evidence confidence;
- unresolved-state handling.

Traits and augments may remain available as supporting evidence, but **do not use them to claim the opponent is playing or will play a named comp** in M4.

Average placement/top-4 evidence can remain visible as context, but placement does not turn unit frequency into a future-choice probability.

## Lobby-wide unit pressure
Aggregate the resolved opponent profiles into an inspectable lobby-level unit pressure model.

For each current-set champion, derive fields such as:
- number of opponents with meaningful recent evidence for the unit;
- confidence-weighted unit presence across opponents;
- recent-5 spike contribution;
- historical copy-demand contribution when available;
- total / normalized lobby pressure;
- evidence coverage and source opponent IDs/profiles.

Prefer interpretable intermediate values. An intuitive measure like `confidence-weighted equivalent historical users` is better than an unexplained magic percentage.

Do not call this `probability opponent will play unit`. Use language such as:
- historical pressure;
- recent unit pressure;
- lobby unit pressure;
- historical demand signal.

Pressure must degrade gracefully when only some opponents resolve or when a profile has low confidence.

## Candidate/playbook contest fit
Replace/refine the current crude `contestFor()` calculation with the M4 lobby pressure evidence.

Use the existing playbook metadata where available:
- `features.unitCriticality`;
- `features.contestElasticity`;
- core unit membership;
- carry/tank role metadata;
- target board / reroll style where explicitly curated.

Important requirements:
- critical carry / reroll core overlap matters much more than a replaceable flex/support unit;
- a one-star flexible utility overlap should contribute little;
- a frequently 3-starred historical unit may contribute more pool-pressure evidence than a normally one-star unit, but do not overstate prediction certainty;
- flexible/low-criticality units must reduce the penalty relative to core units;
- playbook `unitCriticality` and `contestElasticity` are currently seeded/curated metadata, so preserve provenance and do not present the resulting contest score as measured win-rate truth.

Return an inspectable breakdown for each candidate, not only `High/Medium/Low`:
- overall contest state/value;
- top pressured units in this playbook;
- each unit's criticality;
- lobby historical pressure for that unit;
- contribution to candidate penalty;
- evidence/coverage note.

## Recommendation integration
Use the new contest result in the existing recommendation score's `Lobby / contest fit` component.

Do **not** broadly recalibrate the entire recommendation engine in M4. Meta/floor/ceiling/etc. remain seeded until later measured strategy work.

Requirements:
- retain the existing explicit lobby component rather than hiding contest pressure inside another score;
- candidate score must visibly change when high-criticality units become heavily pressured in a deterministic fixture;
- low-criticality overlap should have a materially smaller effect;
- no lobby data must remain neutral/unavailable, not silently treated as a strong or weak lobby;
- partial lobby evidence should influence the score proportionally to coverage/confidence rather than acting as complete certainty.

## Three-plan portfolio
Ensure the three-plan optimizer benefits from M4 candidate contest fit.

At minimum, individual candidate scores must incorporate lobby fit before portfolio enumeration. Additionally, add an inspectable portfolio interaction if useful so that three recommendations are not all exposed to the same high-pressure scarce units.

Do not overfit to the current four example playbooks. The implementation must work when the Comp Library later contains many candidates.

## Targeted UI changes only
M4 is not the general visual-polish milestone, but the new evidence must be usable.

### Opponent evidence card
Replace the current `Repeated units: A, B, C`-only presentation with a compact expandable/inspectable view that can show approximately the top 10–15 unit signals without creating an information wall.

For each displayed unit, prefer concise fields such as:
- portrait + name;
- weighted history %;
- raw games, e.g. `8/20`;
- last-5 signal, e.g. `4/5`;
- trend arrow/label;
- optional historical copy-demand note where meaningful.

Keep average placement/top-4/confidence as secondary context.

### Lobby pressure summary
Add a compact lobby-wide unit-pressure section showing the strongest current historical unit pressure across all resolved opponents.

This should be useful at a glance and expandable for detail. Avoid generic prose/slogans.

### Recommendation cards / playbook explanation
Surface contest pressure on recommendation cards or their existing explanation area. A user should be able to see why a plan is being penalized, including the top 1–3 pressured critical units.

Do not perform the broader UI cleanup yet (renaming Playbook Library to Comps, removing AI-ish microcopy, full density redesign, board positioning overhaul). Those remain a later product pass unless a tiny label change is necessary for M4 clarity.

## No comp prediction in M4
Do not create or display claims such as:
- `This player will play AP Summoners`;
- `70% chance of Hunter`;
- `likely comp = X`.

Do not derive ForceIndex/FlexIndex from guessed comp families in this milestone.

If a future family classifier is added, it must have its own validated methodology and evidence threshold. M4 deliberately avoids that dependency.

## Policy / product boundary
Preserve the existing read-only Riot boundary and manual/pre-game scouting workflow. Do not add protected-process access, automatic gameplay interaction, hidden client inspection, or a substitute for unavailable official APIs.

Keep the existing policy warning/limitations where relevant. M4 is historical evidence analysis, not live board/shop/bench state.

## Persistence/versioning
Version all new derivations. A change to recency weights/trend thresholds/pressure formula must invalidate or migrate stale derived profiles safely without deleting immutable completed matches.

Prefer recomputation from cached completed matches over refetching Riot data.

Persist/reuse derived unit-pressure data only when this improves warm behavior and can be invalidated deterministically from:
- derivation version;
- opponent profile source match IDs/version;
- relevant set;
- configuration/history target.

## Required tests
Add deterministic tests covering at least:

1. **20-game default** while 10/15 remain supported.
2. Newest games receive greater weight than older games.
3. A unit appearing 4/5 recently but rarely before is labeled/tracked as a recent spike.
4. A unit common historically but absent in the last 5 trends downward without disappearing from the 20-game profile.
5. Raw frequency and weighted frequency are both correct for a known fixture.
6. Star-copy historical demand uses only verified ordinary copy math and fails safely for unsupported cases.
7. Seven profiles aggregate into expected unit pressure deterministically.
8. Low-confidence/partial opponent evidence contributes less pressure than equivalent high-confidence evidence.
9. Shared high-criticality carry overlap produces a larger candidate contest penalty than a low-criticality flex overlap.
10. No-lobby evidence leaves the lobby score unavailable/neutral.
11. Candidate ordering can change due to M4 lobby pressure in a controlled fixture.
12. Portfolio output avoids/reduces redundant high-pressure exposure when an otherwise-comparable alternative exists.
13. Existing M3/M3.1 cache/rate-limit/deadline/security tests remain green.
14. UI test verifies more than three unit signals are accessible, recent-5/trend is visible, lobby pressure is visible, and contest explanation appears on a recommendation/playbook.
15. Partial scans and unresolved IDs render safely without fabricated data.

## Benchmark / performance acceptance
Run existing M3 benchmarks and add an M4 derivation benchmark if useful.

The new intelligence layer should be CPU-cheap relative to Riot I/O. On warm cached history, computing profiles + lobby pressure + recommendation contest fit should be effectively immediate on this workstation and should not trigger network fetches simply because derived formulas changed.

Report separately:
- Riot/network/cache acquisition timing;
- M4 derivation timing.

Do not present fixture timings as live Riot latency.

## Acceptance gates
Run and report:
- `npm run typecheck`;
- `npm run lint`;
- full TypeScript tests;
- `npm run format:check`;
- `npm run build`;
- full Playwright/UI suite;
- existing M3 benchmark plus any M4 benchmark;
- Rust tests/checks only if native/Rust code is changed; otherwise state why a native rebuild was unnecessary;
- `git diff --check`.

Run the application and inspect the rendered M4 flow at normal desktop width and at the existing responsive widths. Check information density, readability, and no horizontal overflow.

## Implementation report
Create `docs/M4_IMPLEMENTATION_REPORT.md` containing:
- changed modules;
- exact recency/trend/pressure formulas and configuration;
- derivation/versioning decisions;
- how star/copy evidence is used and bounded;
- candidate contest formula and inspectable breakdown;
- portfolio integration;
- UI changes;
- tests and benchmarks actually run;
- live-vs-fixture evidence distinction;
- unresolved risks/limitations;
- recommended next milestone.

## Out of scope
Do not implement in M4:
- automatic comp-family prediction;
- broad meta/outcome calibration;
- measured Proven/Variant/Emerging promotion thresholds;
- comp discovery/flex-slot generation;
- Team Planner codec enablement;
- personal-history expansion;
- post-game coaching expansion;
- broad visual redesign / copy cleanup;
- protected-process/live-board/shop/bench access;
- runtime LLM decision logic.

## Expected next step after M4
After M4, the product should have trustworthy live history plus useful lobby unit-pressure intelligence. The next major milestone can focus on **measured meta/comp evidence and recommendation calibration**, followed by comp discovery/variants and the broader Comps/UI polish pass.