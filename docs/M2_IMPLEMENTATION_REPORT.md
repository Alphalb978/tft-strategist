# M2 implementation report

Implemented on `codex/m2-tft-truth-audit`, September 6, 2026. The audited scope is standard TFT Set 18, **Enchanted Wilds**, patch **18.1**, mutator `TFTSet18`. No branch switch, merge, push, authenticated Riot request, Team Planner enablement, or protected-process access occurred.

## Outcome

M2 replaces M1's declared-capacity-only checks with a versioned, provenance-aware rule foundation. Boards now use deterministic level capacity, occupied-slot, trait-count, breakpoint, special-unit, item-recipe, and augment-status validation. Source refresh refuses to publish a normalized snapshot that conflicts with the reviewed rules fixture. Seeded recommendation metrics and Experimental playbook evidence remain unchanged.

The generated schema is version 2 and contains 74 exported champion records, separated into 65 shop entries (including the non-fieldable Lux base placeholder) and nine runtime Lux forms, plus 36 traits, 502 item/special-object definitions, 254 augment definitions, and 57 bundled art assets.

## Sources actually used

The applied hierarchy was Riot official documentation, CommunityDragon technical data, then current technical/secondary references where Riot did not publish the base rule. Conflicting secondary values were rejected rather than averaged.

| Source class | Important sources and use |
| --- | --- |
| Riot official | [Patch 18.1](https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-patch-18-1/) for current patch, official hotfix changes, Wisp behavior, and Forge A Friend disablement; [Enchanted Wilds overview](https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/enchanted-wilds-overview/) for set identity, Lux Avatar, and Elder Dragon; patch [16.1](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-16-1/), [16.4](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-16-4/), and [17.1](https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-17-1/) for the XP/shop change chain. |
| CommunityDragon technical | [Normalized TFT export](https://raw.communitydragon.org/latest/cdragon/tft/en_us.json) for active entities, costs, natural traits, thresholds, recipes, augments and art; [Map22 raw data](https://raw.communitydragon.org/latest/game/data/maps/shipping/map22/map22.bin.json) for shop odds, pool contents, and the shipped Riftbeast 10 capacity field. |
| Secondary | [League Wiki champion](https://wiki.leagueoflegends.com/en-us/TFT:Champion) and [experience](https://wiki.leagueoflegends.com/en-us/TFT:Experience) mechanics, [TFT Lab gold](https://tft-lab.com/en/handbook/gold), and [Trait Ladder](https://traitladder.com/) for base mechanics not completely stated in current Riot notes. A current-labeled secondary shop table conflicted with Riot's revert history and the shipped raw table at level 7, so that row was not used. |
| Guide | The four original Mobalytics pages were used only to re-audit their own rosters, broad routes, roles, items and stated limitations. No general meta database was ingested. |

All sources were reviewed September 6. CommunityDragon's normalized response was last modified August 29 at 00:53:30Z; Map22 at 00:50:59Z. Exact URLs, ETags, stable fact IDs, statuses, and limitations are in [M2_RULE_EVIDENCE_LEDGER.md](M2_RULE_EVIDENCE_LEDGER.md).

## Rule status changes

Moved to **verified within the fixture scope**:

- base capacity for levels 1–10 and occupied slot calculation;
- unique-unit natural trait counting and explicit breakpoints;
- Elder Dragon's two occupied slots and two Riftbeast contribution;
- Lux runtime-form classification, doubled represented origin, base-placeholder rejection, and one-form board limit;
- Riftbeast 10's current shipped +2 capacity modifier;
- five-slot/2-gold shop, level 1–10 shop odds, per-cost pool copies, pool roster counts, and 1/3/9 star-copy math;
- XP thresholds, 4-gold/4-XP purchase, 2 passive XP per round, and the 50-gold/5-interest cap;
- exported combined-item recipes and component references;
- Wisp behavior represented by the fixture;
- Forge A Friend's explicit live-disabled override.

Moved to an explicit **unavailable/unverified** state:

- Eclipse's null export threshold is `unavailable`, not an empty threshold that can pass;
- live status for every augment without an authoritative override remains `unverified`, independently of export presence;
- emblem trait counting, non-Riftbeast conditional capacity exceptions, special-item equipability, exact combat values, and Team Planner remain unsupported or unverified.

No rule family is presented as partially verified in the UI. Static combat-value parity is a separate `known-stale` state.

## Hotfix parity

Conclusion: **known stale**. The reviewed CommunityDragon exports predate Riot's August 31 / September 1 patch 18.1 changes. `patchVerified` remains false and `parityStatus` is `known-stale`. The human-reviewed rule fixture carries a stable-ID hotfix overlay for the official changes, including the Riftbeast 7 team-stat adjustment and documented champion changes, without mutating the raw source fixture. Recommendation scoring does not consume those combat fields, so it makes no current-stat claim.

## Playbook audit

All four playbooks remain **Experimental** with no measured outcomes. Every target/stage unit resolves to an audited Set 18 entity, final occupied slots are legal, holders and item references resolve, combined-item recipes resolve to components, and trait claims are recomputed from rule data.

- **Rise and Vine / Solar & Elderwood:** legal seven-unit target. The source still conflicts on buying XP at 2-1; exact early timing remains withheld.
- **Adapt or Die / Adaptors:** legal eight-unit target. Level-7 rolling and the later eight-unit board remain distinct; no exact gold threshold was imported.
- **AP 8-4 / AP Summoners:** legal nine-unit final extension. The Fast 8 label does not establish the missing level-8 stabilization cut, so that board remains unavailable.
- **The Final Forest:** legal nine-unit target. Broad stabilize-at-8/push-9 guidance remains guide-curated; no measured floor, ceiling, timing, or availability estimate was added.

The detailed board and trait reconciliation is in [M2_PLAYBOOK_AUDIT.md](M2_PLAYBOOK_AUDIT.md).

## Changed modules and files

| Area | Files | Change |
| --- | --- | --- |
| Versioned truth | `data/rules/set18.json`, `src/rules/ruleSet.ts` | Added source registry, parity state, rule tables, explicit unknowns, deterministic capacity/slot/trait functions, static-data reconciliation, and hotfix overlay. |
| Domain/provider | `src/domain/models.ts`, `src/domain/staticSchema.ts`, `src/providers/communityDragon.ts`, `public/data/static-set18.json` | Schema v2; entity provenance; champion shop/fieldability classification; trait availability; augment export/live separation; explicit parity. |
| Validation/application | `src/rules/validation.ts`, `src/services/application.ts`, `scripts/refresh-data.ts`, `public/data/asset-manifest.json` | Enforced audited legality and recipes, blocked inconsistent snapshots, made asset-manifest output deterministic. |
| Playbooks | `data/playbooks/set18.json`, `src/providers/playbooks.ts` | Re-audit metadata, audited capacity, and recomputed reachable trait claims. |
| Minimal UI | `src/app/App.tsx`, `src/features/DataSettings.tsx`, `src/features/Playbook.tsx` | Visible known-stale parity, rule-family statuses, audited slots, and active audited trait thresholds. No redesign. |
| Tests/docs | `src/test/provider.test.ts`, `src/test/rules.test.ts`, `e2e/app.spec.ts`, `README.md`, M2 ledger/audit/report | Added deterministic rule/edge-case/playbook coverage, rendered evidence assertions, and maintained documentation. |

## Checks actually run

Final acceptance run:

| Command / check | Result |
| --- | --- |
| `npm run data:refresh` | Passed: 74 champions, 36 traits, 502 items, 254 augments, 57 assets, 0 failed assets. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm test` | Passed: 42 tests across six files. |
| `npm run build` | Passed: Vite production build; 341.97 kB main JS / 105.48 kB gzip and 24.60 kB CSS. Rollup emitted only the existing benign upstream Zod comment warnings. |
| `npm run test:ui` | Passed: six Edge tests covering plans/art/detail/planner/lock, evidence statuses/refresh/settings, 1000/860 layouts, offline assets, and load failure/retry. |
| `npm run format:check` | Passed. |
| `git diff --check` | Passed; Git printed only expected Windows LF→CRLF working-copy notices. |

Rendered inspection used the app started by the UI suite. Home, playbook, and Data & settings captures were inspected at 1440 pixels; responsive captures at 1000 and 860 pixels were also checked. Audited slots/traits and verification statuses are readable, and no new horizontal overflow was observed. No native Rust code or schema changed, so the task-directed native rebuild was deliberately not run.

## M1 assumptions removed

- A board's own declared capacity is no longer accepted as authority; its audited level and active modifier compute capacity.
- Unit-array length no longer stands in for occupied slots; Elder Dragon consumes two.
- Trait membership count is no longer always `unverified`; distinct-unit counting and audited special contributions are deterministic.
- Lux is no longer treated as a generic unresolved special unit; the shop placeholder and runtime forms are explicit.
- Static augment definition presence no longer ambiguously represents live availability.
- Null trait thresholds no longer become empty-but-usable data.
- Shop, pool, XP, interest, and star-copy values are no longer omitted or supplied by memory; they are versioned and source-backed.
- The August 29 export is no longer described merely as parity-unverified; it is explicitly known stale against official later changes.

## Deliberate unknowns and risks for M3/M4

- Team Planner is still disabled pending current-set mapping, a known-good fixture, and manual client paste verification.
- Most live augment availability and all conditional capacity exceptions beyond Riftbeast 10 need authoritative evidence or a provider that can represent them safely.
- Emblems are outside the board model, so emblem-granted trait counts cannot be validated.
- Current combat stats/effects remain unavailable from the stale export unless a maintained overlay is extended into a typed combat-stat domain. M2 records but does not consume the hotfix changes.
- Exact rolling odds under contested/depleted pools, base/streak income, loot, encounters, and augment-driven economy are not represented; future feasibility logic must not imply them.
- The four boards have no measured match sample. Seeded scores, floor/ceiling, availability, fragility, and portfolio weights remain unsuitable for promotion to Proven or for statistical calibration.
- M3 live history/scouting work still needs an approved Riot API integration, production rate-limit behavior, identities, and persistent match evidence. M4 strategy calibration will need patch-aware measured samples and must preserve weak personal influence.

## Recommended next task

Implement the read-only Riot identity and completed-match history adapter with manual lobby identities, bounded rate-limit-aware fetching, patch-aware persistent caches, shared-match deduplication, and partial-confidence output. Use the audited M2 entities/rules for ingestion validation, but keep live lobby discovery, Team Planner, and any protected-process technique out of scope. Measured recommendation calibration should follow only after trustworthy match evidence exists.

