# M7 — Strategy & Playbook Intelligence

## Goal
Turn a recommended comp from a mostly final-board/statistical object into a compact, trustworthy in-game static playbook that answers what the user should be looking for, when to level/roll/stabilize, what temporary boards/holders are supported, what can replace missing pieces, and what nearby plans are viable pivots.

M7 should answer:

> I selected this plan. What should I actually do through the game, what evidence supports that guidance, and how can I adapt without the app reading protected live game state?

This milestone is **source-backed static strategy intelligence and deterministic adaptation UX**. It is not live-board automation, not an LLM gameplay oracle, and not final broad UI polish.

Read `AGENTS.md` and every governing authority it references before changing code. Treat this task packet as highest authority for M7.

## Baseline
M1–M6 already provide:
- audited Set 18 static data/rules and legality validation;
- 13 curated named Set 18 anchor families plus discovered variants/emerging clusters;
- documented Riot aggregate/history acquisition, immutable caching, rate-limit safety and native-only credentials;
- M4 lobby unit pressure, separate from aggregate meta evidence;
- M5 measured family outcomes with uncertainty and quality gates;
- M6 deterministic comp discovery/lifecycle/patch-set refresh and generic curated+discovered registry;
- a Comp Library, recommendations, playbook detail page and static guidance placeholders;
- Team Planner remains unsupported/unverified;
- discovered M6 entries intentionally have no invented item/augment/roll/transition/Decision Map guidance.

Preserve all proven M1–M6 behavior unless this packet explicitly extends the strategy/playbook layer.

## Locked product decisions

### 1. Strategy facts must be sourced or derived from verified project truth
Do not invent early boards, item priorities, augment recommendations, leveling timings, positioning, pivot claims or substitute strength from model memory.

Allowed strategy evidence:
- directly inspectable current public comp/strategy guides;
- existing attributed guide material already in the registry;
- audited static champion/trait/item/rule data for legality and mechanical consequences;
- measured completed-match aggregate evidence where it actually supports a claim;
- deterministic computations from the above.

Every strategy field must carry provenance/status such as:
- `sourced`;
- `derived`;
- `inherited`;
- `unavailable`;
- `stale`.

If a source does not support a fact, leave it unavailable rather than filling it.

### 2. No runtime LLM is required
The app must remain useful with deterministic data/rules only. An LLM may help the coding agent research/curate public evidence during implementation, but generated prose or model memory is not authoritative gameplay truth.

### 3. M7 is static/adaptive guidance, not protected live-state reading
The app may use:
- user/manual choices;
- selected plan;
- current lobby pressure already obtained through allowed paths;
- static stage/level/copies/item/augment questions the user chooses manually.

Do not implement protected process access, input automation, packet interception or any form of live-board scraping.

## A. Versioned strategy-guidance model
Create a generic, versioned strategy model attachable to a comp registry entry without bespoke TypeScript per comp.

At minimum support:
- guidance version and reviewed/fetched time;
- source/provenance list;
- active set/static-source fingerprint;
- target family/registry fingerprint;
- coverage/completeness summary;
- opening/early board states;
- midgame/stabilization board states;
- final/high-cap board states where distinct;
- level/roll milestones;
- carries/tanks/temporary item holders;
- item priorities and acceptable alternatives;
- augment categories/branches where sourced;
- flex slots and replacements;
- warnings / do-not-force conditions;
- decision-map nodes/edges;
- pivot metadata;
- optional positioning data with explicit precision/provenance.

Guidance must be data/configuration. Adding another source-backed strategy should not require custom rendering/scoring code.

## B. Strategy evidence coverage
Deepen guidance for the curated Set 18 families only where current evidence supports it.

Aim for broad useful coverage across the 13 curated anchor families, but never fabricate to reach a numeric target.

For each curated family, inspect current directly accessible public sources already used by the project and additional public current sources when necessary. Record exact source URL/page identity and review time.

Prefer quality over field count. A family with only verified final board + roll style should explicitly remain partially covered rather than receive invented early/item/augment details.

Produce a strategy-evidence ledger/report section that shows, per family, which of these are supported:
- stage boards;
- roll/level plan;
- item carriers/priorities;
- augment branches;
- replacements/flex;
- positioning;
- warnings/pivots.

Do not use authenticated/private competitor APIs or hidden proprietary statistics.

## C. Stage progression
Represent a playbook as a sequence/graph of stage states rather than only one final board.

Each stage state may include when supported:
- stage label / timing range;
- target level;
- board roster;
- core vs temporary vs flex units;
- carry/tank/holder roles;
- entry condition;
- exit/transition condition;
- next states.

Requirements:
- validate every unit against active-set static data;
- validate board capacity where exact level/capacity is known;
- do not claim an exact stage timing if only a general `Fast 8`, `Slow Roll`, etc. label is sourced;
- support unavailable/partial stages;
- distinguish a sourced board from a mechanically legal but merely derived board.

## D. Level / roll / stabilization plan
Create a typed deterministic model for roll/level advice.

Support source-backed concepts such as:
- hold/roll at a level;
- slow roll;
- push level;
- stabilize before greeding;
- cap at 8/9;
- reroll copy threshold when directly sourced;
- transition milestones.

Do not invent gold thresholds, exact stage numbers, HP cutoffs, shop odds or copy rules outside verified evidence.

The UI should be able to answer quickly:
- `Next level/roll objective`;
- `What makes me stay on this branch?`;
- `What makes me leave/pivot?`.

## E. Items and temporary holders
Implement a structured item-guidance model.

For each supported important unit/holder allow:
- primary/sourced items;
- acceptable alternatives when source supports them;
- item/component categories;
- flexible slams where supported;
- temporary holder(s);
- source/provenance;
- confidence/status.

Use audited M2 item IDs/recipes for identity and legality.

Do not relabel one published item list as universal BIS truth. Preserve distinctions such as recommended/core/alternative/flexible when the source makes them.

If two plans share compatible item directions, that may be used deterministically by pivot/portfolio tooling, but only from sourced/verified item metadata.

## F. Augment guidance
Model augments as strategy branches rather than a fake exhaustive tier list.

Where current sources support it, classify guidance into categories such as:
- trait/emblem;
- combat;
- economy;
- leveling;
- item/component;
- reroll;
- special/comp-specific.

Each augment/category should explain only the supported strategy consequence, e.g.:
- enables high-cap branch;
- improves reroll commitment;
- changes target level;
- makes a trait variant legal/possible.

Do not invent exact augment rankings, availability, interactions or trait-count behavior where M2 marks them unverified.

## G. Replacements and flex slots
Build practical substitute/flex data with evidence-safe semantics.

A replacement edge should retain:
- missing/target unit;
- substitute unit;
- whether the relation is sourced or mechanically derived;
- role/function if verified;
- trait changes computable from audited static data;
- board legality/capacity effect;
- source/status;
- explicit warning that a derived legal substitute is not proven equal strength unless measured/sourced.

Allow 1–3 useful substitutes where evidence supports them.

Visually distinguish:
- locked core;
- high-priority replaceable;
- temporary holder;
- flex slot.

Do not derive strategy strength solely from trait overlap.

## H. Decision Map engine
Implement a generic typed static decision-map model and renderer.

The map should support manual/observable conditions such as:
- high/low core-copy signal;
- item direction/category;
- augment branch/category;
- economy/tempo branch when source-supported;
- lobby contest state from M4;
- level/roll branch;
- missing key unit / replacement path.

Requirements:
- deterministic nodes/edges;
- no free-form runtime LLM decisions;
- explicit condition source/status;
- no use of unavailable live board state;
- cycles either forbidden or safely bounded;
- deterministic tests for traversal;
- readable fallback when evidence coverage is partial.

The UI may allow the user to click/select a condition and highlight the relevant branch. This is manual decision support, not gameplay automation.

## I. “What am I looking for?” quick strip
Generate the compact top-of-playbook summary deterministically from sourced guidance.

When available, surface:
- key units/copies to watch;
- item/component direction;
- augment category;
- next level/roll objective;
- strongest sourced fallback/pivot;
- one or two high-value warnings.

Do not add marketing-style explanatory copy. The strip should be usable in seconds.

## J. Positioning representation
Add a real TFT-board visualization model rather than only a horizontal roster.

Requirements:
- render a correct TFT-style hex board geometry;
- support exact hex coordinates only when the position is explicitly sourced/verified;
- otherwise support coarser sourced formation/lane information (front/mid/back, corner, side, etc.) if available;
- if no positioning evidence exists, show `Positioning not verified` rather than inventing hexes;
- distinguish core/flex/temporary slots;
- remain usable at 1440/1000/860 desktop widths.

Do not scrape/infer exact positioning from an unsupported image unless the coding agent can verify it reliably and record provenance.

## K. Pivot graph / portfolio cohesion
Use the existing three-plan portfolio to build an inspectable deterministic pivot graph.

Edges may be based on supported evidence such as:
- shared early units;
- shared sourced item/component directions;
- shared carry/tank holders;
- target level/roll-style compatibility;
- structural unit overlap;
- M4 contest difference;
- transition-cost configuration.

Requirements:
- do not claim a pivot is strong solely because final boards share units;
- expose why the edge exists;
- deterministic transition-cost components;
- allow no edge when evidence is insufficient;
- distinguish `sourced pivot` from `derived compatibility`;
- keep the three recommended plans feeling like one coherent portfolio.

## L. Discovered variants/emerging comps
M6-discovered entries must not suddenly receive invented strategy guidance.

Rules:
- Experimental discovered clusters remain guidance-sparse unless separately sourced;
- a mature Variant may inherit only those parent-guidance fields that remain structurally compatible under an explicit versioned inheritance rule;
- inherited fields must be labeled `inherited` and show parent family;
- do not inherit guidance tied to a removed carry/tank/core unit, changed capacity, incompatible roll style or unsupported board structure;
- Emerging unknown clusters get no named strategy/roll/item/augment guidance unless independently sourced;
- recommendation eligibility from M6 remains unchanged by simply having inherited UI text.

Add tests for safe and unsafe inheritance.

## M. Guidance freshness and patch/set invalidation
Strategy guidance must not silently stay trusted after the comp/set changes.

Include enough fingerprints/versioning that guidance becomes stale/unavailable when relevant inputs change, including:
- active set/static source;
- target board/family fingerprint;
- source review version/time where appropriate;
- item/augment identifiers;
- strategy schema/version.

When a new set arrives:
- old-set guidance remains historical only;
- it must not appear as active strategy;
- curated/discovered families revalidated by M6 must obtain fresh compatible guidance separately.

When a same-set comp target board changes materially, mark incompatible stage/item/holder/positioning guidance stale until re-reviewed or safely inherited.

## N. UI / interaction
Improve the playbook experience materially but keep the broad final polish for M10.

Recommended structure from `docs/UX.md` remains authoritative where compatible:
1. target board;
2. quick `What am I looking for?` strip;
3. stage progression;
4. items;
5. augments;
6. replacements/variants;
7. Decision Map;
8. pivot graph;
9. Team Planner action remains disabled/unverified;
10. score/confidence explanation.

Add a compact sticky/local playbook navigation if it improves real usability.

Reduce unnecessary explanatory microcopy rather than adding more.

The user should be able to extract the next action within a few seconds.

## O. Storage/versioning
Persist strategy guidance, source provenance and user-relevant static playbook state as appropriate.

Requirements:
- deterministic schema/version;
- compatibility checks;
- no destructive overwrite of curated source provenance;
- preserve M5/M6 aggregate/discovery datasets independently;
- no secret/API-key material;
- stale guidance remains auditable but is not presented as current truth.

## P. Performance
Playbook rendering/traversal should be effectively local and fast.

Add benchmarks or targeted performance tests where useful for:
- loading/validating all strategy guidance;
- Decision Map traversal;
- pivot graph construction;
- board rendering/data derivation.

Do not add network requests to the hot playbook read path.

## Q. Required tests
Retain all M1–M6 tests and add deterministic coverage for at least:
- guidance schema/provenance validation;
- active-set and board legality;
- stale/incompatible guidance invalidation;
- partial evidence/unavailable fields;
- stage progression validation;
- item ID/holder validation;
- augment unavailable/sourced states;
- replacement/flex trait-delta derivation;
- Decision Map deterministic traversal;
- no unsupported decision-map live state;
- quick-strip deterministic generation;
- exact-position vs unverified-position behavior;
- pivot edge creation/no-edge cases;
- safe/unsafe discovered-variant inheritance;
- M4 lobby pressure remaining independent;
- recommendation scoring unchanged except where explicitly intended;
- UI playbook navigation and responsive behavior.

## R. Verification
Run the full applicable repository suite:
- typecheck;
- lint;
- formatting check;
- full TypeScript/unit tests;
- production web build;
- Playwright;
- M3, M4, M5, M6 benchmarks plus any new M7 benchmark/perf test;
- `git diff --check`;
- Rust/native fmt/test/check/debug build only if native code changes.

Use the documented D: Rust target/temp/cache paths if native compilation is required.

Render and inspect at 1440, 1000 and 860 px. Test at least:
- a well-covered curated playbook;
- a partially covered curated playbook;
- a discovered Experimental/Variant detail where guidance must remain sparse/inherited safely;
- Decision Map interaction;
- pivot graph;
- board visualization;
- no horizontal overflow or browser-console errors.

Human visual judgment remains required.

## S. Documentation
Create `docs/M7_IMPLEMENTATION_REPORT.md` documenting:
- strategy schema/version;
- public sources used and exact evidence coverage per family;
- stage/roll/item/augment/replacement model;
- Decision Map semantics;
- quick-strip derivation;
- positioning evidence semantics;
- pivot graph formula/components;
- discovered-guidance inheritance rules;
- freshness/invalidation behavior;
- storage/versioning;
- fixture/manual/live evidence clearly separated;
- test/build/benchmark results;
- rendered inspection results;
- unsupported strategy gaps;
- recommended next milestone.

Update durable authority docs only when M7 establishes a lasting project decision.

## Explicit non-goals
Do not implement:
- runtime LLM gameplay advice;
- protected TFT process memory/read access;
- DLL/process injection;
- packet interception/TLS MITM;
- Vanguard bypass/evasion;
- automated gameplay/input;
- named opponent future-comp prediction;
- ForceIndex/FlexIndex expansion;
- undocumented/private competitor APIs or proprietary hidden stats;
- fabricated early boards/items/augments/positioning;
- Team Planner encoding unless separately verified and explicitly authorized;
- post-game personal coaching expansion;
- final broad UI redesign;
- uncontrolled background web/Riot crawling.

## Completion standard
M7 is complete when a selected supported comp provides a source-backed, compact, evidence-labeled playbook with meaningful stage progression, level/roll guidance, items/holders, augment branches, replacements/flex, manual Decision Map, board visualization and portfolio pivot context wherever evidence supports them; unsupported facts remain explicit; discovered comps inherit guidance only through safe deterministic rules; all guidance is versioned/stale-safe; and the real UI is validated as usable during play without reading protected live state.

Work only on `codex/m7-strategy-playbook-intelligence`. Do not merge or push unless the human explicitly asks.