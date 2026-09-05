# M2 Set 18 rule evidence ledger

Audited September 6, 2026 for standard TFT Set 18, Enchanted Wilds, patch 18.1. Research used ordinary public HTTPS only. No protected TFT process, private companion API, authenticated Riot endpoint, or runtime LLM was used.

The machine-readable counterpart is [`data/rules/set18.json`](../data/rules/set18.json). A rule marked **verified** is implemented only for the scope shown. It does not imply that unrelated combat values, edge cases, or strategic advice are verified.

All linked web sources were checked `2026-09-06T00:00:00Z`. The normalized CommunityDragon response reported `Last-Modified: 2026-08-29T00:53:30Z`, ETag `"6a922d8a-170fa5c"`; Map22 reported `Last-Modified: 2026-08-29T00:50:59Z`, ETag `W/"6a922cf3-4217efc"`. These values and per-source classes are also stored in the rule fixture.

## Patch and data parity

| Stable ID | Rule family | Status | Strongest evidence | Implemented meaning and rationale |
| --- | --- | --- | --- | --- |
| `scope.active` | Active set and patch | Verified | Official: [Riot patch 18.1](https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-patch-18-1/) and [Enchanted Wilds overview](https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/enchanted-wilds-overview/) | Set 18 / Enchanted Wilds / patch 18.1 / standard `TFTSet18` is pinned. The app never chooses the highest set number automatically. |
| `data.entities` | Static identifiers and definitions | Verified as export presence | Technical: [CommunityDragon normalized TFT export](https://raw.communitydragon.org/latest/cdragon/tft/en_us.json) | Stable unit, trait, item and augment IDs, roster membership, costs, trait membership, non-null trait thresholds, recipes and art references come from the reviewed export. Export presence is not live availability. |
| `data.map22` | Structural raw rules | Verified for recorded fields | Technical: [CommunityDragon Map22 raw data](https://raw.communitydragon.org/latest/game/data/maps/shipping/map22/map22.bin.json) | Reviewed `TFTSet18` objects provide the shop odds table, shop-content pools, and current Riftbeast 10 team-size modifier. Object IDs and response metadata are preserved in the fixture. |
| `parity.combat` | Live combat-value parity | **Known stale** | Official patch notes compared with the two CommunityDragon resources | Both available exports were last modified August 29. Riot documents later August 31 / September 1 balance changes. The version carries `known-stale`, never `current`. A source-attributed hotfix overlay records the exact official changes without rewriting the raw export; current combat values are not consumed by recommendation logic. |

## Board, unit, and trait rules

| Stable ID | Rule | Status | Source class | Sources | Audited behavior |
| --- | --- | --- | --- | --- | --- |
| `board.capacity.base` | Base board capacity | Verified | Secondary + official context | [TFT champion mechanics](https://wiki.leagueoflegends.com/en-us/TFT:Champion), Riot Set 18 overview | Levels 1–10 allow the corresponding base number of team slots. Levels outside the audited table fail validation. |
| `trait.count.unique-unit` | Normal trait counting | Verified | Technical + secondary | CommunityDragon membership/thresholds; [Trait Ladder Set 18](https://traitladder.com/) | Each distinct fielded unit contributes once to each natural trait. A duplicate copy of the same ordinary unit does not add another trait count. Emblems are not modeled. |
| `trait.breakpoints.exported` | Trait breakpoints | Verified when present | Technical | CommunityDragon normalized export | Only explicit non-null `minUnits` values are usable. The exported Eclipse trait has no usable threshold and is marked `unavailable`; it can never pass a threshold claim silently. |
| `unit.elder-dragon.slots` | Elder Dragon slots | Verified | Official | Riot Set 18 overview | `DA_18_ElderDragon` occupies two team slots. |
| `unit.elder-dragon.riftbeast` | Elder Dragon Riftbeast contribution | Verified | Official + technical | Riot Set 18 overview; CommunityDragon Map22 | Elder Dragon contributes two Riftbeast counts. |
| `trait.riftbeast.10.capacity` | Riftbeast 10 capacity | Verified | Current technical | CommunityDragon Map22 | Riftbeast 10 adds two team slots. Riot's pre-release overview described a different value and explicitly warned that details could change; the current shipped raw set object is used for this structural rule. |
| `unit.lux.origin-count` | Lux Avatar origin contribution | Verified | Official + technical | Riot Set 18 overview; CommunityDragon unit membership | A fielded Lux form contributes two counts to that form's origin, plus its Avatar unique trait. The base export placeholder is not fieldable. |
| `unit.lux.exclusive-form` | Lux form exclusivity | Verified for represented board state | Official | Riot Set 18 overview | At most one distinct runtime Lux form may appear. The base placeholder fails board validation. The model does not simulate shop transformation or selling. |
| `board.capacity.other-conditional` | Other conditional capacity exceptions | Unverified | — | — | No augment, encounter, or other conditional team-size exception is inferred. Only Riftbeast 10 is implemented. |
| `trait.count.emblem` | Emblem counting | Unverified / unsupported | — | — | Boards do not represent emblem-granted traits, so validators make no claim about them. |

## Shop, pool, XP, stars, and economy

| Stable ID | Rule family | Status | Source class | Sources | Audited values |
| --- | --- | --- | --- | --- | --- |
| `shop.slots-reroll` | Shop slots and reroll | Verified | Secondary | [TFT champion mechanics](https://wiki.leagueoflegends.com/en-us/TFT:Champion) | Five shop slots; reroll costs 2 gold. No free-reroll or encounter exception is modeled. |
| `shop.odds.level-1-10` | Shop odds | Verified | Current technical + official change chain | CommunityDragon Map22; Riot [16.1](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-16-1/), [16.4](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-16-4/), and [17.1](https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-17-1/) notes | Cost 1→5 odds by level 1–10 are versioned in the JSON fixture. Every row must contain five values and sum to 1. The shipped level-7 row is 19/30/40/10/1; a secondary Set 18 table still showed the pre-revert 16/30/43 row and was rejected for this field. |
| `shop.pool.copies` | Per-champion pool copies | Verified | Technical + secondary | CommunityDragon `ShopContentData`; TFT champion mechanics | Cost 1→5 copies are 30/25/18/10/9. The fixture also asserts 14/13/14/14/10 shop entries by cost. The Lux base placeholder is the cost-5 shop entry; its nine runtime forms are not nine additional pool entries. |
| `unit.star-copies` | Star-copy math | Verified | Secondary | TFT champion mechanics | One-star uses one copy, two-star three copies, and three-star nine copies. Validators accept star targets only from 1–3. |
| `xp.purchase-passive` | XP purchase and passive XP | Verified | Official change history + secondary | Riot 16.1/16.4; [TFT experience mechanics](https://wiki.leagueoflegends.com/en-us/TFT:Experience) | Buy 4 XP for 4 gold; gain 2 XP per round. |
| `xp.thresholds.level-2-10` | XP thresholds | Verified | Official change history | Riot 16.1/16.4 | XP from level 2→3 through 9→10 is 2/6/10/20/36/60/68/68. |
| `economy.interest` | Interest | Verified | Current secondary | [TFT Lab gold handbook](https://tft-lab.com/en/handbook/gold) | One interest gold per 10 held, capped at five interest at 50 gold. Base income, streak income, portals, encounters, augments, and loot are outside this rule fixture. |

## Items, augments, and Set mechanic

| Stable ID | Rule family | Status | Source class | Sources | Audited behavior |
| --- | --- | --- | --- | --- | --- |
| `item.recipe.exported` | Item identifiers and recipes | Verified as export definition | Technical | CommunityDragon normalized export | Playbook priorities must resolve to combined items. Every recipe reference must resolve to two exported component objects. This verifies identity and recipe structure, not strategic optimality or special-item equipability. |
| `augment.export-presence` | Augment export presence | Verified | Technical | CommunityDragon normalized export | `presentInExport: true` means only that the definition exists in the reviewed payload. It does not become `enabled`. |
| `augment.forge-a-friend.live` | Forge A Friend live status | Verified disabled | Official | Riot patch 18.1 | `DA_ForgeAFriend` is recorded as disabled effective August 28 and is rejected by board/playbook validation. |
| `augment.other.live` | Other augment live status | Unverified | — | — | All other exported definitions default to `liveStatus: unverified`; no static list is treated as a live rotation. |
| `mechanic.wisps` | Wisps | Verified for described behavior | Official | Riot patch 18.1 and Set 18 overview | Wisp position, one-round duration, planning-only behavior, every-other-shop cadence, and the stage-five Combat guarantee are recorded. The recommender does not yet consume Wisp state. |
| `planner.encoder` | Team Planner | Unverified / disabled | — | — | No encoder is enabled. Current-set ID mapping, a known-good fixture, and a manual client paste must all pass first. |

## Evidence conflicts and exclusions

- The CommunityDragon normalized export and Map22 raw file predate the official patch 18.1 hotfix. Structural tables are independently audited; stale combat numbers never become recommendation truth.
- The pre-release Riot overview's Riftbeast 10 capacity text conflicts with the current shipped raw set object. The shipped object wins for the versioned structural rule, and the conflict is documented rather than hidden.
- A current-labeled secondary shop table retained an older level-7 odds row. Official patch history plus the shipped raw table agree on the reverted 19/30/40/10/1 row, so the conflicting secondary row is excluded.
- Exact champion damage, mana, healing, defenses, item balance values, augment effects, Wisp offerings, positioning, rolling probabilities under pool depletion, and strategic win-rate claims are not used by this milestone.

## Reproducibility

- `data/fixtures/cdragon-set18.json` is the reviewed reduced normalized-source fixture; its adjacent provenance file carries retrieval metadata and the generated bundle carries its SHA-256 hash.
- `data/rules/set18.json` is the reviewed, versioned rule fixture and includes direct source records, parity state, exact rule tables, special overrides, the official hotfix overlay, and explicit unknowns.
- `scripts/refresh-data.ts` refuses to emit the bundle when audited pool, odds, recipe, threshold, special-unit, or disabled-augment invariants fail.
- `src/rules/ruleSet.ts` contains deterministic calculations. `src/rules/validation.ts` rejects unsupported or contradictory boards and playbook references.
