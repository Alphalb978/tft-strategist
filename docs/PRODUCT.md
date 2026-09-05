# Product Vision & V1 Scope

## Product definition
TFT Strategist is a private-first desktop companion focused on pre-game/lobby intelligence rather than protected live-game telemetry.

Its core job is to answer:

> Which three strategies give me the best coverage of the game I am about to play, and how should I adapt among them using a compact static playbook?

## Primary user flow
1. Load active TFT set/patch data.
2. Load current meta/playbook candidates.
3. Load the user's modest personal history signal.
4. When lobby participants are available, scan opponent tendencies quickly.
5. Score candidate comps/variants.
6. Optimize a portfolio of three complementary plans.
7. Show score, confidence, reasons, contest pressure, floor/ceiling, and portraits.
8. User selects a plan.
9. Copy verified Team Planner code and paste it into TFT Team Planner.
10. Keep a static playbook open during the game: stage boards, items, augments, substitutions, pivots, Decision Map.
11. After the match, import completed-match data and produce a short evidence-based review.

## V1 features
- Premium Tauri desktop app.
- Current-set champions, traits, items, augments and assets through a static provider.
- Versioned TFT rule/domain layer.
- Board/playbook validation.
- Several current-set structured playbooks with provenance.
- Three-plan recommendation portfolio.
- Visible confidence and score explanation.
- Item paths and alternatives.
- Augment categories/branches.
- Stage progression boards.
- Replacement units/flex slots.
- Pivot graph among recommended plans.
- Decision Map.
- Quick “What am I looking for?” strip.
- Team Planner codec module and copy button; supported only after verification.
- Settings/cache persistence.
- Riot-account/history provider contracts.
- Opponent scouting architecture, preferably a working first path.
- Post-game parser/coach architecture.

## Recommendation portfolio
Do not simply return the three highest independent scores.

The chosen set should cover distinct openings and avoid excessive shared dependencies. A common useful shape is:
- Plan A: strongest reliable AD/reroll or tempo line.
- Plan B: flexible/high-cap route with meaningful item/transition overlap.
- Plan C: AP or otherwise structurally different fallback.

Portfolio logic should reward opening coverage, item coverage, transition compatibility, and strategic diversity while avoiding three near-identical plans.

## During-game behavior
The core V1 does not require automatic reading of board/shop/bench/gold/augment state.

The playbook may contain precomputed conditional branches such as:
- many copies → reroll branch;
- few copies + good econ → push-level branch;
- AD item start → branch A;
- AP item start → branch C;
- leveling augment → Fast 8 branch;
- heavy contest → low-contest variant/pivot.

These branches exist in the playbook before/at plan selection and remain understandable without runtime AI.

## Personalization
Personal history is deliberately secondary. It should identify useful strengths/weaknesses and slightly nudge recommendations, not trap the user in historically familiar comps.

Default personal score contribution: ~5%.
Normal configurable range: ~5–10%.
Small samples must shrink toward neutral.

## Comp evidence labels
Every recommended board/variant must carry one of:
- Proven
- Variant
- Emerging
- Experimental

Novel optimizer-generated boards begin Experimental. Evidence, not model confidence, promotes them.

## Success criteria
A useful V1 is one the user would actually open before every TFT game because:
- the recommendations make strategic sense;
- the three plans cover realistic different openings;
- contest/lobby pressure improves decisions;
- the playbook is fast to scan during play;
- Team Planner copy saves friction;
- UI feels like a polished product rather than a developer tool;
- post-game feedback teaches something actionable.

## Explicit non-goals for first build
- Protected game-process access.
- Live shop/bench/board memory reading.
- Gameplay automation.
- Large-scale perfect meta discovery on day one.
- Runtime LLM dependence.
- Pretending seeded/limited data is a complete live meta dataset.
