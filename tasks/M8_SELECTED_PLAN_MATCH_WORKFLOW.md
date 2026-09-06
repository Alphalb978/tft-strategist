# M8 — Selected Plan, Match Workflow & Team Planner Verification

## Goal
Turn recommendations/playbooks into a coherent pre-game-to-match workflow: the user chooses one plan, locks an exact evidence snapshot, can reopen a compact active-playbook view throughout the match, can switch/end the session explicitly, and—only if the current Team Planner format is independently verified—can copy a trusted current-set Team Planner code.

M8 should answer:

> I chose this plan. How do I keep the exact plan and evidence I chose, reopen it instantly during the match, switch safely if needed, and copy it into TFT Team Planner if the encoder is truly verified?

This milestone is **workflow/session state and Team Planner verification**, not more strategy research, not post-game coaching, and not final product-wide polish.

Read `AGENTS.md` and every governing authority it references before changing code. Treat this task packet as highest authority for M8.

## Baseline
M1–M7 already provide:
- deterministic recommendation portfolio of three complementary plans;
- current-set/static truth, Riot history/aggregate evidence, M4 lobby pressure, M5 measured meta, M6 discovery/lifecycle, and M7 source-backed playbook intelligence;
- existing selected-plan snapshot behavior and a visible `Lock this plan` action;
- M7 playbooks with local quick strip, stages, items, augments, Decision Map, positioning semantics and pivot graph;
- Team Planner remains unsupported/unverified and must fail safe;
- no protected-process access or runtime LLM is required.

Preserve all proven M1–M7 behavior unless this packet explicitly extends workflow/session persistence.

## Locked product decisions

### 1. One explicit active match-plan session
At most one active plan/session should exist at a time.

Locking a plan creates a versioned immutable-at-lock snapshot containing enough context to reproduce what the user chose without silently changing underneath them.

The active session is manual product state. Do not infer that a TFT match started/ended from protected process state.

### 2. Freeze evidence, do not silently re-rank the locked plan
Once locked:
- recommendation score/evidence shown for the session must remain the snapshot the user selected;
- later lobby scans, meta refreshes, discovery refreshes or recommendation recalculation must not silently mutate the active session;
- current data may be compared against the snapshot and surfaced as newer/stale information, but must not rewrite history.

### 3. Team Planner remains disabled unless independently verified
Never enable `Copy Team Code` because an encoder merely looks plausible.

Support requires all of:
- a directly inspectable public/current description or independently reproducible format evidence;
- deterministic encoder/decoder or validator behavior for the active set;
- known-good fixture(s) not produced only by the new encoder itself;
- correct handling of current set/unit IDs and board slots/positions required by the format;
- manual real TFT client paste verification by the human when tooling cannot perform it.

If any requirement is missing, keep Team Planner explicitly `Unverified`/disabled and document the exact missing acceptance evidence. Implementing a clean codec contract/test harness while leaving support disabled is acceptable.

Do not reverse engineer proprietary companion binaries, private IPC/auth, or protected Riot client/game process memory to obtain the format.

## A. Versioned active-session model
Create/refine a generic versioned active-plan session model.

At minimum retain:
- session schema/version;
- stable session ID;
- state: active / ended / abandoned (or equivalent explicit finite states);
- lock/start timestamp and explicit end timestamp when ended;
- selected registry/playbook/family ID and source/lifecycle type;
- complete legal selected target-board/playbook snapshot needed for display;
- strategy guidance version/fingerprint/status at lock time;
- active set/static compatibility fingerprint;
- recommendation portfolio version and the three candidate IDs when locked from `Your plans`;
- selected candidate rank/score/confidence and component provenance snapshot;
- measured-meta/discovery dataset identities when present;
- M4 lobby-pressure snapshot and coverage when present;
- account/Riot ID context only if already available through ordinary allowed app state;
- optional Team Planner support/code metadata only when verified;
- explicit compatibility/staleness state against current app data.

Do not persist API keys, raw secret headers or unnecessary opponent PII.

## B. Lock / replace / end semantics
Implement deterministic session transitions.

### Lock
- lock the exact currently viewed/recommended plan;
- validate it is current-set legal at lock time;
- preserve its current evidence/strategy snapshot;
- persist immediately;
- navigate/indicate the active plan clearly.

### Replace / switch
When another plan is locked while one is active:
- never silently overwrite;
- require an explicit user action to switch/replace;
- preserve the old session as ended/replaced or an auditable prior session according to the minimal storage design;
- carry no Decision Map/manual stage state into the new plan unless explicitly compatible and intentionally designed.

### End
- explicit user action ends the active session;
- ending must not delete the historical session record needed by M9;
- allow a simple `abandoned`/`ended without result` distinction only if it has clear product value; do not over-model.

Add deterministic state-transition tests.

## C. Active-plan persistence and restart behavior
The active plan must survive:
- route/navigation changes;
- recommendation recomputation;
- app restart;
- warm cache/load;
- loss of current network connectivity.

The app should be able to open the locked playbook from local persisted data without a network request.

If the current active set/static/guidance becomes incompatible after restart/refresh:
- keep the historical snapshot visible;
- mark it `stale`/historical clearly;
- do not silently substitute a new family/board/guidance;
- prevent unverified Team Planner copying from stale/incompatible state;
- offer an explicit route back to current recommendations/comps.

## D. Active-plan navigation / match-mode UX
Add a compact, obvious active-plan affordance without broad redesign.

Useful surfaces may include:
- sidebar/nav `Active plan` state or badge;
- top-level `Resume <comp>` action;
- locked-state treatment on `Your plans`;
- clear `Switch plan` / `End session` actions;
- compact match-mode/playbook view optimized for fast re-entry.

The active-plan view should prioritize M7's fastest-use information:
1. target board / positioning state;
2. quick `What am I looking for?` strip;
3. next level/roll objective;
4. items/holders;
5. Decision Map;
6. pivots/stages as secondary detail.

Do not duplicate the entire M7 page into a separate code path if responsive/composable reuse can solve it.

Avoid large explanatory paragraphs. The user should reopen the active plan and understand the next action within seconds.

## E. Manual in-session state
Allow only lightweight manual state that clearly improves match use and remains deterministic.

Reasonable examples:
- currently selected stage/tab;
- current Decision Map node/path;
- optional user-selected branch/pivot target.

Requirements:
- no protected live-state reading;
- no automated input;
- persisted only if useful across navigation/restart;
- reset safely when switching plans;
- never alter underlying sourced strategy truth.

Do not build a full live match tracker in M8.

## F. Portfolio switching/pivot workflow
Use the M7 pivot graph to make switching among the locked portfolio understandable.

When the active session originated from a three-plan recommendation portfolio:
- surface the other portfolio plans compactly;
- show the deterministic pivot reasons/cost already supported by M7;
- allow the user to inspect a destination before switching;
- switching creates a new explicit active-plan snapshot rather than mutating the original plan in place.

Do not invent new pivot strength beyond M7 evidence.

## G. Team Planner research and support contract
Before coding an encoder, inspect current public evidence for TFT Team Planner import/export codes.

Create a versioned contract such as:
- unsupported;
- candidate/unverified;
- verified for specific set/format version.

Document exact evidence used.

If a format can be responsibly implemented:
- encode only legal active-set units/slots supported by the verified format;
- preserve stable deterministic ordering/position semantics required by the format;
- add decode/round-trip validation where possible;
- reject unsupported runtime/special units/forms instead of guessing;
- reject stale/incompatible playbooks;
- produce no code when exact positioning/slot information required by the format is unavailable;
- distinguish target-board membership from verified placement if the format encodes coordinates.

A self-roundtrip is not sufficient proof of compatibility.

## H. Known-good Team Planner fixtures
If Team Planner support is attempted, add fixtures that are independent of the implementation.

At minimum record:
- source of fixture;
- active set/version;
- expected board/unit/slot semantics;
- decode/encode expectation;
- human client-paste result when available.

If no trustworthy fixture exists, leave the feature disabled and make this absence explicit in `docs/M8_IMPLEMENTATION_REPORT.md`.

## I. Clipboard behavior
Only when Team Planner support is verified:
- prominent `Copy Team Code` action;
- copy through a safe desktop/web clipboard path;
- immediate success/failure feedback;
- no hidden network dependency;
- keyboard/focus accessible;
- no code copied when support/compatibility check fails.

If unverified, the disabled UI should explain concisely what is missing without pretending the feature is broken.

## J. M9 handoff / future post-game reconciliation
Design the active-session record so M9 can associate it with a completed Riot match later without changing M8 history.

Retain enough non-secret data to support future reconciliation such as:
- start/lock/end time window;
- account context if known;
- selected plan/family/registry snapshot;
- portfolio/lobby/meta evidence IDs;
- session ID.

Do not implement post-game coaching, placement attribution or personal-model updates in M8.

## K. Compatibility/versioning
The active session must retain historical truth while separately evaluating current compatibility.

Version/fingerprint relevant inputs including:
- session schema;
- selected playbook/registry snapshot;
- active set/static fingerprint at lock;
- M7 strategy target/static compatibility;
- Team Planner codec version/support state if present.

Changing app/static data must not destroy old sessions. It may make them historical/stale.

## L. Storage
Use SQLite/repository abstractions consistently with existing architecture.

Requirements:
- durable active session + minimal prior session history needed for M9;
- deterministic migrations/versioning;
- no destructive reset of M5/M6 data;
- no API credential material;
- no unnecessary raw opponent-history duplication if referenced snapshot/summary is enough;
- one active session invariant enforced by storage/application layer, not only UI.

## M. Performance
Active-plan load/resume must be effectively immediate and local.

Add targeted benchmarks/tests for:
- active-session load;
- lock/persist;
- resume after simulated restart;
- session switch;
- Team Planner encode/decode if implemented.

No network request should be required to resume a valid locked plan.

## N. UI acceptance
Rendered inspection at 1440, 1000 and 860 px must cover:
- locking a plan;
- visible active-plan state;
- navigating away and resuming;
- simulated/reloaded persisted session;
- switching to another portfolio plan;
- ending a session;
- stale historical session after compatibility mismatch fixture;
- Team Planner verified flow if support is enabled, otherwise the correct disabled/unverified state;
- no horizontal overflow / browser-console errors.

Human visual judgment remains required.

## O. Required tests
Retain all M1–M7 tests and add deterministic coverage for at least:
- one-active-session invariant;
- lock snapshot immutability;
- recommendation/meta/lobby refresh not mutating the locked session;
- app-restart resume;
- explicit switch semantics;
- explicit end semantics;
- stale/current compatibility behavior;
- Decision Map/manual-stage state reset/persistence as implemented;
- portfolio pivot switch preserving old session history;
- no secret persistence;
- Team Planner support-state gating;
- Team Planner known-good fixtures/roundtrip if encoder exists;
- stale/unpositioned/unsupported board refusing code generation where required;
- clipboard success/failure gating if enabled;
- responsive active-plan UI.

## P. Verification
Run the full applicable repository suite:
- typecheck;
- lint;
- formatting check;
- full TypeScript/unit tests;
- production web build;
- Playwright;
- M3, M4, M5, M6, M7 benchmarks plus M8 targeted performance tests;
- `git diff --check`;
- Rust/native fmt/test/check/debug build if native source changes.

Use the documented D: Rust target/temp/cache paths if native compilation is required.

## Q. Documentation
Create `docs/M8_IMPLEMENTATION_REPORT.md` documenting:
- active-session schema/version;
- lock/switch/end semantics;
- persistence/restart behavior;
- snapshot immutability and compatibility rules;
- active-plan UX;
- manual in-session state;
- M7 pivot integration;
- Team Planner public evidence researched;
- Team Planner support state and exact codec/fixture evidence if implemented;
- manual TFT client paste verification status;
- clipboard behavior;
- M9 reconciliation handoff;
- storage/migrations;
- tests/build/benchmarks;
- rendered inspection;
- unsupported/remaining gaps;
- recommended next milestone.

Update durable authority docs only when M8 establishes a lasting project decision.

## Explicit non-goals
Do not implement:
- protected TFT process memory/read access;
- DLL/process injection;
- packet interception/TLS MITM;
- Vanguard bypass/evasion;
- automated gameplay/input;
- automatic live board/shop/bench/gold/stage detection;
- runtime LLM gameplay advice;
- opponent future-comp prediction;
- ForceIndex/FlexIndex expansion;
- undocumented/private competitor APIs or reverse engineering proprietary companion IPC/binaries;
- fake/unverified Team Planner codes;
- post-game coaching/personal-model learning;
- final broad UI redesign;
- uncontrolled background Riot crawling.

## Completion standard
M8 is complete when a user can explicitly lock one exact current plan, persist/resume it locally across navigation and restart, switch/end it without losing historical context, use a compact active-match playbook workflow backed by M7 truth, and the Team Planner path is either independently verified and safely copyable or remains explicitly disabled with precise evidence gaps. The resulting session record must be suitable for M9 post-game reconciliation without reading protected live state.

Work only on `codex/m8-selected-plan-match-workflow`. Do not merge or push unless the human explicitly asks.