# Codex Model Routing & One-Day Build Plan

This project follows the cross-project AI routing authority maintained in Google Drive. The goal is not to always use the strongest model; it is to spend scarce capability where it removes expensive iteration.

## Working model roles
### GPT-6 Astra
Use for:
- one large milestone-sized end-to-end implementation;
- architecture-sensitive integration across many files/systems;
- premium UI work that benefits from repeated build/run/visual inspection;
- hard performance/debugging after simpler models fail;
- a final senior-product-engineer pass only if the first Astra run proves strong ROI.

Avoid spending Astra on routine docs, basic CSS cleanup, repetitive tests, renames, fixture generation, or small deterministic edits.

### GPT-5.6 Sol
Use for:
- TFT rules/validator correctness;
- recommendation formulas/confidence;
- Team Planner codec design/verification;
- Riot API/cache/rate-limit review;
- opponent profile/contest math;
- comp discovery/optimizer design;
- architecture review;
- difficult localized bugs.

### GPT-5.6 Terra
Use for:
- normal React components;
- provider adapters;
- SQLite/storage work;
- tests/fixtures;
- routine refactors and bug fixes;
- documentation that requires code understanding.

### GPT-5.6 Luna
Use for:
- repetitive deterministic tests;
- fixture generation;
- mechanical transformations;
- formatting/renaming/cleanup;
- boilerplate.

Do not give Luna architecture ownership.

### Gemini
Use while quality/allowance remains strong for:
- high-volume coding;
- documentation;
- research/data-source review;
- tests;
- long-context repository review;
- independent audit of Astra output;
- second-opinion architecture review.

Prefer cross-model review for important milestones: Astra builds -> Gemini audits is a good default.

## Human role
The user is final acceptance gate for:
- visual quality;
- information density;
- whether the three recommendations are actually useful;
- whether playbooks match real TFT decision-making;
- whether Team Planner flow is comfortable;
- whether algorithmically valid recommendations make strategic sense.

## Skills strategy
- Let Codex auto-select useful installed skills for ordinary work.
- Explicitly name a skill when essential or when benchmarking it.
- Task scope, AGENTS.md, authority docs, and acceptance tests override generic skill guidance.
- Prefer small composable skills.
- Do not create one giant project-specific skill that duplicates repository authority.

## Day-one target
Goal: a polished, runnable private V1 in one focused build day, not the complete long-term meta research platform.

Day-one should ideally include:
- Tauri/React/TypeScript/Vite app foundation;
- current static TFT data loading;
- domain entities;
- versioned rules + board/playbook validation;
- several real structured playbooks;
- recommendation scoring/confidence;
- three-plan portfolio selection;
- premium home + playbook UI;
- Team Planner codec interface and known-good support if verified;
- local settings/cache;
- critical tests;
- Riot/opponent provider contracts;
- preferably a first working opponent scan if API setup/time permits.

## Astra Run 1
Use one substantial Astra High task after authority files are present.

Ask it to:
1. inspect all repository authority first;
2. scaffold the full desktop architecture;
3. implement domain/static-data layer;
4. implement versioned rule/playbook validation;
5. implement recommendation candidate/confidence/portfolio contracts and a functional first pass;
6. implement Team Planner module with explicit unsupported/unverified state where necessary;
7. build a premium home/playbook UI;
8. persist local settings/cache structure;
9. add tests;
10. build/run the app;
11. inspect the actual UI where tooling permits;
12. fix first-pass integration failures;
13. leave a concise implementation report.

It must not invent current TFT strategy facts missing from data/fixtures.

## After Astra Run 1
Recommended sequence:
1. human runs/inspects the app;
2. Gemini independently audits requirement coverage, architecture, data assumptions, missing tests and obvious UX gaps;
3. Sol fixes high-risk correctness/architecture findings;
4. Terra/Gemini fills bounded missing features/providers/components;
5. Luna handles repetitive cleanup/fixtures;
6. manually verify Team Planner paste if encoder exists;
7. benchmark opponent scan latency;
8. log model benchmark results.

## Optional Astra Run 2
Only use after V1 exists and a specific high-value coherence/integration problem remains.

Good target: senior product-engineer pass that runs the app, reviews the full workflow, identifies the highest-value blockers to production-quality coherence, and fixes those without broad unrelated rewrites.

## First-day execution order
- Phase 0: authority/repo/task packet + acceptance checks.
- Phase 1: Astra High large implementation.
- Phase 2: build/run/manual inspection.
- Phase 3: Gemini audit.
- Phase 4: Sol/Terra fixes.
- Phase 5: Team Planner manual paste test + TFT data correctness pass.
- Phase 6: finish/benchmark opponent scouting if not already working.
- Phase 7: final UI/usability pass, packaging, benchmark log.

## Benchmark fields
For meaningful model work record:
- task/milestone;
- model + effort;
- tools/skills used;
- first-pass build/run success;
- tests preserved;
- regressions;
- architecture violations;
- correction prompts;
- independent reviewer findings;
- human acceptance;
- approximate usage;
- elapsed time;
- Keep / Escalate / Downgrade / Retest.

A model earns a routing role through repeated accepted outcomes, not one impressive demo.
