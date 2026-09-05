# M2 — TFT Truth & Evidence Audit

## Goal
Turn the M1 foundation from an honest seeded prototype into a rules/data foundation that can be trusted by later recommendation, scouting, comp-discovery and Team Planner work.

This milestone is about **truth, provenance, validation and current-set correctness**. It is **not** a UI redesign, not a live Riot scouting implementation, not a meta-ranking/calibration milestone, and not a Team Planner enablement milestone.

Read `AGENTS.md` and all governing authority it references before changing code. Treat this task packet as the highest project authority for this milestone.

## Current baseline
M1 already provides:
- Tauri 2 / React / TypeScript / Vite app;
- CommunityDragon normalization/cache pipeline;
- four source-attributed Set 18 playbooks;
- versioned rule/validator boundary;
- deterministic portfolio/scoring architecture;
- visible confidence/evidence states;
- SQLite persistence;
- Team Planner fail-safe disabled state;
- Riot scouting contracts/fixtures only;
- 39 unit/integration tests and 6 browser tests at M1 completion.

M1 intentionally left these incomplete or unverified:
- hotfix parity;
- ordinary level/capacity rules;
- trait counting edge cases and set-specific modifiers;
- Avatar/special-unit semantics;
- uniqueness/duplicate constraints where relevant;
- shop odds;
- champion-pool sizes;
- XP/economy/roll/star-upgrade rules;
- enabled/live augment status;
- some playbook timing/stabilization claims;
- measured meta/outcome evidence.

Do not erase those boundaries merely to make the app look complete.

## Patch/set target
Audit the **currently live Enchanted Wilds / Set 18 environment**. At task start, verify the current live patch from Riot rather than trusting the repository label. If Riot still lists 18.1 as current, audit 18.1. If a newer patch has become live, update the audit target deliberately and document the transition.

Patch/hotfix state is part of the evidence model. Do not claim parity between a CommunityDragon export and Riot hotfixes unless the evidence supports it.

## Source hierarchy
Use the strongest available source for each fact.

1. **Riot official** — patch notes, official set/system documentation, TFT API documentation, official game-update articles.
2. **CommunityDragon/raw game data** — current static exports, set definitions, tables/config where the exact fact is represented.
3. **Established public technical/data references** — only when Tier 1/2 cannot establish the fact. Label these explicitly as secondary evidence.
4. **Public strategy guides** — for playbook-specific strategic guidance only, never as the first authority for exact systemic TFT rules when stronger evidence exists.

LLM memory is not evidence.

For every accepted exact rule/value, retain enough provenance to answer: **what is the claim, what patch/set does it apply to, where did it come from, when was it reviewed, and how strong is the evidence?**

## Required audit domains
Audit only facts that are relevant to this product, but cover the following categories thoroughly enough that downstream strategy code can rely on them or explicitly know they remain unavailable.

### 1. Active set and entity truth
- active Set 18 identifiers/mutator(s);
- current-set units/forms and costs;
- current traits and their exported thresholds;
- current items/components/recipes represented in trusted data;
- augments present in data, while preserving the distinction between `present in export` and `confirmed enabled/live`;
- stable IDs required to join completed-match data later;
- current asset/entity provenance.

Do not silently mix Set 17/legacy records into Set 18 validation.

### 2. Board/capacity legality
Verify and version the rules required to determine legal ordinary boards, including where evidence permits:
- player level and ordinary unit capacity;
- level cap / special exceptions only if verified;
- duplicate/unique-unit legality where relevant;
- special units/forms that alter normal assumptions;
- any Set 18-specific capacity/counting modifiers actually needed by validators.

If special exceptions cannot be established, keep them explicit and fail safe rather than generalizing from memory.

### 3. Trait counting and breakpoint reachability
Implement/verify the rules required to calculate a board's trait state correctly:
- which field(s) define trait membership;
- threshold/breakpoint interpretation;
- whether duplicate copies count, where applicable;
- special trait/unit counting rules;
- Avatar/special-form behavior if it affects trait counting;
- missing/null threshold handling;
- emblem/special-object effects only where verified and needed.

Add fixtures that prove both ordinary and edge cases.

### 4. Shop / pool / roll feasibility
Where reliable current evidence exists, version:
- shop odds by level;
- champion pool copies by cost;
- shop slot count and reroll cost if recommendation logic uses them;
- star-upgrade/copy arithmetic needed by roll-burden calculations.

Do not make recommendation calculations depend on guessed pool/shop values. If a fact remains unverified, keep the dependent strategy component seeded/unavailable rather than hiding an assumption.

### 5. XP / economy / leveling
Where reliably established and relevant, version:
- XP requirements by level;
- XP purchase value/cost;
- interest rules/cap;
- ordinary leveling/economy rules that later Fast 8 / Fast 9 / reroll feasibility will require.

Do not expand into a complete TFT simulator. Represent only rules needed by the product.

### 6. Set-specific mechanics
Audit Set 18 mechanics only to the extent that they affect strategic legality or recommendations, including Wisps or other special mechanics if downstream logic needs them.

Separate mechanic **existence/behavior** from strategic preference. The former is rule truth; the latter is strategy evidence.

### 7. Hotfix parity
Establish an explicit parity state for the bundled/current static source versus Riot's live patch/hotfix state.

The result must be one of:
- verified current/parity supported by evidence;
- known stale with documented differences;
- partially verified;
- unverified.

If exact hotfix changes can be applied safely from authoritative evidence and stable IDs, implement a versioned overlay rather than mutating raw source data. Otherwise keep parity unverified and explain the gap.

## Evidence ledger
Create `docs/M2_RULE_EVIDENCE_LEDGER.md` (or an equivalently clear path) containing a compact auditable table or structured sections for every rule family used by the app.

Each entry should include, where applicable:
- stable rule/fact ID;
- claim/value;
- set/patch scope;
- source URL/file;
- source class (Riot / CommunityDragon / secondary / guide);
- reviewed/fetched timestamp or source version;
- status (`verified`, `partial`, `unverified`, `not-applicable`);
- notes/limitations.

Do not pad the ledger with prose. It should be useful to future agents and humans updating a patch.

## Versioned rule data
Evolve the existing `data/rules/` and `src/rules/` boundary rather than bypassing it.

Requirements:
- patch/set-sensitive values live in versioned data/fixtures, not scattered constants;
- source/provenance metadata accompanies rule data where practical;
- unknown values remain representable as unknown;
- derived validation logic is deterministic and testable;
- source refresh does not silently overwrite human-reviewed rule fixtures;
- patch changes can invalidate/review dependent derived data explicitly.

Prefer simple inspectable JSON/TypeScript schemas over a complex generalized rule DSL.

## M1 playbook audit
Re-audit the four M1 source playbooks against the verified current-set entities/rules and their original public sources.

For each playbook:
- verify every listed unit exists in the audited set;
- verify declared target unit count/capacity is structurally legal;
- recompute displayed traits from audited rules rather than trusting curated labels;
- verify item references exist and recipes/components where relevant;
- identify contradictory/stale route, timing or stabilization claims;
- remove or mark unsupported exact claims instead of reconciling them from intuition;
- preserve the `Experimental` evidence label unless measured outcomes justify promotion in a later milestone.

Create a concise `docs/M2_PLAYBOOK_AUDIT.md` if the findings are substantial; otherwise include the results in the main M2 report/ledger.

Do **not** turn this into a broad comp/meta research task. Four source playbooks are enough for this milestone.

## Strategy-engine boundary
M2 must make the distinction between **verified TFT truth** and **seeded strategy inputs** sharper, not blurrier.

- Keep measured meta strength/top-4/win/contest inputs seeded unless real measured outcome data is deliberately added with provenance.
- Do not label seeded score components as verified merely because the underlying board is legal.
- If a score component requires an exact rule that remains unavailable, expose that dependency and fail safe.
- Confidence should improve only where evidence quality actually improved.

No statistical calibration is required in M2.

## UI scope
Keep UI work minimal and evidence-driven.

Allowed:
- update `Data & settings` / verification ledger presentation so newly verified, partial and unverified rule families are accurately visible;
- correct displayed trait/capacity information that changes because the rule engine is now authoritative;
- fix regressions caused by audited data.

Out of scope:
- visual redesign;
- removing general AI-like microcopy;
- renaming `Playbook library` to `Comps`;
- new Comp Library filters/search;
- board-positioning redesign;
- new scouting UI.

Those are intentionally deferred so this milestone stays about truth.

## Tests and acceptance
Add focused tests for every accepted rule family. At minimum, acceptance should include:

- active-set filtering rejects legacy/wrong-set entities;
- ordinary board-capacity validator uses audited versioned rules;
- trait counting and breakpoint fixtures cover normal + at least one audited edge case;
- missing/null trait thresholds fail safely;
- invalid item/unit references are rejected;
- hotfix/parity state is explicit and tested;
- any verified shop/pool/XP/economy/star values have source-backed fixtures and deterministic tests;
- playbook audit catches a structurally impossible/stale fixture rather than silently accepting it;
- source/provenance metadata survives normalization/versioning where applicable;
- no Team Planner codec is enabled;
- no authenticated Riot provider is added;
- no protected-process access is added.

Run the existing quality gates and report the exact results:

```powershell
npm run data:refresh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:ui
npm run format:check
```

If native code/schema changes, also run the native debug build using the documented D: target/temp paths from `README.md`. If native code is untouched, do not waste time rebuilding Rust merely for ceremony.

Inspect any changed evidence/settings UI in the rendered app where tools permit.

## Required implementation report
Create `docs/M2_IMPLEMENTATION_REPORT.md` with:
- exact patch/set audited;
- source hierarchy actually used and important source URLs;
- rule families moved to verified/partial/unverified;
- hotfix parity conclusion;
- playbook audit findings;
- changed modules/files;
- tests/checks actually run and results;
- facts that deliberately remain unknown;
- any assumptions removed from M1;
- risks that block M3/M4;
- recommended next task.

Do not describe a check as passed unless it was actually run.

## Definition of done
M2 is complete when:

1. The app has a versioned, provenance-aware rule foundation for the audited current Set 18 patch.
2. Validators use verified rules where evidence exists and explicit unknown states where it does not.
3. Trait/capacity/entity legality for the M1 boards is based on audited rules rather than assumptions.
4. Hotfix/static-source parity is explicitly resolved to a documented status.
5. The four M1 playbooks have been revalidated against current data/rules without invented repairs.
6. Exact game-system values used by future recommendation feasibility have source-backed fixtures or remain unavailable.
7. Seeded strategy metrics remain clearly distinct from verified game truth.
8. Existing app behavior/tests remain healthy.
9. The required M2 report/ledger exists and is concise enough to maintain on the next patch.

## Out of scope / do not do
- Do not implement live Riot account/history/lobby connectivity yet.
- Do not ask for or embed a Riot API key.
- Do not implement protected-process access of any kind.
- Do not enable Team Planner codes.
- Do not perform large recommendation-weight calibration.
- Do not scrape/ingest a full live meta database.
- Do not redesign the application or add the planned `Comps` browser expansion.
- Do not merge to `main`.

Work only on the current M2 branch. Finish with the implementation report required above.