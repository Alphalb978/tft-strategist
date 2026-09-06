# Technical Architecture & Data Pipeline

## Working stack

- Tauri 2 desktop shell
- React
- TypeScript
- Vite
- SQLite for local cache/history/derived features
- Versioned JSON fixtures for TFT rules and seeded playbooks

Most strategy logic should stay in TypeScript initially for development speed and inspectability. Move work to Rust/native code only when a measured need appears.

## Layering

`providers -> domain -> rules/validation -> strategy -> application services -> UI`

### Providers

Responsibilities:

- CommunityDragon/static current-set data;
- Riot account/rank/spectator-current-game participant discovery where available;
- Riot completed-match history;
- local seeded playbooks;
- local settings/cache;
- future provider adapters without changing domain contracts.

Providers should return typed source records plus provenance/version metadata.

### Domain

Core stable entities:

- Champion
- Trait
- Item
- Augment
- Board
- Playbook
- CompFamily
- CompVariant
- OpponentProfile
- LobbyPressure
- PersonalProfile
- RecommendationCandidate
- RecommendationPortfolio
- Confidence/EvidenceLabel

Domain objects should not depend on React.

### Rules/validation

Own:

- current-set legality checks;
- board capacity/unit membership;
- trait computation/breakpoint validation;
- versioned rule values used by scoring;
- playbook structural validation;
- Team Planner support capability validation.

Rules must be explicit and testable.

### Strategy

Suggested modules:

- candidate scoring;
- confidence calibration;
- portfolio optimizer;
- contest model;
- stage-strength/risk features;
- opponent tendency features;
- comp-family classifier;
- flex-slot/variant optimizer;
- emerging-meta detector;
- personal weak-signal adjustment;
- post-game analyzer.

### Application services

Coordinate use cases such as:

- refresh active set;
- load recommendation context;
- scan lobby;
- select/lock plan;
- copy Team Planner code;
- import completed game;
- rebuild derived features.

### UI

Consumes application/domain view models. UI should not recreate strategy formulas or query external APIs directly.

## Suggested repository shape

```text
src/
  app/
  components/
  features/
  domain/
  providers/
  rules/
  strategy/
  services/
  storage/
  styles/
  test/

src-tauri/

data/
  rules/
  playbooks/
  fixtures/

docs/
tasks/
```

Exact names may vary if the implementation stays equally clear.

## SQLite

Store at minimum where useful:

- settings;
- source/cache metadata;
- Riot account identifiers needed by the app;
- immutable completed-match cache keyed by match ID;
- player recent-match index/cache timestamps;
- opponent derived profiles with derivation version;
- personal derived profile;
- selected plan/game association;
- recommendation snapshots/provenance;
- comp-family classification outputs.

Do not store API keys in plain logs. Use environment/config/secure local mechanism appropriate to the eventual app.

## Cache strategy

Opponent scanning depends on fast cache-first behavior.

### Immutable match payloads

Completed match payloads can be cached long-term by match ID.

### Player recent-match lists

Cache with a short freshness window. Refresh only when needed.

### Opponent derived profile

Cache with:

- generated-at time;
- source match IDs;
- patch/set relevance;
- classifier/feature version.

### Shared-match dedup

When multiple lobby members were in the same historical match, fetch/parse that match once.

## Parallel opponent scan

Use bounded concurrency consistent with actual Riot API limits.

Desired pipeline:

1. resolve seven opponents;
2. load warm cached profile immediately if usable;
3. fetch missing/stale recent-match IDs in parallel;
4. dedupe match IDs globally;
5. fetch missing immutable matches with bounded concurrency;
6. classify matches to families;
7. update opponent profiles;
8. recompute lobby pressure;
9. update recommendation context;
10. return partial-confidence results if timeout/error prevents completeness.

Never wait minutes just to claim a complete scan.

## Recommendation context contract

Conceptual shape:

```ts
interface RecommendationContext {
  activeSet: ActiveSetVersion;
  meta: MetaSnapshot;
  candidatePlaybooks: Playbook[];
  lobby?: LobbyPressure;
  personal?: PersonalProfile;
  dataFreshness: DataFreshness;
}
```

The engine returns candidates with inspectable score components and then a portfolio with pairwise compatibility/diversity reasoning.

## Team Planner module

Keep isolated behind a narrow interface such as:

```ts
interface TeamPlannerCodec {
  supportStatus(set: ActiveSetVersion): TeamPlannerSupport;
  encode(board: Board): Result<string, TeamPlannerError>;
}
```

Tests must include known-good fixtures. Unsupported formats must fail clearly.

## Meta / comp discovery pipeline

V1 may use seeded curated playbooks, but preserve a path to data-derived evolution:

1. ingest completed match boards;
2. normalize active-set units/items/traits;
3. classify to nearest known family;
4. collect unknown/high-distance boards;
5. cluster or rules-group repeated patterns;
6. calculate performance/recency/sample statistics;
7. surface candidate variants/emerging families;
8. pass legal candidates through rule validation;
9. label evidence class;
10. make them eligible for recommendation only under configured confidence rules.

Start with simple weighted core-unit/trait family matching before introducing complex ML.

### M5 aggregate evidence boundary

The implemented M5 path is `tft-league-v1 cohort -> documented summoner identifier resolution -> tft-match-v1 IDs/details -> immutable match cache -> current-set filter -> versioned retrospective classifier -> uncertainty-aware family statistics -> quality-gated recommendation calibration`. Aggregate popularity is never reused as M4 lobby contest pressure. Derived datasets retain classifier, family-definition, static-source, cohort, and statistics fingerprints; incompatible cache entries are ignored and recomputed from immutable source matches.

### M6 discovery and lifecycle boundary

The implemented M6 path extends the same aggregate matches with `fail-closed canonical board -> champion-combination index -> bounded density graph -> medoid/consensus -> curated-anchor relation -> lifecycle/eligibility -> generic registry`. Exact board shapes are collapsed before neighbor search; fixed-width champion blocks generate bounded candidate pairs, so the clustering path does not perform an unconditional all-pairs comparison over observations. Noise remains unclustered. Curated anchors are never mutated by observed clusters.

Discovery datasets are keyed by active set/static source, canonical/similarity/clustering/relation/lifecycle/statistics versions, centralized configuration, family definitions and aggregate sample definition. Static/set refresh ignores incompatible derived evidence, reuses compatible immutable matches, revalidates registry boards, and keeps patch relevance unavailable unless a verified mapping exists. M4 lobby pressure is supplied independently at recommendation time and is not a discovery feature.

### M7 strategy-guidance boundary

The generic registry entry now carries a versioned strategy attachment loaded from a validated public-source ledger. The attachment records static-source, target-board and family/core fingerprints plus field-level source status. Stage, roll, item, augment, replacement, Decision Map and positioning validation remains in the rules/strategy layers; React only renders the validated model.

The hot playbook path is local: deterministic quick-strip derivation, acyclic manual Decision Map traversal, TFT-board rendering data and three-plan pivot construction make no network request. Discovered final boards begin with sparse guidance. A mature Variant can inherit only retained holder/item directions after explicit core/capacity compatibility checks; recommendation eligibility and M4 lobby pressure remain independent.

### M8 selected-plan session boundary

The existing selected-plan snapshot is extended into a versioned `PlanSession`; no parallel live-match tracker exists. One active session is enforced by repository operations and a SQLite unique partial index. SQLite replacement is one atomic insert: triggers require the named active predecessor, end its persisted payload as `replaced`, and then admit the successor. Ending retains the record for later completed-match reconciliation.

The lock snapshot includes the selected playbook/candidate, all three portfolio candidates, relevant evidence identities/summaries, and the static display data needed for offline resume. Its fingerprint and payload are immutable after creation. Mutable session state is restricted to stage, Decision Map path/current node, inspected pivot target, current compatibility, end metadata and future match association. Compatibility is evaluated against current static/registry/guidance inputs without rewriting the historical snapshot.

### M9 post-game and personal-learning boundary

M9 reconstructs each logical match-plan chain from M8 replacement links and stores reconciliation, review and personal-model records separately from the immutable lock snapshot. Candidate matching requires resolved PUUID participation and current-set compatibility, ranks only bounded recent completed matches from the existing immutable Riot cache, and retains explicit candidate evidence and audit actions. SQLite unique constraints enforce one match per logical chain and one chain per match; browser and memory repositories enforce the same contract.

Reviews reuse the M5 retrospective family classifier plus M6 canonical-board and similarity models. Derived records fingerprint the match, saved static set, selected target, classifier/canonical/similarity versions and compatible lock-time M5 baseline. Incompatible review derivations remain auditable but do not enter current personal learning.

The personal model is rebuilt only from unique, confidently attributed, current-set reviews carrying an eligible compatible M5 family baseline. It uses recency-weighted placement residuals with strong prior shrinkage and exposes confidence separately from its bounded recommendation adjustment. M4 lobby pressure, M5 meta, M6 discovery, M7 guidance and M8 history remain independent inputs.

## Testing

Critical unit/integration tests should cover:

- active-set normalization;
- board legality;
- trait calculation/breakpoints used by playbooks;
- seeded playbook validation;
- recommendation score component determinism;
- portfolio diversity behavior;
- contest weighting/criticality;
- recency weighting;
- cache/dedup behavior;
- Team Planner known-good fixture behavior;
- personal shrinkage toward neutral;
- evidence-label gating.

Use fixtures rather than network calls for deterministic tests.

## Observability

Development diagnostics may show:

- source version/freshness;
- cache hits/misses;
- opponent scan timings;
- number of matches requested/fetched/deduped;
- classifier confidence;
- recommendation component scores;
- unsupported data fields.

Never log tokens, API keys, auth headers, or private connector credentials.

## Protected-process boundary

This architecture intentionally does not require memory reading, injection, packet interception, automated input, kernel access, or Vanguard bypass. If a future feature proposal requires one of those, it is outside current project authority and must not be added silently.
