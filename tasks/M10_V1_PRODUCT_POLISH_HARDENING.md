# M10 — V1 Integrated Product Polish & Release Hardening

## Goal
Turn the complete M1–M9 TFT Strategist into a cohesive, professional-feeling V1 desktop product: visually polished, fast to understand, reliable across real workflows, resilient to missing/stale/offline data, and ready for the human to use repeatedly without it feeling like an internal prototype.

M10 is the final integrated product pass. It should make the app feel intentionally designed rather than accumulated milestone-by-milestone.

The target user reaction is:

> This looks and behaves like a polished commercial TFT companion. The information hierarchy is obvious, the important actions are fast, the app handles incomplete data gracefully, and nothing feels like a developer dashboard or AI-generated mockup.

Read `AGENTS.md` and every governing authority it references before changing code. Treat this task packet as the highest authority for M10.

## Baseline
M1–M9 already provide the functional V1:
- Tauri 2 + React + TypeScript desktop shell;
- audited current-set/static TFT truth and deterministic legality;
- Riot account/history/scouting and immutable completed-match caching;
- M4 lobby unit pressure;
- M5 measured aggregate family outcomes with uncertainty;
- M6 deterministic comp discovery/lifecycle;
- M7 source-backed playbook intelligence and TFT board rendering;
- M8 durable selected-plan/match session workflow;
- M9 conservative completed-match reconciliation, post-game review and weak personal learning;
- SQLite/local persistence, versioning and compatibility checks;
- Team Planner explicitly disabled until independently verified;
- no protected-process access or runtime LLM requirement.

Preserve the correctness and evidence boundaries proven in M1–M9. M10 may broadly improve presentation, interaction, startup/recovery, packaging, accessibility, performance and bounded correctness defects found during end-to-end use. Do not casually rewrite working strategy/statistical/data architecture.

## Product standard
The app should feel like one coherent product, not nine features joined together.

Visual direction:
- premium dark desktop UI;
- TFT-inspired but not a counterfeit Riot client;
- dark navy/charcoal foundation with restrained warm/gold accent;
- strong typography and spacing hierarchy;
- current TFT champion/item/trait art used where it aids recognition;
- compact but breathable information density;
- subtle depth, hover/focus/motion and polished states;
- avoid glowing/neon gamer excess;
- avoid generic SaaS/admin dashboard appearance;
- avoid excessive rounded cards inside rounded cards;
- avoid decorative art that does not improve decisions;
- no fake generated TFT UI/assets.

Human visual acceptance is mandatory.

# A. Begin with a real product audit
Before implementing the redesign/hardening, run and inspect the current M9 app.

Capture/inspect the main real states at 1440, 1000 and 860 px, including at minimum:
- Your Plans / recommendation portfolio;
- opponent/lobby scouting state;
- Comps library;
- well-covered curated comp detail;
- partially covered comp detail;
- discovered/Experimental comp detail;
- active-plan session;
- stale/historical active session;
- Post-game unmatched/reconciled/ambiguous states;
- mature/insufficient personal evidence;
- Data & Settings;
- empty/no-account/no-key/error/offline states that can be reached safely.

Write an internal prioritized audit before broad edits. Rank issues by:
1. usability/correctness risk;
2. information hierarchy;
3. professional visual quality;
4. consistency;
5. interaction friction;
6. responsive/accessibility quality;
7. low-value microcopy/noise.

Do not blindly repaint the app. Preserve parts that already work well.

# B. Establish one coherent design system
Consolidate the presentation into deliberate reusable primitives/tokens rather than per-page styling drift.

Review and standardize:
- typography scale and weights;
- page titles/subtitles;
- section headings;
- spacing scale;
- content widths and grids;
- surfaces/background layers;
- border/divider treatment;
- accent usage;
- status colors with non-color labels;
- radii;
- shadows/elevation;
- buttons and icon buttons;
- inputs/search/selects;
- tabs/segmented filters;
- pills/badges/status chips;
- cards/rows/stat blocks;
- tooltips/popovers;
- dialogs/confirmation flows;
- toasts/feedback;
- skeleton/loading states;
- empty/error/stale/disabled states;
- scrollbars where controlled by the app;
- keyboard focus rings.

Use CSS variables/design tokens where practical. Do not introduce a huge UI framework merely for this milestone unless the existing app genuinely requires one.

The design system should reduce one-off styling and make every page visibly belong to the same product.

# C. Navigation and shell polish
Make the desktop shell feel intentional.

Review:
- app/brand mark and product name placement;
- sidebar width, visual hierarchy and active state;
- logical route grouping;
- Active plan visibility when a session exists;
- Post-game visibility without dominating pre-game use;
- Data/Settings lower-priority treatment;
- status indicators for data/offline/session state;
- window resizing behavior;
- page content alignment and consistent top offsets;
- sidebar collapse/compact behavior only if it materially improves 860 px use.

Remove redundant slogans/descriptions. Route names should be obvious without tutorial copy.

# D. Your Plans — make the core screen excellent
This is the app's primary value surface and should receive especially strong design attention.

The three-plan portfolio should be immediately comparable.

At a glance expose only information that materially helps choose:
- rank;
- family/comp name;
- evidence/lifecycle label;
- recommendation score;
- confidence;
- measured meta where available;
- contest/lobby pressure;
- floor/ceiling/risk where evidence supports it;
- meaningful champion portraits/final-board recognition;
- portfolio role;
- one compact structured reason.

Improve hierarchy so the user can answer in seconds:
- which plan is #1;
- which is safer;
- which is less contested;
- which is the alternate item/tempo route;
- why the three belong together.

Do not show every scoring component by default. Deeper `Why this plan?` details may be expandable.

Avoid excessive card height and repeated labels. Make the three cards feel like deliberate recommendation choices, not analytics reports.

Lock/select-plan action should be obvious and professional.

# E. Scouting / lobby presentation
Opponent history should improve decisions without becoming an information wall.

Default presentation should prioritize:
- scan completeness/confidence;
- aggregate unit pressure;
- meaningful pressure on the three portfolio plans;
- fresh/cached/partial/unavailable state;
- high-value recent trends when they matter.

Detailed per-opponent evidence can remain expandable.

Review copy so historical evidence is clearly probabilistic and not presented as prediction certainty.

Make warm-cache scans feel instant and cold scans feel active rather than frozen.

# F. Comps library
Make the library feel like a real strategy catalog.

Improve:
- search/filter/sort clarity;
- lifecycle/source distinctions;
- card/row density;
- champion portrait hierarchy;
- provenance/evidence without clutter;
- measured stats where available;
- partial/Experimental states;
- empty/filter-no-results states.

Curated, Variant, Emerging, Experimental, Stale and Retired should be understandable without overwhelming the page with colored chips.

Do not visually imply that an Experimental comp is equivalent to a strongly evidenced curated comp.

# G. Playbook detail — optimize for in-match scanning
M7 is functionally strong; M10 should make it exceptionally fast to consume.

Target hierarchy:
1. comp identity + status;
2. target/final board;
3. `What am I looking for?` quick strip;
4. stage / roll progression;
5. items/holders;
6. augments;
7. replacements/flex;
8. Decision Map;
9. pivot graph;
10. Team Planner state;
11. detailed score/provenance explanation.

Specific polish goals:
- reduce low-value explanatory prose;
- make sourced/derived/inherited/unavailable/stale status visible but quiet;
- keep key units/items/actions highly recognizable;
- make stage progression read like a timeline/route, not a database listing;
- make item-holder transfer visually obvious where sourced;
- improve Decision Map interaction clarity;
- improve pivot graph readability and transition-cost explanation;
- make local sticky navigation feel native and useful;
- ensure unavailable sections do not consume excessive space.

### Positioning handling
Never invent positions.

When exact/coarse positioning is not verified, do not let a large empty board dominate the page. Keep the truthful `Positioning not verified` state, but choose a compact presentation that still communicates the target roster well.

When positioning is sourced, the board should become the primary visual.

# H. Active-plan match workflow
Make M8 feel like a focused mode rather than merely another route.

The active-plan view should prioritize immediate playbook actions and minimize analytics clutter.

Review:
- Active plan header/status;
- plan lock time only where useful;
- current manual stage;
- current Decision Map branch;
- quick strip;
- stage advance/change interaction;
- inspected pivot target;
- switch confirmation;
- end-session confirmation;
- offline/restart resume state;
- stale/historical warning.

The user should reopen the app and immediately know what plan is active and what to look at next.

Do not mutate M8 immutable evidence semantics.

# I. Post-game review and personal learning
Make M9 concise and educational without pretending causality.

Review page hierarchy should emphasize:
- placement;
- selected terminal plan;
- final family/board relation;
- selected-vs-final structural similarity;
- core present/missing where supported;
- switch-chain context;
- compatible M5 baseline residual where available;
- one evidence-backed adjustment or explicit no-supported-adjustment state;
- personal model sample/confidence only when meaningful.

Do not lead with internal model terminology.

Move technical evidence/model details behind expandable secondary treatment if needed.

Ambiguous reconciliation should make confirmation safe and obvious. Reject/unlink should not be dangerously easy.

# J. Data & Settings
Turn the settings page from an engineering console into a trustworthy product settings surface.

Group into clear sections such as:
- Riot account;
- current TFT data;
- meta/discovery refresh;
- scouting defaults;
- personal influence;
- cache/storage/status;
- advanced/debug details.

Default view should contain user-relevant controls and health/state, not internal implementation trivia.

Advanced provenance, versions, fingerprints, cache counts and diagnostic information may remain accessible but visually secondary/collapsible.

Never hide meaningful stale/unavailable/error status.

# K. Microcopy pass
Perform a product-wide copy audit.

Remove/rewrite:
- repetitive helper text;
- slogans;
- generic AI-like explanatory sentences;
- verbose paragraphs that restate visible UI;
- implementation terminology shown to normal users;
- overly defensive wording where a compact status communicates the same truth.

Keep copy precise where evidence boundaries matter.

Prefer terse TFT-oriented labels such as:
- `Low contest`;
- `Patch relevance unavailable`;
- `Positioning not verified`;
- `5/7 guidance fields` only if useful;
- `Cached 2m ago`;
- `Partial scan`;
- `No evidence-backed adjustment`.

Do not turn uncertainty into false confidence simply to make the UI cleaner.

# L. Loading, empty, stale, offline and error experience
Professional quality includes failure states.

Exercise and polish at least:
- first launch/no local data;
- no Riot account configured;
- no Riot API key;
- invalid/expired development key;
- API rate limiting/retry state;
- partial opponent scan;
- static-data network failure with compatible cache;
- static-data failure without usable cache;
- stale strategy guidance;
- stale M8 active session;
- no M5 aggregate dataset;
- no M6 discovery dataset;
- empty Post-game history;
- ambiguous reconciliation;
- corrupted/incompatible cached derivation where safely testable;
- disabled Team Planner.

Messages should tell the user what happened and what action is available, without exposing raw stack traces or secrets.

Avoid full-page blocking spinners when partial/cached data can keep the UI useful.

# M. Team Planner
Do not lower the M8 verification gate.

Team Planner may be enabled only if M10 obtains all required trustworthy evidence:
- audited active-set planner-ID mapping;
- independently known-good current Set 18 fixture(s) with expected unit/slot semantics;
- correct codec behavior against those fixtures;
- human manual paste into the current real TFT client and confirmation of the resulting planner board.

If any gate remains missing:
- keep the feature disabled;
- improve its disabled UX so it does not look broken;
- clearly state what is missing in advanced/detail context;
- do not spend disproportionate M10 effort reverse engineering it.

Never inspect protected processes or proprietary companion internals.

# N. Startup, persistence and recovery hardening
Treat the actual shipped Tauri app as the product.

Review and harden:
- first startup;
- normal warm startup;
- DB migrations M1–M9;
- existing user database upgrade path;
- corrupted/incompatible derived cache handling;
- offline restart with active M8 session;
- stale active-session rendering;
- storage write failures where practical;
- refresh cancellation/timeouts;
- duplicate actions/double-click protection;
- route refresh/deep navigation behavior;
- app close/reopen persistence;
- no secret persistence/logging.

Do not destroy user history to make migration easier.

# O. Performance
The app should feel responsive on ordinary desktop hardware.

Profile before optimizing.

Pay attention to:
- startup time;
- route transition responsiveness;
- 545 KB+ active snapshot load/render;
- 13-comp guidance validation/load;
- large Comp Library filtering;
- history/review load;
- image decoding/layout shifts;
- unnecessary rerenders;
- avoidable repeated derived calculations;
- current production bundle-size warnings.

Use code splitting/lazy loading or memoization only where measured or clearly justified. Do not destabilize the application for theoretical gains.

Retain M3–M9 performance regressions.

# P. Accessibility and interaction quality
Ensure the polished UI remains usable without relying only on color or pointer precision.

At minimum:
- visible keyboard focus;
- logical tab order for primary flows;
- buttons have meaningful accessible names;
- tooltips are supplementary, not required to understand core actions;
- sufficient text contrast;
- status meaning not color-only;
- interactive card/button distinction is clear;
- disabled actions explain why where needed;
- confirmation for destructive/relink/switch/end actions;
- common viewport widths remain usable without horizontal page overflow.

# Q. Packaging / release readiness
Produce and exercise a real Windows release candidate where the repository/tooling supports it.

Review:
- application name/title;
- app/window icon assets already legally available or create a simple original project icon if none exists;
- Tauri metadata/versioning;
- build configuration;
- installer/bundle generation;
- startup from built executable/bundle rather than only Vite/dev mode;
- local database/cache path behavior in built app;
- failure messages in packaged mode;
- no development-only filesystem assumptions.

Do not spend the milestone on marketing assets. Functional release packaging comes first.

If signing is unavailable, document that clearly; do not fake signing.

# R. End-to-end real workflow validation
Perform a full product walkthrough in the real Tauri app.

Minimum fixture-backed path:
1. launch clean/known state;
2. load current Set 18 data;
3. view three recommendations;
4. inspect scouting/pressure;
5. open comp/playbook;
6. lock a plan;
7. navigate away and resume Active plan;
8. change stage/Decision path;
9. inspect a pivot;
10. switch or retain plan;
11. close/restart and resume;
12. end/reconcile through fixture-backed Post-game flow;
13. inspect personal evidence;
14. verify history remains intact.

### Bounded live Riot validation
If a temporary `RIOT_API_KEY` is supplied, perform a bounded live regression of the proven public Riot paths and M9 acquisition/reconciliation candidate generation where a real session is available.

Never persist/log the key.

If no corresponding real M8 session exists, do not fabricate persistent history; use fixture-assisted live evidence and label it correctly.

# S. Visual acceptance matrix
Render and personally inspect the real app, not only component tests.

Required widths:
- 1440 px;
- 1000 px;
- 860 px minimum desktop width.

Inspect at least these final states:
- plans with strong evidence;
- plans with partial meta/scouting evidence;
- opponent scan loading/partial/complete;
- Comp Library default + filtered;
- curated playbook high coverage;
- curated playbook low coverage;
- discovered Experimental comp;
- active plan;
- stale active plan;
- Post-game unmatched;
- Post-game matched;
- Post-game ambiguous;
- insufficient personal sample;
- mature personal sample;
- Data & Settings normal;
- relevant error/offline state.

For each, evaluate:
- hierarchy;
- density;
- alignment;
- text wrapping;
- consistency;
- hover/focus/disabled states;
- horizontal overflow;
- whether key decisions are obvious within seconds.

Iterate after seeing the screenshots. Do not stop after the first CSS pass.

# T. Testing / verification
Run the complete applicable suite after final changes:
- TypeScript typecheck;
- ESLint;
- formatting check;
- all unit/integration tests;
- production web build;
- full Playwright suite;
- M3, M4, M5, M6, M7, M8, M9 benchmarks;
- add M10 targeted performance/UX tests where useful;
- `git diff --check`;
- Rust fmt/test/check;
- Tauri debug build;
- release build/bundle if practical;
- inspect packaged executable behavior.

If M10 changes native code, add appropriate native regression coverage.

Do not weaken tests to accommodate the redesign.

# U. Bounded correctness fixes
During the integrated walkthrough, M10 may fix genuine bounded correctness bugs in M1–M9 discovered through real use.

Rules:
- identify root cause;
- add regression coverage;
- preserve evidence/freshness/security boundaries;
- do not turn final polish into unrelated architectural refactoring;
- document material fixes.

# V. Documentation
Create `docs/M10_V1_RELEASE_REPORT.md` documenting:
- baseline audit findings;
- major visual/design-system changes;
- route-by-route UX improvements;
- copy reduction;
- failure/offline/startup behavior;
- accessibility improvements;
- performance changes with before/after evidence where measured;
- packaging/release status;
- Team Planner support status;
- live vs fixture validation;
- full test/build results;
- screenshot/render acceptance results;
- any unresolved V1 gaps;
- exact manual checks the human should perform before calling V1 complete.

Update durable authority docs only where M10 establishes a lasting project rule.

# Explicit non-goals
Do not implement:
- protected process memory reading;
- DLL/process injection;
- packet interception/TLS MITM;
- Vanguard bypass/evasion;
- automated gameplay/input;
- runtime LLM gameplay advice;
- named opponent future-comp prediction;
- causal coaching unsupported by completed-match evidence;
- major new strategy research as a substitute for polish;
- private/authenticated competitor APIs;
- fake Team Planner support;
- mobile/web product expansion;
- account/cloud sync;
- monetization/marketing systems;
- a wholesale rewrite of the proven M1–M9 domain/statistical architecture.

# Completion standard
M10 is complete when:
- the whole app has one coherent professional visual system;
- the primary plan-selection and active-playbook workflows are fast and clear;
- secondary surfaces feel intentionally designed rather than developer/admin pages;
- microcopy and visual noise are substantially reduced;
- partial/stale/offline/error states are polished and truthful;
- startup/restart/persistence/migrations are resilient;
- packaged Windows behavior is exercised;
- accessibility and responsive desktop behavior are acceptable;
- M1–M9 correctness/evidence/security boundaries still hold;
- full tests/build/benchmarks pass;
- the real rendered UI has been inspected and iterated at all required widths;
- `docs/M10_V1_RELEASE_REPORT.md` records final evidence and remaining gaps.

Work only on `codex/m10-v1-product-polish-hardening`.
Do not merge, commit or push unless the human explicitly asks.