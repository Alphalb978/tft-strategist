# M8 Implementation Report — Selected Plan & Match Workflow

Date: 2026-09-06  
Branch: `codex/m8-selected-plan-match-workflow`

## Outcome

M8 turns the M7 selected-plan snapshot into one durable, explicit match-plan session. A user can lock a current portfolio plan, reopen its exact local playbook after navigation or restart, retain manual stage and Decision Map progress, inspect an M7-supported pivot destination, switch through an auditable replacement transition, and end without deleting history needed by M9.

The active playbook reuses the M7 board, quick strip, stage, item-holder, Decision Map and pivot components. It adds an `Active plan` navigation affordance, resume banner, compact match header, explicit switch/end actions and a historical/stale treatment. M4/M5/M6/M7 scoring and evidence derivation are not changed.

Team Planner remains explicitly disabled and unverified. No encoder or clipboard write path was added.

## Session schema and version

- Schema: `PLAN_SESSION_SCHEMA_VERSION = 1`.
- Fingerprint namespace: `match-plan-session-v1`.
- Stable record identity: random UUID, preserved for the session's lifetime.
- State: `active | ended`.
- End reason: `replaced | ended-without-result`.
- Times: immutable `lockedAt`; nullable `endedAt`.
- Transition links: `replacesSessionId` and `replacedBySessionId`.
- Selected identity: registry ID, playbook ID, family ID, source kind, lifecycle and structural fingerprint.
- Compatibility: separately mutable `current | stale`, evaluation time and deterministic reasons.
- M9 field: nullable `reconciliation.matchId` plus the lock/end time window and optional ordinary Riot ID/platform context.

The immutable `snapshot` stores:

- complete selected M7 `Playbook` and scored `RecommendationCandidate`;
- the complete three-plan `RecommendationPortfolio`, portfolio version, candidate IDs and selected rank;
- normalized static display data plus `static-set-compatibility-v1` fingerprint;
- strategy schema/guidance version, lock-time status and static/target/registry fingerprints;
- M5 aggregate dataset identity and portfolio-family statistics when present;
- M6 discovery dataset identity and portfolio cluster evidence when present;
- compact M4 lobby coverage/version/timing summary when present; candidate contest components already retain the non-PII pressure result;
- verified Team Planner metadata only if every support gate is satisfied; this is `null` in M8.

No API key, auth header, provider credential or raw opponent profile/history is stored. Optional account context is limited to the already configured Riot ID and platform.

## Lock, switch and end semantics

### Lock

Lock accepts only one of the current three portfolio candidates. It resolves the validated registry entry, re-runs current-set playbook legality, rejects stale strategy guidance, clones the full snapshot, fingerprints it, persists immediately, and opens the active view. Both application logic and storage reject a second independent active session.

### Switch

The destination is inspected before the user presses `Switch to this plan`. A switch creates a new snapshot; it never changes the original session's selected plan or evidence. Manual stage, Decision Map and pivot state starts from the destination defaults. The predecessor becomes `ended/replaced`, both records are linked, and exactly one successor is active.

Browser and memory repositories replace the single versioned session envelope in one write. SQLite uses one successor insert plus M8 triggers: the successor must name the current active predecessor, the predecessor payload is ended and linked inside the same statement, and the unique partial index enforces at most one active row.

### End

`End session` changes the active record to `ended/ended-without-result`, adds `endedAt`, and removes only the active pointer. The record and immutable snapshot remain available for M9.

## Snapshot immutability and compatibility

`planSessionSnapshotFingerprint` covers the full snapshot. Repository create/update/replace methods validate the fingerprint; browser/memory updates also compare the stored snapshot byte-for-byte. SQLite has a `BEFORE UPDATE` trigger that rejects any changed snapshot or snapshot fingerprint.

Recommendation recomputation, settings changes, M4 lobby scans, M5 meta refreshes, M6 discovery refreshes and static refreshes operate on current application state. They do not rewrite an active snapshot.

Compatibility is evaluated separately against:

- active set;
- semantic static-data fingerprint;
- registry availability and structural fingerprint;
- strategy guidance version, target and registry fingerprints;
- current guidance freshness.

An incompatible session remains visible using its saved static/playbook evidence, is labeled historical/stale, keeps Team Planner disabled, and links back to current recommendations. It is never substituted with a current family or board.

## Persistence and restart behavior

Storage is local through the existing repository architecture:

- Tauri: `plan_sessions` SQLite table from migration 3;
- browser development/Playwright: `strategist:v1:plan-sessions` local-storage envelope;
- tests/benchmarks: the same repository contract in memory.

The saved playbook, portfolio and display-static snapshot are sufficient to render without a Riot, CommunityDragon or strategy-source request. Normal startup prefers compatible cached/bundled current data for compatibility evaluation; if current static loading fails, a valid active session's saved static snapshot is an offline fallback. The optional art manifest is non-blocking.

An existing valid M7 `selection` value is upgraded once when no M8 active session exists. The legacy portfolio/evidence is preserved; fields that M7 never stored, such as a separate lock-time static snapshot, necessarily use the compatible current local static data during migration.

## Active-plan and manual-state UX

- Sidebar `Active plan` item with a non-color-only label and small status dot.
- Resume banner on current plans, comp library and data/settings routes.
- Active header shows lock time, portfolio rank, local/offline status and `End session`.
- Stale header explains that the exact historical snapshot is being shown.
- Existing M7 target board and quick strip remain first, followed by stage/roll, items, Decision Map and pivots.
- Destination playbooks show `Switch to this plan`; the selected plan shows `Plan active`.

Only these manual fields persist: selected stage, current Decision Map node, complete validated Decision Map edge path and optional inspected portfolio pivot target. Application validation rejects stages, paths, nodes or pivot targets outside the locked playbook/portfolio. Switching resets all manual fields.

## M7 pivot integration

The active view builds the existing `portfolio-pivot-v1` graph from the frozen three-plan portfolio. It shows the existing source/derived reasons and transition cost. Clicking a destination opens its existing M7 playbook; switching requires a separate explicit button and produces a new session. M8 adds no pivot-strength inference.

## Team Planner research and support state

Directly inspected public evidence on 2026-09-06:

1. Riot's public `/Dev: Quality of Life Improvements` confirms that Team Planner Codes are copy/paste codes, but does not document the wire format: <https://teamfighttactics.leagueoflegends.com/en-au/news/dev/dev-quality-of-life-improvements/>.
2. CommunityDragon currently exposes Riot's public team-planner dataset path: <https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json>.
3. The public `nkhoit/tftkit` repository claims Set 18 uses a version-2 shape with ten 12-bit planner IDs and a set suffix: <https://github.com/nkhoit/tftkit>. This is useful candidate evidence, not an independent fixture or a human verification for TFT Strategist.
4. A public 2024 gist documents the older Set 13 version-1 shape and CommunityDragon mapping approach: <https://gist.github.com/xrr2016/22fa6e92278a2481f9026f6456b0afa4>. It does not verify Set 18.

The runtime contract is now `team-planner-support-v2` and records state, candidate format version, mapping/fixture/manual-paste gates and fixture IDs. Set 18 reports `unverified` with candidate format `candidate-v2-public-claim`.

Support remains disabled because:

- the repository's audited Set 18 static fixture contains zero normalized planner IDs;
- no independently sourced known-good Set 18 code with expected unit/slot semantics is checked in;
- no manual paste into the current real TFT client has been performed by the human;
- no client-side result is available to verify special/runtime forms and Set 18 slot semantics.

Known-good fixture status: none.  
Manual current-client paste status: not performed.  
Encoder/decode status: not implemented.  
Clipboard behavior: the visible button is disabled with the exact missing acceptance evidence; no clipboard API is called and no code is produced for current, stale, unpositioned or unsupported boards.

## M9 reconciliation handoff

M9 can match completed Riot games against the immutable session using session ID, lock/end window, optional Riot ID/platform, selected registry/family/playbook snapshot, portfolio version/candidate IDs, M4/M5/M6 evidence identities and nullable `reconciliation.matchId`. Associating a match later updates only the outer reconciliation field; it need not rewrite M8 history or infer live state.

M8 does not attribute placement, coach the game or update the personal model.

## Storage and migration

Migration 3 adds:

- `plan_sessions(id, state, locked_at, ended_at, payload, match_id)`;
- unique partial index `one_active_plan_session`;
- reconciliation-window index over lock/end/match;
- replacement-predecessor validation trigger;
- atomic predecessor-end trigger;
- immutable-snapshot update trigger.

Existing M5/M6 settings/cache tables and immutable Riot match tables are unchanged. The old `selected_plans` table remains intact for historical/backward compatibility; no destructive reset occurs.

## Validation results

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test -- --run`: passed, 123 tests in 12 files (9 M8 workflow tests plus SQLite migration/trigger coverage).
- `npm run build`: passed; only existing third-party Zod annotation and bundle-size warnings.
- `npm run test:ui`: passed, 24 Playwright tests including the full M8 flow at 1440, 1000 and 860 px.
- `npm run benchmark:m8`: passed; representative final fixture values were lock 21.30 ms, persist 12.93 ms, local resume 1.88 ms/op, manual update 1.82 ms/op and switch 32.25 ms for a 545,137-byte offline-capable snapshot. Gates are 50/50/5/5/75 ms respectively.
- `git diff --check`: passed (only Git's expected LF→CRLF working-copy notices).
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed with the isolated toolchain and documented D: target/temp policy.
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed, 5 native tests.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- `npm run tauri build -- --debug --no-bundle`: passed; executable at `D:\CodexBuildCache\tft-strategist-m1\target\debug\tft-strategist.exe`.

Final regression benchmark run:

| Benchmark                                                    |                                 Result |
| ------------------------------------------------------------ | -------------------------------------: |
| M3 1×10 cold                                                 |                                9.19 ms |
| M3 7×20 cold / warm immutable / warm profile                 |                  4.50 / 3.69 / 3.40 ms |
| M3 partial timeout                                           |                 36.56 ms, 43% coverage |
| M4 warm acquisition / profile+pressure / candidate+portfolio |                 2.98 / 9.99 / 63.44 ms |
| M5 8,000-board classification / statistics                   |                       138.54 / 7.68 ms |
| M5 aggregate cold / warm                                     |                         1.86 / 0.84 ms |
| M6 canonicalize 20,000 / similarity 100,000                  |                     463.39 / 391.74 ms |
| M6 cluster 1,000 / 8,000 / 20,000                            |            153.43 / 494.94 / 957.01 ms |
| M7 load / validate all guidance                              |                43.9028 / 41.0470 ms/op |
| M7 Decision Map / pivot graph / board fingerprint            |         0.0010 / 0.0219 / 0.0038 ms/op |
| M8 lock / persist / resume / manual / switch                 | 21.30 / 12.93 / 1.88 / 1.82 / 32.25 ms |

## Rendered inspection

Playwright and direct screenshot inspection at 1440, 1000 and 860 px exercised lock, visible active state, navigation/resume, full reload, persisted stage, portfolio destination inspection, explicit switch, predecessor history, stale static/guidance compatibility, disabled Team Planner, end and post-end current plans.

The active header, stale notice, board, quick navigation and actions remain readable at the 860 px Tauri minimum. Document and main content have no horizontal overflow, and the inspected runs emitted no browser page errors. Captures are written to `artifacts/m8-stale-active-*.png` and `artifacts/m8-ended-*.png` (plus focused active captures in the final pass).

## Remaining gaps and recommended next milestone

- Team Planner cannot be enabled until a reviewed Set 18 planner-ID mapping is normalized, independent known-good codes define unit/slot semantics, and the human records a successful current-client paste.
- Browser local storage provides single-app deterministic enforcement but cannot provide cross-tab transactional locking comparable to SQLite; the shipped Tauri path uses SQLite enforcement.
- M8 retains session history but intentionally has no history browser; M9 should add completed-match reconciliation and only the minimal review surface needed for that workflow.

Recommended next milestone: M9 completed-match reconciliation and evidence-bounded post-game review, using `reconciliation.matchId` without mutating the M8 lock snapshot.
