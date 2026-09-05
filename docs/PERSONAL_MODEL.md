# Personal Model & Post-Game Coaching

## Principle
Personal history should help, but it must not dominate recommendations.

Default recommendation influence: approximately 5%.
Normal configured range: approximately 5–10%.
With small samples, shrink strongly toward neutral.

The app should never trap the user in familiar comps merely because they were played often before.

## Personal features
When enough completed-match evidence exists, derive cautiously:
- performance by comp family;
- performance by reroll / Fast 8 / Fast 9 style;
- AD vs AP line performance;
- average final level;
- top-4 and win rate by broad strategy family;
- performance when playing high-contest vs low-contest families if inferable;
- repeated failure patterns supported by data;
- repeated strengths supported by data.

Prefer broad stable style signals over tiny comp-specific samples.

## Shrinkage / confidence
Every personal insight must carry confidence from sample size and relevance.

Rules of thumb:
- very small sample -> neutral;
- moderate sample -> gentle nudge;
- larger consistent sample -> still modest influence on recommendation score;
- old-set history should not overpower current-set evidence;
- contradictory recent results reduce confidence.

Do not display a weakness/strength as fact from one or two games.

## Strength/weakness detector
Examples of acceptable insights when supported:
- stronger on reroll lines than greedy Fast 9 lines;
- good results with AD tempo openings;
- repeated poor results on AP transition families;
- frequent low final level compared with the intended plan;
- good top-4 rate but low win conversion on a style.

The detector should identify patterns, not psychoanalyze the user.

## Post-game import
Use completed TFT match history and map the result back to:
- selected recommended plan if known;
- nearest comp family/variant;
- final units/star levels/items/traits available in match data;
- augments;
- placement;
- final level and other reliable end-state fields;
- patch/set metadata.

Store raw source IDs plus derived interpretation/version so later classifier changes can recompute insights.

## Post-game coaching
Keep the review short and evidence-based.

Useful sections:
- placement;
- intended plan;
- final family/variant;
- what matched the plan;
- one or two likely issues supported by completed-match evidence;
- one actionable adjustment;
- whether this game materially changes a personal strength/weakness estimate.

Examples of evidence-safe coaching:
- selected reroll plan finished without target 3-star -> note incomplete upgrade condition;
- final board diverged heavily from selected family -> note transition/pivot outcome;
- item direction matched intended carry -> positive confirmation;
- final level much lower than selected Fast-8 plan target -> flag as a possible execution issue, not proven cause.

## Causality rule
Completed-match data is incomplete. Never claim a loss happened because of a specific in-game decision unless the available evidence truly supports it.

Use language like:
- `Possible issue`
- `Likely mismatch with plan`
- `Evidence suggests`

rather than inventing exact roll/econ/positioning mistakes that were not observed.

## Runtime AI
V1 should not require an LLM.

Generate core post-game observations from deterministic templates/structured rules. An optional LLM may later polish explanations, but it must only receive validated structured facts and must not become the source of gameplay truth.
