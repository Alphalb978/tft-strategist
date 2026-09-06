# M3.1 — Live Riot Calibration & Scouting Evidence Cleanup

## Goal
Correct issues discovered during the first real Riot API smoke tests before M4 consumes scouting evidence.

This is a small corrective milestone. Do not redesign the app, add comp-family prediction, enable Team Planner, or change recommendation scoring beyond removing invalid patch-confidence penalties.

Read `AGENTS.md` and governing authority before editing.

## Live findings to reproduce
Real EUN1 validation on September 6, 2026 proved:
- native `RIOT_API_KEY` detection works;
- Riot ID resolution works;
- live `tft-match-v1` history/detail fetching works;
- rate-limit waits/retries occur in practice;
- bounded partial behavior works;
- a real player produced 11/15 relevant Set 18 games from a 60-ID horizon in ~4.7s;
- another real player produced 15/15 relevant Set 18 games in ~2.3s;
- both profiles showed `0 same patch`, which is almost certainly an invalid comparison between Riot game/build version and the app's TFT content patch label `18.1`;
- self-entry in Manual Opponents is resolved/cached but then silently filtered, producing confusing UX.

## Required work

### 1. Separate Riot build version from TFT content patch
Audit the exact semantics of `info.game_version` from `tft-match-v1` and the repository's `data.version.patch`.

Do not compare unlike version namespaces as strings.

Create explicit fields/concepts if needed, for example:
- Riot game/client build version from match payload;
- TFT content patch / set patch label used by the product;
- patch relevance status derived only when a defensible mapping exists.

If a reliable current mapping cannot be established from public evidence, do not invent one. Replace the current false `samePatchGames = 0` behavior with an explicit `patch relevance unavailable/unverified` state and ensure confidence is not heavily penalized merely because two unrelated version labels differ.

Add provenance/docs explaining the decision.

### 2. Confidence calibration fix
Opponent evidence confidence must reflect evidence actually available:
- relevant game count/sample coverage;
- recency;
- supported queue/mode quality;
- patch relevance only when validly comparable.

A full 15/15 recent-game sample must not collapse to single-digit confidence solely because patch mapping is unavailable.

Keep confidence conservative and inspectable. Do not convert it into probability of future behavior.

### 3. Self-entry UX
When a Manual Opponents entry resolves to the currently resolved own account:
- do not present it as a successful opponent followed by `No opponent identities were resolved`;
- mark it explicitly as `your account — ignored` (or equivalent concise wording);
- do not start history requests for it;
- add regression coverage.

### 4. Preserve live-proven behavior
Do not regress:
- native secret isolation;
- Riot account routing;
- match history/detail normalization;
- 10/15/20 target behavior;
- 60 raw-ID horizon unless evidence justifies changing it;
- shared-match dedupe;
- rate-limit handling;
- immutable match cache;
- partial result deadline;
- manual identity fallback;
- official spectator safety boundary.

### 5. Tests and evidence
Add regression fixtures/tests representative of the real behavior discovered:
- Riot `game_version` that does not share the product's TFT `18.1` namespace;
- full 15-game sample with patch mapping unavailable should retain sensible evidence confidence;
- partial 11/15 sample remains partial;
- own Riot ID entered as opponent is explicitly ignored;
- existing M3 rate-limit/cache tests remain green.

Run all relevant TypeScript/Rust/UI checks. Native rebuild is required only if native code changes.

## UI scope
Only make minimal clarity changes required by this task. Do not perform the planned general UI cleanup (`Playbook library` → `Comps`, copy reduction, density, board previews) here.

## Deliverable
Create `docs/M3_1_LIVE_CALIBRATION_REPORT.md` containing:
- root cause of the patch mismatch;
- evidence used;
- exact confidence behavior before/after;
- live findings retained as unverified where no new live key test is performed;
- tests/checks actually run;
- any remaining blockers for M4.

Work only on `codex/m3-1-live-calibration`. Do not merge or push unless explicitly asked.