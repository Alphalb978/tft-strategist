# M1 source and verification ledger

Reviewed September 5–6, 2026 using ordinary public HTTPS. No private companion APIs or protected game processes were accessed.

| Source actually used | Imported facts | Limits |
| --- | --- | --- |
| [Riot patch 18.1](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-1/) | Set 18 name, patch identity, existence of August 31 / September 1 updates | No imported economy/combat formulas |
| [CommunityDragon export](https://raw.communitydragon.org/latest/cdragon/tft/en_us.json) and [listing](https://raw.communitydragon.org/latest/cdragon/tft/) | Active mutator, unit IDs/costs/traits/art, non-null trait thresholds, item recipes, augment definitions | August 29 export; hotfix parity unverified. Internal name says Set10. Eclipse threshold is null. Legacy/PvE records excluded. |
| [Asset documentation](https://www.communitydragon.org/documentation/assets) | Public game asset paths and PNG references | Required art is bundled with source URLs preserved; Riot retains asset rights. |
| [Adapt or Die](https://mobalytics.gg/tft/comps-guide/adaptor-reroll-3HRVQSudB7SJTckVeLxU4ICvPDg) | Adaptor final/early/mid rosters, primary role/item suggestions, broad level 7 route/signals | Eight-unit final target is distinct from rolling level. No economy/star thresholds imported. |
| [Rise and Vine](https://mobalytics.gg/tft/comps-guide/elderwood-reroll-3HDqt0FrDEBPMY81ihqGePxVjU3) | Solar/Elderwood rosters, Kayle/Sejuani item directions, broad level 6 route/signals | Early XP instructions contradict each other and are withheld. Seven-unit final target differs from rolling level. |
| [AP 8-4](https://mobalytics.gg/tft/comps-guide/eldritch-3GPUwYsD4LyC2jj0jH40XM7iS2f) | AP rosters, Soraka/Malphite role/item directions, broad Fast 8 route | Nine-unit final target; eight-unit stabilization cut unverified. |
| [The Final Forest](https://mobalytics.gg/tft/comps-guide/elderwood-cap-3HBMcPmR81fWMyuppwi8smQJ37O) | Final/early/mid rosters, Draven/Maokai roles/items, broad Fast 9 route | No measured floor/ceiling or availability estimates. |
| [Riot TFT API docs](https://developer.riotgames.com/docs/tft) | Future identity/history provider boundary | No authenticated API calls; discovery needs verification for target region/client generation. |
| [tftkit implementation](https://github.com/nkhoit/tftkit) | Research lead for Set 18 Team Planner | No encoder imported; no accepted fixture or manual client paste. |

## Reproducibility

- `data/fixtures/cdragon-set18.json` is a reduced real export retaining raw active-set objects, not a hand-authored gameplay dataset.
- Its adjacent provenance JSON retains retrieval/review and export dates. `public/data/static-set18.json` includes a SHA-256 hash of the reduced raw fixture.
- `scripts/refresh-data.ts` builds the normalized snapshot and asset manifest. Explicit downloads update provenance rather than reusing M1 timestamps.
- `data/playbooks/set18.json` carries per-guide attribution, review date and limitations. Guidance is a short paraphrase, not wholesale guide reproduction.
- `data/rules/set18.json` records structural scope and missing rules. Null facts never become memory-derived defaults.
- Test matches are labeled `fixture:synthetic-matches` and never displayed as user evidence.

## Evidence meanings

**Source-verified:** a field exists in the public export. This does not certify live balance, special-unit legality, item equipability or strategic quality.

**Guide-curated:** a limited roster/role/item/route assertion is traceable to a reviewed public guide. Contradictions are withheld. No measured sample is implied.

**Seeded:** numeric candidate inputs, coverage taxonomy, core criticality, contest elasticity, score/portfolio weights, and the Decision Map's reassess navigation action. These are not win probabilities or live analytics.

**Unverified:** active trait modifiers, special rules, enabled augment list, hotfix parity, shop/pool/XP/economy, star assumptions, positioning, exact timing, substitutes, alternatives, stabilization cuts, actionable pivot conditions and Team Planner acceptance.

Confidence independently considers source age, sample size, patch relevance, lobby coverage, evidence class and seeded metadata. Experimental boards/seeded inputs cap confidence at Low; no automatic promotion to Proven.
