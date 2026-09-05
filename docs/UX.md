# UX, Playbooks & Team Planner Integration

## Product feel
The app should feel like a polished commercial companion, not an admin dashboard.

Working visual direction:
- dark premium desktop interface;
- strong typography and spacing;
- real current-set TFT champion/item/trait visuals where available;
- compact information density;
- subtle motion and clear hover states;
- few decorative elements that do not aid decisions;
- no fake generated game UI.

Human visual acceptance is required.

## Home / recommendation screen
The primary screen should make the three recommended plans obvious at a glance.

Each card should expose without opening detail:
- rank (#1/#2/#3);
- comp/family name;
- recommendation score;
- confidence;
- evidence label (Proven/Variant/Emerging/Experimental);
- contest pressure;
- floor/ceiling hint;
- key champion portraits;
- short reason for selection;
- portfolio role such as Main, Flex, AP Fallback, Safe, High Cap.

The cards should be visually distinct enough to compare quickly but share one consistent design system.

## Playbook detail
A selected plan should provide a compact visual board first, then deeper guidance.

Recommended structure:
1. final/target board;
2. quick “What am I looking for?” strip;
3. stage progression;
4. items;
5. augments;
6. variants/replacements;
7. Decision Map;
8. pivot graph;
9. Team Planner action;
10. score/confidence explanation.

Avoid forcing the user to read paragraphs during play.

## Quick strip
The top of the playbook should answer in seconds:
- key copies/units to watch for;
- component priorities;
- augment categories/signals;
- level/roll plan;
- strongest fallback/pivot;
- one or two major “do not force” warnings.

Example shape:
`Copies: X/Y | Components: Bow > Sword | Augments: Trait/Econ | Level: hold 6 → slow roll | Fallback: Plan B`

## Stage progression
Show visual stage boards such as:
- opener / early board;
- Stage 3 board;
- stabilization board;
- level 8/9 or reroll cap board.

Each stage should identify temporary holders and which units are disposable vs core.

## Items
For each important holder:
- primary/BIS items where supported;
- acceptable alternatives;
- component directions;
- flexible slams;
- temporary holders;
- item compatibility with alternate portfolio plans.

Do not imply a strict BIS requirement when evidence says several items are acceptable.

## Augments
Organize guidance around branches, not only a long ranked list.

Examples:
- trait-specific;
- combat;
- economy;
- leveling;
- item/component;
- special/emblem-dependent.

Show what the augment category changes in the playbook, e.g. reroll commitment, push-level timing, high-cap variant, or pivot.

## Decision Map
Present the static conditional logic visually.

Example concept:
`Start -> many core copies? -> reroll branch`
`Start -> few copies + strong econ? -> Fast-8 branch`
`AD components? -> Plan A/B`
`AP components? -> Plan C`
`heavy contest? -> Low-Contest variant / pivot`

The user should understand the main adaptation choices without the app reading the live board.

## Replacements and flex slots
Visually distinguish:
- locked core;
- high-priority but replaceable;
- temporary holder;
- flex slot.

For a missing unit, show 1–3 practical substitutes and what trait/role tradeoff each causes.

## Pivot graph
Show the three recommended plans as a small directed graph.

Each transition can surface:
- shared items;
- shared early units;
- transition cost;
- common trigger;
- likely target level/stage.

This should make the portfolio feel like one coherent strategy set rather than three unrelated tier-list cards.

## Opponent/lobby presentation
Opponent scouting should primarily improve ranking invisibly.

Default UI should show aggregated pressure such as:
- Hunter: High contest
- AP Fast 8: Low
- shared frontline pool: Medium

Detailed opponent profiles may be expandable, but should not dominate the home screen.

Show scanning status clearly:
- cached / fresh;
- partial data;
- confidence;
- scan in progress;
- unavailable.

Do not block the whole interface while one opponent fails to resolve.

## Team Planner workflow
The selected plan must have a prominent `Copy Team Code` action.

Desired flow:
1. user selects plan;
2. clicks Copy Team Code;
3. app copies the verified code to clipboard;
4. immediate visible confirmation;
5. user pastes into TFT Team Planner.

If the active-set encoder is unverified, disable or label the action rather than generating an untrusted code.

Where helpful, allow codes for multiple variants (e.g. Standard / High-Cap) but avoid cluttering the primary workflow.

## Post-game screen
Keep review concise and evidence-based.

Suggested structure:
- placement and selected plan;
- final comp/family match;
- items/augments/final level summary;
- what matched the plan;
- likely issue(s) supported by data;
- one actionable adjustment for next time;
- personal-model update/confidence if enough sample exists.

Do not invent causality from incomplete match data.

## Accessibility / interaction quality
- keyboard focus should work for primary actions;
- text contrast must remain readable;
- portraits/icons require useful tooltips/labels;
- layout should remain usable at common desktop scales;
- copying a code should not require precise tiny clicks;
- important score/confidence meaning should not rely only on color.

## Acceptance gate
Source code that looks attractive in review is not enough. The app should be run and visually inspected where tooling permits, and the user makes the final judgment on visual quality, density, clarity, and whether the playbook is actually usable during a TFT match.
