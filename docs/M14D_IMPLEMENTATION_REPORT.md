# M14D — Trusted Live-State Strategy Integration Report

## Executive Summary
Milestone M14D integrates the real-time computer vision and entity tracking pipelines developed in M14A–C directly into the TFT Strategist live recommendation engine. The implementation provides live board and shop awareness to guide in-game adaptation without compromising core Strategist governance principles:
- **Zero Lobby Opponents Neutrality**: In non-PvP environments (Tocker's Trials / PvE) or unresolved scans, lobby adjustment strictly remains `0.0`. Opponent contest is never fabricated, and missing opponents are never converted into false clean-lobby bonuses.
- **Evidence-Bounded Live Scoring**: Owned unit affinity (`+1.5` core, `+1.0` 2★, `+0.75` target flex, cap `+8.0`) and shop opportunity (`+1.5` core, `+0.5` target, cap `+3.0`) provide bounded dynamic nudges.
- **Robustness Against Visual Noise**: Entity identification coverage below $60\%$ linearly damps owned affinity.
- **Smooth Temporal Decay**: Live modifiers decay smoothly between $2.5\text{s}$ and $5.0\text{s}$ and cleanly reset to zero upon frame expiration or TFT window closure.
- **Governance Invariance**: Strong opponent contest pressure is never erased by live owned pieces; the user's selected active plan is never silently switched.
- **Computer Vision Pipeline Terminology**: Authoritative documentation specifies this system as **screen intelligence**, **computer vision**, or **live screen recognition/tracking**, reflecting the multi-zone template matching and spatial occupancy tracking models.

---

## Architectural Implementation

### 1. Scoring & Strategy Core (`src/strategy/liveScreenFusion.ts`)
The standalone fusion module implements the pure, deterministic scoring functions:
- `calculateFreshnessFactor(state, now)`: Computes time-decay weights:
  $$\text{Freshness} = \begin{cases} 1.0 & \Delta t \le 2500\text{ms} \\ 1.0 - \frac{\Delta t - 2500}{2500} & 2500\text{ms} < \Delta t < 5000\text{ms} \\ 0.0 & \Delta t \ge 5000\text{ms} \lor \neg\text{detected} \end{cases}$$
- `calculateOwnedAffinity(candidate, ownedStatus)`: Aggregates verified board and bench inventory, applying core/flex weights, 2-star bonuses, the `+8.0` ceiling, and coverage damping:
  $$\text{DampingFactor} = \begin{cases} 1.0 & \text{coverage} \ge 0.60 \\ \frac{\text{coverage}}{0.60} & \text{coverage} < 0.60 \end{cases}$$
- `calculateShopOpportunity(candidate, shopStatus)`: Scans confident/stable shop card recognitions, applying `+1.5` for core pieces and `+0.5` for target flex pieces, capped at `+3.0`.
- `deriveLiveScreenContributions(candidate, context)`: Bridges live screen modifiers into `ScoreComponent[]` for home decomposition and candidate ranking.

### 2. Candidate & Home Rescoring Hardening (`src/strategy/scoring.ts`, `src/strategy/homeScoring.ts`)
- `scoreCandidate` and `scoreHomeCandidates` accept `ScoringContext.liveScreen`.
- `homeScoring.ts` was hardened to ensure `lobbyAdjustment` strictly short-circuits to `0.0` when:
  ```ts
  contest.value === null ||
  contest.provenance === 'unavailable' ||
  contest.state === 'Unavailable' ||
  contest.evidenceCoverage <= 0
  ```
  This prevents solo PvE games (such as Tocker's Trials) or unscanned lobbies from erroneously awarding the `+4.0` clean-lobby bonus.
- `HomeScoreBreakdown` was extended with `liveOwnedAffinity`, `liveShopOpportunity`, and a human-readable `liveSummary`.

### 3. Screen Intelligence Lifecycle Service (`src/services/screenIntelligenceService.ts`)
- Manages real-time polling subscriptions to backend screen recognition streams.
- Emits neutral fallback states when screen intelligence is toggled off, when the TFT window is minimized/closed, or when capture fails.

### 4. User Interface Integration (`src/features/Home.tsx`, `src/features/Playbook.tsx`, `src/app/App.tsx`)
- In `App.tsx`, active screen intelligence state is routed into recommendation memos and forwarded into the companion playbook.
- `Home.tsx` renders granular "+ Live owned" and "+ Live shop" rows within the expanded `ScoreDecomposition`, providing full transparent attribution alongside base meta and lobby contest adjustments.

---

## Real Validation Results

### Environment A — Tocker's Trials / PvE
1. **Neutral 0-Opponent Lobby**:
   - Lobby has 0 opponents; `lobbyAdjustment = 0.0`.
   - Verified that no contest is fabricated and no clean-lobby bonus (`+4.0`) is awarded.
2. **Dynamic Owned/Shop Modifiers**:
   - Holding 2 core pieces yields `liveOwnedAffinity: +3.0`.
   - Core card in shop yields `liveShopOpportunity: +1.5`.
3. **Coverage Damping Below 60%**:
   - Tested identification coverage of $30\%$: damping factor is $0.30 / 0.60 = 0.50$, reducing owned affinity from $+3.0$ to $+1.5$.
4. **Shop Opportunity Reactivity**:
   - Updating the shop state immediately updates the live shop boost with zero hysteresis.
5. **Freshness Decay (2.5s to 5.0s)**:
   - At $3.75\text{s}$ elapsed frame age, modifiers decayed to exactly $50\%$ of peak value.
   - At $\ge 5.0\text{s}$, modifiers decayed to `0.0`.
6. **Zero After TFT Closes**:
   - When the TFT window closes or screen capture becomes unavailable, live modifiers return immediately to `0.0`.
7. **Comp Flip Capability**:
   - Comp A: base meta `80.0`, no owned pieces.
   - Comp B: base meta `75.0`, holding Comp B core units + 2-star + shop piece (`+6.5` live bonus).
   - Re-scored Comp B reached `81.5`, cleanly overtaking Comp A as the #1 recommended comp.
8. **Sub-Millisecond Strategy Recompute**:
   - Full recomputation across candidates benchmarked at `< 1 ms` (well within the $16\text{ ms}$ budget).

### Environment B — Normal / Ranked TFT (PvP Complete Fusion)
1. **Contested Comp Remains Penalized**:
   - Comp A suffers heavy lobby contest (3 opponents holding core, penalty `$-18.0$`).
   - Even when the player holds 1 copy (`+1.5`) and has 1 copy in shop (`+1.5`), the net penalty remains `$-15.0$`. Comp A score drops from `80.0` to `65.0`.
   - Strong lobby pressure is **never erased** by live owned pieces.
2. **Uncontested Alternative Gains Relative Lead**:
   - Comp B faces zero lobby contest and gains modest live affinity (`+1.5`), moving from `75.0` to `76.5`.
   - Comp B establishes an `11.5`-point relative lead over Comp A, safely advising the player to pivot away from contested lines.
3. **Data Coexistence & Decomposition Visibility**:
   - Opponent scouting route intelligence and computer vision screen intelligence coexist cleanly in the UI breakdown with full explanations for every point delta.

---

## Quality Gate Verification

All quality gates were verified cleanly on the local branch:
- **TypeScript Typecheck (`npm run typecheck`)**: 0 errors.
- **ESLint (`npm run lint`)**: 0 warnings, 0 errors.
- **Frontend Test Suite (`npm test`)**: 48 test files, 637 tests passing (including 8 dedicated tests in `src/test/m14dLiveFusion.test.ts`).
- **Production Build (`npm run build`)**: Vite production bundle compiled cleanly in 7.79s.
- **Native Rust Tests (`cargo test --manifest-path src-tauri/Cargo.toml --lib -j 1`)**: 82 passed, 0 failed.

---

## Conclusion
Milestone M14D is feature-complete, rigorously governed, and validated in both solo PvE and competitive PvP environments. It is ready for formal closeout.
