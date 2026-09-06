# M7 Implementation Report — Strategy & Playbook Intelligence

Date: 2026-09-06  
Branch: `codex/m7-strategy-playbook-intelligence`

## Outcome

M7 extends the existing generic `Playbook`/comp-registry model with a versioned strategy attachment and turns the selected-plan page into a local, deterministic match playbook. Supported curated families now expose compact stage progression, level/roll milestones, audited item holders, source-scoped augment branches, manual Decision Maps, a real TFT hex-board representation, and portfolio pivot context. Partial and discovered entries remain useful without presenting missing strategy as truth.

No runtime LLM, protected-process access, live board/shop/bench reading, input automation, Team Planner expansion, post-game expansion, private competitor API, or network request was added to the hot playbook path.

## Human-acceptance fingerprint correction

Human visual acceptance found that a network-refreshed Tauri cache made otherwise compatible M7 facts stale. The condition was not real gameplay-data staleness. `set18.strategy.json` stored the SHA-256 of the reviewed reduced CommunityDragon payload, while `normalizeCommunityDragon` intentionally sets `version.sourceVersion` to `provenance.hash`, then HTTP `Last-Modified`, then `fetchedAt`. Network refreshes do not calculate the reduced-payload hash, so the real persisted cache used `Sat, 29 Aug 2026 00:53:30 GMT`. M7 compared these two differently defined values directly. The original M7 fixture also injected the payload hash, masking the production path.

The minimal correction adds `static-set-compatibility-v1`: a deterministic fingerprint over normalized gameplay-semantic Set data. It includes set, patch, schema, champion identity/cost/traits/eligibility, trait breakpoints/counting, item recipes/categories/availability, and augment identity/availability requirements. Entity collections use an explicit code-unit ID comparator and set-like nested arrays are sorted. Transport/cache source versions, retrieval/review timestamps, provenance URLs/notes/hashes, display art, warnings, and collection order are excluded because they do not change strategy compatibility. The strategy seed now stores the resulting `fnv1a-9b3bc81f`; both curated loading and discovered-guidance attachment use the same function, and validation independently recomputes it. The compatibility gate and stale-value suppression remain in place.

The real Tauri SQLite cache was inspected read-only after the fix. Its transport `sourceVersion` remains the HTTP date above, with no provenance hash, while its semantic compatibility fingerprint is `fnv1a-9b3bc81f`. Loading that exact persisted payload produces current guidance: Adaptors and Solar & Elderwood are `5/7`; Apex Predator is current at `1/7` with only unsupported fields unavailable.

## Strategy schema and versions

- Strategy schema: `1`.
- Curated guidance version: `set18-strategy-v1`.
- Discovery attachment: `set18-strategy-v1+discovery-inheritance-v1`.
- Decision Map: `decision-map-v1`.
- Pivot graph: `portfolio-pivot-v1`.
- Target fingerprint: `strategy-target-v1` over set, audited capacity, and sorted stable champion IDs.
- Registry fingerprint: `strategy-registry-v1` over family ID, sorted core IDs, and target fingerprint.
- Static compatibility fingerprint: `static-set-compatibility-v1` over sorted normalized gameplay-semantic Set data, excluding mutable transport/provenance and presentation metadata.

`data/playbooks/set18.strategy.json` is validated with Zod before use. Each runtime `Playbook` retains its existing M1–M6 fields and gains a generic `strategy` attachment; no parallel comp registry or per-comp renderer was created.

The model supports reviewed sources and source versions; field-level source status; stage-state graphs; typed level/roll milestones; item groups, roles, components, and temporary holders; category-based augment branches; replacement deltas; deterministic Decision Maps; exact/coarse/unverified positioning; coverage; and freshness reasons.

## Public strategy sources

All pages below were directly inspected on 2026-09-06 without authentication. Exact page identity, URL, review time, scope and limitation notes are retained in the strategy ledger and surfaced in the playbook.

| Source ID                  | Public page                                                                                         | Imported scope                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobalytics-rise-and-vine` | [Rise and Vine](https://mobalytics.gg/tft/comps-guide/elderwood-reroll-3HDqt0FrDEBPMY81ihqGePxVjU3) | Final/early/mid rosters, Level 6 Slow Roll, entry signals, holders/items, reroll branch, public tips. Its contradictory early XP call is withheld.                           |
| `mobalytics-adapt-or-die`  | [Adapt or Die](https://mobalytics.gg/tft/comps-guide/adaptor-reroll-3HRVQSudB7SJTckVeLxU4ICvPDg)    | Final/early/mid rosters, Level 7 Slow Roll, entry signals, carry/tank holders, item lists, reroll and Artifact branches.                                                     |
| `mobalytics-ap-8-4`        | [AP 8-4](https://mobalytics.gg/tft/comps-guide/eldritch-3GPUwYsD4LyC2jj0jH40XM7iS2f)                | Final/early/mid rosters, Fast 8 stabilization, entry signals, holders/items, economy and emblem branches. Final nine-unit board and unpublished level-8 cut remain separate. |
| `mobalytics-final-forest`  | [The Final Forest](https://mobalytics.gg/tft/comps-guide/elderwood-cap-3HBMcPmR81fWMyuppwi8smQJ37O) | Final/early/mid rosters, level-8 stabilization into Fast 9, entry signals, holders/items, Maokai/Taric tank-flex tip.                                                        |
| `tftactics-set18-tierlist` | [TFTactics Set 18 team comps](https://tftactics.gg/tierlist/team-comps/)                            | Public final rosters, roll-style labels, and visibly marked augment/emblem gates only.                                                                                       |

No authenticated/private competitor endpoint, hidden statistics, or proprietary IPC was used. Public strategy pages were evidence for the fields they exposed, not outcome-strength evidence.

## Coverage per curated family

Legend: `S` sourced, `U` unavailable. “Decision/warning” includes source-scoped entry/avoid signals; pivot edges themselves are derived separately.

| Family               | Stage progression                  | Roll/level                    | Items/holders | Augment branch                | Replacements | Positioning | Decision/warning     |
| -------------------- | ---------------------------------- | ----------------------------- | ------------- | ----------------------------- | ------------ | ----------- | -------------------- |
| Solar & Elderwood    | S: early, level-6, target          | S                             | S             | S: reroll                     | U            | U           | S + derived fallback |
| Adaptors             | S: early, mid, level-7, target     | S                             | S             | S: reroll, item/artifact      | U            | U           | S + derived fallback |
| AP Summoners         | S: early, mid, level-8, target     | S                             | S             | S: economy, emblem            | U            | U           | S + derived fallback |
| The Final Forest     | S: early, mid, stabilize-8, target | S                             | S             | S: economy                    | U            | U           | S + derived fallback |
| Apex Predator        | U: target only                     | S: `Fast 9` label only        | U             | U                             | U            | U           | U                    |
| Consuming Flora      | U: target only                     | S: `Slow Roll (5)` label only | U             | U: unknown augment gate       | U            | U           | S: gate warning      |
| Flora Executioners   | U: target only                     | S: `Fast 8` label only        | U             | U                             | U            | U           | U                    |
| Invoker Spellweavers | U: target only                     | S: `Fast 8` label only        | U             | U: emblem details unavailable | U            | U           | S: emblem warning    |
| Unrivaled            | U: target only                     | S: `Slow Roll (7)` label only | U             | U: unknown augment gate       | U            | U           | S: gate warning      |
| Elderwood Rapidfire  | U: target only                     | S: `Fast 8` label only        | U             | U                             | U            | U           | U                    |
| Blackthorn Sprykin   | U: target only                     | S: `Slow Roll (5)` label only | U             | U                             | U            | U           | U                    |
| Blossom Executioners | U: target only                     | S: `Slow Roll (6)` label only | U             | U                             | U            | U           | U                    |
| Coven Invokers       | U: target only                     | S: `Fast 8` label only        | U             | U                             | U            | U           | U                    |

Coverage counts shown in the UI intentionally exclude a final roster from “stage progression”; a target-only page therefore remains partial.

## Fact semantics

- `sourced`: directly supported by retained public page IDs.
- `derived`: a mechanical consequence of audited project truth, such as target capacity, trait delta, exact board fingerprint, cluster representative roster, or transition-cost component. Derived legality is never labeled equal strategic strength.
- `inherited`: copied field-by-field from a compatible curated parent, with parent and original sources retained.
- `unavailable`: no supporting source/mechanical derivation exists; the UI gives a compact unavailable state.
- `stale`: a configured fact failed set/static/target/registry compatibility. Its runtime value is suppressed while source metadata remains auditable in the bundle.

The audited M2 champion/trait/item/rule catalog validates every imported champion, board capacity, combined item recipe, component ID and referenced augment ID. Strategy claims do not overwrite static truth or M5 outcome evidence.

## Stage, roll, item, augment and replacement model

Stage states have stable IDs, timing and level facts, typed roster roles/slot classes, entry/exit conditions and next-state IDs. Exact levels/timings are present only where the page exposes them; a stabilization state may leave its exact board unavailable.

Roll milestones support hold, roll, slow-roll, push-level, stabilize and cap. The UI exposes the next objective plus source-backed stay/leave conditions. No unsourced HP, shop odds, copies or economy rule was added. Solar early XP remains unavailable because the source contradicts itself.

Item guidance distinguishes primary and alternative published lists without calling either universal BIS. Items and components are accepted only if the audited M2 catalog and recipes validate. Ornn → Sejuani is shown as a temporary-holder transfer only because the inspected Solar guide states it.

Augments are branches, not an exhaustive ranking. M7 stores supported category, manual signal and consequence. Specific augment IDs remain empty where live availability or exact interaction is not verified.

The replacement engine can deterministically replace a selected board slot, recompute verified trait counts/breakpoints, calculate capacity delta and validate the result. It always carries “mechanically legal does not mean equal strategic strength.” No inspected source published a sufficiently clear target→substitute edge, so the active ledger exposes none rather than manufacturing suggestions.

## Decision Map semantics

Decision Maps are finite directed acyclic graphs. Supported conditions are limited to manual core signal, item direction, augment category, economy/tempo, existing M4 lobby contest, manual level/roll, missing unit and application navigation. Unknown/live-automation conditions fail validation; cycles, missing roots and disconnected edge references fail validation.

The UI shows the current question/action and lets the user select one supported edge at a time. Traversal is deterministic (`current node + edge ID -> next node`), resettable and ephemeral. It never reads the game process, board, shop, bench, gold or augment selection.

## Quick-strip derivation

The six cells are generated locally from active guidance and the current portfolio: source-emphasized watch units; sourced/inherited component directions; first augment branch; first next objective; lowest-cost supported outgoing pivot; and first source warning. Missing cells say unavailable/no supported edge and retain their status badge.

## Positioning evidence semantics

The board renders TFT geometry as four staggered rows of seven hexes. Exact coordinates require `precision=exact`, unique row/column coordinates, target-board membership and source provenance. Coarse formation has a separate front/mid/back plus side model and does not imply an exact hex.

None of the inspected text/structured public evidence established reliable exact or coarse positions. All current entries therefore render an unassigned board labeled `Positioning not verified`, with the roster beside/below it and core/flex/temporary styling. Source roster order is never converted into coordinates.

## Pivot derivation

A directed edge requires shared sourced early units, shared sourced/inherited components, shared sourced/inherited holders, or an explicit sourced pivot. Final-board overlap alone cannot create an edge.

```text
item cost      = 0 with shared sourced components, otherwise 28
unit cost      = 45 × (1 - final-board Jaccard overlap)
route cost     = 0 for compatible sourced primary roll/level objectives, otherwise 18
contest adjust = clamp(destination M4 pressure - source M4 pressure, -8, +8)
total          = clamp(round(sum), 0, 100)
```

Every edge shows reasons, cost and `sourced`/`derived` status. M4 pressure remains an independent recommendation-time input; M7 does not feed strategy text into M4, M5 or M6 scoring.

## Discovered-guidance inheritance

Experimental and Emerging unknown clusters remain strategy-sparse. A mature `Variant` may attempt inheritance only when relation is `variant-candidate`, lifecycle is exactly `Variant`, capacity delta is zero, the complete parent core is retained as stable shared core, no parent core is repeatedly omitted, and parent guidance is current.

Even then, M7 inherits only directions for item holders still present plus retained watch-unit IDs. Every inherited fact retains its parent/source IDs. Stage boards, roll plan, augments, replacements, Decision Map and positioning never inherit in v1 because final-board similarity cannot prove them compatible. Recommendation eligibility is unchanged.

The M6 browser fixture remains an Experimental Variant and correctly shows 0/7 strategy coverage. Safe and unsafe mature-Variant inheritance are deterministic unit fixtures, not live evidence.

## Freshness, invalidation and storage

Guidance becomes stale when strategy schema/guidance version, active set, semantic static-set compatibility fingerprint, target IDs/capacity fingerprint, family/core/target registry fingerprint, or required source availability differs. Unknown items, holders, stages, augment IDs, Decision topology and positions fail validation. A new set returns no Set 18 playbooks; a same-set semantic structural/static change suppresses facts until review. HTTP dates, fetch timestamps, source aliases, provenance notes, art URLs and ordering cannot independently invalidate otherwise compatible guidance.

Curated guidance is persisted in the immutable versioned JSON bundle. The existing selected-plan snapshot persists the attached validated playbook and remains guarded by set/patch/static/portfolio validation. M5 aggregate and M6 discovery datasets retain their independent keys/fingerprints; M7 never overwrites them.

## Validation results

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors/warnings after final cleanup.
- `npm run format:check`: passed.
- `npm test -- --run`: passed, 114 tests in 11 files (17 M7 tests).
- `npm run build`: passed; only existing third-party Zod annotation warnings.
- `npm run test:ui`: passed, 21 Playwright tests.
- `git diff --check`: passed.
- No Rust/native source changed, so native fmt/test/check/debug build was not required.

M7 tests cover schema/provenance, active stage boards, stale suppression, partial evidence, item/holder IDs, augment category with unavailable IDs, replacement deltas, deterministic/cyclic/unsupported Decision Maps, quick-strip determinism, positioning precision, pivot edge/no-edge behavior, safe/unsafe inheritance, and unchanged recommendation/M4 inputs. Acceptance regressions additionally cover the real no-hash/HTTP-date refresh shape, order and irrelevant-metadata independence, semantic static mutation, active-set mutation, and deterministic M6 family/M7 static fingerprints. The shared fixture no longer injects the payload hash that concealed the mismatch.

## Benchmarks

One deterministic fixture run on this workstation:

| Benchmark                                                    |                      Result |
| ------------------------------------------------------------ | --------------------------: |
| M3 1×10 cold                                                 |                     9.11 ms |
| M3 7×20 cold / warm immutable / warm profile                 |       4.35 / 3.33 / 2.68 ms |
| M3 partial timeout                                           |      37.65 ms, 43% coverage |
| M4 warm acquisition / profile+pressure / candidate+portfolio |      2.92 / 9.53 / 12.79 ms |
| M5 8,000-board classification / statistics                   |            140.17 / 7.32 ms |
| M5 aggregate cold / warm                                     |              1.92 / 0.81 ms |
| M6 canonicalize 20,000 / similarity 100,000                  |          473.10 / 380.09 ms |
| M6 cluster 1,000 / 8,000 / 20,000                            | 160.05 / 497.28 / 948.17 ms |
| M7 load all 13 guidance entries                              |               36.2909 ms/op |
| M7 validate all guidance                                     |               36.2772 ms/op |
| M7 Decision Map traversal                                    |                0.0010 ms/op |
| M7 three-plan pivot graph                                    |                0.0213 ms/op |
| M7 board rendering-data fingerprint                          |                0.0038 ms/op |

No M6 pair budget was reached. M7 confirms that traversal, pivot construction and board-data derivation are effectively local and sub-millisecond.

## Rendered inspection

Playwright and human screenshot inspection covered 1440, 1000 and 860 px for well-covered Adaptors, partial Apex Predator, discovered Experimental Variant of Adaptors, Decision Map selection/reset, the pivot graph, the TFT board, item/augment branches, unavailable replacements, sticky navigation, overflow and page errors.

All widths had no document/main horizontal overflow and no browser console errors. The visual pass caught and fixed a global `nav` selector collision that initially made the sticky playbook navigation vertical. Recaptured renders show it compact at all required widths. Screenshots are in ignored local `artifacts/` for human review.

Acceptance revalidation launched the real `tft-strategist.exe` Tauri shell against the corrected live frontend. This Codex host did not expose native-window capture, so visual inspection used the same running Vite document served to the Tauri WebView, while the actual Tauri SQLite cache was separately loaded and fingerprinted read-only. Adaptors showed `5/7`, meaningful sourced quick-strip units/components/augment/next objective, sourced stage progression, holders, augment branches and Decision Map, with freshness `current`. Solar & Elderwood showed the same supported sections as current. Partial Apex Predator showed freshness `current`, its sourced Fast 9 objective, and honest unavailable states for stages, holders, augments and Decision Map. All three retained `Positioning not verified` and empty hexes. No `STALE` label or static-source-change message appeared. A clean native rebuild was attempted but the host's C: drive exhausted space while compiling dependencies; the existing debug shell launched successfully and no Rust/native source changed.

## Unsupported strategy gaps

- No current family has directly verified exact or coarse positioning.
- No inspected source established a clear substitute edge; replacements remain unavailable.
- Nine TFTactics-backed families remain target/roll-label-only, without opener, transition, item holder or Decision Map.
- Specific augment IDs/rankings and live availability are not asserted from category/gate labels.
- AP Summoners has no source-published exact level-8 cut board.
- Solar early XP timing remains withheld because the source contradicts itself.
- No explicit cross-family public pivot was established; current edges are derived compatibility.
- No live mature M6 Variant inheritance was observed; only deterministic fixtures validate the rule.
- Static combat parity and TFT content-patch mapping retain their pre-existing known-stale/unavailable status.

## Recommended next milestone

Proceed to the next authorized milestone without broadening M7. Additional strategy depth should arrive only through newly reviewed public evidence or audited project data, especially for the nine partial families, positioning and explicit substitutions. Team Planner and post-game learning remain separate milestones.
