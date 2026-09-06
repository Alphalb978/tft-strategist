# M10 — V1 release candidate report

Date: 2026-09-06  
Branch: `codex/m10-v1-product-polish-hardening`  
Version: `1.0.0-rc.1`  
Status: Current Meta V1 completion pass implemented. The human Team Planner gate is closed; live meta population and packaged acceptance remain human follow-ups. No commit, push, or merge performed.

## Scope and baseline audit

All three M10 task packets governed this work. The continuation instruction superseded native screenshot capture: visual work used the real React application in Playwright, deterministic fixtures, and the supplied Blitz/MetaTFT screenshots. No further competitor browsing or Windows capture debugging was used.

The baseline was run before editing. Captures are preserved in `artifacts/m10-baseline/`. The prioritized audit was:

1. **Usability/correctness:** the normal lobby workflow required too much manual entry; session termination/switching and post-game relinking needed explicit confirmation; disabled planner support lacked a concrete verification path.
2. **Hierarchy:** plan cards were too tall to compare quickly. A large empty positioning board competed with the useful roster. Settings exposed technical details before product controls.
3. **Visual quality:** text was small, surfaces and spacing varied, and secondary sections resembled reports. Champion recognition needed more emphasis.
4. **Consistency:** navigation, buttons, selected states, status treatments, and section spacing needed shared tokens.
5. **Friction:** account discovery and history scan were separate steps; active-session next actions were buried; review results required reading too much prose.
6. **Responsive/accessibility:** compact widths needed a narrower shell, reliable text wrapping, focus-visible controls, and keyboard-safe dialogs.
7. **Copy:** repeated implementation explanations obscured the few statements that genuinely convey evidence limitations.

Preserved the existing deterministic portfolio, M3/M4 scanner, measured-evidence gates, current-set membership, M7 guidance provenance, M8 immutable snapshots, M9 terminal attribution and weak personal influence. No new gameplay rules, positions, or performance claims were invented.

## Product changes

- **Shell:** compact desktop navigation, dedicated Scouting route, visible Active plan state, persistent Resume banner, quieter footer and explicit known-stale combat-data status. The minimum-width shell retains accessible navigation names while showing icons.
- **Your plans:** three horizontal roster-led recommendations with rank, portfolio role, source/lifecycle, score, confidence, measured outcomes when present, historical contest and one reason. Deeper portfolio explanations remain expandable. The first-run strip points to account setup while preserving offline planning. All three choices fit in the 860 × 1000 acceptance viewport.
- **Comps:** dense catalog rows with recognizable full rosters, search/filter/sort, source/lifecycle distinctions, measured statistics, and a clear-filter empty state. Experimental status does not imply measured strength.
- **Playbook:** compact target roster when positioning is unverified; sourced exact positions retain the board renderer. Stronger quick strip, stage route, item-holder sections, Decision Map and pivot presentation; sticky local navigation. Detailed score/evidence is secondary. Missing guidance remains visibly unavailable.
- **Active plan:** current manual stage and current decision appear near the top, with direct navigation. End and switch actions require confirmation. Session evidence and fingerprints remain immutable.
- **Post-game:** placement, final family, structural similarity, core presence/missing units and final roster lead. The compatible baseline or unavailable state and a supported adjustment/no-adjustment statement are explicit. Attribution and diagnostics are expandable. Link/unlink/reject require confirmation, and failed loads offer retry.
- **Settings:** Appearance and Riot account first in both visual and DOM order, followed by current data, discovery, and recommendation defaults. Connection routes and the verification ledger are expandable. The normal scan action has stronger emphasis than manual fallback.
- **Interaction hardening:** synchronous busy guards protect duplicate scan/session/reconciliation actions; account and opponent inputs cannot change during a scan. Static/meta refreshes cannot overlap. Safe provider auth/rate-limit messages survive the automatic-discovery error path. Toasts use a neutral information icon so a failure is not shown with a success check.

Copy was reduced by replacing repeated paragraphs with concise state labels and moving detailed provenance below the decision surface. Domain-authored guidance was retained rather than rewritten into unsupported TFT advice.

## Appearance and accessibility

`src/app/appearance.ts` owns Gold, Blue, Teal and Purple accents and Navy, Charcoal and Near-black backgrounds. `src/styles/product.css` centralizes the main surfaces, accent, text, focus, spacing treatment and semantic status colors. Appearance is stored separately under `strategist:appearance:v1`; it cannot alter scoring, gameplay data or session snapshots. Applying a preset is immediate; reset restores Gold/Navy. Invalid JSON/unknown values safely default. A storage failure keeps the current preview usable and explains that it was not saved.

Keyboard controls have visible focus, route buttons retain meaningful names at 860 px, statuses have text labels, and native HTML dialogs handle Escape, cancellation and focus return. Settings DOM order matches its visual order. Unit tests verify accent contrast above 4.5:1 across all preset surfaces and dark primary-button text. This is targeted contrast verification, not a claim of a complete screen-reader/WCAG audit. Existing reduced-motion treatment remains active.

## Automatic current-lobby discovery

`src/services/currentLobby.ts` composes the existing official native provider with the existing history store. The flow is configured Riot ID → cached/fresh official account identity → spectator TFT current game → exclude self and duplicate/empty PUUIDs → at most seven official opponents → existing M3 `scanLobby` → M4 aggregate historical unit pressure → portfolio.

Own-account cache reuse is bounded to 24 hours. Identity and participant-name lookups use an eight-second deadline; missing public display names do not discard official PUUIDs. The history pipeline retains its own eight-second partial-result budget, shared-match deduplication, profile/index/match caches, recency weighting and confidence semantics. These are sequential bounded stages, not a claim that the entire cold operation is limited to eight seconds.

A full fixture finds seven opponents and 140/140 relevant historical games. A three-opponent fixture reports 60/140 and 43% coverage, rather than claiming a complete lobby. Automatically discovered identity, manual fallback, and historical/cached evidence are distinctly labeled. No live boards, shop, items, intent or protected-process state are inferred.

Supported platforms use the existing `SPECTATOR_TFT_PLATFORMS` allowlist; PH2 and TH2 remain unsupported by the audited route contract. No active game, hidden/no visible identities, unsupported routes and API failures explain manual fallback/retry. A missing key leaves local planning available. Manual entry still needs valid API access to acquire uncached history; it does not bypass credentials or turn arbitrary text into evidence.

**Product policy remains a separate release constraint.** The [Riot TFT developer policy](https://developer.riotgames.com/docs/tft) restricts opponent-history/lobby-stat display during gameplay/loading. Public API availability is not product-policy approval. M10 documents that distinction in the interface and here; it does not claim an approved live-game deployment. No key was available during the initial M10 pass. The later bounded Current Meta native validation is recorded below; automatic lobby discovery and its failure paths retain their fixture/native-regression evidence.

## Team Planner audit and human test

Public mapping source: [CommunityDragon team-planner dataset](https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json). Retrieved 2026-09-06; full response SHA-256 `4045ed79bd1b4b95503752916b9476292e88e86533781ee103e5c451e3cca307`. The normalized, directly joined mapping is in `data/rules/set18.teamplanner.json`. Public format documentation was checked in [tftkit Team Planner codes](https://github.com/nkhoit/tftkit#team-planner-codes), including `000` as an empty slot.

The human-supplied independent wire fixture is stored in `data/fixtures/set18-teamplanner-blitz.json`:

```text
023eb3ff3ed40140440b4153fb430000TFTSet18
```

The decoder preserves ten exact slots: `3eb 3ff 3ed 401 404 40b 415 3fb 430 000`. Re-encoding reproduces the supplied string exactly. Publicly matched names in order are Alistar, Ezreal, Amumu, Gnar, **unresolved**, Kennen, Maokai, Draven, Taric, empty.

**The public dataset does not map `404` / 1028.** It must not be guessed as Ivern: the retrieved public Ivern ID is 1029 / `405`. This is a genuine external-fixture/mapping discrepancy, not a successful full roster verification. The fixture verifies wire behavior independently; it does not verify that missing identity.

The mapping contains 65 directly inspectable entries: 64 eligible current-set units and a noneligible Lux base placeholder. The nine runtime Lux origin forms have no independently preserved mapping here. Encoding rejects Lux-origin rosters, placeholders, unknown/runtime forms, duplicate units, wrong sets and excess capacity. A static compatibility fingerprint fails closed when active gameplay data changes. Code slots express roster order, not positioning, star level, or items.

### Human-verified current-client fixture

The human pasted this exact code into the current real TFT client and confirmed the ordered roster and two empty slots on 2026-09-06:

```text
0241b40e41642443742a40f43a000000TFTSet18
```

Expected ordered roster:

| Slot | Hex | Champion  |
| ---- | --- | --------- |
| 1    | 41b | Nidalee   |
| 2    | 40e | Kog'Maw   |
| 3    | 416 | Master Yi |
| 4    | 424 | Rengar    |
| 5    | 437 | Vi        |
| 6    | 42a | Sett      |
| 7    | 40f | Krug      |
| 8    | 43a | Yorick    |
| 9    | 000 | Empty     |
| 10   | 000 | Empty     |

**Observed filled slots: 8.** This fixture has no Lux ambiguity. It is retained in `data/fixtures/set18-teamplanner-human.json` and regression-tested against the Adaptors playbook. The user supplied successful current-client verification; no client build number or screenshot was invented.

Copy Team Code is now enabled when the audited static fingerprint and every roster mapping pass. `manualPasteVerified` is true with the human evidence recorded. New immutable plan snapshots include the verified roster code and fixture IDs. Existing snapshots remain unchanged. Lux rejection, unresolved `404`, unknown/runtime-form rejection, capacity/duplicate guards and stale-snapshot disabled reasons remain. No positioning is encoded or invented.

## Persistence, recovery and release package

Package metadata is `1.0.0-rc.1`; product title is TFT Strategist. The existing original S/hexagon icon is retained. Identifier `local.tft-strategist.desktop`, storage locations, and all four existing SQL migrations are unchanged. No history migration or data deletion was introduced.

The optimized executable and x64 NSIS installer were built. Copies for human testing are in `artifacts/release/`:

- `tft-strategist.exe` — direct executable; WebView2 is required.
- `TFT Strategist_1.0.0-rc.1_x64-setup.exe` — Windows installer.
- `SHA256.json` — hashes of those exact files.

**Unsigned**: no signing identity was supplied. NSIS generation and hash verification of its downloaded build tools succeeded. The installer itself was not installed/uninstalled on the user's machine; clean installation, SmartScreen/signing experience and uninstall behavior remain human checks.

The built release executable was launched, confirmed responsive, closed through its normal close request, and reopened. The existing database at `%APPDATA%\local.tft-strategist.desktop\strategist.db` had integrity `ok` before and after. All table counts and every row were preserved, including 231 Riot completed matches, 10 opponent profiles and seven scan snapshots. Four migrations remained applied. A local SQLite backup was retained under ignored validation artifacts before the smoke test. No keys or record contents were printed.

One manually renamed executable copy remained running after two normal close requests and was stopped for cleanup. The identical final binary, supplied under its original `tft-strategist.exe` filename, subsequently started, responded and exited normally. The cause of the renamed-copy behavior was not established; no native lifecycle code was changed to mask it. Check normal close after installation on the target machine.

Native process/storage smoke is distinct from visual acceptance: no native screenshot or accessibility capture was attempted. Clean first-run, locked/offline restart, settings persistence, corrupt derived-cache fallback, stale snapshot, ambiguous review and storage-failure interactions were exercised in browser/unit fixtures. A real packaged active-session walkthrough remains a human check because the existing native database had no active session and this run did not fabricate one into user history. Restart intentionally opens Your plans with a Resume banner; URL route persistence is not implemented.

## Performance evidence

Profiled before changing loading behavior. A 558.13 KB main production chunk justified loading Playbook, Comps, Settings and Post-game as separate views. React transitions retain the prior view during lazy navigation. With no lobby pressure, the application reuses its already-computed portfolio rather than scoring it again on every state change. No scoring formulas changed.

| Measurement                               |    Before |     Final |
| ----------------------------------------- | --------: | --------: |
| Main production JavaScript                | 558.13 KB | 495.25 KB |
| Main JavaScript gzip                      | 163.47 KB | 145.71 KB |
| CSS                                       |  76.87 KB |  76.87 KB |
| First plans, Vite/headless Edge           |  637.7 ms |  624.6 ms |
| Median library/home round trip, five runs |  120.4 ms |  145.3 ms |
| Median reload/resume, five runs           |  540.1 ms |  605.0 ms |

Browser timing includes Playwright, local Vite compilation and scheduling; it is not a controlled packaged-startup benchmark. The split reduces initial shipped bytes (~11%) and removes the >500 KB warning, but **does not establish a navigation/resume speedup**. Initial lazy-route loading has a cost. Captured browser session storage contained 716,589 characters; the M8 domain benchmark's immutable snapshot remains 545,362 bytes. Screenshots now wait for image decoding and CSS transitions so partially streamed PNGs are not mistaken for missing art. Fixed portrait frames prevent image-driven reflow; failed art retains named fallbacks.

M3–M9 benchmarks were run without changing gates:

| Benchmark | Result                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3        | Seven × 20 cold: 27 requests, 20 details, 120 shared deduplications; warm profile/index: zero requests, 27 cache hits; partial scenario 43% coverage |
| M4        | Warm acquisition 3.34 ms; profiles/pressure 12.32 ms; candidate/portfolio 75.18 ms; zero network requests                                            |
| M5        | 8,000 boards classification/statistics 148.15 ms; warm collection 1.00 ms with zero detail requests                                                  |
| M6        | 20,000-board clustering 1,019.61 ms; no pair budget reached; 19 clusters                                                                             |
| M7        | Load all 13 entries 46.11 ms/op; validate 41.89 ms/op; Decision traversal 0.0011 ms/op                                                               |
| M8        | Lock 26.72 ms; persist 21.53 ms; resume 2.72 ms; manual 2.24 ms; switch 37.15 ms; all gates pass                                                     |
| M9        | Idle rerun: 500 reviews 1,601.69 ms; 100 warm loads 498.50 ms; all gates pass                                                                        |

The first M9 run, concurrent with rendering, failed its warm-history gate at 644.11 ms (review derivation 1,814.96 ms). The renderer-idle rerun passed; both logs are retained. The warm-load result is close to the existing 500 ms budget and should be watched on ordinary hardware. No gate was loosened and no domain rewrite was made to chase timing noise.

## Visual acceptance and iterations

Baseline → iteration 1 → iteration 2 → final render. The second pass corrected catalog-card minimum-height specificity, roster image sizing, action wrapping and narrow-screen layout. The final pass corrected screenshot timing, settings tab order, manual-action emphasis and provider-failure clarity. Original and intermediate captures remain available in `artifacts/m10-baseline`, `artifacts/m10-iteration1`, and `artifacts/m10-iteration2`.

Final renders at **1440, 1000 and 860 px** cover:

| State                                       | Artifact pattern under `artifacts/`                               |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Default/offline-ready plans                 | `m10-final/plans-{width}.png`                                     |
| Strong fixture evidence                     | `m10-states/plans-strong-{width}.png`                             |
| Partial lobby + measured fixture evidence   | `m10-states/plans-partial-scout-{width}.png`                      |
| Scan loading/partial/complete               | `m10-states/scan-loading-*`, `scan-partial-*`, `m10-final/scan-*` |
| No current game, auth rejection, rate limit | `m10-states/not-in-game-*`, `expired-key-*`, `rate-limit-*`       |
| Catalog default / filtered                  | `m10-final/catalog-*`, `m10-final/catalog-filtered-*`             |
| Covered / partial playbooks                 | `m7-covered-*`, `m7-partial-*`                                    |
| Discovered structure                        | `m6-detail-*`                                                     |
| Active / historical active                  | `m8-active-*`, `m8-stale-active-*`                                |
| Unmatched / ended session                   | `m10-final/history-*`, `m8-ended-*`                               |
| Matched / ambiguous / mature sample         | `m9-matched-*`, `m9-ambiguous-*`, `m9-mature-stale-*`             |
| Settings and persisted alternate theme      | `m10-final/settings-*`, `m10-theme-settings-*`                    |
| Offline alternate-theme resume              | `m10-theme-active-*`                                              |
| Failed local load/retry                     | `error-state.png`                                                 |

Rendered images were personally inspected across these states for hierarchy, wrapping, control clarity, roster recognition, status visibility and overflow. The render scripts assert no horizontal main overflow. Tests also verify minimum-width controls and disabled/confirmation behavior. Some workflow screenshots deliberately show a scrolled Decision Map or review; top-of-page route captures are in `m10-final/`.

All strong/mature/partial fixtures are synthetic acceptance evidence. Their displayed win rates and placements are **not current live TFT meta claims** and were not written to the native user database. Human visual acceptance at real Windows scaling remains open.

## Commands and checks actually run

- `npm run typecheck`, `npm run lint`, `npm run format`, `npm run format:check`.
- `npm test`: **146 tests in 14 files pass** (11 new M10 unit tests).
- `npm run build`: production web build succeeds; only upstream Zod annotation warnings remain.
- `npm run test:ui`: **32 tests pass** in the complete browser suite; M10 adds width-specific automatic discovery/theme/offline/confirmation coverage and safe API-failure coverage.
- `npm run benchmark:m3` through `npm run benchmark:m9`; M9 idle rerun as documented above.
- `node scripts/profile-m10.mjs before`, `after`, `final`.
- `node scripts/render-m10.mjs iteration1`, `iteration2`, `final`; `npx tsx scripts/render-m10-states.ts`.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo test --manifest-path src-tauri/Cargo.toml` (**5 native tests pass**), `cargo check --manifest-path src-tauri/Cargo.toml`.
- `npm run tauri build -- --debug --no-bundle`; `npm run tauri build -- --bundles nsis`.
- Release process launch/normal close/reopen; SQLite backup, integrity and before/after row comparison; Authenticode status and SHA-256 hashing.
- `git diff --check`; working-tree/branch review.

Native commands used the existing repo-local Cargo/Rustup caches and `D:\CodexBuildCache\tft-strategist-m1\target` / `tmp` to avoid filling C:. No native source or SQL schema changed. Build and benchmark logs are in `artifacts/m10-validation/`.

## Remaining human gates

1. Populate a larger live meta sample with native Riot API access using an explicit bounded refresh. No key was available during this follow-up, so the large samples below are fixtures. Team Planner manual validation is complete.
2. Judge the final UI at 1440/1000/860 and Windows 100–150% scaling, including keyboard focus, long labels, dialogs, and the four accents/three backgrounds.
3. Run the installer and test clean install/upgrade/uninstall behavior. Check launch without API access, configure native API access without saving a key in the app, and complete a real packaged lock → manual stage/Decision Map → close/reopen → end → reconcile path.
4. With an available supported current game and valid key, verify seven-opponent public spectator discovery plus partial/manual fallback. Resolve the documented Riot product-policy restrictions before broader distribution; technical endpoint success alone does not close that gate.
5. Keep current-data limitations visible: combat-value parity is known stale, some public guide sections/positions are unavailable, discovery begins Experimental, and Lux planner origins plus the external `404` identity remain unresolved. No runtime LLM is required.

The deliverable is a buildable, tested release candidate for human review and in-client testing, not a claim that those human/product-policy gates have been completed.

## Current Meta V1 completion pass

This section supersedes the earlier M10 collection-size, planner-gating, test-count and package measurements. Existing M10 UI, themes, automatic scouting, session safety and all prior work were preserved. The implementation remains uncommitted on the same branch.

### Architecture and providers

The same M5 collector now feeds both family aggregation and the existing M6 discovery engine. There is no second meta engine or third-party feed. `RiotProvider` supplies documented ladder and completed-match operations through the existing native boundary; `HistoryStore` supplies immutable shared match payloads; CommunityDragon remains identifier/art/set truth. Provider source is explicit, including fixture versus Riot evidence.

A bounded public-source search found no independently verified, current, permitted statistics feed suitable to integrate. No private competitor APIs, authenticated scraping, companion internals, protected process access, or copied competitor statistics were used. Source checks used the [official TFT API catalog](https://developer.riotgames.com/apis#tft-league-v1), [Riot's API limits and response guidance](https://developer.riotgames.com/docs/portal), and [Riot's queue catalog](https://static.developer.riotgames.com/docs/lol/queues.json). Queue 1100 is the ranked TFT filter for the new collection path. Missing queue IDs, other modes, future dates and other sets are excluded rather than guessed.

### Scope and collection budgets

Supported cohorts are Challenger, Grandmaster+ and Master+, using the documented high-ladder endpoints. Diamond+, Emerald+ and Platinum+ are explicitly unavailable in this V1 acquisition path; no fake lower-rank filter exists. The native provider can inspect up to 500 entries per tier; Standard/Deep rotate a bounded slice through that ordered sample. This is an upper-ladder convenience sample, not a random census of everyone at those ranks. Duplicate ladder identities across tiers are removed.

Region selection uses the existing platform-to-regional routing map. EUN1/EUNE, EUW1, NA1 and KR are among the supported choices. PH2 and TH2 are omitted because their route support remains unverified in this repository. No combined/global sample is claimed. Windows are recent 1, 3 or 7 days ending at collection time. Current-patch filtering is disabled because Riot build-to-TFT-content-patch mapping remains unavailable.

**Rank scope means ranked lobbies containing sampled ladder players.** Co-participant ranks are not verified. All eligible final boards in those lobbies are analyzed, and the UI states this population boundary. Regional route, cohort, collection start/end, observation window, provider, sample/coverage counts, classification and derivation versions, pending IDs and patch relevance accompany each dataset.

| Mode     | Players per tier | Recent IDs per player | New detail-request limit |   Deadline |
| -------- | ---------------: | --------------------: | -----------------------: | ---------: |
| Quick    |                5 |                    10 |                       20 |  2 minutes |
| Standard |               20 |                    20 |                      120 |  8 minutes |
| Deep     |               50 |                    20 |                      600 | 20 minutes |

These are explicit product workload ceilings, not promised sample sizes or rate entitlements. Three-tier Deep considers at most 150 players. Each refresh adds one ladder request per tier and at most one match-index request per sampled player, unless the 10-minute shared index cache applies. Native retries can add attempts. The existing native limiter reads app/method headers, respects Retry-After, retries transient failures boundedly, and observes cancellation/deadlines. Two detail requests may be in flight. At Riot's documented small-key allowance of 100 requests per 120 seconds, a worst-case cold Standard collection already spans several minutes; larger modes remain explicit. Actual headers, deduplication, availability and deadlines determine the realized workload. No startup crawl was added.

### Incremental database and recovery

Versioned cohort membership keys persist the union of discovered match IDs and the ladder-slice cursor. Pending IDs survive partial refreshes and are retried later. Known immutable payloads use the same M3 cache, so a later refresh reuses previous matches even when they drop out of the latest player index. Shared match IDs are deduplicated across players. Match indexes cache for ten minutes; completed payloads have no expiration. Old raw matches remain reusable when a different rolling window or classifier is selected.

Classification is cached per match and classifier/family/static fingerprint. Changes to those semantics reclassify existing raw evidence instead of downloading it again. The dataset fingerprint also distinguishes source, region, cohort, window semantics and M5 statistics version. Classification yields periodically; bounded M6 discovery runs in a worker. The UI renders only catalog rows, never thousands of raw boards.

A refresh keeps current evidence visible and reports player progress, unique/new/cached matches, analyzed boards, classified, ambiguous and unclassified observations. Cancelling retains already fetched immutable matches and the prior published dataset. Authentication and missing-key failures stop acquisition; partial detail failures can publish a nonempty partial dataset. Empty eligible results cannot replace cached evidence. A single `meta-current:v1` write publishes the meta/discovery pair atomically; scope-specific catalog entries allow real cached region/rank/window selection. Expired rolling evidence is retained for inspection but cannot contribute mature recommendation inputs.

Persistence uses **additive versioned keys in the existing SQLite settings table** and the existing immutable match table. No SQL schema migration or destructive alteration is necessary. Old `aggregate-meta`, `comp-discovery`, settings, account/history, M8 and M9 rows are retained. A read-only backup of the real M10 database was exercised with the new keys: 18 tables / 279 existing rows preserved, SQLite integrity `ok`. Both the old and new contracts work against the same four-migration schema. `scripts/verify-meta-storage.py` and its artifact report make this reproducible; synthetic evidence was never inserted into the original database.

### Statistics, popularity and trends

The existing M5 statistics and recommendation-quality gate remain unchanged: at least 20 classified observations, confidence at least 0.45, and bounded evidence age. Small samples receive **Insufficient sample** without prominent percentages. Mature rows and Home show raw average placement, raw Top 4 and raw first-place rates. Adjusted placement, confidence and denominator details remain labeled in secondary row information. The modeled strength/floor/ceiling inputs still use the existing documented M5 shrinkage formula. No S/A/B tier labels were invented.

`meta-catalog-v1` defines family play rate as family classified observations / all uniquely classified observations in that selected dataset. The header reports classification coverage and its denominator; play-rate confidence is capped by coverage. Existing raw frequency across all eligible boards is retained separately. Popularity sorting compares share of **all sampled boards**, making curated and discovered rows comparable without silently changing the displayed conditional family denominator. Cluster representation is labeled as a share of analyzed boards. Curated family and variant evidence can overlap; those row percentages are not a partition to sum to 100%.

Trend uses the two equal halves of a single compatible complete rolling dataset. Each half needs 100 classified observations, at least 20 family observations and 20 distinct family matches. Rising/falling requires an absolute frequency difference exceeding 1.96 times the binomial standard error; otherwise the descriptive label is Stable. Partial, legacy or small windows show unavailable. This is a descriptive within-sample adoption comparison, not causal evidence or a verified patch-change effect. M6 retains its own gated adoption/cohesion/stability logic. Performance-trend and cross-provider comparisons are not added.

M4 lobby pressure remains the specific opponents' historical signal. Aggregate popularity is displayed as context and never added as a duplicate contest penalty. Mature M5/M6 evidence continues to supply the existing strength/floor/ceiling inputs. Personal influence remains default 5%, constrained to 5–10%. A regression test changes popularity radically while confirming the recommendation result is unchanged.

### Discovery and the actual fourteenth comp

The real local database contained **48 aggregate boards, 22 classified**, and a discovery dataset analyzing 44 legal canonical boards. Its additional row is `cluster-0c0bd2fa`: a variant candidate related to `flora-executioners`, supported by six unique matches, cohesion 0.8769, lifecycle Experimental, not recommendation-eligible. It is legitimate M6 output rather than a duplicate or UI artifact. A sanitized structural/statistical fixture preserves this exact investigation without player identifiers. The regression confirms 13 curated rows plus this experimental variant = 14.

M6 continues to canonicalize all eligible observed boards, including unknown families, collapse repeated shapes, perform bounded similarity clustering and reject noise. Known-family clusters do not duplicate curated rows; recurring non-anchor structures may appear as Experimental/Variant/Emerging according to the established gates. A cluster does not manufacture a teaching playbook: the catalog labels sourced versus partial/inherited guidance, and unavailable stages/items/augments/positions remain unavailable. Sorting supports discovered sample, confidence, raw outcomes when eligible, representation and mature adoption. Measured-strength sorting remains an M5 family metric; no synthetic cluster tier was added.

### Augments and Team Planner

The human-verified code and eight-unit observed roster above close the current Set 18 codec gate. Current audited rosters now copy; unsupported units, Lux origins, stale snapshots and changed static fingerprints still fail safely. New locked snapshots store the verified code with fixture IDs and the human confirmation date; old snapshots are not retroactively modified.

Augment branches have stronger icon/category hierarchy. The existing sourced strategy branches identify categories, not specific augment IDs, so no particular augment art is falsely attached as a recommendation. A compact searchable Augment reference displays legitimate current-provider artwork, names and explicit availability state. The rendering path also supports exact branch art when a sourced augment ID exists. There is no generated TFT artwork or invented live availability.

### Follow-up validation and measured limits

New deterministic tests cover cohort acquisition, route/source separation, shared deduplication, incremental and warm refresh, pending work, cancellation during acquisition, partial rate-limit failure, authentication failure preservation, rank/queue/time filtering, denominator semantics, raw versus adjusted rates, minimum evidence, derivation invalidation, trend prerequisites, expired windows, old-storage compatibility, the exact human code and the real fourteenth comp. Existing M6 tests continue to cover unknown recurring boards, noise and lifecycle relationships. Existing native tests exercise rate headers, retries, Retry-After and cancellation.

The 8,000-board / 1,000 cached-match benchmark fetched **zero new details**. Initial measured results: collection plus discovery 1,176.54 ms; family-statistics recomputation 6.70 ms; mean filter/sort 0.026 ms; cached browser startup 559.51 ms; catalog route 295.53 ms; serialized meta/discovery bundle 3,232,970 bytes. Node heap increased about 159 MiB during fixture creation plus collection; this is not a measured native working-set figure. SQLite is the desktop store; browser localStorage is only the preview fallback and retains its normal quota limitations.

M3–M8 regression gates passed. M9 initially measured 537.52 ms for 100 warm history loads; the idle rerun passed at 490.66 ms. The existing 500 ms gate was not changed. Logs retain both results and the earlier M10 timing history. Large cached dataset loading, filtering, recomputation and discovery have a dedicated `scripts/benchmark-meta-v1.ts` gate.

The initial implementation pass had no native API credential and used fixtures. **The bounded live Quick collection, continuation, fully cached rerun, and offline native restart have now passed**, as detailed below. Larger Standard/Deep population remains normal app usage; this validation does not claim a representative large meta sample.

Remaining limits: upper-ladder convenience sampling (first 500 entries per tier); unverified co-participant rank and content-patch mapping; no lower-rank acquisition or global combined view; no verified external statistics feed; no sourced exact augment recommendations where the guide only names categories; no clean-machine installer/upgrade/uninstall acceptance; unsigned Windows package; and unchanged underlying static combat-parity and guidance gaps. These are visible scope limits, not inflated statistics.

### Final acceptance record for this pass

- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `npm run test -- --reporter=dot`: **164 tests, 15 files passed** (`meta-unit-final.txt`).
- `npm run test:ui -- --workers=2`: **36 tests passed** (`meta-playwright-final-pass.txt`). Earlier failures and their logs are retained: legacy planner/count assertions were updated to the human-verified behavior, and a clean Vite session resolved fixture overrides pointing at an older hot-reloaded module. No assertion timeout or evidence gate was relaxed.
- `npm run benchmark:m3` through `npm run benchmark:m9`: passed, with the documented idle M9 rerun.
- `npx tsx scripts/benchmark-meta-v1.ts`: passed its 8,000-board gates. A clean-server repeat measured collection/discovery **1,498.46 ms**, statistics **10.74 ms**, sort **0.047 ms**, cached startup **3,555.25 ms**, route **1,356.64 ms**, and Node heap delta **102 MiB**. These slower dev-server values are retained alongside the warmed results; no speedup is claimed. They include Vite/module compilation effects and are not native startup measurements.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo test --manifest-path src-tauri/Cargo.toml` (**5 tests**), and `cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- Production web build passed. The final main chunk is **499.82 kB / 147.70 kB gzip**; discovery runs in a separate worker and the refresh module loads on demand. The upstream Zod annotation warning remains; no chunk-warning threshold was increased.
- `node scripts/render-meta-progress.mjs`: rendered and inspected progress/cancel states at **1440/1000/860**, with no horizontal overflow.
- `python scripts/verify-meta-storage.py`: passed on the copied real M10 database; original opened read-only.

Browser screenshots personally reviewed include mature/insufficient catalog rows, real cached scope switching, curated and discovered/Experimental details, enabled code, stale unsupported code, augment artwork/reference and Data & settings. The focused iteration tightened the new metrics into a two-column block and shortened rank/window display names. New captures are under `artifacts/meta-v1/`; refreshed M6/M8 captures remain under `artifacts/`. No Windows/native screenshot tooling was used.

Changed-file groups: M5 collector and refresh orchestration (`metaPipeline`, `discoveryRefresh`, new discovery worker); evidence presentation and sorting (`metaCatalog`, Comp Library, Home); scope/progress controls (App, DataSettings); augment and verified-code UI (Playbook), planner mapping/human fixture and immutable session code; provider ladder limit and deterministic preview queue; new meta tests, exact fourteenth-comp fixture, benchmark/renderer/storage verification scripts. Existing M10 files remain in the working tree. No commit, push or merge was performed.

### Updated Windows deliverables

`npm run tauri -- build --debug` and `npm run tauri -- build` both completed, including production web builds and NSIS bundles. Release compilation took 1 minute 56 seconds; debug compilation took 59.43 seconds. The new unsigned `1.0.0-rc.1` files are isolated under `artifacts/release/current-meta/`, preserving the earlier M10 artifacts:

| File                                      |      Bytes | SHA-256                                                            |
| ----------------------------------------- | ---------: | ------------------------------------------------------------------ |
| `tft-strategist.exe`                      | 20,026,368 | `255F42E6820F097BA146CC4E795E2AF8BE44BF272FB01074FC8AC1CAB71A6514` |
| `TFT Strategist_1.0.0-rc.1_x64-setup.exe` |  8,950,093 | `3E991B34690D8C4D1228E7B0B6EB91AD2E8F98ED69C6883CEAA6169B459C1B5C` |

The new executable launched, responded and exited through a normal close request; no forced cleanup was needed. Before/after read-only comparison confirmed **all 279 existing rows across 18 tables unchanged**, with SQLite integrity `ok`. `meta-release-smoke.json`, `meta-release-storage.json` and the checksum manifest retain the evidence. This process lifecycle check does not replace clean-machine installer or real live-match acceptance. Final formatting and `git diff --check` passed.


## Bounded live Current Meta V1 acceptance — 2026-09-06

**Passed through the packaged release app**, using Playwright over the WebView2 browser debugging interface, the real `NativeRiotProvider`, native Rust Riot commands/HTTPS client/limiter, production M5/M6 pipeline, discovery worker, and Tauri SQL plugin against the existing native SQLite database. No alternate Node HTTP provider or memory-only repository was substituted. The tested executable is the Current Meta release with the SHA-256 listed above; production source and binaries required no changes during this validation.

The credential entered a terminal with echo disabled and was passed only in the child process environment. It was not printed, written to a file, placed in argv, or included in reports. The credential-bearing process exited normally. A subsequent clean native launch without the credential confirmed `keyDetected: false` and zero startup HTTP requests.

### Scope, budgets and timings

Used the ordinary **Quick** UI preset: **EUN1 / EUROPE / Challenger / Set 18 / recent 7 days**, at most five players, ten recent IDs per player, twenty new details per refresh, two detail workers and a two-minute ceiling. The live ladder yielded **four considered and four unique sampled players with real PUUIDs**. Four recent-index requests returned **40 ID references, deduplicated to 30 unique matches**; ten shared references did not cause duplicate detail fetches. Co-participants' ranks are unverified. The final sample contains **72 unique participants**.

| Run | UI wall time | API requests | New details | Cached details | Eligible matches / boards | Publication |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Initial / partially cold | 6.683 s | 25: 1 ladder + 4 indexes + 20 details | 20 | 6 | 26 / 208 | Partial, four pending |
| Warm continuation | 1.769 s | 5: 1 ladder + 4 details | 4 | 26 | 30 / 240 | Complete, zero pending |
| Fully cached after renderer reload | 0.850 s | 1 ladder | 0 | 30 | 30 / 240 | Complete, zero pending |

All three runs had **zero retries, zero rate-limit waits and zero wait milliseconds**. Total collection traffic was **31 requests and 24 new immutable matches**, not thousands. The initial run was not a pristine empty cache: six details already existed. Timings include UI scheduling and up to 500 ms polling granularity, so they are not isolated HTTP latency measurements. The bounded continuation completed the same thirty IDs; no Standard/Deep crawl was started.

A subsequent live cancellation added **one ladder attempt**, for **32 total native API attempts** during this session. An invalid-route guard check made no HTTP request. No live 429, 5xx or credential rejection occurred; their retry/error behavior remains covered by existing native regression tests, not claimed as newly observed live.

### Data correctness and discovery

The read-only audit independently recomputed family board counts, distinct match counts, raw placement means, top-four rates and win rates from the persisted observations. Every analyzed match passed EUN1, queue 1100, Set 18, no-future and seven-day filtering. There were **240 distinct match/participant observations: 104 classified, 29 ambiguous, 107 unclassified**; coverage **43.33%**. This live sample contained no out-of-scope match, so rejection of other sets, queues, regions and dates remains supported by the existing boundary tests.

The displayed family play-rate denominator is **104 classified boards**. Popularity sorting uses **240 sampled boards**. For example, Adaptors is 20/104 = 19.23% displayed play rate and 20/240 = 8.33% overall board share. Family samples sum to 104. Cluster samples are separate, potentially overlapping evidence and are not added to family counts. Trends remain unavailable at this sample size. Collection completion does not imply a statistically representative cohort.

Final eligible match timestamps span **2026-09-02 16:50:03.540 UTC to 2026-09-06 18:38:12.819 UTC**. Collection began **18:50:08.012 UTC**; the final cached publication completed **18:50:55.632 UTC**. Scope, rolling window, API provenance, classifier/statistics/static fingerprints, sample coverage and pending counts survived persistence and reload. TFT content-patch mapping remains unavailable; the static source still reports known-stale combat parity.

M6 analyzed **218 canonical boards** and rejected **22** because special/placeholder/runtime units lack a verified canonical form. The audit reproduced that exact reason for all 22; no mapping was guessed. It found **eight active clusters**: four known-family relations and four Experimental emerging candidates. Seven active clusters are Experimental and one known-family cluster is Proven under the existing M6 gates. **No active Variant or promoted Emerging lifecycle** resulted. One nine-board Solar & Elderwood variant candidate from the partial publication was retained as **Stale**, giving nine stored clusters but eight active clusters. Known-family clusters enrich existing entries; they do not create duplicate catalog rows. The catalog showed **18 entries: 13 curated, four Experimental emerging candidates, and one retained Stale variant**.

### Visible comp sample sizes

Counts below are classified board observations and distinct matches, not a count of independent player experiments. Eligible refers to the existing M5 outcome-display gate.

| Curated comp | Boards | Unique matches | Outcome evidence |
| --- | ---: | ---: | --- |
| Solar & Elderwood | 22 | 19 | eligible |
| Adaptors | 20 | 18 | eligible |
| AP Summoners | 20 | 17 | eligible |
| The Final Forest | 8 | 8 | insufficient |
| Apex Predator | 6 | 5 | insufficient |
| Consuming Flora | 2 | 2 | insufficient |
| Flora Executioners | 0 | 0 | unavailable |
| Invoker Spellweavers | 9 | 8 | insufficient |
| Unrivaled | 4 | 3 | insufficient |
| Elderwood Rapidfire | 4 | 4 | insufficient |
| Blackthorn Sprykin | 1 | 1 | insufficient |
| Blossom Executioners | 0 | 0 | unavailable |
| Coven Invokers | 8 | 8 | insufficient |

| Additional visible discovery entry | Boards | Unique matches | Lifecycle |
| --- | ---: | ---: | --- |
| Variant of Solar & Elderwood | 9 | 9 | Stale |
| Emerging cluster-771e5741 | 6 | 6 | Experimental |
| Emerging cluster-79b6de79 | 12 | 10 | Experimental |
| Emerging cluster-8e92f325 | 23 | 21 | Experimental |
| Emerging cluster-99ad6927 | 9 | 9 | Experimental |

The four known-family clusters have 6/6 (Invoker Spellweavers), 14/14 (Adaptors), 11/11 (Solar & Elderwood), and 36/24 (Flora Executioners) board/match counts. These M6 structural relations do not replace the stricter M5 classification totals in the table. Small, Experimental and Stale evidence remained visibly qualified; no tier or strength was invented.

### Persistence, progress and failure checks

- Actual UI progress advanced through player acquisition and unique/new/cached detail counts. Cold and warm publication showed the correct partial/complete status. Production discovery completed and its results appeared in Comp Library. Browser screenshots were inspected; no Windows/native capture tool was used.
- Clicking Cancel during a live refresh displayed the cancellation message and preserved the **entire published meta/discovery pair byte-for-byte**. This exercised acquisition cancellation, not cancellation at every later pipeline phase.
- A native invalid platform command returned the structured safe `invalid-route` error with no additional HTTP request. Live auth/rate-limit failures were not manufactured.
- The SQLite audit passed integrity checks across 18 tables. **All 237 pre-existing immutable match rows were unchanged**, with 24 new rows bringing the total to **261**. All **272 pre-existing rows outside the mutable recent-index table** were unchanged, including existing sessions, profiles, scans, static data and legacy M5/M6 evidence. Recent indexes refreshed normally. The pre-live SQLite backup is retained under ignored artifacts.
- Renderer reload reused all thirty detail payloads. A full native process restart without the credential still displayed 240 boards and 18 catalog entries, with **zero native API requests**. The live catalog remains in normal app storage for the user.

**Correctness fixes:** none required in the production pipeline during this live pass. Only reusable validation/audit scripts and this report were added/updated; the existing release artifact remains current. The run verified bounded-budget continuation, deduplication, immutable persistence and current UI behavior without changing evidence gates.

Evidence: `artifacts/m10-validation/meta-live-{cold,warm,cached}.json`, `meta-live-cancellation.json`, `meta-live-audit.json`, `meta-live-visible-comps.json`, `meta-live-offline-restart.json`; browser captures `artifacts/meta-v1/live-{cold,warm,cached,comps}.png`. Runnable tools: `scripts/live-meta-native-launch.mjs`, `scripts/live-meta-native-validate.mjs`, `scripts/audit-meta-live.ts`. The launcher must be used only for an explicitly authorized local validation and closed afterward; it does not save a key for future launches.

No commit, push, merge, installer installation or larger population crawl was performed. Larger Standard/Deep collection is left to normal app usage.

Post-live checks actually run: `npx tsx scripts/audit-meta-live.ts`, `npm run typecheck`, `npm run lint`, focused Prettier check, `git diff --check`, and `npm run test -- --reporter=dot` all passed (**164 tests, 15 files**, 9.43 seconds for this regression run). A credential-pattern scan of 110 validation/source/report/database files found zero credential-shaped values. Both native validation launches closed normally. Full build and 36-test browser-suite results above remain from the unchanged production source; they were not rerun merely for audit-script/report additions.
