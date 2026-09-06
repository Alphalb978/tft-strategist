# M9 — Completed-Match Reconciliation, Post-Game Review & Weak Personal Learning

## Goal
Turn M8's immutable match-plan sessions into evidence-bounded completed-game reviews and a deliberately weak personal-history signal that can slightly improve future recommendations without overfitting the user or rewriting historical plan evidence.

M9 should answer:

> Which completed Riot match belongs to the plan session I just played, how closely did the final board correspond to the route I selected, what objective evidence can we review without inventing causality, and what small personal signal—if any—should influence future recommendations?

This milestone is **completed-match reconciliation, descriptive post-game review, and modest personal learning**. It is not live coaching, not causal loss diagnosis, not protected-process telemetry, and not a broad final UI redesign.

Read `AGENTS.md` and every governing authority it references before changing code. Treat this task packet as the highest authority for M9.

## Baseline
M1–M8 already provide:
- audited current-set/static truth and deterministic legality;
- Riot account/history and completed-match normalization with immutable match caching;
- M4 lobby unit pressure;
- M5 measured aggregate family outcomes with uncertainty;
- M6 discovered-family lifecycle and generic registry;
- M7 source-backed static playbook intelligence;
- M8 exactly one durable active plan session, immutable-at-lock playbook/portfolio/evidence snapshot, explicit switch chains, manual stage/Decision Map/pivot state, session history, optional Riot account context, and nullable `reconciliation.matchId`;
- Team Planner remains unverified/disabled;
- recommendation scoring already reserves a small personal component and product authority caps normal personal influence at roughly 5–10%, with ~5% default.

Preserve all proven M1–M8 behavior unless this packet explicitly extends reconciliation, review, or the personal model.

## Locked product decisions

### 1. M8 history is immutable evidence
Never rewrite the M8 lock snapshot, selected family, portfolio, recommendation score, M4/M5/M6 evidence, or manual in-session path after the match.

M9 may attach reconciliation/review/personal-learning records outside the immutable snapshot.

### 2. Completed matches are the only gameplay outcome source
Post-game facts come from documented Riot completed-match payloads already normalized by the project, plus explicit M8 user/session state.

Do not infer or claim unseen:
- shop decisions;
- bench state;
- exact gold/economy;
- positioning during rounds;
- roll timing not explicitly recorded;
- HP trajectory;
- causal combat mistakes;
- why a unit/item was or was not found.

### 3. Descriptive evidence is not causality
The review may say, for example:
- the final board differed from the selected target;
- two selected core units were absent from the final board;
- the final board classified as another known family;
- the user switched from Plan A to Plan B during the M8 session chain;
- the placement was below/above the aggregate family baseline when compatible measured evidence exists.

It must not say:
- "you lost because you rolled too late";
- "this item caused the loss";
- "you should have positioned differently";
unless the required evidence truly exists.

### 4. Personalization remains weak by design
Default recommendation influence remains approximately 5%; normal configured range remains approximately 5–10%.

Small samples shrink aggressively toward neutral. Personal history must never dominate current meta strength, lobby pressure, legality, or evidence confidence.

## A. Versioned reconciliation model
Create a deterministic, versioned reconciliation layer that associates M8 session history with completed Riot matches.

Requirements:
- one completed match may reconcile with one logical M8 match-session chain;
- one logical session chain may reconcile with at most one completed match;
- preserve all linked predecessor/successor sessions from M8 switches;
- use the final active/successor session as the terminal selected route while keeping the full switch sequence visible;
- store match ID only in outer reconciliation state; never mutate session snapshots;
- expose reconciliation state such as `unmatched | candidate | matched | ambiguous | rejected`;
- expose deterministic reasons/confidence/evidence for a match candidate;
- make manual confirmation possible when more than one plausible match remains;
- allow unlink/reject only through an explicit auditable action; never silently relink history.

## B. Match candidate selection
Use only documented/normalized evidence.

Candidate matching should consider, where valid:
- configured Riot account identity / resolved PUUID;
- platform/routing context;
- completed-match participation by that account;
- match timing relative to the M8 lock/end window using the actual documented semantics available in normalized Riot payloads;
- replacement-chain timing;
- queue/mode/set compatibility;
- existing match-cache identity.

Important:
- inspect the existing normalized timestamp fields and Riot semantics before choosing overlap tolerances;
- do not guess that a field is game start vs game end;
- do not auto-link based mainly on final family similarity, placement, or the selected comp;
- if timing semantics are insufficient for a unique match, surface ambiguity/manual confirmation rather than forcing a link.

Add deterministic candidate-ranking logic and explicit thresholds/configuration.

## C. Explicit post-game import/check flow
Add a bounded user-driven workflow such as `Check completed match` / `Review latest game`.

Requirements:
- no uncontrolled background polling;
- use existing Riot native credential/rate-limit/cache path;
- prefer immutable cached match payloads;
- fetch only a bounded recent match-index horizon needed to reconcile recent unreconciled sessions;
- shared/cached completed-match behavior must remain efficient;
- if no API key/account context is available, show a clear local/unavailable state without damaging session history.

A matched active M8 session may be ended as completed through an explicit M9 reconciliation transition, but the M8 snapshot must remain unchanged.

If M8 end-reason/schema extension is required, make it versioned/backward-compatible and preserve old `ended-without-result` / `replaced` history.

## D. Review evidence model
Create a versioned post-game review record separate from raw match data and M8 snapshots.

Retain enough provenance to reproduce the review:
- session chain IDs;
- terminal session ID;
- match ID;
- review/model versions;
- match/static/set fingerprints;
- final participant placement and any other directly normalized participant fields used;
- final board canonical/classifier evidence;
- selected target/family fingerprint from M8;
- compatible M5/M6 aggregate-baseline identity when used;
- creation/review time;
- evidence gaps/warnings.

Derived review data must invalidate/recompute when the review/classifier/static model changes, while the immutable Riot match payload and M8 snapshot remain intact.

## E. Selected route vs final board
Use existing M5 classifier / M6 canonical/similarity primitives where appropriate instead of inventing a second board-comparison system.

For the terminal M8 selected plan, derive inspectable evidence such as:
- final canonical board if valid;
- selected-target vs final-board similarity;
- final known-family classification / ambiguous / unclassified state;
- selected core units present/missing;
- final units added relative to target;
- target capacity vs final canonical size where meaningful;
- whether the final family matched the selected family, a linked pivot destination, another known family, or remained unknown.

Requirements:
- fail closed on unsupported/special runtime forms as existing M6 semantics require;
- never call a structurally legal board "correct" or "incorrect" solely from similarity;
- do not score a user's execution quality from target-board overlap alone;
- preserve switch-chain context: if Plan A was explicitly replaced by Plan B, do not penalize the user for not ending on Plan A.

## F. Items / augments / level / other direct outcome evidence
When normalized Riot payloads actually expose validated participant evidence, compare only supported fields.

Possible descriptive review evidence:
- final level;
- final unit star tiers;
- final equipped item IDs;
- selected final carry/tank item overlap with M7 sourced guidance;
- augment IDs/categories only when normalized and current static data validates them;
- final comp-family classification;
- placement.

Rules:
- no "BIS score" unless project authority/data explicitly defines one;
- no penalty for a missing recommended item if acquisition opportunity is unknown;
- no claim that an augment/item choice caused placement;
- unsupported fields remain unavailable.

## G. Aggregate-baseline comparison
When a compatible M5 measured family statistic exists, compare user outcome descriptively against the correct family/sample baseline.

Prefer residual/context-aware evidence over raw placement alone, e.g.:
- selected/final family aggregate mean placement;
- user's observed placement difference from that baseline;
- top-4 result vs measured top-4 expectation;
- baseline confidence/sample quality.

Do not use an incompatible/stale/insufficient M5 dataset as if it were current truth.

If no compatible measured baseline exists, say baseline unavailable and keep the review descriptive.

## H. Evidence-bounded review output
Generate a short deterministic review from structured evidence.

Recommended shape:
1. placement + terminal selected plan;
2. final family/board relation;
3. what clearly matched the selected route;
4. what clearly differed;
5. aggregate-baseline context when available;
6. at most one actionable adjustment when the evidence genuinely supports one;
7. evidence gaps.

Actionable feedback must be rule/evidence bounded. Examples that may be valid:
- `Your final board omitted two source-defined locked core units while remaining structurally close to the selected family.`
- `You switched to Solar & Elderwood, and the final board matched that destination more closely than the original Adaptors route.`

Do not fabricate causality to ensure every review contains advice. `No evidence-backed adjustment identified` is acceptable.

No runtime LLM is required; deterministic templates/structured text are preferred for V1.

## I. Weak personal model
Implement a versioned personal-history model designed for **small nudges only**.

The model should learn only from reconciled completed matches with sufficient evidence.

Potential signals, when valid:
- family-specific outcome residual relative to compatible aggregate baseline;
- final-family match confidence;
- repeated successful/unsuccessful plan families;
- reroll/Fast8/Fast9 style outcomes only when style metadata and final attribution are reliable;
- route adherence / pivot usage as descriptive context, not a direct skill score;
- set/recency relevance.

Requirements:
- centralized/versioned formula;
- aggressive small-sample shrinkage toward neutral;
- recency decay and set isolation;
- no cross-set transfer unless an explicit later model defines it;
- robust to one lucky first place or one eighth;
- confidence separate from adjustment;
- explicit minimum evidence before non-neutral influence;
- bounded output so normal recommendation contribution remains in the authority-defined 5–10% range and default stays ~5%;
- never promote familiarity over clearly stronger current evidence by a large margin.

Prefer outcome residual versus aggregate family expectation when compatible evidence exists so the personal model does not simply reward playing whichever comp is strongest in the meta.

When aggregate baseline is unavailable, either use a more heavily-shrunk neutral fallback or withhold family skill inference; document the choice.

## J. Attribution safety
Personal learning must not assign a placement to the wrong plan.

Rules:
- if a terminal session's final board confidently matches its selected family/variant, family outcome attribution may be eligible;
- if the final board confidently matches an explicit M8 switched destination, attribute only to the terminal/destination route;
- if classification is ambiguous/unclassified or strongly mismatched, do not treat the placement as clean evidence of skill with the originally selected family;
- `ended-without-result` unreconciled sessions do not enter the personal model;
- duplicate/relinked matches cannot be counted twice;
- stale/out-of-set historical matches remain auditable but do not influence the active-set personal adjustment.

## K. Recommendation integration
Activate the existing personal component using the new personal model without changing M4/M5/M6 semantics.

Requirements:
- personal adjustment is a separate visible component;
- default contribution remains approximately 5% of total scoring authority;
- configurable normal range remains 5–10% if existing settings permit configuration;
- missing/insufficient personal evidence is neutral and explicit;
- score explanation shows sample/confidence and whether adjustment is positive, negative or neutral;
- M4 lobby pressure, M5 measured meta, M6 discovery and M7 guidance remain independent inputs;
- portfolio optimization still selects complementary plans.

Add deterministic tests proving:
- sufficient personal evidence can slightly reorder otherwise close candidates;
- it cannot overwhelm a materially stronger measured-meta/lobby signal;
- one lucky/poor game barely changes the score;
- small samples shrink toward neutral;
- wrong-family/ambiguous games do not contaminate family adjustment.

## L. Strengths / weaknesses summary
Provide a conservative personal summary only when evidence is mature enough.

Possible supported outputs:
- `Above baseline with <family> in N reconciled current-set games`;
- `Limited evidence on Fast 9 routes`;
- `Your current-set sample is too small for a reliable style signal`.

Do not label psychological tendencies or invent root causes.

The summary should expose sample size, confidence and active set.

## M. Minimal post-game/history UI
Add only the UI needed for M9:
- a recent session/game history surface;
- unreconciled session status;
- explicit `Check completed match` action;
- candidate/manual-confirm state when ambiguous;
- matched placement/final-family summary;
- concise review detail;
- personal-model summary/sample/confidence;
- clear stale/current-set treatment.

Do not perform the final product-wide redesign. Reuse existing cards/board components where possible.

## N. Storage/versioning
Persist reconciliation, reviews and personal-model derived state without mutating M8 snapshots.

Requirements:
- versioned schemas;
- one-to-one match/session-chain reconciliation constraints;
- derived review/model fingerprints;
- safe recomputation from immutable M8 snapshots + cached Riot matches;
- no destructive reset of M1–M8 data;
- no API keys/raw auth material;
- historical old-set reviews may remain visible but cannot contaminate the active personal model.

Use SQLite transactional enforcement for the Tauri path where needed; browser/in-memory repositories must implement the same logical contract for tests/development.

## O. Live validation
When a valid temporary `RIOT_API_KEY` is available, perform a **bounded** real validation through existing documented Riot paths.

Preferred validation:
- resolve the configured user account through existing M3 paths;
- fetch a very small recent completed-match index;
- reuse cached immutable payloads where possible;
- parse at least one real participant/final board;
- demonstrate reconciliation candidate generation against a compatible M8 session if a real session exists.

If no genuine M8 session corresponds to a current real match:
- do not contaminate persistent history with a fake completed session;
- validate real latest-match acquisition/parsing separately;
- use an in-memory/fixture M8 session anchored to the real normalized match timing only to exercise reconciliation mechanics;
- label this clearly as fixture-assisted live evidence, not a real user-session reconciliation.

Also verify a warm rerun with fewer/zero immutable detail fetches where expected and audit credential non-persistence.

Do not expand the crawl just to manufacture a match.

## P. Performance
Post-game review should be fast and mostly local after match acquisition.

Add M9 benchmarks/perf tests for:
- recent-session reconciliation candidate ranking;
- review derivation;
- personal-model rebuild from 20, 100 and ~500 reconciled fixture games if practical;
- recommendation scoring with personal adjustment;
- warm history/review load.

Reuse existing immutable caches and avoid network calls on the review render path.

## Q. Required tests
Retain all M1–M8 tests and add deterministic coverage for at least:
- session-chain reconstruction;
- match candidate timing/account/mode logic;
- unique match↔session-chain constraints;
- ambiguous candidate/manual confirmation;
- immutable M8 snapshot preservation;
- active session completed reconciliation semantics;
- selected vs final board relation;
- switched-plan attribution safety;
- ambiguous/unclassified final board handling;
- item/augment unavailable semantics;
- aggregate-baseline compatibility;
- deterministic review text/evidence;
- no unsupported causality language;
- personal small-sample shrinkage;
- recency/set isolation;
- one lucky/poor game robustness;
- family attribution gating;
- bounded personal recommendation influence;
- M4/M5/M6 independence;
- history/review UI states;
- persistence/invalidation;
- credential redaction/no secret persistence.

## R. Verification
Run the full applicable repository suite:
- typecheck;
- lint;
- formatting check;
- full TypeScript/unit tests;
- production web build;
- Playwright;
- M3, M4, M5, M6, M7, M8 benchmarks plus new M9 benchmarks;
- `git diff --check`;
- Rust/native fmt/test/check/debug build only if native code changes.

Use the documented D: Rust target/temp/cache paths if native compilation is required.

Render/inspect at 1440, 1000 and 860 px. Exercise at least:
- unreconciled ended session;
- successful matched review;
- ambiguous/manual-confirm flow;
- switched-plan chain review;
- insufficient personal evidence;
- mature fixture personal evidence;
- stale/old-set history;
- no horizontal overflow or console errors.

## S. Documentation
Create `docs/M9_IMPLEMENTATION_REPORT.md` documenting:
- reconciliation schema/version;
- match-candidate formula/thresholds and actual Riot timestamp semantics used;
- session-chain attribution;
- review evidence model;
- selected-vs-final board comparison;
- aggregate-baseline compatibility;
- deterministic review rules;
- personal-model formula/shrinkage/decay/confidence;
- recommendation integration/maximum influence;
- storage/invalidation;
- live vs fixture-assisted evidence clearly separated;
- benchmark/test/build results;
- rendered inspection;
- unsupported review/causality gaps;
- recommended M10 final-hardening scope.

Update durable authority docs only when M9 establishes a lasting project decision.

## Explicit non-goals
Do not implement:
- live match/process telemetry;
- protected process memory, injection, packet interception or Vanguard bypass;
- automated gameplay/input;
- runtime LLM coaching;
- causal loss diagnosis from incomplete completed-match data;
- psychological/player-type labeling;
- opponent future-comp prediction;
- ForceIndex/FlexIndex expansion;
- broad new strategy research;
- Team Planner encoding unless separately verified and explicitly authorized;
- large background match polling;
- final broad UI redesign;
- cross-set personal-skill transfer without explicit future evidence/modeling.

## Completion standard
M9 is complete when TFT Strategist can conservatively reconcile M8 session chains to completed Riot matches, produce a concise evidence-bounded post-game review without inventing causality, maintain an auditable current-set personal model with strong small-sample shrinkage, apply only a weak transparent personal adjustment to future recommendations, preserve all M8 immutable history, and expose the workflow through a minimal usable history/review UI with full deterministic tests, benchmarks, rendered inspection and bounded live validation when a key is available.

Work only on `codex/m9-postgame-personal-learning`. Do not merge or push unless the human explicitly asks.