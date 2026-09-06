# M6 — Automatic Comp Discovery, Variants & Patch/Set Lifecycle

## Goal
Build the scalable layer that lets TFT Strategist maintain a current comp ecosystem from observed completed-match evidence instead of requiring manual re-entry of every comp after each meta change.

M6 should answer:

> Which recurring final-board structures exist in recent evidence, which correspond to known families, which are meaningful variants, which are emerging unknown structures, and how should families be promoted, demoted, retired, or marked stale as the set/meta evolves?

This milestone is **deterministic discovery and lifecycle management**. It is not LLM comp invention and not opponent future-choice prediction.

Read `AGENTS.md` and every governing authority it references before changing code. Treat this task packet as highest authority for M6.

## Baseline
M1–M5 already provide:
- audited Set 18 static data/rules and legality validation;
- 13 source-attributed Set 18 comp families;
- documented Riot cohort/match acquisition with native-only credentials, bounded rate limiting, retries, deadlines and immutable match caching;
- M3.1 patch/build separation and explicit patch relevance unavailable when a verified mapping does not exist;
- M4 opponent unit-history/lobby pressure, kept separate from aggregate meta evidence;
- M5 deterministic retrospective family classification, ambiguity/unclassified states, aggregate statistics with shrinkage/uncertainty, quality-gated recommendation calibration, and a usable Comp Library;
- M5 live EUW1 Challenger validation where 56 real Set 18 boards produced 18 classified, 5 ambiguous and 33 unclassified observations, demonstrating that the curated registry does not cover the entire observed meta.

Preserve all proven M1–M5 behavior unless this task explicitly extends a derived-data model.

## Locked product decisions

### 1. Discovery operates on completed aggregate boards, never current opponents
Discovery input comes from aggregate completed-match evidence only. Do not use the current lobby's seven players to invent or infer new comp families. M4 remains independent.

### 2. No LLM is the clustering/legality/quality oracle
Use deterministic/statistical algorithms as source of truth. An LLM may later explain a discovered result, but M6 must not generate a board, choose legality, assign performance, or promote a family through free-form reasoning.

### 3. Existing curated families remain anchors
The 13 M5 families are trusted named anchors with provenance. Discovery may:
- match observations to an existing family;
- identify a structurally close recurring variant;
- identify a recurring cluster not close enough to a known family;
- leave noisy/high-roll/insufficient structures unclassified.

Do not silently mutate a curated family definition because a cluster looks different. Version proposed changes separately.

## A. Canonical final-board representation
Create a versioned canonical board representation suitable for similarity/clustering.

Requirements:
- normalize stable current-set champion IDs;
- collapse cosmetic/runtime forms only according to M2 verified rules;
- represent ordinary star/copy evidence separately from unit identity;
- preserve board capacity/size;
- optionally retain valid trait/role/star/cost features as secondary structured evidence;
- fail closed for unresolved/special units rather than inventing equivalence;
- deterministic serialization/fingerprint.

Do not let placement, player identity, or family label leak into structural clustering features.

## B. Deterministic board similarity
Implement and version a similarity metric for two canonical boards.

The primary signal should be champion structure. Reasonable ingredients include:
- weighted unit-set Jaccard/overlap;
- extra weight for higher-cost/repeatedly central units only when sourced from stable public data;
- board-size fit;
- optional trait similarity where normalized trait evidence is valid;
- optional star/copy pattern as a small secondary signal, not identity.

Keep coefficients centralized as configuration and add interpretable component output.

Tests must show:
- identical boards are maximally similar;
- one flex substitution remains close;
- several core substitutions reduce similarity materially;
- structurally unrelated boards remain far apart;
- special/runtime forms follow M2 semantics.

## C. Unsupervised/graph discovery over observed boards
Cluster recurring observed final boards without forcing every board into a cluster.

Prefer a deterministic graph/density/medoid-style method that works for mixed categorical board data and can expose noise. Do not use a method that requires pretending Euclidean coordinates are TFT truth.

Requirements:
- deterministic output for identical inputs;
- configurable minimum cluster support;
- configurable similarity/neighborhood threshold;
- explicit noise/unclustered boards;
- stable cluster IDs derived from canonical structure/version rather than incidental iteration order;
- representative medoid/consensus board;
- per-unit prevalence within the cluster;
- cluster cohesion/separation metrics;
- sample count/effective sample, recency and placement outcome statistics;
- bounded computational cost for at least tens of thousands of boards.

Do not cluster tiny samples into fake meta families.

## D. Match clusters to known families and identify variants
For each discovered cluster, compare its representative/consensus structure against curated known families using a versioned relation model.

Possible relation states:
- `known-family`: close enough to an existing anchor that it is evidence for that family;
- `variant-candidate`: meaningfully close to one family but with a stable repeated structural difference;
- `emerging-candidate`: coherent recurring cluster not sufficiently close to any known family;
- `noise/insufficient`.

For a variant candidate, retain an inspectable diff:
- shared core;
- units consistently added;
- units consistently omitted;
- changed carry/tank only when evidence supports roles;
- capacity/roll-style differences only when supported;
- structural distance to parent.

Do not assign a human-readable strategy name by hallucination. Use neutral generated labels such as `Variant of <Known Family>` or `Emerging cluster <short-id>` until a sourced/curated display name exists.

## E. Promotion, demotion and retirement lifecycle
Implement a versioned lifecycle state machine for discovered evidence.

Keep the existing evidence concepts but make promotion evidence-driven. Suggested states:
- Experimental: low-support discovered candidate;
- Emerging: sufficient recent repeated structure and outcome evidence;
- Variant: mature structurally-close derivative of a known family;
- Proven: reserved for a mature family with strong evidence and/or curated public provenance according to project authority;
- Stale/Retired: previously active family with insufficient current-set/recent evidence or illegal structure.

Promotion/demotion must use explicit thresholds combining, as appropriate:
- raw/effective sample size;
- recency/freshness;
- cluster cohesion;
- classifier/relation certainty;
- placement/top-4 outcome confidence;
- adoption frequency/acceleration;
- structural distance to known anchors.

A single lucky result must never promote a family.

Every transition must retain:
- previous state;
- new state;
- timestamp;
- evidence/model version;
- concrete drivers/reasons.

## F. Emerging-meta acceleration
Derive recent adoption change from aggregate samples/windows without pretending it is future certainty.

At minimum expose:
- recent-window play frequency;
- prior-window play frequency;
- acceleration/delta;
- uncertainty/sample counts;
- whether the signal is mature enough to display.

Use this as one promotion/visibility input, not as a guaranteed forecast.

## G. Patch/set lifecycle and automatic refresh architecture
M6 must make updates scalable across patches/sets while preserving M3.1 evidence safety.

Implement a versioned refresh/lifecycle coordinator capable of:
1. detecting a changed static set/source/version from the existing authoritative static-data path;
2. validating every existing family against the new active-set catalog/rules;
3. marking illegal/out-of-set families stale/retired rather than silently using them;
4. invalidating derived classifier/discovery/stat evidence when static source, active set, family definitions or model versions change;
5. reusing immutable completed-match caches where compatible;
6. collecting a new bounded recent aggregate sample;
7. recomputing known-family evidence, discovery clusters and lifecycle states;
8. exposing refresh status/provenance to the application.

Important:
- do not invent Riot-client-build ↔ TFT-content-patch mappings;
- if exact content patch remains unavailable, operate on verified set membership + collection time/recency and label patch relevance unavailable;
- a new **set** must not inherit old-set families as usable candidates unless explicitly revalidated/migrated;
- historical datasets may remain stored for audit but must not contaminate the active set.

M6 may provide an explicit `Refresh Meta` action/CLI/task rather than background scheduling. The architecture should make later automatic periodic refresh straightforward, but do not add an uncontrolled launch-time crawl or unsupported background service.

## H. Registry model: curated + discovered without code changes
Refactor only as needed so the comp registry can represent:
- curated anchor families;
- discovered variants;
- emerging clusters;
- lifecycle/evidence state;
- provenance;
- measured statistics;
- structural fingerprints.

Adding/promoting a discovered family should be derived data/configuration, not require adding bespoke TypeScript logic for each comp.

Curated source metadata must never be overwritten by derived discovery metadata.

## I. Recommendation integration
M6 discovery may expand the candidate universe only when a discovered candidate clears explicit legality and evidence gates.

Requirements:
- Experimental/insufficient clusters are visible for analysis but not automatically recommended unless authority explicitly permits it;
- Emerging/Variant candidates need explicit minimum support/confidence before recommendation eligibility;
- recommendation score continues to use M5 measured outcomes when quality-gated;
- M4 lobby pressure remains an independent input;
- no aggregate popularity double-counting as current-lobby contest;
- portfolio optimizer still selects complementary plans.

Add deterministic tests showing a mature discovered variant can become recommendation-eligible while a tiny/high-win cluster cannot.

## J. UI: discovery/lifecycle visibility, not final redesign
Add only the product surfaces needed to inspect M6:
- Comp Library filters for Curated / Variant / Emerging / Experimental / Stale where applicable;
- compact badge/state showing curated vs discovered provenance;
- measured support/sample and recent trend where available;
- a discovery/refresh section in Data & Settings showing last refresh, active dataset, boards analyzed, clusters, known/variant/emerging/noise counts and status;
- detail view for a discovered cluster/variant showing representative board, consensus/prevalence, parent relation/diff, evidence and why it has its current lifecycle state.

Do not perform the broad final visual-polish pass yet.

## K. Storage/versioning
Persist discovery outputs and lifecycle history with deterministic invalidation based on:
- active set/static source;
- canonical board model;
- similarity model;
- clustering configuration;
- family registry fingerprint;
- relation thresholds;
- lifecycle/statistics configuration;
- aggregate sample definition.

Preserve immutable completed matches. Recompute derived discovery evidence from cache when possible.

## L. Live validation
When a valid temporary `RIOT_API_KEY` is available, perform a bounded real smoke test using documented Riot endpoints and the existing native security/rate-limit boundary.

Do not attempt a production-scale crawl. The live test should prove the path, not fully map EUW meta.

Verify at minimum:
- bounded high-rank aggregate acquisition;
- current-set filtering;
- canonicalization of real boards;
- known-family matches plus ambiguous/unclassified/noise handling;
- at least one discovery cluster if the bounded evidence legitimately supports one; otherwise explicitly report insufficient support rather than lowering production thresholds to force a cluster;
- cluster-to-known-family relation output;
- lifecycle evaluation;
- persisted/compatible derived dataset or application-load path;
- warm rerun/cache reuse with zero/fewer immutable detail fetches;
- no secret leakage.

If a small live sample cannot support discovery, use deterministic larger fixtures/locally cached real-compatible normalized shapes for acceptance and state that live cluster discovery remains sample-limited.

## M. Benchmarks
Add M6 benchmarks for at least:
- canonicalization + similarity throughput;
- clustering 1k, 8k and (if practical) 20k boards;
- known-family relation pass;
- lifecycle/stat derivation;
- warm cached derived-data load.

The algorithm should remain practical for future larger samples. Document asymptotic/observed bottlenecks; avoid naive all-pairs behavior at large N unless bounded/indexed sufficiently.

## N. Required tests
Retain all M1–M5 tests and add deterministic coverage for:
- canonical board normalization/fingerprints;
- similarity monotonic examples;
- stable deterministic cluster IDs;
- cluster/noise behavior;
- known-family relation;
- variant diff extraction;
- emerging/noise thresholds;
- promotion/demotion/retirement transitions;
- acceleration windows;
- illegal/out-of-set family retirement;
- active-set/static-source invalidation;
- derived-cache recomputation from immutable matches;
- recommendation eligibility gates;
- M4 lobby-pressure independence;
- UI filters/statuses;
- secret redaction/no credential persistence.

## O. Verification
Run the full applicable repository suite:
- typecheck;
- lint;
- formatting;
- full TypeScript/unit tests;
- production web build;
- Playwright;
- M3, M4, M5 benchmarks plus new M6 benchmarks;
- `git diff --check`;
- Rust/native fmt/test/check/debug build if native code changes.

Use the documented D: Rust target/temp/cache paths if native compilation is required.

Render/inspect at 1440, 1000 and 860 px and confirm no horizontal overflow or browser-console errors.

## P. Documentation
Create `docs/M6_IMPLEMENTATION_REPORT.md` documenting:
- canonical board representation/version;
- exact similarity formula and coefficients;
- clustering algorithm/configuration and why chosen;
- cluster IDs/noise rules;
- known-family/variant relation thresholds;
- lifecycle state machine and promotion/demotion thresholds;
- adoption acceleration windows;
- patch/set refresh and invalidation behavior;
- recommendation eligibility rules;
- storage/versioning;
- live vs fixture evidence separately;
- benchmark results;
- validation results;
- limitations/false-positive risks;
- recommended next milestone.

Update durable authority docs only when the implementation establishes a lasting project decision.

## Explicit non-goals
Do not implement:
- LLM-generated comps or LLM clustering decisions;
- named prediction of what an opponent will play next;
- ForceIndex/FlexIndex expansion;
- protected process memory, DLL injection, packet interception, Vanguard bypass or gameplay automation;
- undocumented/private competitor APIs;
- Team Planner code unless separately verified and explicitly authorized;
- full personal/post-game coaching;
- broad final UI redesign;
- an uncontrolled periodic/background Riot crawl;
- fabricated current-patch mapping.

## Completion standard
M6 is complete when TFT Strategist can deterministically discover recurring structures from aggregate completed boards, relate them conservatively to curated families, identify evidence-backed variant/emerging candidates without forcing noise into families, manage promotion/demotion/staleness through a versioned lifecycle, survive active-set/static-data changes safely, expose discovery evidence to the user, and recompute from cached immutable match data with full tests/benchmarks and bounded live validation when available.

Work only on `codex/m6-auto-comp-discovery`. Do not merge or push unless the human explicitly asks.