# M12 — Final companion implementation report

## FINAL BOUNDED CLEANUP — METRICS AND RIOT API CONFIGURATION

September 7, 2026. No recommendation weights, evidence-fusion philosophy, page redesign, item/star extraction, commit, push or merge in this cleanup.

### Pick Rate and Direct Share

- **Pick Rate** is an explicit value captured from a uniquely named visible MetaTFT public comp row. It is not the pre-existing histogram-derived participant-board share renamed. The ordinary public page currently displays values such as `0.48` **without a percent sign**; that provider format is preserved. A percent sign is used only when explicitly reported by the source. Current live collection captured five visible rows out of 53 mapped comps. Unsupported rows remain unavailable; no scrolling/scraping architecture expansion was added.
- **Direct Share** uses the existing selected direct dataset's classified-board denominator and family assignment count. Its region/rank/window remains visible. Discovery-only structures without a corresponding classified-family count do not borrow an incompatible discovery-population denominator.
- Compatible captured Pick Rate is primary beside fused Avg/Top 4/Win. Direct Share, direct sample, scope and the explanation remain inspectable in comp Evidence & Method. Missing, stale, wrong-patch, unmapped or invalid-scope external Pick Rate falls back to Direct Share; missing direct data is explicitly unavailable. Both metrics use the same display component in Library/companion/details. No adoption-divergence score or single-snapshot trend claim was added.
- Production inspection caught and fixed two serialization/presentation issues: absent optional Pick Rate fields must be omitted before hashing JSON, and the provider's millisecond update timestamp must not be treated as seconds. The already captured native/public snapshot was repaired without changing its statistics. JSON-round-trip and timestamp tests cover these cases.

Source check: a normal browser visit to [MetaTFT Comps](https://www.metatft.com/comps) showed Pick Rate `0.48`, Win Rate `14.8%`, and Top 4 `59.1%` for the first visible comp. This cleanup deliberately does not infer identical denominator semantics from those labels.

### Secure Riot API workflow

Data & settings now includes Riot API status, a masked replacement-key input, Save key, Test connection and Remove key, plus configured account/region and last successful API request time. Saving clears the transient input immediately. React receives only a whitelisted connection-status object; the stored key is never returned or put in application state, JSON, SQLite, localStorage or logs.

Windows uses a per-user generic credential named `TFTStrategist/RiotApiKey`, through [Credential Manager CredWriteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew) and [CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw). The native secret remains wrapped in `SecretString`; the OS read buffer is wiped before being freed. Removing deletes the Windows credential. Storage errors return fixed safe messages.

Precedence is **nonempty RIOT_API_KEY environment override → stored Windows credential → unavailable**. Environment credentials are never automatically persisted. The UI explains when an environment override remains active after saving/removing a stored credential. Save/remove take effect for subsequent native requests without restarting the app. An in-flight request retains its original credential snapshot, and a generation check prevents its result overwriting a newer credential's status.

Test connection uses the existing NativeRiotProvider → native RiotState HTTPS client, limiter, deadlines and sanitized error handling, with the selected platform's [TFT status API](https://developer.riotgames.com/apis/#tft-status-v1/GET_getPlatformData). There is no duplicate Riot client. Success records a timestamp; auth failures show Invalid / expired and permit replacement in Settings. Cached/offline recommendations continue to work. Last successful request is session-local, not persisted across restarts.

### Validation and review artifact

- Focused TypeScript tests: **45 passed** across `m12Cleanup`, `m12`, and `riot`.
- Native tests: **9 passed**, including environment precedence/no automatic persistence, stored fallback/save/remove, safe status serialization, mocked success/auth expiry, and a real Windows Credential Manager round trip with an isolated dummy credential that was removed afterward. No live Riot key was used.
- Browser cleanup flow: **3/3 passed** at 1440/1000/860, including masked save, connected/invalid transitions, remove, no raw key in rendered text/localStorage, and continued offline plans. Existing companion scenarios passed **3/3**. Direct-meta catalog scenarios passed **3/3** after updating the old “play rate” assertion to Direct Share. Cancellation passed a focused rerun after moving screenshot capture after the cancellation action, avoiding a test-only completion race.
- Typecheck, ESLint, Prettier, native check, web build, desktop release build and `git diff --check` were run. Build warnings remain the existing bundle-size/vendor-annotation warnings.
- Production `dist` smoke used the real refreshed public snapshot, with an explicit assertion that captured Pick Rate renders, and reported **no page errors** at all three widths. Library, comp detail and Riot settings screenshots were inspected. Credential connectivity UI screenshots use a mocked bridge; OS secure storage was tested separately with the dummy fixture.
- Updated standalone release: **`src-tauri/target/release/tft-strategist-m12-cleanup.exe`**, built with embedded production assets using `tauri/custom-protocol`. The temporary alternate binary declaration was restored; Cargo retains only the Windows API dependency addition. No existing application process was stopped.

Commands: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check`, `npx.cmd vitest run src/test/m12Cleanup.test.ts src/test/riot.test.ts src/test/m12.test.ts`, relevant `npx.cmd playwright test` runs (`m12Cleanup`, `m12`, `metaV1`), Cargo fmt/test/check, `npm.cmd run build`, Cargo release build for the cleanup binary, one `npm.cmd run metatft:refresh`, production preview smoke, and `git diff --check`. Logs/screenshots: `artifacts/m12/cleanup-*`.

Changed surfaces: `AdoptionMetric`, external optional Pick Rate contract/normalizer, Library/companion/details labels, `RiotApiSettings`, native credential storage and Riot status/commands, native provider status filtering, scouting status refresh, focused tests and this report.

Remaining limits: captured Pick Rate coverage is currently the five visible public rows; other rows use the explicit fallback. Secure credential storage is Windows-specific. Live Riot connectivity and real-game use require the user's valid key and were not tested with a real credential. External item/star enrichment remains deferred as requested.

---

## HUMAN ACCEPTANCE FOLLOW-UP — EXTERNAL EVIDENCE INTEGRATION

September 7, 2026. This follow-up corrects production integration; it does not declare human acceptance complete.

### Root cause and corrected pipeline

Application startup constructed the internal registry before loading MetaTFT. Re-scoring could consume public statistics, but the Library received only the internal catalog and displayed direct-Riot-only metrics. Settings/recollection paths also rebuilt that internal-only registry. The old experimental confidence cap suppressed strong broad evidence.

Startup now loads and validates external evidence, then reconstructs the unified catalog and portfolio. Settings, Riot refresh, profile changes and scope selection preserve the external input; opening a non-portfolio Library entry also scores with it. The Library uses the shared fusion estimator for outcome metrics and sorting. Broad source scope, population and update information are visible above the separate direct Riot sample. Source filters include Fused, External Reference, Curated and Discovered alongside lifecycle states.

Exact canonical roster matches attach to existing entries without creating an external duplicate. Meaningful variants retain separate legal reference rosters and parent-family relationships. Unmatched mapped legal rosters become stable set/provider-ID External References. With the current public snapshot and no collected direct sample the production Library contains 57 entries, instead of the 13 curated-only entries in that fallback fixture. Reference timing, roles and core membership remain unknown unless separately supported. References with sufficient current support can enter the joint portfolio; they are not labeled internally discovered. Existing Emerging/Experimental discovery lifecycle remains separate from statistical confidence. Shared portfolio dependency uses roster overlap when core roles are unknown.

External outcomes remain the broad statistical prior; direct Riot evidence supplies compatible local correction, verification and discovery. Tiny local samples do not receive equal weight. Current-game and lobby contributions still alter recommendations. Compatible external support materially determines statistical confidence instead of being capped at Low by an unrelated Experimental guide label. The builder now admits related external-roster units into its candidate pool as well as scoring related completed structures; it does not optimize from global champion average alone.

### Sample semantics and acquisition boundary

The public DOM is not the source of an invented per-comp sample. The captured ordinary-page JSON contains `count` and eight placement bins plus their total. Normalization requires all eight bins to sum to the total and requires `count` to agree. These are provider-reported structured counts. Average/Top 4/win and participant-board share are calculated from those verified counts. DOM per-lobby pick rate is not treated as a percentage or multiplied into the population. New normalized comp rows explicitly record `provider-histogram` sample method and `participant-board-share` rate method. Total population remains independently recorded. New snapshots prefer the response's absolute update timestamp when exposed.

The working allowlisted public collector was preserved. No alternate scraping investigation or restricted data path was introduced. Holder-conditioned build tables in definition metadata still have independent, unverified scope: they remain excluded from statistical fusion. External item-package, star and exact-position coverage is therefore still incomplete. This is a source-contract gap, not silently fabricated gameplay advice. Curated sourced item groups can appear as icon rows in hover when measured local packages are absent.

### Product presentation

External Meta now appears directly beneath the Data & settings heading, with a prominent **Refresh MetaTFT Data** button, compatible/stale/error messaging, set/patch, compact rank/window, population and mapped-comp count. Update times, snapshot version/hash and exact source warnings are one disclosure deeper. The existing native command still refreshes, reloads the application (therefore rebuilding the catalog), and retains last-good data on failure. Its installed-project/npm/Edge dependency remains; this follow-up did not convert it into a standalone packaged collector.

A deterministic display formatter removes markup, escaped newlines and unresolved source expressions without inventing numerical values; source data stays intact for diagnostics. Mechanics prose keeps supported effect wording and marks missing detailed values. Hover supports trait entities, compact counts/rank, icon-based item groups and keyboard/Escape behavior. The main companion and Home reasons no longer append raw component weights. Current level has an explicit Unknown option; unset drafts no longer claim the target is several levels away. External references do not falsely claim their unknown core is already owned.

### Validation actually performed

- Full unit run: **206/206 passed** (`npm.cmd test`). Subsequent focused snapshot/normalizer tests passed 16/16; final display/catalog tests passed 2/2 after updating the assertion to permit retained qualitative damage wording.
- Full browser run: 39/50 initially passed. Failures were legacy fixed catalog counts, old context/hover copy, and direct-only insufficient-sample assertions. Legacy fallback suites now explicitly disable external evidence. A focused rerun of all affected scenarios passed **12/12**. The new normal-route external catalog/settings/hover suite passed at **1440, 1000 and 860**. The complete suite was not repeatedly rerun.
- TypeScript compilation/web build, ESLint, formatting and diff checks were run. Logs are under `artifacts/m12/followup-*`.
- Production `dist` smoke via Vite preview: Library, Fused filter, plan/hover and Settings; **no page errors**. Screenshots visually inspected: `production-library-1440.png`, `production-fused-1440.png`, `production-hover-1440.png`, `production-settings-1440.png`. Additional three-width screenshots: `followup-library-*`, `followup-external-*`, `followup-hover-*`, `followup-settings-*`, `followup-combined-library-*` and `active-*`.
- M3–M12 benchmark scripts ran. M8 and M10 timing limits initially failed during concurrent validation and passed focused reruns: M8 resume 2.26 ms/manual 2.23 ms; M10 8,000-board pipeline 7.38 s. M12 normalization 35.65 ms, fusion 0.99 ms, matching 0.78 ms, builder 83.37 ms, What-If 1.58 ms.
- The normal Tauri build could not replace the running `tft-strategist.exe` (Windows file lock). That process was preserved. A separate **`src-tauri/target/release/tft-strategist-m12.exe`** was built with embedded production assets (`--features tauri/custom-protocol`). A temporary bin declaration was restored afterward; Cargo.toml has no retained change. This executable has not been manually driven through a native refresh-success/failure cycle in this follow-up; production web screens and the existing native collector boundary were checked separately.

Commands include `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd test`, `npx.cmd vitest run src/test/m12Acceptance.test.ts src/test/m12.test.ts`, `npm.cmd run test:ui -- --workers=2`, focused `npx.cmd playwright test` runs, `npm.cmd run build`, `npm.cmd run tauri -- build --no-bundle`, isolated Cargo release build/test/check, `npm.cmd run benchmark:m3` through M9 plus M11/M12, `npx.cmd tsx scripts/benchmark-meta-v1.ts`, `node scripts/profile-m10.mjs`, and `git diff --check`.

### Changed areas and remaining acceptance limits

Catalog/domain/application/scoring/portfolio now share external evidence. Library, Settings, Home, companion, entity hover/details and current-game presentation were updated. Builder candidate selection, normalizer sample metadata, targeted tests and this report changed. No protected-process path, runtime LLM, Team Planner downgrade, commit, push or merge was introduced.

Still requiring verification or further coverage: independently scoped external holder/item/star associations; native refresh progress/success/failure interaction in the separately built executable; and complete per-entity sourced role/star guidance where current source data is absent. These gaps are not described as completed acceptance. The collector remains dependent on the project installation on this machine.

---

Implementation: September 7, 2026. Branch: `codex/m12-final-companion`. Uncommitted working tree; no push or merge. The existing M11 architecture, cached Riot evidence, discovery eligibility, manual state, Team Planner contract and session chain remain in place.

## Delivered flow

Your Plans now incorporates compatible public external outcomes in the existing joint three-plan portfolio. Opening a plan defaults to Quick: fit, style, confidence, contest, a real hex board, core/flex, next objective, observed holder packages, current inputs and alternative routes. Details retains the M11 intelligence, stages, items, augments, Decision Map, pivots and source inspection. Optimize Board remains available from the heading. What If edits an isolated state, compares score-component changes, supports hypothetical core contest, and lists legal boards at the simulated level. Discard does not write the real game state.

The critical active-plan surface fits at **1440 × 1000** in the acceptance fixture, measured from the top of the main scroll container. At **1000 and 860**, panels reflow instead of shrinking the text. The one-screen claim is not for every display height, expanded inventory, or expanded scenario.

## Public acquisition and refresh

A bounded browser investigation confirmed that ordinary visits to these public pages retrieve usable structured responses:

- https://www.metatft.com/comps
- https://www.metatft.com/units
- https://www.metatft.com/items
- https://www.metatft.com/traits

The collector uses Playwright with installed Microsoft Edge, opens those pages sequentially and observes only allowlisted public aggregate responses. It does not invoke endpoints directly, supply authentication, or capture account/user-content traffic. Endpoint names and response formats are isolated in `scripts/metatft-refresh.ts` and `scripts/metatft-normalize.ts`. No restricted Early Comps, supporter/app-only content, proprietary client, private IPC, or augment performance is collected.

The successful smoke activated **53 comps, 65 canonical champions, 141 items, and 36 traits**. Observed scope was Set 18, patch **18.1d**, ranked queue 1100, **Platinum+**, last three days. Region is unknown. Population and update metadata remain provider-reported. Tables fetched separately can have slightly different update times and populations; these are recorded. The checked-in captured fixture is reduced to the public inputs used by normalization.

Captured comp fields: provider ID, mapped roster, friendly source name, exposed leveling/style label, placement histogram-derived average/Top 4/win, sample, and participant-board share. Provider per-lobby pick rate is not confused with participant-board share. Units/items retain marginal outcome estimates and counts. Traits retain separate provider-level conditional rows; a provider level index is not relabeled as a verified TFT breakpoint. Tier labels, item place-change semantics, holder-conditioned external packages, star-conditioned external data and exact public positions are not currently extracted. Comp-definition performance/build tables have independent, unverified filter scope and are intentionally excluded from scoring.

Refresh options:

1. `npm.cmd run metatft:refresh`
2. `Refresh MetaTFT Data.cmd` in the project folder
3. Desktop Data & settings → External Meta → **Refresh MetaTFT Data**

The desktop button launches the fixed project collector without a visible console, then reloads after success. It requires the project checkout, Node dependencies and Edge; it is not a standalone bundled scraper installation. Web preview explains the launcher workflow. No collector stays running during play.

Persistent location: `%LOCALAPPDATA%\TFT Strategist\external-data\metatft`. The current normalized snapshot is one JSON file, with immutable archive files and a bounded 12-snapshot history view. The collector also updates the bundled web-preview snapshot. Native startup reads persistent data; browser startup uses the bundled snapshot and repository fallback. Locked sessions preserve their external snapshot by content identity in the repository.

## Validation and failure behavior

Zod schemas constrain counts, rates, positions and provenance. Exact canonical IDs take priority; normalized display aliases must be unique. Fuzzy mapping is never used. Separate alternate aliases are excluded when an explicit canonical response row exists; their counts are never pooled. Unmapped entities are reported, and an unmapped ratio above 10% rejects the table. Filter overrides, incompatible set/patch, changed histogram shapes, bad histogram totals, duplicate normalized entities, illegal positions, hash mismatch and a count collapse below 70% of the previous table reject activation.

Validation happens before archiving/replacing current data. A uniquely named pending file is renamed over current after validation; previous good snapshots remain archived. Failures save a screenshot and diagnostic message and retain current. The smoke caught nullable lookup names, an unclassified `-1` bucket and a page-loading race; the implementation now handles the first two explicitly and waits for the table response itself. The final complete refresh succeeded.

Same-patch age reduces evidence weight. Wrong-patch evidence contributes zero. Incompatible external data produces a refresh notice; internal/curated operation remains available. Existing mechanics parity warnings remain visible: a matching base patch does **not** establish hotfix parity with the mechanics snapshot.

## Evidence semantics and scoring

- **MECHANICS TRUTH:** selected Riot/CommunityDragon fields and audited rules, with their existing current/stale/unverified status. External data never overwrites them.
- **EXTERNAL AGGREGATE:** public MetaTFT placement counts under captured filters. Marginal item/unit performance is selection-biased association.
- **DIRECT RIOT OBSERVATION:** the existing immutable completed-match pipeline and observed comp profiles. Unknown patch mappings are not upgraded to verified mappings.
- **CURATED GUIDANCE:** existing individually sourced playbook fields and exact timing only where already supported.
- **DERIVED INFERENCE:** structural relation, discounted fusion, fit, hypothetical scenarios, legal board search and range-based positioning. None is combat simulation or causal expected value.
- **PERSONAL EVIDENCE:** unchanged cautious M9 learning, approximately 5% by default with existing bounds.
- **UNAVAILABLE:** unsupported external conditions, augment performance, exact positions/adjacency and other missing facts remain absent.

Fusion retains separate external/internal weights and disagreement. External counts receive a 0.25 reliability/overlap discount, exponential seven-day freshness decay, scope discount and structural-relation discount. Compatible direct effective samples adjust that prior; a 30-board local sample cannot equal a 10,000-board external sample. Wrong patch/queue contributes zero. Unknown rank/window lowers confidence. Populations may overlap, so effective weights are not displayed as independent games. These initial constants are inspectable model assumptions requiring human calibration.

Structural matching uses roster intersection/union plus core recall. Exact structure is strong; sufficient overlap retaining core is a variant; weak/unknown structures remain independent. It neither renames discoveries nor promotes Experimental boards. This is a bounded first matcher, not a full carry/trait/style-distance model.

Comparable archived snapshots support adoption/performance deltas. Scope equality, ordering and minimum samples gate comparison. The conservative detector exposes low-contest value, sufficiently supported external/local disagreement and rising adoption. It does not generate “secret OP” or automatically promote locally novel boards. Broader emerging/saturation/new-variant detection remains a future extension.

The optimizer adds bounded support for closely related mature external rosters while retaining legality, direct co-unit/holder evidence, inventory retention and pressure. Global champion average is not a slot-selection oracle. The external enhancement is currently **structural**; scoped external holder packages are not part of optimization.

## Positioning, hover and game state

The hex view uses four rows and seven columns, unique occupants, board capacity and explicit coordinates. Sourced exact positions retain provenance; compatible exact external positions can round-trip through the contract. No live external exact-position fixture was established in this run. Current generated boards therefore use verified attack-range fields, deterministic row preferences and a visible **Suggested positioning · mechanically derived · Low confidence** label. Missing ranges leave positions unavailable. The evaluator describes forward/rear coverage; it does not claim optimality, matchup-specific counters or verified aura placement.

Champion/item hover is available by pointer and keyboard focus, uses tooltip semantics and Escape dismissal, and opens the existing detail dialog with Enter/click. It shows sourced identity/effect/tags, core/flex and observed package context, plus compatible marginal external context. Small observed packages remain explicitly limited. The real acceptance fixture supplies direct observed packages; those synthetic observations are test data, not imported into the user's Riot cache.

What If copies the current state into React-local state, reuses scoring and legal search, and shows structured component deltas. Hypothetical contest is identified separately from observed lobby evidence. A route entering the portfolio is labeled as such. It does not automatically perform items, leveling, unit changes or any game input. No unsupported exact gold/placement EV is claimed.

## Calibration

New locks preserve the engine version, external content identity, knowledge patch and initial manual state alongside the existing full three-plan score/confidence/component/lobby snapshot. Versioned internal-only, external-only and fused outcome baselines for the locked portfolio are stored. External-only isolates outcome evidence while retaining the same non-outcome decision features; it is not a different gameplay model. Meaningful manual edits retain the latest 100 state snapshots. Existing immutable switch chains and reconciled terminal outcomes provide the final structure and placement linkage.

Post-game exposes an offline calibration disclosure. Evaluation deduplicates completed matches, requires eligible terminal attribution, groups outcomes by model/rank/confidence/contest, retains available outcome residuals and personal contributions, and never changes weights. Fit scores are not converted into placement probabilities. Historical M11 sessions remain distinguishable and missing historical predictions stay unavailable. This infrastructure does **not** establish that M12 wins more games, and it does not yet preserve every intermediate lobby refresh or user-selected builder variant as a full event stream.

## Validation evidence

The complete unit/integration suite ran once: **203/203 passed across 18 files**. Later focused regression checks passed **30/30**, including 16 M12 tests, covering the final snapshot/session/calibration changes. The full Playwright suite ran once: **45/47 passed**; one legacy assertion needed the new Details navigation and one meta fixture hit its 30-second time limit during concurrent builds. A focused rerun passed both affected flows and all M11/meta flows; an intermediate M12 run encountered a dev-server reload during edits. Final dedicated M12 acceptance passed **3/3**, including actual observed holder hover and isolated scenarios at all required widths.

Typecheck, lint, format, production web build, desktop release build and diff whitespace checks were run. Native fmt/test/check were run using the repository's isolated Cargo installation; **5 native tests passed**. The initial bare `cargo` invocation was unavailable on PATH and was corrected to `.cache/cargo/bin/cargo.exe` with the matching isolated environment. The existing non-failing JavaScript chunk-size warning remains.

Commands and full output are in `artifacts/m12/`: `typecheck-final.log`, `lint-final.log`, `format-final.log`, `unit-tests.log`, `focused-unit-final.log`, `browser-tests.log`, `focused-browser-final.log`, `m12-acceptance-final.log`, `desktop-build-final.log`, native logs, and `diff-check-final.log`. Browser tests were adapted to explicitly select Details when asserting legacy detail content; the new M12 tests exercise default Quick.

M3–M12 benchmarks all exited successfully without threshold changes. Representative results:

| Work | Measured time |
| --- | ---: |
| M12 public normalization | 24.89 ms |
| M12 portfolio fusion | 0.74 ms |
| M12 catalog matching | 0.53 ms |
| M12 external-assisted builder | 74.39 ms |
| M12 What-If portfolio scoring | 1.27 ms |
| M11 5,000-board derivation | 2,647 ms |
| M10 8,000-board cached pipeline | 6,519 ms |
| Browser cold load | 544 ms |
| Browser warm reload/resume | 479–587 ms |

The last two are real Playwright wall-clock observations on this machine, not universal latency guarantees. Snapshot parsing happens at load/refresh, not each render. Builder search remains bounded by M11's beam/pool limits. `benchmark-status.json` records each exit code.

## Visual acceptance and remaining work

Personally inspected rendered screenshots at 1440, 1000 and 860, including the real hex board, item-holder package row, keyboard tooltip, responsive tab labels and current inputs. Fixed the inherited narrow-screen nav selector and duplicate-header space after inspection. Final screenshots are `artifacts/m12/active-{width}.png` and `hover-{width}.png`. Automated 1440 acceptance checks the entire companion bottom is inside the 1000-pixel viewport after scrolling the main container to its true top. Native executable compilation is verified; native-window interaction and actual TFT-game usefulness still require human testing.

Known limitations are material: no verified external position extraction; no scoped external holder/build or star-condition extraction; no augment aggregate; no advanced adjacency/opponent-specific positioning; only a simple structural comp matcher; incomplete intermediate decision-event calibration; no causal claim of improved outcomes. The compact library keeps the existing card structure with explicit core/flex and the existing measured stats, rather than adding an inline expandable card system. Deep details still have the legacy section layout behind one tab. No optional unrelated features were added.

Future intelligence opportunities: verified public positioning/holder sub-adapters, richer conditional structural matching, persistent builder-choice attribution, confidence calibration from sufficient human games, and more discriminating opportunity tests. These are documented gaps, not completed features.

Main changed areas: new external domain/provider/collector/storage boundary; evidence fusion, positioning, opportunity and calibration modules; Quick/hover/What-If components; scorer, builder, session and post-game integration; desktop snapshot/refresh commands; deterministic public fixtures, focused tests and M12 benchmark. Existing M3–M11 regression coverage remains.

Final executable: `src-tauri/target/release/tft-strategist.exe`, 20,262,912 bytes, built September 7 at 01:35:38 local time. The final build includes the calibration baseline isolation. The current complete suite now contains one additional focused-tested calibration case beyond the earlier 203-test full run. No second full suite was run.
