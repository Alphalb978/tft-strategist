# Lobby discovery and static-cache hardening — 2026-09-13

Scope: codex/m12-final-companion, following db32b4b5d80068270ceeb3cc3157f36276982390. M14E was not started. Migrations 1–7, Riot/LCU access policy and strategist.db were preserved.

## Findings and fixes

The old discovery workflow gave every operation one 8-second deadline and raced it against an 8-second rejecting watchdog. Spectator could consume the LCU fallback time, and the outer rejection discarded connection diagnostics. Native testing also reproduced a separate SQLite writer-lock problem: account identity caching could stall after LCU had already found all participants.

Discovery now has a 15,000 ms watchdog, with an inner deadline at 14,750 ms. Account/cache/connection refresh shares 2,000 ms; Spectator has 2,500 ms; LCU gameflow has 3,250 ms, allowing the existing native HTTPS maximum of 3,000 ms; the identity bridge uses the remaining inner budget. Every provider and history-store await is bounded even if an implementation ignores its deadline. Watchdog and inner failures return safe structured diagnostics. Timings measure wall time per stage, including overlapping identity requests. Native Spectator deadline errors retain a timed-out result. History acquisition remains a separate 8,000 ms workflow, with history-specific messages. A Spectator 403 no longer overwrites an identity timeout with an inferred expired-key message.

On initial inspection, settings.static already exactly matched the bundled 18.2 JSON and passed currentStaticSnapshotUsable, while static_cache still held an older payload with fetched_at 2026-09-07T14:52:57.869Z and source_version Sat, 29 Aug 2026 00:53:30 GMT. A native static_cache write failed with SQLite code 5, database is locked, after 5,655 ms. This establishes a real partial write/locking failure, not a sourceVersion encoding problem.

Knowledge imports issued BEGIN, writes and COMMIT as separate plugin calls through a SQLx connection pool. Those calls do not reserve one connection. A per-statement JavaScript mutex does not make the transaction connection-affine. Imports now buffer their write-only transaction and send it to a native SQLx Transaction that owns one connection and rolls back on error. Both static copies are also written in one such transaction. The static_cache row is now the explicit static read source, with settings fallback only when that row is absent. Persistence verifies its payload and metadata; application startup re-reads and checks compatibility, sourceVersion and the structural fingerprint. Replacement failures emit only safe write/read/revalidation categories and an honest user notice.

Important limit on the historical banner diagnosis: the first fresh native launch during this investigation already showed Local cache because its old read path used the current settings copy. Therefore the repeatedly reported banner was not independently reproduced across fresh processes before the changes. The duplicate-row inconsistency and locking failure were directly reproduced; there is no evidence that another startup path restored old values. The report does not infer such a path.

## Real native evidence

Executed npm.cmd run tauri dev on Windows. Native capture through the computer-use plugin failed (activation/capture interface errors); attached to the app's own WebView through a temporary loopback debug port. This was the actual Tauri process, not browser fixture mode. No lockfile secrets, passwords, authorization headers, API keys or raw private payloads were emitted.

| Case | Account | Spectator | LCU gameflow | Identity bridge | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Before SQLite fix, bounded orchestration | 1,866 ms | 110 ms, 403 | 36 ms | 12,348 ms | 14,755 ms total; 8 participants, 8 local summoners, 1 public identity; structured timeout |
| Fixed native ranked session, warm caches | 8 ms | 85 ms, 403 | 41 ms | 178 ms | 312 ms total; 8 participants, 8 identities, 7 usable opponents |
| Real native UI successful scan | 1,278 ms | 170 ms, 403 | 57 ms | 322 ms | UI reached LOBBY READY 7/7 and 70/70 relevant history games |
| Injected hung Spectator, real LCU | 8 ms | 2,514 ms, timed-out | 48 ms | 415 ms | 2,985 ms total; 8 identities, 7 usable opponents |
| Injected one local summoner failure, otherwise real providers | 8 ms | 84 ms, 403 | 39 ms | 211 ms | 342 ms total; 7 identities, 6 usable opponents; partial result |

The injected cases deliberately replace just one provider operation; they are not claims of naturally occurring Spectator slowness or partial LCU failure.

Restart proof: after replacement, both settings.static and static_cache.payload were equal, patch 18.2, fetched_at 2026-09-13T15:20:57.597Z, source_version a3973eec2c134b9e76e9f75858de2f9cfafa5547b2554d2eea22df905ff61f07. Closed the native app, confirmed its process exited, and relaunched via npm.cmd run tauri dev. The new process showed Local cache and no incompatible-cache banner. See native-restart.png and native-restart-footer.png. These rendered screenshots were inspected.

Remaining manual coverage: the machine remained in a ranked TFT session. League Client open outside TFT, loading transition, a separate Normal session, and naturally unavailable LCU were not manually reproduced. No game was entered/exited by automation. No-session, ended-game, unavailable/TLS/lockfile, partial identity and fallback failures are covered by fixtures. A request to let us know when the client is outside TFT was sent to the user.

## Validation

- npm.cmd run typecheck: passed.
- npm.cmd run lint: passed.
- npm.cmd test: initial 686/686 passed; after adding the native-deadline regression, one unrelated M12 filesystem test exceeded its 5-second limit during competing builds. Final full run with npm.cmd test -- --maxWorkers=2: 687/687 tests, 51 files, passed without changing test timeouts.
- npm.cmd run build: passed; existing bundle-size / dependency annotation warnings remain.
- cargo test --manifest-path src-tauri/Cargo.toml: 85 passed, all binary/doc test targets passed. Used the repository's bundled Cargo/Rustup, CARGO_TARGET_DIR on D:, CARGO_BUILD_JOBS=2, CARGO_PROFILE_TEST_DEBUG=0 and CARGO_INCREMENTAL=0. The first C: attempts failed due to disk exhaustion/PDB errors; D: completed successfully. Final log: D:/CodexBuildCache/tft-strategist-lobby-cache-validation/rust-validation.log.
- npx.cmd playwright test e2e/m10.spec.ts --grep 'failure retains|rescan clears|discovery timeout' --workers=1: 3 passed. Checks actual UI working-state cleanup, neutral non-provisional baseline after failure, removal of previous lobby evidence, manual fallback and retry without reloading.
- git diff --check: passed.

SQLite regressions use real SQLite and cover obsolete replacement, next initialization, metadata read-back, unrelated-data retention and rollback of both rows on a failed second write. The Rust pool regression proves failed native batches roll back and the pool remains usable. Existing importer tests cover failed activation retaining prior snapshots.

Environment note: C: reached zero free space during Rust compilation. Automatic approval review rejected recursive deletion of disposable incremental build files, so those files were retained. Two newly generated PDB copies were moved to D: for preservation, and Rust validation used a separate D: target. A later dev rebuild also hit C: space exhaustion; the previously successful native executable was relaunched against the final frontend (subsequent Rust source changes were formatting only). Disk-space cleanup remains an environment concern outside this patch.

## Changed files

- src/services/currentLobby.ts, src/providers/riot.ts: independent budgets and safe deadline diagnostics.
- src/app/App.tsx, src/features/Home.tsx, src/features/RiotScouting.tsx, src/domain/models.ts: preserve/display diagnostics, retry cleanup and accurate failure classification.
- src/services/scouting.ts: explicit history-budget wording.
- src/services/application.ts: verified write-through and safe persistence diagnostics.
- src/storage/repository.ts, src/storage/sqlBatch.ts, src/storage/knowledgeDatabase.ts: consistent static read/write and connection-owned atomic import batches.
- src-tauri/src/storage_batch.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock: native SQLx transaction command and regression test; no migration changes.
- src/test/currentLobby.test.ts, src/test/application.test.ts, src/test/staticCacheSql.test.ts, e2e/m10.spec.ts: regressions.
- diagnostics/lobby-cache-hardening/: safe native evidence and this report.

Commit and remote verification are reported in the task's final response after publishing this patch.
