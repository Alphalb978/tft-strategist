# M1 implementation report

Implemented on `codex/m1-v1-foundation`, September 5–6, 2026. No branch switch, merge, push, or governing-authority rewrite.

## Built

Tauri 2 / React / TypeScript / Vite application with a dark desktop workflow: three complementary recommendations, four structured source playbooks, stage rosters, item directions, Decision Maps, score/confidence explanations, a library, evidence/settings screen, and saved plan locking. Current-set art and static data are bundled for offline startup. There is no runtime LLM dependency or protected-process functionality.

## Architecture and major modules

| Files / modules | Responsibility and decision |
| --- | --- |
| `src-tauri/` | Native shell, restricted capabilities/CSP, SQL plugin and initial SQLite migration. Ordinary window; no game-process integration. |
| `src/domain/` | React-independent gameplay, evidence, portfolio, lobby, personal and post-game contracts; runtime static-cache schema. |
| `src/providers/communityDragon.ts`, `scripts/refresh-data.ts` | Normalize a reviewed active mutator into stable IDs. Ignore malformed legacy-set objects before active-set validation. Preserve provenance and missing facts. |
| `data/fixtures/`, `public/data/`, `public/assets/tft/` | Reduced real export/provenance, normalized bundle, asset manifest and 57 real art files. |
| `data/playbooks/`, `src/providers/playbooks.ts` | Four attributed structured guide examples; field-level unavailable states. |
| `data/rules/`, `src/rules/` | Versioned structural validation and isolated fail-safe Team Planner contract. Unknown rules do not become defaults. |
| `src/strategy/` | Eleven inspectable score components, independently calculated confidence, exact three-plan portfolio search, weak personal adjustment, end-state post-game comparison. |
| `src/providers/riot.ts`, `src/services/scouting.ts` | Read-only contracts and synthetic fixture provider; bounded parallel history scanner with cache/deduplication, recency/patch weighting, timeout and partial results. |
| `src/storage/`, `src/services/application.ts` | SQLite schemas/repository, browser localStorage fallback, validated cache bootstrap, refresh preservation and immutable selected-portfolio snapshot. |
| `src/app/`, `src/features/`, `src/components/`, `src/styles/` | Actual application screens, reusable artwork, responsive desktop layout, keyboard focus and loading/error states. |
| `src/test/`, `e2e/`, root configuration | Unit/integration tests, Edge UI tests, TypeScript, ESLint, Prettier and reproducible dependency lockfiles. |
| `README.md`, `docs/M1_DATA_SOURCES.md`, `docs/RIOT_SETUP.md`, `docs/V1_5_BACKLOG.md` | Setup, public-source ledger, credential boundary and prioritized next work. |

Portfolio selection enumerates triples and rewards source-tagged item/opening/style coverage while penalizing shared cores. A test proves it excludes the second-highest individual candidate when another triple fits better. Numeric weights remain uncalibrated. Personal influence defaults to 5%, clamps to 5–10%, shrinks small samples, and contributes zero without history.

Native SQLite establishes nine tables for settings/static cache, accounts, completed matches/index, opponent/personal profiles, selections and snapshots. M1 uses a compact key/value repository plus static/selection records; dedicated high-volume repositories remain future work.

## Sources and truth boundaries

Actually used public sources: [Riot patch 18.1](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-1/), [CommunityDragon TFT export](https://raw.communitydragon.org/latest/cdragon/tft/en_us.json), its [listing](https://raw.communitydragon.org/latest/cdragon/tft/) and [asset documentation](https://www.communitydragon.org/documentation/assets), four Mobalytics guides, [Riot TFT API docs](https://developer.riotgames.com/docs/tft), and [tftkit](https://github.com/nkhoit/tftkit) as a Team Planner research lead. Exact guide links and limitations are in [the source ledger](M1_DATA_SOURCES.md).

- **Source-verified:** Set 18 identity and exported IDs, costs, traits, non-null thresholds, item composition and art references. Bundle: 74 unit records (including Avatar forms), 36 traits, 502 item/special-object definitions and 254 augment definitions. This does not certify all objects as live/equippable.
- **Guide-curated:** Adaptors, Solar & Elderwood, AP Summoners, and Final Forest rosters, source-supported early/mid boards, primary roles/items, broad routes and play/avoid signals. All begin Experimental; no measured outcome sample exists. Contradictory Solar/Elderwood early XP guidance was withheld. Fast 8 AP route and nine-unit final roster are distinguished; no level-eight cut was invented.
- **Seeded:** Score/risk inputs, weights, coverage taxonomy, core criticality, contest elasticity and the Decision Map's reassess-navigation action. UI explicitly labels seeded scores; these are not win probabilities.
- **Unverified/unavailable:** August 29 static export parity with subsequent hotfixes; enabled augments; special unit/trait modifiers; level capacity, shop/pool/economy/star rules; exact timing, stabilization cuts, positioning, substitutes, alternatives and actionable pivots. Missing Eclipse threshold stays missing.

## Checks actually executed

| Command / action | Result |
| --- | --- |
| `npm install` | Passed; dependencies installed, audit reported zero vulnerabilities. |
| `npm install -D prettier@3.6.2` | Passed. |
| `npm run data:refresh` | Passed: normalized counts above, 57 assets, zero failed assets. |
| Full 24 MB public export download + `npx tsx -e ... normalizeCommunityDragon(...)` | Passed against the complete payload, not only the reduced fixture. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm test` | Passed: 39 tests across six files. |
| `npm run build` | Passed: production Vite bundle, approximately 335 KB JavaScript / 103 KB gzip and 24.6 KB CSS. |
| `npm run format` / `npm run format:check` | Passed. |
| `npm run test:ui` | Six Edge tests passed: art/detail/planner/lock/reload, refresh failure/settings persistence, 1000/860 layouts, offline external network, loading/error/retry. |
| `npm run dev` | Launched successfully on `http://127.0.0.1:1420`. |
| `npm run tauri icon src-tauri/icons/app.svg` | Generated native icon assets. |
| Official rustup minimal install, isolated under ignored `.cache/` | Passed; Rust 1.98.1 MSVC installed without permanent PATH changes. |
| `npm run tauri build -- --debug --no-bundle` | Passed after resolving disk space and a required direct `serde_json` dependency. Executable: `D:\CodexBuildCache\tft-strategist-m1\target\debug\tft-strategist.exe`. Debug build only; no signed installer claimed. |
| `cargo clean --manifest-path src-tauri/Cargo.toml --target-dir <verified project target>` | Removed 309.8 MiB of this task's partial output after C: ran out of space; retry uses `CARGO_TARGET_DIR`, `TEMP` and `TMP` under `D:\CodexBuildCache\tft-strategist-m1`. |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` (isolated toolchain) | Passed after adding the official rustfmt component and formatting Rust sources. |
| Native launch through Computer Use | Passed: window titled TFT Strategist, full Home content returned by native accessibility, no startup error state. |
| Read-only `node:sqlite` inspection of the created native database | Passed: all nine application tables exist and SQLx migration version 1 has `success = 1`. |
| `git diff --check` | Passed during implementation. |

First-pass issues fixed include a null exported trait threshold, malformed unrelated legacy export records, source item curation mismatch, Windows PATH casing in the Tauri wrapper, the generated Tauri configuration's direct `serde_json` dependency, cache/snapshot validation, readable detail sizing and safe library lock states. Build emits benign upstream Zod pure-comment warnings; Node's SQLite test API is experimental.

## UI inspection

Ran the real app and inspected rendered Home, playbook stages/items/Decision Map/pivots, and Data & settings in the in-app browser. Reviewed saved Edge screenshots at 1440, 1000 and 860 pixels and the error state. Real art loads, three plans remain legible, no horizontal overflow was detected at tested desktop widths, and unsupported planner status is obvious. Keyboard-focus styling is present. Browser tests also verify all visible art with external requests blocked and failed-load recovery. A manual live refresh fetched the full public export successfully, displayed Network provenance, and a subsequent reload restored three plans from Local cache. Screenshots are retained locally under ignored `artifacts/`.

Native executable launched successfully. The native accessibility tree exposed all three recommendation cards, champion labels, scores, confidence and navigation. The native screenshot tool failed with Windows `SetIsBorderRequired` / unsupported-interface error, so native pixel-level inspection is not claimed. Subsequent native input control was also unavailable; browser interaction/visual checks cover the shared frontend. The SQLite database was independently inspected read-only and the migration succeeded. Native saved-selection interaction remains part of human release smoke testing.

## Support, risks and next task

**Team Planner:** Unverified, Copy disabled, encode fails safely. No speculative code or claimed fixture. Public implementation research is insufficient without accepted current-set ID mapping/fixture and manual paste in the actual client. That manual paste remains a human gate.

**Opponent scouting:** Provider/service contracts and fixture-backed scanner are implemented. Default 15 relevant games per opponent, configurable 10–20; up to seven opponents, three workers, recent-ID cache, shared-match deduplication, recency/patch awareness and partial-confidence output. No `RIOT_API_KEY` was present and no secret values were read or logged. No authenticated adapter, live lobby discovery, production rate limiter, or UI account connection is claimed. Setup is documented.

Remaining risks are evidence quality and missing current rules, native distribution signing/installers, live API access/rate limits, persistent production match repositories, and measured calibration. C: remains low on space; future native commands should reuse the D: build/temp paths documented in README. Post-game association/summary is a contract and deterministic first pass; there is no completed-match import UI yet. Human product review and Team Planner client acceptance remain outstanding.

**Recommended next task:** Audit current-set rules and playbook evidence, add verified fixtures and measured match samples, then implement the native read-only Riot identity/history adapter with manual lobby identities, rate-limit handling and persistent caches. See [V1.5 backlog](V1_5_BACKLOG.md) for ordered acceptance goals.
