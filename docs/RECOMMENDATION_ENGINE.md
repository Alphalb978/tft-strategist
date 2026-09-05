# Recommendation Engine, Opponent Scouting & Comp Discovery

## Objective
Choose three complementary plans that maximize expected usefulness for the upcoming game rather than merely sorting a tier list.

The engine should combine current meta evidence, lobby contest pressure, comp flexibility/feasibility, modest personal signal, and confidence/provenance.

## Candidate score direction
Exact weights are configuration, not permanent truth. Initial direction:
- current meta strength: major input;
- expected top-4/consistency floor: major input;
- win/first-place ceiling: separate from floor;
- lobby contest fit: major input;
- item flexibility: important;
- transition quality: important;
- augment flexibility: important;
- roll/availability feasibility: important;
- stage/tempo safety: important;
- dependency fragility: smaller penalty;
- personal history: intentionally small, ~5% default and usually no more than ~10%.

A candidate should expose its component scores so the UI can explain `why` without inventing prose.

## Confidence
Confidence is not the same as recommendation score.

Confidence should reflect:
- sample size;
- patch relevance;
- data freshness;
- source reliability;
- variance/uncertainty;
- amount of missing opponent data;
- whether the comp is Proven, Variant, Emerging, or Experimental;
- whether important strategy metadata is curated vs inferred.

Do not fake precision. Prefer High/Medium/Low or an interpretable calibrated value.

## Risk-adjusted outputs
Track at least conceptually separate:
- expected average strength;
- top-4 floor/consistency;
- first-place/cap ceiling;
- bot-4 risk;
- stage-strength curve;
- roll burden;
- transition cost;
- dependency fragility;
- contest elasticity.

This allows a safe climbing line and a high-roll line to be distinguished even if their average score is similar.

## Opponent scouting
### Goal
Use recent historical completed-match behavior of the seven opponents to estimate likely unit/comp-family pressure before play, without protected game-process access.

### Default history window
Approximately 10–20 relevant recent games per opponent.

Tune from measured latency and predictive value. Same-patch games receive the highest weight. Older-patch games may decay aggressively or be ignored if the set changed.

### Profile features
For each opponent, derive when data supports it:
- recent comp-family frequency;
- ForceIndex;
- FlexIndex;
- reroll / Fast 8 / Fast 9 tendency;
- AD/AP preference;
- recurring carry/tank families;
- core-unit frequency;
- recent placement by family;
- recency-weighted sample confidence.

Historical tendencies are probabilistic. They do not prove what the player will do this game.

### Performance requirements
The scout must feel fast.
- fetch opponents in parallel within API/rate constraints;
- cache player profiles and recent match IDs/results;
- deduplicate matches shared by lobby members;
- avoid re-fetching immutable completed match payloads;
- prefer cache-first results and refresh stale data in the background/task trajectory where appropriate;
- support a short timeout returning partial-confidence output rather than blocking recommendations for minutes;
- benchmark cold cache, warm cache, 10-game target, 20-game target.

## Contest model
Do not treat every shared unit equally.

Conceptually:
`ContestPressure(comp) = Σ opponentCommitmentProbability × sharedUnitCriticality × compContestElasticity × recencyConfidence`

Important distinctions:
- core reroll carry copies matter far more than a replaceable utility slot;
- a reroll comp requiring multiple 3-stars is more contest-sensitive than a flexible Fast-8 board;
- a shared premium tank can create pressure even when opponents play different named comp families;
- flexible replacements should reduce the penalty.

Expose aggregate lobby pressure by comp and optionally expandable opponent detail.

## Portfolio optimization
After individual candidate scoring, optimize the set of three together.

Reward:
- strong total candidate quality;
- AD/AP/item-opening coverage;
- different roll/level patterns;
- useful transition/pivot relationships;
- complementary contest exposure;
- broad augment/econ coverage.

Penalize:
- three plans requiring the same core units;
- three plans demanding the same narrow component start;
- redundant reroll lines with identical failure modes;
- portfolio choices that look diverse by name but share the same scarce carry/tank pool.

The result should answer: `Which three strategies give the best coverage of plausible games?`

## Pivot graph
Represent directional pivots among the recommended plans.

Each edge should include:
- triggering conditions/signals;
- shared items/holders;
- shared early units;
- transition cost;
- what is abandoned;
- destination stage/board.

Example concept:
- Plan A reroll -> Plan B Fast 8 when copies are weak but AD items/econ are strong.
- Plan A -> Plan C AP when component/augment direction strongly changes.

## Comp discovery
### Baseline
Established real comp families are the safest starting point.

### Family representation
Each family should identify:
- locked/core units;
- flex slots;
- required/desired trait breakpoints;
- carry/tank roles;
- target level;
- common stage boards;
- standard item/augment relationships;
- evidence/provenance.

### Variants
Known families may generate:
- Standard;
- Low-Contest;
- High-Cap;
- tempo/stabilization variants;
- emblem/augment-dependent variants when requirements are explicit.

### Flex-slot optimizer
Lock core units and search only legal current-set combinations for flex slots.

Candidate generation must respect:
- target unit capacity;
- active-set membership;
- trait breakpoint constraints;
- role balance;
- unique/special-unit rules;
- emblem/augment requirements;
- declared carry/tank needs.

Rank using structured synergy + historical evidence + contest reduction. An LLM may explain a result but must not be the legality/quality oracle.

### Evidence labels
- Proven: established family/variant with strong recent evidence.
- Variant: close structural variation on an established family with supporting evidence.
- Emerging: rising or promising pattern with meaningful but not yet mature evidence.
- Experimental: optimizer-generated or low-evidence board.

Promotion thresholds should later use sample count, confidence interval, recency, high-skill adoption, placement/top-4 performance, and structural distance from an established family.

## Emerging-meta detection
Track recent changes such as:
- usage acceleration;
- improving placement/top-4 performance;
- adoption by stronger players/ranks if reliable data is available;
- repeated appearance of a specific variant;
- strength relative to saturation/contest.

An emerging comp can earn visibility before becoming a widely saturated tier-list pick, but must keep its confidence/evidence label visible.

## Meta bootstrap
V1 may begin with a curated set of real current-set playbooks or a bounded local Riot match sample. The UI must reveal provenance and must not claim comprehensive live-meta intelligence if the dataset is seeded/limited.

Long term, prefer our own completed-match-derived family statistics and discovery pipeline over permanent dependence on another companion's private data.

## Inspectability
For every recommendation, store enough structured reasoning to show:
- strongest positive factors;
- strongest penalties;
- confidence drivers;
- contest pressure summary;
- portfolio role (main/flex/AP fallback/etc.);
- evidence label.

The user should be able to understand why a plan ranked #1 without asking an LLM.
