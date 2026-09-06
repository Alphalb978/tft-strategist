# Decision Log & Open Questions

## Approved product decisions

- M8 represents the chosen match plan as one explicit, versioned active session. Its plan, portfolio, scoring, evidence and display-static snapshot are immutable at lock; stage, Decision Map and inspected pivot target are the only mutable manual fields. Switch and end create auditable state transitions, and current compatibility is evaluated separately from historical truth.
- M8 Team Planner remains `unverified`. Public Set 18 format claims are useful candidate evidence, but the audited static fixture has no planner-ID mapping, no independent known-good Set 18 code fixture is checked in, and no human current-client paste result exists.
- M7 strategy guidance is a versioned, source-ledger-backed attachment on the generic curated/discovered comp registry. Facts are individually `sourced`, mechanically `derived`, safely `inherited`, `unavailable`, or `stale`; incompatible guidance stays auditable but is not shown as active truth.
- M7 discovered-guidance inheritance is deliberately field-level and fail-closed. Only a mature Variant retaining capacity and the complete curated core may inherit retained item-holder directions; stage boards, roll plans, augments, replacements, Decision Maps and positioning are not inherited from final-board similarity.
- M7 exact TFT hex positions require direct position evidence. Without it the real hex board remains unassigned and visibly says positioning is not verified; roster order is never treated as coordinates.
- M7 portfolio pivot edges require sourced early-unit, item/component or holder compatibility (or an explicit sourced pivot). Final-board overlap alone cannot create an edge, and M4 contest remains an independent transition-cost input.
- M6 discovery uses versioned canonical champion-board structures, champion-first similarity and deterministic indexed density clustering with explicit noise; placement, player identity and family labels never enter structural features.
- Curated comp families remain immutable anchors. Discovered variants/emerging structures are separately versioned derived registry entries with neutral generated labels, lifecycle history and fail-closed recommendation gates.
- Meta/discovery refresh is an explicit bounded action. Immutable completed matches are reusable, while derived classifier/stat/discovery data is invalidated by set/static, family, sample or model/config fingerprints.
- M5 aggregate outcome evidence is a versioned regional/rank-cohort sample, never "global meta"; it remains separate from M4 historical lobby unit pressure.
- Completed-board family classification is retrospective and conservative: low-score and close-score boards remain unclassified or ambiguous.
- Measured meta/floor/ceiling inputs replace the old seeded inputs only after explicit sample, freshness, and confidence gates; otherwise the outcome contribution is a visible neutral fallback.
- Product type: private TFT pre-game/lobby strategist plus static in-game playbook.
- Goal: improve win/top-4 decision quality with three strong complementary plans, not automated play.
- TFT knowledge is structural/data-driven; model memory is not authoritative.
- UI quality is a first-class requirement.
- Team Planner Copy Team Code is core where the current format is verified.
- Three recommendations are optimized together as a portfolio.
- Personal history is intentionally weak: ~5% default, roughly 5–10% normal range.
- Personal strengths/weaknesses and post-game coaching are approved.
- Opponent scouting is required for stronger recommendations.
- Default opponent history target: ~10–20 relevant recent games each.
- Opponent scanning must be parallel, cached, recency-weighted, patch-aware, deduplicated and partial-confidence capable.
- Lobby contest fit should matter more than personal history.
- Visible confidence is required.
- Risk-adjusted metrics, stage-strength curves, roll burden, transition cost, dependency fragility and contest elasticity are approved.
- Decision Maps are approved.
- Quick “What am I looking for?” strip is approved.
- Pivot graphs among the three plans are approved.
- Item and augment branches are approved.
- Replacement units/flex slots are approved.
- Comp discovery is approved, including lower-contest and high-cap variants.
- Generated/new comps must be validated and labeled Proven, Variant, Emerging or Experimental.
- Emerging-meta detection is approved.
- Prefer evidence-driven board optimization over arbitrary AI theorycrafting.
- Core V1 does not require automatic live board/shop/bench/gold/augment reading.
- V1 should remain useful without runtime LLM/API reasoning.
- No protected-process access: no memory reading, DLL injection, packet interception, input automation, kernel tricks, process hiding or Vanguard bypass.
- One-day polished V1 is the working target; deeper discovery may continue into V1.5.

## Recommendation direction

Major inputs:

- current meta strength;
- consistency/top-4 floor;
- win/cap ceiling;
- lobby contest fit;
- item flexibility;
- transition quality;
- augment flexibility;
- roll/availability feasibility;
- stage/tempo safety.

Smaller penalty:

- dependency fragility.

Intentionally small:

- personal influence.

Exact weights remain configuration and should be calibrated from outcomes.

## Opponent model

Approved features:

- recent comp-family frequency;
- ForceIndex / FlexIndex;
- reroll / Fast 8 / Fast 9 tendencies;
- AD/AP preference;
- recurring carry/tank families;
- core-unit frequency for pool pressure;
- recent placement by family;
- same-patch recency weighting;
- confidence from sample size and patch relevance.

Contest pressure must weight unit criticality and comp sensitivity rather than treating all shared units equally.

## Comp discovery model

- Established real families are the safest baseline.
- Families can have Standard, Low-Contest, High-Cap and other validated variants.
- Flex-slot optimizer locks core units and searches legal active-set combinations.
- Search respects level/capacity, trait breakpoints, role balance, set rules, emblem/augment requirements and unique-unit constraints.
- Historical evidence increases trust.
- Novel boards begin Experimental.
- Experimental -> Emerging -> Proven only as evidence improves.

## UI direction

- Dark premium desktop interface.
- Real current-set visuals where available.
- Three prominent recommendation cards.
- Cards show name, score, confidence, evidence label, contest pressure, floor/ceiling, portraits and short reason.
- Playbook includes visual board, stage progression, quick strip, Decision Map, items, augments, variants, replacements and pivot graph.
- Copy Team Code is prominent with immediate feedback.
- Opponent data is aggregated by default and expandable.
- Post-game review is short/evidence-based.
- Avoid generic admin-dashboard appearance/data walls.

## Technical direction

- Tauri 2 + React + TypeScript + Vite.
- SQLite local cache/history/derived features.
- Versioned JSON/rule fixtures.
- CommunityDragon/static current-set provider.
- Riot TFT APIs for account/rank/current-game participant discovery where available and completed match history.
- Provider -> domain -> rules -> strategy -> UI separation.
- Deterministic/statistical scoring with inspectable components.
- Team Planner codec isolated/tested.
- Cache-first lobby analysis.
- No secrets in logs.

## Open questions to verify during implementation

### Meta bootstrap

V1 needs a practical current comp library before a large self-collected dataset exists. Choose between:

- curated current-set seed playbooks from reliable strategy evidence;
- bounded sampled Riot match dataset;
- another permitted structured source.

Do not permanently depend on scraping another companion's private data.

### Exact TFT rule values

Shop odds, pool counts, XP/economy values, special units and active set mechanics must be sourced/validated before fixtures become authoritative.

### Team Planner code format

Current set/patch encoder must be verified using known-good codes and a manual client paste.

### Riot API latency/rate limits

Benchmark warm cache, cold cache, 10-game window, 20-game window, shared-match dedup and partial-confidence timeout.

### Recommendation freeze behavior

Working default: recommendations can update while lobby scouting completes, then freeze when the user selects/locks a plan or active play begins. Test whether a manual refresh-before-game action helps.

### Evidence thresholds

Define numeric Proven/Variant/Emerging/Experimental thresholds after the first dataset exists.

### Comp classifier

Start with weighted core-unit/trait nearest-family classification. Add more complex clustering only if it materially improves unknown-board classification.

### Personal insights

Define minimum sample size/shrinkage after observing real user data; small samples remain neutral.

### Runtime LLM

Not needed for V1. Later evaluate only for explanation quality; it may receive structured validated facts but never own gameplay truth.

## First-build release gates

- Current static data loads and validates.
- Rules fixtures exist for every rule actually used by recommendations.
- Several real current-set playbooks are represented structurally.
- Three-plan recommendation path works.
- Confidence/reasons are visible.
- Portfolio diversity logic works.
- Premium UI passes human review.
- Team Code is verified or clearly marked unverified.
- Opponent scan architecture exists; a working scan is strongly preferred.
- Critical tests pass.
- No protected-process functionality exists.
