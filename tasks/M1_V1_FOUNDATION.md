# M1 — TFT Strategist V1 Foundation

## Recommended execution model
GPT-6 Astra — High effort.

This is intentionally one coherent milestone-sized task. Do not split it into dozens of disconnected micro-tasks unless blocked by the environment.

## Outcome
Produce the first runnable, visually polished TFT Strategist desktop V1 foundation from this mostly empty repository.

The result must be a real application architecture, not a static mockup. It should establish correct current-set data/domain/rule boundaries, render a premium recommendation/playbook workflow, and leave strong extension points for Riot history/opponent scouting and later comp discovery.

## Read before changing code
Read in full, in this order:
1. `AGENTS.md`
2. `docs/DECISIONS.md`
3. `docs/TFT_KNOWLEDGE.md`
4. `docs/RECOMMENDATION_ENGINE.md`
5. `docs/UX.md`
6. `docs/ARCHITECTURE.md`
7. `docs/PRODUCT.md`
8. `docs/PERSONAL_MODEL.md`
9. `docs/MODEL_ROUTING.md`

These are governing project authority.

## Critical instruction
Do not invent exact current TFT facts to make the demo look complete.

If an exact current-set rule, champion property, trait breakpoint, shop/pool/economy value, Team Planner encoding detail, or strategic playbook fact is not verified from a current public source or supplied fixture:
- do not guess;
- implement the surrounding contract;
- mark the value/path as unverified;
- keep the rest of the milestone moving;
- report the gap at the end.

## In scope
### 1. Desktop application foundation
Create a working:
- Tauri 2 shell;
- React + TypeScript + Vite frontend;
- coherent source layout matching `docs/ARCHITECTURE.md`;
- local development/build commands;
- lint/typecheck/test setup appropriate to the stack.

The app must actually launch in development on the target environment if dependencies/tooling permit.

### 2. Active-set static data provider
Implement a provider boundary for current TFT static data, with CommunityDragon or another current public static source as the working implementation.

Ingest at least:
- active-set champions/units;
- traits;
- items;
- augments when available/reliable;
- art/icon references;
- IDs/provenance/version metadata needed by domain objects.

Normalize external payloads before use by strategy/UI.

Cache static data locally enough that the app does not become unusable if a network refresh fails after a successful fetch.

### 3. Domain model
Implement typed domain structures for at least:
- ActiveSetVersion;
- Champion;
- Trait;
- Item;
- Augment;
- Board;
- Playbook;
- CompFamily / CompVariant;
- EvidenceLabel;
- Confidence;
- RecommendationCandidate;
- RecommendationPortfolio;
- OpponentProfile/LobbyPressure contracts;
- PersonalProfile contract.

Domain types must not depend on React components.

### 4. Rules and validation
Implement a versioned rule/validation layer sufficient for the data/playbooks used in this milestone.

At minimum validate:
- active-set unit membership;
- board unit count/capacity for its declared target;
- missing/invalid referenced items/augments;
- declared required units;
- duplicate/unique constraints only when verified and relevant;
- declared trait breakpoint claims only when the necessary current rule data is verified;
- unsupported Team Planner status.

Tests must prove invalid seeded boards are rejected/flagged.

### 5. Structured playbooks
Create the playbook schema described in authority docs.

Seed several real current-set example playbooks only from verified current evidence/data available during the task. Each playbook should carry provenance/evidence status.

A playbook should support:
- final/core board;
- early/mid/stabilization/final stage boards where evidence is available;
- core vs flex units;
- carry/tank roles;
- item priorities/alternatives;
- augment categories/branches;
- play/avoid signals;
- Decision Map nodes/edges;
- replacements;
- pivot relationships;
- variants;
- Team Planner support status.

If high-quality current strategy evidence is not available for a field, leave it explicitly unavailable rather than making up a TFT opinion.

### 6. Recommendation engine first pass
Implement inspectable deterministic scoring contracts and a functional first pass.

Candidate scoring must expose components for at least:
- meta/evidence strength input;
- consistency/floor;
- ceiling/cap;
- item flexibility;
- augment flexibility;
- transition quality;
- stage/tempo safety;
- roll/availability feasibility;
- dependency fragility penalty;
- lobby/contest input contract;
- personal adjustment with default small weight (~5%).

Some components may use seeded values in V1 if provenance says they are seeded/demo rather than derived live.

### 7. Confidence
Implement confidence independently from recommendation score.

Confidence should be able to account for:
- evidence label;
- source freshness;
- sample size when present;
- missing lobby data;
- current-patch relevance;
- seeded vs derived strategy metadata.

UI must display confidence clearly.

### 8. Three-plan portfolio optimizer
Do not simply take the top three candidates.

Implement a first portfolio optimizer that can reward:
- item/opening coverage;
- strategic diversity;
- useful pivot relationships;
- reduced shared core-unit dependency;
- different roll/level styles where data exists.

Tests should include a case where the third-highest individual score is preferred over the second because it creates a meaningfully better three-plan portfolio, or equivalent proof that portfolio interaction changes selection.

### 9. Premium UI
Build a real product-quality first UI consistent with `docs/UX.md`.

Required primary screens:

#### Recommendation home
Three prominent recommendation cards showing:
- #1/#2/#3;
- comp name;
- score;
- confidence;
- evidence label;
- contest pressure state (may initially be unavailable/neutral if no lobby data);
- floor/ceiling cue;
- champion portraits;
- short structured reason;
- portfolio role.

#### Playbook detail
Must include a visually useful version of:
- target board;
- quick “What am I looking for?” strip;
- stage progression;
- items;
- augments;
- variants/replacements;
- Decision Map;
- pivot information;
- Team Planner Copy Team Code action/status;
- why-this-plan score/confidence breakdown.

Use real current-set art/assets when legally/technically available from the static provider. Avoid fake generated TFT UI imagery.

UI requirements:
- dark premium desktop design;
- strong spacing/typography;
- no generic Bootstrap/admin-dashboard look;
- responsive to common desktop window sizes;
- sensible loading/error/empty states;
- keyboard focus for primary actions;
- score/confidence meaning not dependent only on color.

Run the app and inspect the actual rendered UI if the environment permits. Fix obvious visual/integration issues before finishing.

### 10. Team Planner module
Implement an isolated codec/support module.

If the current active Set Team Planner encoding can be verified from a trustworthy public implementation/source plus a known-good fixture:
- implement it;
- add tests;
- expose Copy Team Code.

If it cannot be verified confidently:
- implement the interface/status model;
- show `Unverified`/disabled UI;
- do not emit speculative codes.

Manual paste in the actual TFT client remains a human acceptance gate after this task.

### 11. Local persistence/cache
Establish SQLite/local storage architecture for:
- settings;
- static-data cache metadata;
- recommendation snapshots or saved plan selection if useful;
- completed-match/opponent cache schemas or repositories sufficient for future implementation.

Do not overbuild migrations for features that do not exist yet.

### 12. Riot/opponent scouting contracts
Create clean provider/service contracts for:
- user Riot account/profile identity;
- current-game/lobby participant discovery where available through official/public Riot paths;
- recent match IDs;
- completed match fetch;
- opponent profile derivation;
- lobby pressure output.

If API credentials/access are already available safely in the environment and implementation is straightforward, implement a first working read-only opponent path.

If credentials/setup are absent, do not block M1. Provide the contracts, mocks/fixtures, caching shape and clear setup docs without embedding secrets.

### 13. Personal/post-game contracts
Implement enough typed structure to support later:
- selected plan -> completed match association;
- weak personal adjustment;
- personal strength/weakness insights;
- post-game summary.

A full historical model is not required in M1.

## Explicit non-goals
Do not implement:
- process memory reading;
- injection;
- packet interception/TLS MITM;
- Vanguard bypass/evasion;
- kernel/driver work;
- automated gameplay input;
- private Blitz/MetaTFT IPC/auth extraction;
- live shop/bench/board reading;
- a runtime LLM dependency;
- complex ML merely to look sophisticated;
- broad scraping of proprietary companion internals.

## Tests / acceptance checks
At minimum, add automated tests that cover:
- static provider normalization fixtures;
- active-set membership validation;
- playbook board validation;
- deterministic score components;
- personal adjustment stays weak/default-bounded;
- portfolio optimizer interaction/diversity behavior;
- confidence differs from score and falls with missing/weak evidence;
- unsupported Team Planner format fails safely;
- known-good Team Planner fixture if encoder is implemented.

Run all available:
- install/build;
- typecheck;
- lint if configured;
- unit/integration tests;
- Tauri build/check appropriate to environment;
- app launch/manual visual inspection where possible.

Do not report a command as passed unless it was actually run.

## UI acceptance
Before declaring complete, inspect for:
- three-plan screen legible at a glance;
- real champion art loading correctly;
- no broken/missing asset walls;
- no huge data tables as the primary experience;
- playbook readable without scrolling through paragraphs of prose;
- Copy Team Code status/action obvious;
- loading/error states not visually broken;
- no placeholder lorem ipsum or fake analytics presented as real.

## Documentation to leave
Update/create concise project docs as needed for:
- local setup/run commands;
- environment variables without secrets;
- current static source/provenance;
- what recommendation inputs are real vs seeded;
- current Team Planner verification status;
- current opponent-scouting status;
- known gaps.

Do not rewrite governing authority docs unless the task genuinely requires a correction; if so, explain why.

## Required final report
Return a concise implementation report with:
- summary of what was built;
- important architecture decisions;
- changed files/major modules;
- public data sources actually used;
- which TFT facts/playbooks are verified vs seeded/unverified;
- tests/build/run commands actually executed and results;
- UI inspection performed;
- Team Planner support status;
- opponent scouting status;
- unresolved blockers/risks;
- recommended next task.

## Definition of done
M1 is done when:
- the app can be launched;
- current static TFT data is represented through a real provider/domain layer;
- rule/playbook validation works for the facts used;
- several current-set playbooks can be rendered structurally with honest provenance;
- three-plan scoring/portfolio selection works;
- confidence/reasons are visible;
- home + playbook UI are coherent and polished enough for human review;
- Team Planner is verified or explicitly unavailable/unverified;
- critical tests pass;
- no protected-process functionality exists;
- remaining work is a prioritized V1.5 list rather than missing foundational architecture.
