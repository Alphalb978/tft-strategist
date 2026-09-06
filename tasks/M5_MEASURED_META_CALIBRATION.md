# M5 — Measured Meta Evidence, Comp Library Expansion & Recommendation Calibration

## Goal
Replace the weakest remaining part of TFT Strategist — the tiny four-playbook, seeded-strength candidate pool — with a larger, current, provenance-backed Set 18 comp library and measured aggregate outcome evidence.

M5 should answer:

> What current Set 18 plans are actually supported by evidence, how often and how well do they perform in a clearly defined sample, how confident are we in those measurements, and how should that measured evidence influence the three recommended plans alongside M4 lobby unit pressure?

This milestone is **aggregate meta measurement and calibration**, not more opponent scouting and not free-form comp invention.

Read `AGENTS.md` and all governing authority it references before changing code. Treat this task packet as highest authority for this milestone.

## Baseline
M1–M4 already provide:
- Tauri/React/TypeScript architecture with provider → domain → rules → strategy → UI separation;
- audited Set 18 static data/rules and explicit stale/unverified states;
- four curated Set 18 playbooks with source provenance;
- deterministic candidate scoring and three-plan portfolio optimization;
- live-proven Riot account/match routing, native-only credential boundary, rate-limit/retry/deadline behavior, immutable match caching and SQLite persistence;
- M3.1 patch/build calibration and explicit `patch relevance unavailable` when no verified mapping exists;
- M4 20-game recency-weighted opponent unit evidence, last-five trend, lobby unit pressure, per-unit contest breakdown, and recommendation/portfolio integration;
- current playbook `meta`, `floor`, `ceiling` and related values are still seeded demonstration inputs rather than measured outcome statistics.

Preserve all M1–M4 behavior unless this task explicitly replaces a seeded meta component with a measured equivalent.

## Product decisions locked for M5

### 1. Aggregate meta evidence is separate from opponent scouting
M5 must not expand opponent-specific prediction, ForceIndex/FlexIndex, named opponent-comp prediction, or in-game scouting behavior.

Build an **aggregate** current-set evidence pipeline suitable for measuring comp families and recommendation strength. Keep M4 lobby pressure as a separate, inspectable recommendation input.

Riot's current TFT developer policy explicitly distinguishes aggregate player statistics from opponent scouting. Do not blur those concepts in code, UI, or documentation.

### 2. Use documented/public sources only
Preferred outcome-data source is official documented Riot TFT APIs (`tft-league-v1`, `tft-match-v1`, and documented account/summoner endpoints only where required).

For curated comp definitions/guides, public current pages may be used when the content is directly inspectable and attributable. Do not call undocumented/private competitor APIs, reverse engineer companion apps, scrape authenticated/private endpoints, or import proprietary hidden statistics.

Every external source used for a comp definition or measured dataset must retain provenance:
- source type/provider;
- URL or endpoint family;
- fetched/collected time;
- set identifier;
- region/platform/rank cohort when applicable;
- sample size;
- classification/model version.

### 3. Expand the current comp candidate library without inventing boards
The current four playbooks are insufficient.

Research and curate a broader current Set 18 library from public, current, verifiable sources. Target **at least 12 distinct usable comp families** if that many can be verified cleanly. More is acceptable when evidence and implementation remain bounded. If fewer than 12 can be verified, stop and document the gap rather than fabricate filler.

Each family must have, where supported:
- stable family ID and display name;
- final target board;
- core units;
- flex units or explicit unknown state;
- carry/tank roles;
- target level / roll style (reroll, Fast 8, Fast 9, etc.) only when sourced or structurally verified;
- item/opening metadata only when sourced;
- legal Set 18 validation against M2 rules/static catalog;
- source provenance and last-reviewed time.

A public guide defines a candidate family; it does **not** automatically prove its statistical strength.

Do not create novel/optimizer-generated comps in M5. Comp discovery and experimental variants remain later work.

### 4. Build a bounded aggregate Riot sample collector
Implement a versioned aggregate meta-sample pipeline using documented Riot endpoints.

The pipeline should be capable of:
- obtaining a clearly defined high-skill cohort from documented TFT ladder endpoints where available (for example Challenger/Grandmaster/Master);
- resolving identifiers only through documented endpoints as needed;
- gathering recent current-set completed match IDs;
- deduplicating shared matches globally;
- reusing the existing immutable match cache/normalizer where practical;
- honoring the same native-only API-key handling and rate-limit/retry discipline already proven by M3/M3.1;
- returning partial aggregate samples rather than failing the whole collection when rate/deadline limits are reached;
- persisting enough metadata to reproduce/inspect the sample definition.

Do not silently call a regional sample `global meta`. The dataset identity must say exactly what it is, e.g. region(s), ladder cohort, time window, number of unique matches/participants, and collection time.

Keep the collector bounded for development-key limits. The architecture may support larger future samples, but the M5 live test must not require thousands of requests to prove correctness.

If extending the native provider boundary for `tft-league-v1`, preserve secret isolation and add the appropriate Rust/native tests and build checks.

### 5. Current-set filtering must stay evidence-safe
Use verified set membership from normalized match/static evidence.

Do not compare Riot client build strings directly with TFT content patch labels. M3.1's patch relevance semantics remain binding.

If exact content-patch mapping is unavailable, report the aggregate dataset as current-set/recent with patch relevance unavailable rather than inventing a patch mapping.

### 6. Deterministic match-to-family classification
To measure comp families, classify final boards against the curated family definitions using a deterministic, versioned classifier.

The classifier must be inspectable and conservative. It should use evidence such as:
- overlap with required/core units;
- carry/tank presence when known;
- board overlap/Jaccard or similar normalized board similarity;
- optional trait/role evidence only when valid and helpful;
- target board size differences;
- family-specific required units.

Requirements:
- never force every board into a family;
- support `unclassified` when no candidate clears threshold;
- support `ambiguous` when top candidates are too close;
- expose classifier score/margin and version;
- deterministic tie-breaking;
- validate that one cosmetic/special/runtime form does not incorrectly create a different family when M2 rules say it is the same underlying unit concept;
- add fixtures for clear match, clear non-match, ambiguous board, partial board, and two structurally similar families.

Classification is retrospective categorization of a completed final board. It is **not** a prediction of what an opponent will play next.

### 7. Measured family statistics
For every curated family with classified observations, derive at least:
- classified games / unique matches;
- weighted and raw play frequency within the defined sample;
- average placement;
- top-4 rate;
- first-place/win rate;
- bot-4 rate;
- placement distribution or equivalent inspectable counts;
- recency/freshness;
- classification quality/coverage;
- confidence/uncertainty.

Use recency weighting for freshness but keep raw statistics visible too.

Do not fake precision. Add uncertainty appropriate to each metric. Reasonable options include:
- Wilson intervals for top-4/win/binomial rates;
- standard error / bootstrap or another documented deterministic method for mean placement;
- shrinkage toward the sample-wide baseline for very small family samples.

Exact statistical method is implementation configuration, not TFT truth. Centralize and version it, document formulas, and test it.

### 8. Evidence confidence is not recommendation score
Measured-stat confidence should reflect things such as:
- classified sample size;
- sample freshness;
- classifier certainty/ambiguous rate;
- regional/cohort coverage;
- missing/unclassified boards;
- source provenance.

It must remain separate from M4 opponent evidence confidence and separate from final candidate score.

### 9. Replace seeded strength inputs carefully
The recommendation engine currently exposes seeded `meta`, `floor`, and `ceiling`-style values. M5 should replace or override those components with measured equivalents **only when the measured family evidence clears explicit minimum-quality thresholds**.

Suggested semantic mapping:
- measured meta strength: risk-adjusted outcome/frequency evidence;
- measured floor/consistency: top-4 rate / bot-4 risk / placement spread;
- measured ceiling: first-place rate and strong-placement tail;
- availability/contest remains separate from M4 lobby pressure;
- item/augment/transition/tempo metadata may remain curated/seeded if not measured in M5, but must stay visibly labeled as such.

For low-sample or unavailable measured families:
- do not promote seeded values as if measured;
- use explicit fallback/unavailable semantics;
- shrink conservatively toward a neutral/sample baseline where mathematically appropriate;
- expose which recommendation components are measured vs curated vs unavailable.

M4 lobby fit must remain an independent visible component; do not double-count aggregate play frequency as lobby contest pressure.

### 10. Recommendation calibration acceptance
Create deterministic tests proving that measured outcome evidence can reorder candidate rankings while M4 contest evidence can independently change the result in a different lobby.

At minimum test:
- statistically stronger family outranks weaker family when all else is equal;
- low-sample high raw win rate does not automatically dominate a mature family;
- strong M4 pressure can reduce a statistically strong family without erasing its measured strength;
- missing meta evidence falls back explicitly rather than producing NaN/fake values;
- portfolio optimization still chooses three complementary plans rather than merely top three measured win rates.

### 11. Minimal Comps UI evolution, not broad polish
Rename the user-facing `Playbook library` navigation/page to **`Comps`** or **`Comp Library`**. Keep internal type names if changing them would create unnecessary migration risk.

Upgrade the page enough to make the larger library usable:
- search by comp/unit/trait when supported;
- filters for evidence class and roll style when metadata exists;
- sort by measured overall strength, average placement, top-4, win rate, sample size/confidence, and low contest only when those values are genuinely available;
- display measured sample/provenance clearly;
- retain explicit `Experimental`/curated labels where evidence is insufficient.

Do not perform the broad final visual-polish pass in M5. Avoid fake UI, marketing slogans, excessive explanatory microcopy, animated dashboards, or a complete navigation redesign.

### 12. Recommendation cards
Update recommendation cards so a user can distinguish:
- measured meta/outcome evidence;
- M4 historical lobby contest pressure;
- confidence;
- curated strategy metadata.

A useful card should expose compactly, when available:
- measured score / average placement;
- top-4 rate;
- win rate;
- sample size;
- evidence confidence;
- historical lobby contest state;
- strongest positive and negative score drivers.

Do not overload cards with every metric; deeper detail can be expandable/on the comp detail page.

## Live validation requirement
M5 should perform a bounded real Riot API validation when a valid temporary development key is available through `RIOT_API_KEY` or explicitly supplied for this test.

The live test should verify at least:
- documented ladder/cohort retrieval on one supported platform;
- identifier resolution if required by the chosen endpoint shape;
- a bounded recent-match collection;
- shared-match deduplication/cache reuse;
- current-set filtering;
- at least one classified or explicitly unclassified real completed board;
- aggregate statistic derivation;
- warm rerun using cached immutable matches with substantially fewer/no detail fetches where expected.

The agent may use the temporary key for live testing. Never commit/hardcode the key into source, fixtures, Git history, generated reports, URLs, screenshots, or application bundles.

If the key is unavailable or expired, complete deterministic/fixture validation and document exactly which live assertions remain unverified. Do not fabricate live results.

## Data persistence/versioning
Add versioned aggregate-meta storage as needed. Preserve immutable completed matches.

Derived aggregate datasets/statistics must include enough versioning/fingerprints that a change to:
- classifier formula/thresholds;
- family definitions;
- static source version;
- cohort/sample definition;
- weighting/statistical model;

causes recomputation from cached source matches rather than silently reusing incompatible derived evidence.

Avoid destructive migrations unless unavoidable.

## Performance
The user-facing app must not block for minutes waiting for a large meta crawl.

Separate:
- source acquisition;
- classification/stat derivation;
- UI read path.

Prefer cache-first stored aggregate datasets. A meta refresh may be an explicit/settings action in M5 rather than an automatic launch-time crawl.

Add benchmarks for:
- fixture classification throughput;
- aggregate stat derivation;
- warm cached meta load;
- bounded live/cold acquisition if a key is available (report as live, not benchmark truth).

## Required tests
Add deterministic coverage for at least:
- legal curated-family validation;
- classifier clear/ambiguous/unclassified cases;
- source deduplication;
- current-set filtering;
- versioned derived-cache invalidation;
- average placement/top4/win/bot4 math;
- uncertainty/shrinkage behavior;
- recency weighting;
- recommendation component provenance;
- ranking reorder from measured evidence;
- independence of M4 lobby pressure;
- Comp Library search/filter/sort behavior;
- partial/unavailable aggregate dataset states;
- no secret leakage.

Retain all existing M1–M4 tests.

## Required verification
Run the repository's full applicable verification suite, including:
- typecheck;
- lint;
- formatting check;
- TypeScript/unit tests;
- production web build;
- Playwright UI tests;
- M3/M4 benchmarks plus new M5 benchmark(s);
- `git diff --check`;
- Rust/native tests/check/build if native files change.

Use the documented D: build/cache paths if native compilation is required; do not fill C: with a fresh Rust target/cache.

Rendered inspection must cover at least 1440, 1000 and 860 px desktop widths and verify:
- expanded Comps library is usable;
- sorting/filtering does not overflow;
- measured recommendation evidence is legible;
- lobby pressure remains visually separate from aggregate meta evidence;
- no console errors/warnings caused by the milestone.

## Documentation/output
Create `docs/M5_IMPLEMENTATION_REPORT.md` containing:
- exact sources/endpoints used;
- live vs fixture evidence clearly separated;
- cohort/sample definition;
- number of unique players/matches/boards in any live sample;
- classifier formula, thresholds and ambiguity rule;
- outcome/statistical formulas and uncertainty/shrinkage method;
- recommendation calibration mapping;
- comp-library additions and provenance;
- storage/versioning changes;
- benchmark results;
- all validation commands/results;
- limitations and remaining risks;
- recommended next milestone.

Update existing authority docs only where the implementation makes a durable project decision.

## Explicit non-goals
Do **not** implement in M5:
- opponent named-comp prediction;
- protected process memory/client injection/packet interception;
- automated gameplay/input;
- Team Planner code generation unless separately verified and already in scope;
- free-form LLM comp generation;
- optimizer-generated variants;
- broad comp discovery/clustering of unknown meta families beyond the conservative curated-family classifier;
- personal-model/post-game coaching expansion;
- broad final UI polish;
- replacing deterministic scoring with an LLM.

## Completion standard
M5 is complete when the app has a substantially broader verified Set 18 candidate library, a reproducible aggregate outcome-evidence pipeline, conservative retrospective family classification, measured family statistics with uncertainty, recommendation scoring that visibly distinguishes measured strength from M4 lobby pressure and curated metadata, usable Comps browsing, full deterministic validation, and a bounded live Riot smoke test when the temporary key is available.

Work only on `codex/m5-measured-meta-calibration`. Do not merge or push unless the human explicitly asks.