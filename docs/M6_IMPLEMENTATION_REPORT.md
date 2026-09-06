# M6 Implementation Report — Automatic Comp Discovery, Variants & Lifecycle

Date: 2026-09-06  
Branch: `codex/m6-auto-comp-discovery`

## Outcome

M6 adds a deterministic, versioned comp-discovery layer on top of the M5 aggregate Riot acquisition and immutable match cache. It canonicalizes completed final boards, clusters recurring champion structures without forcing noise, relates cluster representatives to immutable curated anchors, derives inspectable variant diffs and emerging candidates, records evidence-driven lifecycle transitions, persists fingerprinted discovery datasets, and exposes refresh/status/detail surfaces in the desktop UI.

The recommendation universe expands only for legal discovered `Variant` or `Emerging` entries that clear every configured support, confidence, cohesion, freshness, relation and outcome gate. Experimental, stale, retired and known-family evidence clusters remain inspectable but do not create automatic recommendations. M4 historical lobby unit pressure remains a separate scoring input.

## Canonical board representation

Version: `canonical-board-v1`; schema version 1.

Each canonical board stores:

- active set and observed capacity;
- normalized, sorted stable champion IDs;
- public static cost and verified trait memberships as secondary data;
- star tier and verified ordinary copy count separately from champion identity;
- distinct board size;
- deterministic FNV-1a structural fingerprint.

The fingerprint includes model version, set, capacity, unit identity and star/copy evidence. Placement, PUUID/player identity, match outcome and family classification never enter structural features. Unit order is irrelevant.

Canonicalization accepts only active-set, board-eligible ordinary pool units. Unresolved IDs, placeholders and runtime/special forms without an M2-verified equivalence fail closed. The live smoke therefore retained 49 canonical boards and explicitly rejected seven boards containing an unresolved or unsupported special/runtime form; it did not guess an equivalence.

## Similarity model

Version: `board-similarity-v1`.

For boards `A` and `B` in the same set:

```text
unitWeight(u) = 1 + 0.08 × max(0, publicCost(u) - 1)
unitStructure = weightedJaccard(A.units, B.units, unitWeight)
boardSize     = 1 - abs(size(A) - size(B)) / max(1, size(A), size(B))
traits        = Jaccard(verifiedTraitPresence(A), verifiedTraitPresence(B))
starPattern   = mean over shared units:
                1 when both unknown,
                0.5 when one unknown,
                max(0, 1 - abs(starsA - starsB) / 2) otherwise

similarity = 0.82 × unitStructure
           + 0.08 × boardSize
           + 0.06 × traits
           + 0.04 × starPattern
```

Different sets return zero. Champion structure owns 82% of the score; cost only modifies champion-overlap weight using public static data. Trait and star signals cannot override a structurally unrelated board. Deterministic tests cover identity, one flex substitution, multiple substitutions, unrelated boards and special/runtime failure semantics.

## Clustering algorithm and IDs

Version: `indexed-density-medoid-v2`.

The pipeline:

1. collapses identical canonical fingerprints and retains their observation support;
2. creates deterministic three-unit combination blocking keys (or all available units for boards smaller than three);
3. skips blocks larger than 1,500 shapes and caps unique candidate pairs at 2,000,000;
4. computes full similarity only for indexed candidate pairs;
5. makes a shape a density core when its own plus neighbor observation support reaches six;
6. forms deterministic connected components among core shapes;
7. assigns border shapes to the most similar core component with stable tie-breaking;
8. leaves everything else as explicit noise;
9. chooses a weighted medoid from a deterministic sample capped at 128 candidates/256 comparison members;
10. derives unit prevalence, cohesion and inter-cluster separation.

Production neighborhood similarity is 0.78 and minimum cluster support is six. Cluster IDs hash clustering/canonical versions plus the representative canonical fingerprint, so they do not depend on input iteration order and remain stable while the representative structure remains stable. Candidate-pair budget exhaustion or over-common skipped blocks makes the dataset partial and leaves unmatched observations as noise.

This is a mixed-categorical density graph, not Euclidean clustering. Exact-shape collapse makes observation growth cheap when many boards repeat; the champion-combination index avoids unconditional observation-level `O(n²)` comparisons. Dense high-cardinality blocking buckets and medoid calculation are the main bounded bottlenecks.

## Known-family and variant relation

Version: `anchor-relation-v1`.

Every cluster representative is compared with canonical curated final boards using the same similarity model. Relations use stable family-ID tie-breaking:

- `known-family`: similarity at least 0.88, nearest-anchor margin at least 0.05, and no stable additions/omissions;
- `variant-candidate`: similarity at least 0.72 and margin at least 0.05;
- `emerging-candidate`: coherent cluster that does not clear the conservative known/variant relation;
- `noise/insufficient`: represented by unclustered/noise observations rather than a fabricated family.

Variant diffs retain curated parent ID, shared parent core at 70% or greater prevalence, repeated additions at 70% or greater prevalence, repeated omissions at 30% or lower prevalence, structural distance and capacity delta. Carry/tank and roll-style changes are not inferred. Display labels remain neutral: `Variant of <curated family>` or `Emerging cluster <short-id>`.

## Lifecycle and recommendation eligibility

Version: `discovery-lifecycle-v1`; statistics version `discovery-statistics-v1`.

Cluster statistics include raw games, unique matches, 14-day recency-weighted Kish effective sample, average placement, shrunk top-four/win estimates with Wilson intervals, freshest evidence age, cohesion, separation, relation certainty and adoption windows.

Current production thresholds are product configuration, not TFT truth:

- cluster formation: six boards at similarity 0.78;
- `Variant` promotion: variant relation plus at least 20 boards;
- `Emerging` promotion: emerging relation plus at least 20 boards;
- confidence at least 0.55;
- cohesion at least 0.80;
- freshest evidence no older than 21 days;
- variant relation certainty at least 0.72;
- top-four Wilson lower bound at least 0.25.

All gates must clear for recommendation eligibility. A six-game 100%-win fixture stays Experimental because support is 6/20. Known-family clusters contribute evidence to their immutable anchor and do not create duplicate candidates. Discovered candidates are never auto-promoted to `Proven`; a sufficiently mature known-anchor evidence cluster may report Proven evidence for the anchor. Missing current-refresh support becomes `Stale`; an illegal representative or evidence older than 45 days becomes `Retired`.

Every state change appends previous state, new state, timestamp, lifecycle model version and concrete drivers. Stable representative-based IDs allow transitions to survive support changes. Curated provenance and family definitions are never overwritten.

## Emerging adoption acceleration

Recent adoption compares the last seven days with the preceding 21 days:

```text
recentFrequency = cluster boards in last 7d / all aggregate boards in last 7d
priorFrequency  = cluster boards in preceding 21d / all aggregate boards in preceding 21d
delta           = recentFrequency - priorFrequency
```

The signal is display-mature only with at least 20 aggregate boards in each window and at least five recent cluster boards. It is one lifecycle/visibility input and is never presented as a forecast.

## Refresh, invalidation and storage

`refreshMetaDiscovery` reuses the M5 `collectAggregateMeta` path:

`tft-league-v1 cohort -> recent IDs -> global dedup -> immutable match cache -> current-set filter -> M5 classification/statistics -> M6 canonicalization/clustering/relation/lifecycle -> persistence`.

Discovery is persisted under `comp-discovery`; aggregate M5 evidence remains under `aggregate-meta`. The discovery derivation fingerprint includes:

- active set and static source version;
- canonical, similarity, clustering, relation, lifecycle and statistics versions;
- full centralized discovery configuration;
- order-independent curated family-definition fingerprint;
- aggregate sample-definition fingerprint.

Incompatible discovery data is ignored by application load and queued for recomputation. Immutable completed matches remain reusable. The registry revalidates every supplied curated and discovered board against the active catalog/rules; illegal/out-of-set entries become Retired and recommendation-ineligible. Historical discovery datasets may remain stored for audit but cannot contaminate the active set.

M6 also fixed one bounded M5 correctness issue found during integration: the family-definition fingerprint depended on playbook array order. The fingerprint now sorts by stable family ID, with regression coverage, so registry presentation order cannot spuriously invalidate equivalent evidence.

Patch relevance remains `unavailable`. No Riot client-build to TFT content-patch mapping is inferred. Refresh uses verified set membership plus collection time/recency.

## Registry and application behavior

The generic registry combines:

- immutable curated anchor playbooks and provenance;
- discovered variant/emerging entries derived from cluster data;
- lifecycle, structural fingerprint, parent relation, sample/effective sample, trend and recommendation eligibility.

Discovered playbooks contain the legal representative board and prevalence-derived core slots (80% or greater), but item holders, augments, roll/level plan, transitions, replacements and Decision Map remain explicitly unavailable. Neutral non-outcome feature defaults and the default 0.70 contest elasticity are configuration, not gameplay facts. Team Planner remains unsupported.

Eligible discovered candidates use measured cluster placement/top-four/win/confidence for the M5-style outcome components. M4 lobby pressure is added only afterward through the existing independent lobby component. Tests prove lobby pressure can change the candidate score without changing its discovery/meta input.

## UI

Targeted M6 surfaces were added without a broad redesign:

- Comp Library source/lifecycle filters for Curated, Variant, Emerging, Experimental, Stale and Retired;
- curated/discovered provenance plus lifecycle badges;
- clustered support, average placement, top-four estimate and mature trend where available;
- explicit `Refresh meta & discovery` action in Data & Settings;
- dataset status, last refresh, boards, clusters, known/variant/emerging/experimental/noise counts;
- discovered detail with representative board, unit prevalence, parent relation/diff, support/cohesion/certainty, trend maturity and exact recommendation gates.

The development fixture deliberately creates one six-board recurring variant. It remains Experimental and inspection-only at the real production thresholds.

## Live Riot evidence

Status: passed on 2026-09-06 with the user-authorized temporary development key. The key was entered through a secure prompt, existed only in process memory, was removed in `finally`, and was not written to tracked files, cache fixtures, screenshots or reports.

Bounded sample: EUW1/EUROPE Challenger, ladder positions 3 and 5, two players, four recent IDs per player.

| Field                                     | Live result |
| ----------------------------------------- | ----------: |
| Recent ID references                      |           8 |
| Unique match IDs                          |           7 |
| Shared references deduplicated            |           1 |
| Cold immutable details fetched            |           7 |
| Current Set 18 matches / boards           |      7 / 56 |
| M5 classified / ambiguous / unclassified  | 18 / 5 / 33 |
| M6 canonical / fail-closed invalid boards |      49 / 7 |
| M6 clusters / noise boards                |      1 / 43 |
| Candidate pairs compared                  |         190 |
| Pair budget reached / oversized blocks    |      no / 0 |
| Warm stable cluster IDs                   |         yes |
| Discovery dataset accepted by application |         yes |

The one legitimately supported live cluster contained six boards, cohesion 0.946, and related as a variant candidate of `solar-elderwood` at similarity 0.839. It remained `Experimental` and recommendation-ineligible because support was 6/20 and its top-four Wilson lower bound was 0.10/0.25. Thresholds were not lowered.

Cold acquisition took 2,552.14 ms with 10 requests. Warm acquisition took 439.18 ms with three mutable ladder/index requests, seven immutable cache hits and zero match-detail fetches. Both runs had zero retries/rate-limit waits. Patch relevance remained unavailable. This is bounded regional evidence, not a production meta map.

## Fixture and synthetic evidence

Deterministic tests use synthetic completed matches only and verify:

- canonical normalization, star/copy separation, order-independent fingerprints and fail-closed special/runtime forms;
- similarity monotonicity;
- stable cluster IDs, density support and explicit noise;
- known-family relation, recurring variant diff and neutral emerging label;
- full-threshold Variant/Emerging promotion and tiny high-win rejection;
- acceleration windows;
- Stale and Retired transitions with history;
- illegal/out-of-set retirement;
- model/static/family invalidation and order-independent family fingerprints;
- warm recomputation from immutable cached matches;
- recommendation eligibility and M4 independence;
- Comp Library lifecycle/source filters and secret redaction.

The UI fixture analyzed 21 boards, produced one six-board Experimental variant and 15 noise boards. Those numbers are synthetic UX evidence only.

## Measured benchmarks

One run on this workstation; all benchmark inputs are deterministic fixtures, not live Riot latency.

### M3–M5 regression benchmarks

| Benchmark                     | Result                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| M3 1 × 10 cold                | 11.26 ms; 11 requests; 10 details                                           |
| M3 7 × 20 cold                | 7.59 ms; 27 requests; 20 details; 120 shared refs deduped                   |
| M3 7 × 20 warm immutable      | 7.14 ms; 7 requests; 20 cache hits; zero details                            |
| M3 7 × 20 warm profile/index  | 3.70 ms; zero requests; 27 cache hits                                       |
| M3 partial timeout            | 32.39 ms; 43% coverage                                                      |
| M4 warm profile + pressure    | 3.56 ms acquisition; 12.14 ms derivation; 23.13 ms recommendation/portfolio |
| M5 8,000-board classification | 187.48 ms                                                                   |
| M5 statistics                 | 9.02 ms                                                                     |
| M5 aggregate cold / warm      | 2.39 / 0.87 ms; warm zero details                                           |

### M6 benchmarks

| Benchmark                       |                                                  Result |
| ------------------------------- | ------------------------------------------------------: |
| Canonicalization, 20,000 boards |                              518.94 ms; 38,540 boards/s |
| Similarity, 100,000 comparisons |                        419.25 ms; 238,524 comparisons/s |
| Clustering, 1,000 boards        | 134.38 ms; 9,253 candidate pairs; 11 clusters; 35 noise |
| Clustering, 8,000 boards        |          566.78 ms; 25,629 candidate pairs; 19 clusters |
| Clustering, 20,000 boards       |        1,084.58 ms; 25,629 candidate pairs; 19 clusters |
| Known-family relation pass      |                                 6.37 ms for 19 clusters |
| Lifecycle pass                  |                                 0.09 ms for 19 clusters |
| Warm derived-data load          |              737.29 ms for 1,000 cloned in-memory loads |

No benchmark reached the 2,000,000 pair budget or skipped an oversized block. Observation count and canonicalization dominate once repeated shapes collapse. Worst-case many unique boards sharing the same three-unit blocks can approach the explicit pair/block bounds; skipped/budget-limited work is reported as partial rather than silently treated as complete.

## Validation results

Final results are recorded after the last source change:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test -- --run`: passed, 97 tests in 10 files.
- `npm run build`: passed; third-party Zod annotation warnings only.
- `npm run test:ui`: passed, 18 Playwright tests.
- `npm run benchmark:m3`, `benchmark:m4`, `benchmark:m5`, `benchmark:m6`: passed.
- `npm run m6:live-smoke`: passed bounded cold/warm live path.
- `git diff --check`: passed.
- credential repository/environment audit: passed.

No Rust/native source changed, so native fmt/test/check/debug build was not required by the M6 packet. The live smoke reused the proven documented M5 endpoint/acquisition/cache path and did not alter the Rust boundary.

## Rendered inspection

Playwright rendered and checked discovery Data & Settings, Comp Library and discovered detail at 1440, 1000 and 860 px. All widths had no document/main horizontal overflow and no page errors. Screenshots are in the ignored local `artifacts/` directory.

Hands-on browser inspection separately exercised bounded fixture refresh at 1440 and discovered library/detail at 860. It confirmed readable counts, filters, representative portraits, prevalence, relation diff and recommendation gates. That inspection found and corrected stale “guide-curated” wording in discovered item/decision/board sections; discovered strategy guidance now remains explicitly unavailable.

## Assumptions and configurable product parameters

The following are centralized product/model parameters, not TFT truths:

- similarity weights and the 0.08 per-cost weight step;
- 0.78 neighborhood threshold and support six;
- three-unit blocks, block size 1,500 and pair budget 2,000,000;
- 0.88 known, 0.72 variant and 0.05 relation-margin thresholds;
- 70% stable-diff and 80% prevalence-core thresholds;
- support 20, confidence 0.55, cohesion 0.80, age 21 days, relation certainty 0.72 and top-four lower bound 0.25 promotion/eligibility gates;
- seven-day recent, preceding-21-day prior and acceleration maturity counts;
- 45-day retirement age;
- neutral discovered non-outcome feature values and 0.70 contest elasticity.

Verified TFT/static facts remain active-set IDs, public cost, board eligibility, M2 special-unit rules, ordinary star/copy math and verified trait membership/breakpoints. Outcome values come only from match evidence.

## Limitations and false-positive risks

- A final board does not prove its opener, roll timing, item plan, augment branch, carry/tank intent or pivot path; M6 leaves those fields unavailable.
- Density connectivity can chain close shapes. Cohesion, medoid, prevalence and relation detail make this visible, but future larger evidence may justify a stricter component-splitting pass.
- Combination blocking is bounded and approximate under extreme over-common buckets. Any skipped work is partial/noise, never forced classification.
- Small bounded samples can discover a coherent structural cluster but cannot establish mature meta strength. The live six-board cluster correctly stayed Experimental.
- Rank-cohort adoption is regional/sample-specific and not “global meta.”
- Patch relevance remains unavailable until a reliable public mapping exists.
- Curated anchors remain incomplete: M5's live 33/56 unclassified result and M6's noise both show that registry coverage is not comprehensive.

## Recommended next milestone

Use a larger but still policy/rate-limit-bounded scheduled research sample to calibrate discovery thresholds, validate cluster stability across rolling windows, and add a human curation workflow for naming/approving mature structures. Preserve deterministic legality/relation/lifecycle authority and keep M4 lobby pressure independent.
