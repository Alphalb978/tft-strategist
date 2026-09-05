# AGENTS.md — TFT Strategist Authority

## Mission
Build a polished desktop TFT strategist that improves pre-game and lobby decisions without reading or manipulating the protected TFT game process.

The product should give the user three complementary plans, explain why they fit the patch/lobby, provide compact static playbooks for adaptation during the game, support TFT Team Planner codes, and learn modestly from completed games.

## Authority order
When instructions conflict, use this order:

1. Explicit current task packet in `tasks/`.
2. This file.
3. `docs/DECISIONS.md`.
4. `docs/TFT_KNOWLEDGE.md`.
5. `docs/RECOMMENDATION_ENGINE.md`.
6. `docs/UX.md`.
7. `docs/ARCHITECTURE.md`.
8. `docs/PRODUCT.md`.
9. `docs/MODEL_ROUTING.md`.
10. Existing code/tests and implementation notes, unless an authority above intentionally supersedes them.

Do not silently reinterpret product scope because another architecture or library seems fashionable.

## Non-negotiable product rules
- TFT truth must come from current-set data, versioned rules, verified fixtures, and measured match evidence. LLM memory is never authoritative gameplay truth.
- The three recommendations are optimized together as a portfolio, not merely the top three independent scores.
- Personal history is intentionally weak. Default influence is approximately 5%; normal configured range is roughly 5–10%.
- Opponent scouting is a major input and should analyze approximately the last 10–20 relevant recent games per opponent, using parallelism, caching, recency weighting, patch awareness, shared-match deduplication, and partial-confidence behavior.
- Recommendation confidence must be visible and must reflect evidence quality, not cosmetic precision.
- Comp discovery may produce variants/new boards, but novel boards begin Experimental and must never be treated as proven merely because an optimizer or model likes them.
- UI quality is a first-class requirement. Avoid generic admin dashboards and information walls.
- Team Planner copy/paste is part of the core workflow. Never mark an encoder supported until a known-good fixture and manual client paste verification exist.
- V1 must remain useful without a runtime LLM API.

## Protected-process boundary
Do not implement or instruct:
- process-memory reading;
- DLL/process injection;
- packet interception/manipulation or TLS MITM;
- kernel/driver tricks;
- process hiding/evasion;
- Vanguard bypass;
- automated mouse/keyboard gameplay;
- extraction of private Blitz/MetaTFT IPC/auth or decompilation of proprietary binaries for hidden state.

Allowed data paths include Riot APIs, CommunityDragon/static data, normal HTTPS, local app storage, user/manual input, completed match history, and other ordinary desktop/API mechanisms that do not access the protected game process.

## Engineering principles
- Provider → domain → rules/validation → strategy → UI separation.
- Prefer deterministic/statistical scoring with inspectable components over opaque model-generated scores.
- Version set/patch-sensitive rules and fixtures.
- Do not log secrets/API keys.
- Cache network-derived data aggressively but preserve freshness/provenance.
- Make partial or stale evidence explicit instead of pretending it is current.
- Keep current-set identifiers stable internally; display names/art come from the active data provider.
- Fail safe on unsupported Team Planner formats or unknown rules.

## TFT fact discipline
If an exact TFT rule, champion property, trait breakpoint, shop/pool value, set mechanic, item interaction, augment fact, Team Planner format detail, or strategy claim is not present in authoritative data/fixtures/evidence:

1. Do not guess.
2. Implement the interface/contract if useful.
3. Mark the fact as unverified/TODO with provenance.
4. Continue the rest of the task when possible.
5. Report the gap in the implementation summary.

## Quality gates
Every significant task should leave:
- buildable/runnable code;
- relevant tests;
- no regressions in existing tests;
- concise changed-files summary;
- commands actually run;
- manual checks actually performed;
- unresolved risks/gaps;
- no invented TFT facts.

For visually judged work, the agent must run the app where tools permit and inspect the real rendered result rather than stopping at source edits.

## Skills
Use relevant installed skills where they materially help. Explicit task scope, this authority, repository rules, and acceptance tests override generic skill guidance. Do not let a skill expand scope silently.
