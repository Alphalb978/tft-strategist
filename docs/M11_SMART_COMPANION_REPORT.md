# M11 — Smart Companion implementation report

## Human acceptance follow-up — 2026-09-07

The earlier completion statement did not establish acceptance of the real product flow. This follow-up preserves the uncommitted implementation and fixes the production integration failures identified by manual use. Human acceptance remains for the user to confirm on the updated executable.

### Root cause verified against desktop persistence

A read-only audit opened the real `strategist.db` through SQLite and inspected the selected meta bundle and its referenced intelligence model. The database contained 1,244 cached matches across scopes. The selected EUN1 bundle contained **488 participant boards / 61 matches**, collected on September 6. Its persisted intelligence had an empty client/window scope and zero samples in every profile.

Every selected native match had ranked queue **1100** and `modeSupport: unverified`. The Riot normalizer deliberately uses that mode label; existing ranked meta acquisition accepts the explicit queue. M11 incorrectly required `modeSupport === supported`, a condition satisfied by its original synthetic tests but never by these native records. Consequently, the worker persisted an empty model successfully. This was a production derivation contract mismatch, not a lack of source observations.

The observed pipeline now accepts explicit ranked queue 1100 with unverified mode metadata while continuing to reject explicitly unsupported modes, other queues, wrong sets, incompatible reported patches/builds, out-of-window evidence, invalid boards, and duplicates. It does not change the native metadata to pretend mode or patch verification occurred. The derivation version is `observed-v2-ranked-queue-family-join`.

Read-only rederivation of that same selected cache produced **437 valid participant boards** and retained **51 validation exclusions**. Examples: Adaptors 40 boards; Solar/Elderwood 46; Flora/Executioners 70. All 12 selected discovery cluster profiles now have their actual member counts, ranging from 11 to 70 boards. Blossom/Executioners remains zero because no compatible family evidence was found. No immutable match, account, or session record was edited by the audit.

The actual Adaptor sample contains 14 observed item-bearing champions, 107 distinct holder/item rows, 88 two-item package rows and 20 three-item package rows. These are conditional rows, not independent games. **The selected cached normalized matches contain no augment selections**, so the repaired real-data view correctly reports augment evidence unavailable. The fixture proves populated augment rendering and scoring when selections exist; it does not supply synthetic augment recommendations to the user's real dataset.

Startup now recognizes old or knowledge-incompatible intelligence, presents a cached-derivation status, rebuilds from immutable match IDs already in the selected dataset, persists the model, and replaces the application registry/portfolio with the hydrated result. It needs no Riot request and no hidden fixture route. Failures keep existing evidence with an explicit retry notice.

Curated profiles also union classifier-associated rows with actual members of confidently related `known-family` clusters (certainty at least 0.72), respecting the distinction between playbook IDs and classifier family IDs. The union operates on deduplicated participant rows, so overlapping relations do not double-count observations. Uncertain/variant relations are not indiscriminately pooled.

### Normal product flow now exposed

| User action                                   | Connected behavior                                                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your Plans → Current game                     | Stage, level, health and economy are immediately visible; an inventory disclosure exposes components/items, important unit copies, augment/category and optional board. No locked session is required.                                                        |
| Change current inputs                         | The shared state recomputes the three-plan portfolio through the existing registry eligibility boundary. Cards display Context-aware and structured contribution values, named copies and supported item direction.                                           |
| Reload or lock a plan                         | A pre-lock draft survives reload and is copied into the new active session's manual fields. Active updates use serialized persistence without changing the locked snapshot. End-session clears the current draft.                                             |
| Comps → comp detail                           | Observed evidence appears before the static target board: portraits/prevalence, core/flex, visible holder cards, common items, separate two/three-item packages, augments, level/star distributions, and style with confidence/reasons.                       |
| Comp detail → Optimize board / Build variants | Opens an editable builder in the ordinary page. Choose this comp or selected core, target level, optional current inventory/owned units, and use current scanned pressure.                                                                                    |
| Build legal variants                          | Shows legal rosters, scores, confidence/evidence status, added/removed units, and expandable structured reasons. Novel outputs remain Experimental. Component inputs now participate in conditional holder fit.                                               |
| Click a portrait/item/augment in intelligence | Opens a compact native HTML dialog with sourced mechanics, tags, contextual statistics and usage. Champion views include traits/cost, own items, co-units and common comps; items and augments show per-comp associations without adding overlapping samples. |
| Active Plan                                   | Current Game stays prominent. Current compatible observed intelligence can be viewed alongside the preserved locked decision; stale locked sessions retain their historical context.                                                                          |

The style classifier is versioned `style-v1`. Explicit sourced roll guidance takes precedence. Otherwise mature observed evidence combines modal final level, low-cost core 3-star concentration, four-cost 2-star patterns or legendary-heavy cores. Labels include Level N reroll-like, Fast-8-like / Level 8 cap, Fast-9-like / Level 9 cap, Flexible / Mixed, or Style not established. These estimates display supporting counts and confidence and do not invent exact roll rounds. No style is inferred from a comp's name.

### Follow-up acceptance evidence

Five new unit/integration tests cover native unverified-mode ranked records and rejection cases; confident curated-cluster joins and overlap deduplication; populated core/flex/packages/augments and conservative style; cached-model upgrade and persistence without changing raw matches; and pre-lock draft restoration/transfer to a session.

The new browser acceptance fixture uses **40 matches**, with **80 recurring unknown-comp boards**, two alternating flex units, holder packages/augment selections and **40 compatible curated boards**. It intentionally uses the native `unverified` mode and unavailable patch mapping shape. The production worker and repository prepare the evidence; subsequent actions use normal navigation and controls, without fixture query parameters or test-only routes.

At **1440 / 1000 / 860**, Playwright opens the Comp Library, opens the mature named discovery, checks populated evidence/style, inspects an entity, edits target level in the builder, generates legal alternatives, opens a curated comp and verifies 40 observed boards, edits Current Game on Your Plans, verifies changed portfolio text and named scoring contributions, reloads, and transfers the draft into an active plan.

Focused browser result: **8/8 passed**, including existing M11 flows and all three new acceptance widths. Full unit/integration result: **188/188 across 17 files passed**. The final full browser suite passed **44/44** in 3.6 minutes. Typecheck, lint, format check, production web build and `git diff --check` passed.

The final desktop build (`npm run tauri -- build --no-bundle`) succeeded. The updated executable is `src-tauri/target/release/tft-strategist.exe` (20,141,056 bytes; built September 7 at 00:27 local time). Use this executable for the next manual check; an older installed shortcut may still point at the previous binary. The native wrapper was compiled but no native source or installer was changed. On first load it rebuilds the old intelligence from the selected existing cache; no network collection is needed. Native visual interaction and human acceptance are not claimed by the browser checks. The web build retains the existing non-failing chunk-size warning (main bundle approximately 543 kB before gzip).

The follow-up **M3–M10 benchmark regressions and M11 benchmarks all passed without raised thresholds**. M11 compiled knowledge in 37.81 ms, derived 5,000 boards in 1,896.51 ms, and searched legal alternatives in 66.83 ms. The M10 8,000-board cached pipeline completed in 6,963.87 ms with zero new match fetches; catalog reload was 338.68 ms and library navigation 277.31 ms. Browser cold load was 490.9 ms, with warm reload/resume 487.5–615.6 ms. Results and commands are preserved in `artifacts/m11/acceptance-benchmarks.json` and associated logs.

Actual screenshots inspected include discovered core/flex/style at 1440 and 860; item and two/three-item packages at 1000; augment/level/star data at 860; builder at 1000 and 860; the entity dialog at 860; contextual recommendations at 860; and active manual state at 1440. Text, wrapping, controls and evidence labels were checked in the rendered application. A nested input width issue found during inspection was corrected. Artifacts are `artifacts/m11/acceptance-*.png`, with unit/build/browser logs in the same folder. The initial acceptance run used a shorter cold-start wait than the existing suite; the test now uses the existing 20-second startup allowance, and all focused flows pass.

Commands for this follow-up include `npx tsx artifacts/m11/audit-evidence.ts` (read-only), `npx vitest run src/test/m11Integration.test.ts`, the standard typecheck/lint/format/test/build scripts, the focused and full Playwright suites, `npm run tauri -- build --no-bundle`, and `git diff --check`. No research, live Riot crawl, broad redesign, private API access, runtime LLM, commit, push, or merge was performed.

Source limitations remain explicit: missing item effects/augment fields are not fabricated; unknown content/build mapping does not become verified patch parity; a genuinely empty/weak compatible sample stays empty/weak; exact timing/positioning and causal benefits remain unavailable. All existing recommendation eligibility, sample/confidence and novel-board safeguards remain in place. P1 remains deferred.

---

## Original implementation record (superseded by the acceptance follow-up above)

Implementation date: 2026-09-06. Branch: `codex/m11-smart-companion`.

M11 adds deterministic knowledge normalization, observed strategy intelligence, legal board search, and manual contextual adaptation to the existing M10 application. Work remains in the working tree for human review. No commit, push, merge, reset, installer experiment, runtime LLM, or live Riot collection was performed. P1 is deferred.

## Evidence vocabulary

- **Sourced:** identity, display assets, structured effects, ability variables, base stats, recipes, and reviewed legality rules actually present in the selected source or repository authority.
- **Mechanically derived:** bounded semantic tags with a readable source clause, structured tag, stat, or effect attached as evidence. Opaque hashes are retained without guessed meanings.
- **Statistically observed:** compatible completed-match frequencies, distributions, conditional subsets, shrunk outcome estimates, and confidence. These are associations, not causal effects.
- **Inferred:** deterministic search scores, naming choices, strategic flexibility/fragility estimates, and scenario fit. These are inspectable model judgments, not proven gameplay strength.
- **Unavailable:** unsupported source fields, combat parity, actual final bonus capacity, stage timing, positioning, causal item/augment effects, and contest elasticity without sufficient evidence.

## Correctness fixes (P0-A)

All live recommendation recomputation now passes through `rescoreRecommendations`, which uses the same registry eligibility boundary as initial recommendations. Experimental, Stale, Retired, and otherwise ineligible discovered entries cannot return after lobby scanning or manual-state updates. Registry construction also rejects those lifecycle states even if a stale eligibility flag says otherwise.

Your Plans only displays Avg / Top4 / Win for eligible M5 family statistics. Insufficient samples show their game count and an explicit insufficient-sample message, with outcomes neutral. M5 quality thresholds remain unchanged. Dedicated regression tests cover both fixes.

## TFT knowledge and patch handling (P0-B, C, R)

`TFTKnowledgeSnapshot` contains knowledge/semantic versions, reviewed set identity, a separately nullable balance patch, fetch provenance, official evidence links, combat parity, per-entity mechanics and fingerprints, and a complete coverage ledger. `knowledgeSchema.ts` validates this layer as part of static-data loading.

`compileKnowledge` deterministically normalizes inspectable CommunityDragon fields. The original static catalog remains the source of identity, display metadata, roster eligibility, and existing rule integration. Knowledge enriches it rather than replacing those contracts.

| Fields                                                       | Populating source and treatment                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Champion ID/name/cost/traits/art/shop status                 | Existing CommunityDragon normalization and audited roster/rule fixtures                                                   |
| Ability name/description/variables; relevant base stats      | Selected champion `ability` and `stats` objects; original variables and unresolved tokens retained                        |
| Traits and breakpoint effects                                | Selected trait descriptions and `effects` entries, including min/max and variable maps; counting remains in audited rules |
| Item identity, artwork, recipe, category                     | Existing structured item normalization; raw class, effects, restrictions, and tags retained when present                  |
| Item effect description/stat modifiers                       | Source `desc`/`effects`; missing values remain unavailable                                                                |
| Augment identity, artwork, availability                      | Existing active-set selection and structured normalization; unsupported state is unverified                               |
| Augment descriptions, effects, associated traits, tier/class | Structured source fields only; tier/class remain null when absent                                                         |
| Semantic dimensions                                          | Explicit readable source tags, known numeric effect keys, positive mechanic clauses, and sourced attack range             |
| Patch identity and combat parity                             | Existing version/provenance authority; reviewed set identity does not assert a new balance or hotfix verification         |

Source used: [CommunityDragon TFT structured export](https://raw.communitydragon.org/latest/cdragon/tft/en_us.json), the checked-in reduced source fixture, and existing M2–M10 reviewed rules. The reviewed identity manifest references the existing [official Set 18 patch identity authority](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-1/). No competitor scraping was used.

One bounded live public-static inspection confirmed the missing combined-item fields also exist in the public export: `desc: null`, `effects: {}`. The inspected response reported Last-Modified `Sat, 29 Aug 2026 00:53:30 GMT`; the raw response is an ignored artifact at `artifacts/m11/public-static-inspection.json`. It was inspected for schema/source gaps and did not silently replace the reviewed release data or assert current combat parity.

Coverage of the selected fixture is **866 normalized entities: 74 champions, 36 traits, 502 items, 254 augments**. The full inspected export accounts for the same 866 selected entities plus 630 explicit exclusions, principally entries outside the reviewed active namespace. Coverage records include exclusion reasons and asset availability. Tests check identity/display safety even with advanced fields absent. Coverage means accounted for, not that every mechanic is available or every asset URL was downloaded.

`data/rules/active-set.json` is the small reviewed identity manifest. Resolution requires exactly one matching set/mutator plus identity probes. It never selects the highest set number or final payload entry. Ambiguous or missing identity fails closed. A future set requires reviewed identity and legality updates; ordinary same-set balance labels do not require editing TypeScript constants to load the source.

Set identity and nullable balance patch are separate. Same-set rule auditing continues to check roster, recipes, and board rules instead of rejecting solely on the historical patch string. Old guidance becomes stale when appropriate. This does not upgrade existing known-stale/unverified combat parity.

Knowledge fingerprints include source entity content and normalized mechanics, excluding fetch-time-only changes. Entity deltas selectively remove dependent observed profiles, champion summaries, and graph edges. A different known balance patch or set invalidates incompatible intelligence. Unchanged structural catalog references can be rebased on refresh; immutable matches and historical session data remain intact. Client-to-content patch mapping is not invented.

## Observed strategy, items, augments, champions, graph (P0-D–H, O, S)

`deriveIntelligence` builds `intelligence-v1` / `observed-v1` summaries from current-set supported ranked matches (or explicit test fixtures). It excludes future/out-of-window evidence, deduplicates immutable match/participant observations, and partitions unknown content patches by exact latest client version. Known content patches require an exact match. Scope includes set, patch/client versions, cohort, region, window, and freshness.

Discovered profiles join actual canonical cluster member fingerprints. Curated profiles use the existing classifier. No curated definition is required for an unknown cluster's intelligence.

Each profile includes:

- Unit prevalence, core/flex/situational labels (frequency thresholds 80% and 25%), star distributions, final levels, common structures, bounded pairs and useful triples.
- Champion-and-profile-conditioned item frequency, holder concentration, completed two/three-item packages, recipe components, package diversity, and observational outcome context.
- Augment frequency, sourced tier/category where available, diversity/concentration, outcome context, and association relative to the compatible population.
- Sample, unique/effective match count, freshness-sensitive confidence, scope, provenance, derivation version, and explicit unavailable fields.

Outcome estimates use recency weighting, a 20-observation neutral prior, effective sample capped by distinct matches, minimum 20 matches, and a confidence threshold. Top4 estimates carry a bounded uncertainty interval. This is a conservative approximation for clustered observational data, not a causal estimator. Frequency alone never means necessity or optimality; rare winners do not bypass the sample gate.

Final capacity is explicitly unavailable: participant level cannot prove bonus slots. Final-board evidence does not manufacture early boards, transition stages, roll timing, or positioning.

Global champion profiles expose presence, shrunk placement/Top4/win/bot4, stars, own-holder items/packages, co-units, and family membership. They are adoption/context priors, not standalone champion power. Verified-member champion summaries are preferred in the entity view where available. Large redundant family-style tables are omitted from global champion records to control memory.

The versioned unit graph records co-occurrence, conditional co-occurrence, shared traits, sourced range complementarity, and observational outcomes. Eligible edges support the builder's flex pool and contextual structure scoring. Co-occurrence is not labeled causal synergy.

Learned feature records reduce neutral defaults only where evidence permits: item flexibility, augment flexibility, core/holder/star/rarity fragility, availability burden, mature floor and ceiling. Each has sample/confidence, derivation and fallback. Contest elasticity remains unavailable. Exact tempo and transition timing are not learned from final boards.

## Naming and playable discovery (P0-I, K, Q)

Friendly names use deterministic observed core/holder evidence while preserving stable cluster IDs. Display names, name derivation version, and name evidence are separate from persistence identity. Related curated variants retain their parent relationship. No reroll or special-mechanic title is generated without supporting evidence.

Comp detail now exposes observed core/flex, holder and item-package icons/samples, augments, star/level distributions, common structures, entity mechanics, builder alternatives, and evidence gaps. Existing curated guidance and lifecycle/meta surfaces remain available. Unsourced discovered stages remain unsourced.

The mandatory autonomous fixture uses a legal six-unit current-set structure absent from every curated definition. Repeated evidence (32 matches / 64 participant boards) passes canonicalization, clustering, unknown classification, lifecycle promotion, stable friendly naming, profile/core/item/package/augment derivation, registry/catalog exposure, and gated recommendation/builder use. Small-sample versions remain ineligible. Unit tests cover the full chain, and a browser test executes the production discovery/intelligence worker path with a fixture provider before opening the resulting observed profile. Curated comp definitions were not edited for this acceptance case.

## Verified ladder cohort (P0-L)

Acquisition records known PUUID membership from the existing supported official Challenger/Grandmaster/Master ladder endpoints. The selected union permits Challenger, Grandmaster+, or Master+ scope. This uses existing bounded endpoint acquisition, not a new crawl.

Two populations remain explicit: broad discovery-lobby observations and the subset whose PUUID appears in known selected membership. Production rank-specific family statistics prefer the verified subset; broader family statistics remain available for discovery. Catalog representation uses the matching verified denominator. The intelligence layer can additionally derive verified champion profiles. Lower-rank membership is not inferred.

The existing acquisition cap and failures can leave membership partial; completeness is conservative. Membership describes known ladder membership when fetched, not independently proven participant rank at historical match time.

## Builder and board quality (P0-J)

`board-optimizer-v1` uses a bounded pool of 22 units, beam width 10, and three add/swap search rounds. Seeds come from desired/observed/curated core; flex candidates use compatible traits, eligible graph edges, observed prevalence, and owned units. Inputs include desired champions/trait, target level, current game, and lobby pressure.

Every emitted board passes the existing legality validator with no unresolved validation issue: current pool eligibility, distinct units, target-level capacity, special-unit restrictions, required core, and verified trait requirements. Unsupported conditional bonus capacity/special access is conservatively rejected. Desired traits must reach a verified active threshold.

Inspectable score components cover conditional structure/pairs (shared 35-point budget), verified traits, range complementarity, owned-unit retention, supported item-holder evidence, observed augment association, historical unit pressure, rarity/uncertainty, and empty capacity. Correlated structure signals have an explicit joint cap. Scores are search heuristics, not combat simulations or evidence of meta superiority.

The builder can return Standard, Low-contest, Item-compatible, and Current-board pivot alternatives when inputs and distinct legal results support them. Lobby pressure is connected through the actual comp-detail UI. Unsupported High-cap labels are not forced. Exact sufficiently observed structures can be labeled Observed; all novel boards remain Experimental.

## Current game, contextual scoring, portfolio (P0-M, N, P)

Validated `CurrentGameState` records stage, level, health/economy bands, owned copies, components, completed items, augments/category, optional current board, set, and update timestamp. The Active Plan editor uses compact selectors, champion search, chips, and copy steppers. Entity IDs/counts are validated.

Current state persists in manual session fields outside the immutable locked snapshot and survives reload and plan switches. The locked portfolio remains a record of the original decision. Live Your Plans and Active Plan adaptation use current context, with explicit target gaps.

Structured deterministic contributions explain owned copies, retained core, sourced/observed item direction, supported augments, level/economy feasibility, and critical-health transition burden. Unsupported signals contribute zero. Existing lobby pressure and weak personal influence remain bounded; default personal influence stays 5% with the existing 5–10% range.

Scenario compatibility comes from supported AD/AP item directions, reroll-copy evidence, sourced leveling feasibility and economy, retained-board stabilization, flexibility, and lobby pressure. No scenario probabilities are fabricated. The portfolio objective adds scenario coverage and shared failure penalties to candidate quality, strategic diversity, shared-core/contest protection, and pivot compatibility. Roles include Best current fit and distinct evidence-supported alternatives. Tear presence is no longer the AP role heuristic. A regression demonstrates selection differs meaningfully from redundant naive top-three ranking.

## Storage and performance (P0-T)

Expensive observation derivation runs in a cancellable worker in the browser, with a deterministic direct path for non-worker tests. A Data action rebuilds intelligence only from immutable IDs already in the selected cached dataset. It performs no network collection. Models are fingerprinted with scope, source/knowledge, discovery/statistics/semantic/optimizer versions and evidence identity.

Large knowledge and intelligence blobs are stored once and referenced by immutable fingerprints. Locked snapshots retain original static display data plus a knowledge reference, avoiding repeated full mechanic blobs. Browser catalogs and large model payloads use IndexedDB with small localStorage references; legacy inline values remain readable. SQLite uses the existing repository/settings mechanism, without a native schema migration. Writes persist blobs before publishing pointers. Missing derived blobs become unavailable rather than silently inventing data. Raw immutable match storage and M8/M9 history remain separate.

M8/M9 regressions exposed repeated static fingerprint computation. A bounded value-signature cache preserves historical hash semantics and detects in-place changes; post-game history computes static compatibility once per chain. No benchmark thresholds were relaxed.

Final measured results on this Windows workspace (fixture data, wall time varies):

| Check                                      | Measured result                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| M3 warm 7×20 profile/index                 | 4.34 ms; zero requests, 27 cache hits                                            |
| M4 warm candidate/portfolio                | 33.41 ms; three plans                                                            |
| M5 8,000-board classification + statistics | 159.05 ms                                                                        |
| M6 / M7                                    | Existing benchmark scripts pass unchanged thresholds                             |
| M8 lock / persist / resume / switch        | 18.52 / 19.79 / 2.35 / 34.82 ms; snapshot 546,486 bytes                          |
| M9 500 reviews / 100 warm history loads    | 350.02 / 346.58 ms                                                               |
| M10 8,000-board cached pipeline            | 5,467.16 ms; 1,000 cached matches, zero new matches                              |
| M10 catalog reload / library route         | 338.99 / 266.64 ms; full bundle 7,919,150 bytes                                  |
| M10 browser cold / warm reload-resume      | 491.1 ms / 408.8–603.9 ms                                                        |
| M11 knowledge compilation                  | 35.26 ms mean across ten compilations; 866 entities                              |
| M11 observed intelligence                  | 1,810.46 ms for 5,000 boards, 25 profiles, 74 champion profiles, 308 graph edges |
| M11 derived model                          | 1,190,101 serialized characters in the benchmark fixture                         |
| M11 optimizer                              | 66.37 ms; every emitted board legal                                              |

The M10 large-catalog test initially exposed localStorage quota failures. The final benchmark uses the production repository and now passes. This is separate from machine disk free space. Browser storage has per-origin limits.

## Validation and rendered acceptance (P0-U)

Commands actually run:

```text
npx tsx scripts/compile-knowledge.ts
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run benchmark:m3
npm run benchmark:m4
npm run benchmark:m5
npm run benchmark:m6
npm run benchmark:m7
npm run benchmark:m8
npm run benchmark:m9
npx tsx scripts/benchmark-meta-v1.ts
node scripts/profile-m10.mjs m11
npx tsx scripts/benchmark-m11.ts
npx playwright test --workers=1
git diff --check
```

Final unit/integration result: **183 tests across 16 files passed**, including 19 focused M11 tests. Typecheck, lint, formatting, and production web build passed. M3–M10 regressions and all three new M11 benchmark categories passed. The full browser suite passed **41/41**. No native source changed; Rust checks were not required or claimed.

The production build retains a non-failing Vite chunk-size warning (main chunk approximately 536 kB before gzip), plus third-party annotation warnings. Measured startup remains within the existing benchmark budget; no threshold was raised to suppress a failure.

Browser validation artifacts are in `artifacts/m11/`: manual state, intelligence/builder, Your Plans, and Data at **1440, 1000, 860** pixels, plus the autonomous discovered profile at 1440. Tests exercise manual updates, reload persistence, immutable snapshot preservation, mechanics display, legal alternatives, no horizontal overflow, legacy sessions, and the existing M1–M10 flows. A dedicated browser storage regression round-trips a 6,000,000-character catalog payload, replacement, and a legacy inline payload.

Actual rendered screenshots were inspected: Current Game at 1440 and 860, mechanics/builder at 1000 and 860, Your Plans at 1440, Data knowledge metadata at 1440/1000/860, and the discovered profile at 1440. Controls wrap within the available width, panels remain readable, original navigation/theme are preserved, missing mechanics are labeled, and novel alternatives are explicitly Experimental. The discovered profile displays observed core and item/package icons with samples plus augment/star/level evidence. The transient existing lock confirmation appears in some captures. These are browser-rendered checks, not a new human in-game/client-paste verification.

Intermediate UI runs found storage quota pressure, asynchronous lock-test races, and remote-image decode waits. Fixes address actual storage and synchronization; screenshot decoding waits are bounded. Existing visual design, navigation, and M10 surfaces are preserved. Native Windows screenshot tooling was not used.

## Changed-file map

- Knowledge: `src/domain/intelligence.ts`, `knowledgeSchema.ts`, `staticSchema.ts`; `src/providers/knowledge.ts`, `communityDragon.ts`; `data/rules/active-set.json`; bundled static data; `scripts/compile-knowledge.ts`.
- Intelligence/search/context: `src/strategy/observedIntelligence.ts`, `intelligenceCompatibility.ts`, `boardOptimizer.ts`, `currentGame.ts`, and integrations in scoring/portfolio/meta catalog.
- Application: registry, refresh workers/services, meta acquisition, application/session lifecycle, and the shared domain models.
- Persistence: repository and new derived cache; compatible fingerprint/post-game performance fixes.
- UI: `SmartCompanion.tsx`, App, Playbook, Home, DataSettings, and targeted product CSS.
- Validation: M11 unit fixtures/tests, browser scenarios, knowledge/observation/optimizer benchmark, existing verified-cohort expectations, async-lock/seed/screenshot helpers, and the M10 benchmark's production repository seeding.

## Remaining limits and deferred work

1. Complete source accounting does not mean complete combat knowledge. Missing combined-item descriptions/stat modifiers, many augment classes/tiers, hashed variables, and unresolved ability/trait placeholders remain explicitly unavailable. The compiler preserves raw evidence and can consume future supported fields.
2. Official hotfix parity and exact client/content-patch mapping remain unverified where the existing authority cannot establish them. The UI does not upgrade known-stale data to current. Incompatible derived models are withheld.
3. Final-board data supports observed structure and outcome context, not actual final bonus capacity, stage-by-stage strategy, exact roll/transition timing, positioning, necessity, or causality.
4. Builder search is bounded and heuristic. It can miss a better legal board, rejects unverified special/bonus rules, and never proves a novel board is meta. Conditional item/augment evidence is limited by compatible sample and public source completeness.
5. Verified rank means explicit membership in the fetched selected ladder subset. Endpoint bounds, partial collection, and historical rank changes limit coverage. Discovery-lobby participants do not acquire verified rank by association.
6. Browser model blobs are immutable derived caches; automatic garbage collection is not added in M11. Native SQLite remains the primary desktop store. Browser backup/export behavior was not expanded.
7. P1 opponent tendencies, richer personal learning, and aggregate post-game pattern insights are deferred to keep this milestone focused on P0.
