# Patch 18.2 Authority and MetaTFT Reliability Pass

Reviewed: 2026-09-13
Scope: focused Patch 18.2 roll-forward on `codex/m12-final-companion`; M14E excluded.

## Root cause

MetaTFT had correctly advanced its public scope to Patch 18.2 while Strategist's reviewed authority still declared Patch 18.1 in `ACTIVE_SET` and `data/rules/set18.json`. Exact compatibility validation therefore rejected the provider snapshot with the intentionally fail-closed generic `Wrong set or patch` error. The rejection was correct; the diagnostics and app authority were stale.

## Primary and technical evidence

- Riot Games, [Teamfight Tactics patch 18.2](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-2/), published 2026-09-09. Primary authority for patch identity and gameplay changes.
- CommunityDragon normalized TFT export, last modified 2026-09-12 00:37:08 UTC, weak ETag `6aa49eb4-170eb27`.
- CommunityDragon Map22 export, last modified 2026-09-12 00:35:39 UTC, weak ETag `6aa49e5b-4256696`.
- CommunityDragon Team Planner export, last modified 2026-09-12 00:36:20 UTC, SHA-256 `0cdb14f5e271b88000ec90a0f1934d7cdb54381dff0020e0ebef21c6654c93d4`.
- Current Mobalytics Set 18 guide pages and TFTactics Patch 18.2 team-comps page, reviewed 2026-09-13 for the narrow board/route fields already curated by Strategist.

## Authority audit

| Product contract | Patch 18.2 result |
| --- | --- |
| Active identity | Promoted to Set 18 / Enchanted Wilds / `TFTSet18` / 18.2; Xayah and Fiddlesticks probes preserved. |
| XP | Adopted Riot's 56 / 64 / 64 costs for 7→8, 8→9, and 9→10. |
| Traits | The engine represents breakpoints/counting, not Patch 18.2 combat values or Coven/Fae rewards. No represented breakpoint/counting change was found. |
| Units | The normalized domain represents ID, name, cost, traits, art, role, and board eligibility. Riot's Patch 18.2 spell/stat/targeting changes are not normalized, and no cost/trait-membership change was asserted. |
| Augments | Export presence remains separate from live availability. Forge A Friend is absent from the current export; Know Your Enemy is newly present but remains live-unverified. Patch 18.2 reward/exclusivity changes are not modeled. |
| Wisps | Existing cadence fields remain valid. Prices, Combust damage, Cutpurse chance, Borrowed Gear timing, and Field of Mice removal are not represented by current product logic. |
| Hotfix overlay | The 18.1 overlay is retained as history. No current combat overlay is applied to the post-18.2 structural export, whose exact combat parity remains unverified. |
| Playbooks | Existing boards/routes were re-audited against current pages and versioned 18.2. They remain Experimental and make no inferred current strength claim. |

## CommunityDragon parity

The approved refresh selected exactly Set 18 with mutator `TFTSet18`: 74 champions and 36 traits, with no champion ID loss. Relative to the prior reduced fixture, the technical item/augment catalog added Crystal Ball, Crystal Ball Upgrade, and Know Your Enemy; removed Death's Defiance, Hullcrusher, Memorial Dummy, Memorial Dummy Upgrade, Flora Fatalis Augment Plus, Calculated Loss, Construct a Companion, Double Trouble, and Forge A Friend. The normalized result contains 500 items and 250 augments. The current Team Planner export retains 65 Set 18 entries but remaps Ivern from 1029 to 1028 and moves the non-fieldable Lux base placeholder to 1029; the audited human fixture still verifies the wire format and its roster is unchanged. Structural parity is reviewed; exact live combat-value parity is `unverified`.

## MetaTFT safety and diagnostics

The collector now queries MetaTFT's public patch endpoint before launching the browser. Any patch other than reviewed 18.2 stops before full collection. Full normalization still validates Set 18, queue/filter scope, entity joins, placement histograms, mapping thresholds, duplicates, content hash, future timestamps, collapse thresholds, and exact set/patch compatibility.

Failures are safely classified as network/navigation, endpoint/schema, browser/challenge, normalization/mapping, set mismatch, patch mismatch, or snapshot validation. The Tauri command surfaces only the explicit safe message. No cookies, headers, credentials, or page payloads are exposed in the UI.

Activation continues to write an immutable archive before an atomic `current.json` rename. A failure leaves the last good snapshot untouched.

## Validation record

- `npm.cmd run metatft:refresh`: activated 54 mapped comps for Set 18 / Patch 18.2 from 6,136,962 analyzed boards; the activated content hash revalidated as `fnv1a-a7bef7cb`.
- `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`: passed. Vite retained its existing third-party annotation and large-chunk warnings.
- `npm.cmd test`: 49 files passed, 651 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 84 library tests passed; seven auxiliary binaries, `main`, and doc tests contained zero tests; no Rust failures.
- `npm.cmd run tauri dev`: the desktop executable launched. The live dev frontend's Data & Settings view rendered Set 18 / Patch 18.2, `MetaTFT · Patch 18.2 · Updated …`, 54 mapped comps, the last-good retention note, Riot API controls, and Screen Intelligence controls without console errors after the final reload. The collector was then exercised directly again because native-window input is unavailable to this automation surface.
