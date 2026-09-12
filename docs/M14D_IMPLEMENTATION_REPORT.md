# M14D — Trusted Live-State Strategy Integration Report

## Executive Summary
Milestone M14D (hardened in M14D.1) integrates real-time computer vision and entity tracking pipelines directly into the TFT Strategist live recommendation engine. The implementation provides live board and shop awareness to guide in-game adaptation without compromising core Strategist governance principles:
- **Restoration of Final Safety Invariance**: `Final Safety` remains strictly the established strategic score (`Base Performance + Low-Pick Edge + Lobby Adjustment`). Live screen state is never included in `Final Safety`.
- **Separation of Live Direction**: The screen-aware score is represented separately as `Live Direction = Final Safety + Live Owned Affinity + Live Shop Opportunity`. When screen intelligence is unavailable, neutral, or stale, `Live Direction` equals `Final Safety` exactly.
- **Zero Lobby Opponents Neutrality**: In non-PvP environments (Tocker's Trials / PvE) or unresolved scans, lobby adjustment strictly remains `0.0`. Opponent contest is never fabricated, and missing opponents are never converted into false clean-lobby bonuses.
- **Evidence-Bounded Live Scoring**: Owned unit affinity (`+1.5` per unique known core champion, `+1.0` 2★ commitment bonus, `+0.75` per unique known target flex champion, cap `+8.0`) and shop opportunity (`+1.5` core, `+0.5` target, cap `+3.0`) provide bounded dynamic guidance.
- **Governed Coverage Damping**: When computer vision identification coverage is $\ge 60\%$, no damping is applied (factor $1.0$). When coverage falls below $60\%$, owned affinity is scaled by `(identityCoverage / 0.60)`. At $0\%$ coverage, owned contribution is zero.
- **Stale-State Error Hardening**: Polling failures never preserve fresh evidence indefinitely. Elapsed wall-clock time continuously ages the state. By $\ge 5.0\text{s}$ without fresh evidence, live contribution is strictly zero. TFT close zeroes modifiers immediately. Successful polling recovery restores evidence.
- **Governance Invariance**: Strong opponent contest pressure is never erased by live owned pieces; the user's selected active plan/session is never silently switched.
- **Computer Vision Pipeline Terminology**: Authoritative documentation specifies this system as **screen intelligence**, **computer vision**, or **live screen recognition/tracking**, reflecting multi-zone template matching and spatial occupancy tracking models.

---

## Architectural Implementation

### 1. Scoring & Strategy Core (`src/strategy/liveScreenFusion.ts`)
The standalone fusion module implements pure, deterministic scoring functions:
- `calculateFreshnessFactor(state, nowMs)`: Computes time-decay weights, incorporating elapsed wall-clock time from `state.lastUpdated`:
  $$\text{Freshness} = \begin{cases} 1.0 & \Delta t \le 2500\text{ms} \\ 1.0 - \frac{\Delta t - 2500}{2500} & 2500\text{ms} < \Delta t < 5000\text{ms} \\ 0.0 & \Delta t \ge 5000\text{ms} \lor \neg\text{detected} \end{cases}$$
- `calculateOwnedAffinity(candidate, ownedStatus)`: Aggregates verified board and bench inventory, applying unique core piece bonuses (`+1.5`), 2★ commitment bonuses (`+1.0`), target flex bonuses (`+0.75`), the `+8.0` ceiling, and governed coverage damping:
  $$\text{DampingFactor} = \begin{cases} 1.0 & \text{coverage} \ge 0.60 \\ \frac{\text{coverage}}{0.60} & \text{coverage} < 0.60 \end{cases}$$
- `calculateShopOpportunity(candidate, shopStatus)`: Scans confident/stable shop card recognitions, applying `+1.5` for core pieces and `+0.5` for target flex pieces, capped at `+3.0`.
- `deriveLiveScreenContributions(candidate, context)`: Bridges live screen modifiers into `ScoreComponent[]` for home decomposition and candidate ranking.

### 2. Candidate & Home Rescoring Hardening (`src/strategy/homeScoring.ts`)
- Preserves the established meaning of `finalSafety`:
  ```ts
  const finalSafety = round(clamp(entry.basePerformance + rarity + lobby, 0, 100));
  ```
- Separates `liveDirection`:
  ```ts
  const liveTotal = round((live.ownedAffinity + live.shopOpportunity) * 10) / 10;
  const liveDirection = round(clamp(finalSafety + liveTotal, 0, 100));
  ```
- Enforces zero-opponent lobby neutrality: `lobbyAdjustment` strictly evaluates to `0.0` when opponent evidence coverage is $\le 0$ or state is unavailable.
- `HomeScoreBreakdown` contains both `finalSafety` and `liveDirection` alongside `liveOwnedAffinity`, `liveShopOpportunity`, and `liveSummary`.

### 3. Screen Intelligence Lifecycle Service (`src/services/screenIntelligenceService.ts`)
- Tracks last successful observation timestamp (`lastSuccessfulPollTime`) and advances effective frame age on polling errors.
- Automatically transitions state to unavailable / zero live contribution if more than $5.0\text{s}$ elapse without a successful poll.
- Immediately zeroes live state upon TFT window close or capture state changes.
- Seamlessly restores live evidence when polling succeeds after transient failures.

### 4. User Interface Presentation (`src/features/Home.tsx`, `src/styles/product.css`)
- `ScoreDecomposition` renders:
  ```
  Base              74.2
  + Low-pick        +3.8
  + Lobby           -4.0
  Final Safety       74.0
  + Live owned      +4.0
  + Live shop       +1.5
  Live Direction     79.5
  ```
- Live rows are displayed only when active and non-zero.
- Ranking explanation text is context-aware: states `#1 is the highest Live Direction (incorporating live board & shop intelligence)` when live evidence contributes, and `#1 is the highest Final Safety` when in baseline mode.

---

## Real Validation Results

### Environment A — Tocker's Trials / PvE
1. **Neutral 0-Opponent Lobby**:
   - 0 opponents; `lobbyAdjustment = 0.0`.
   - Verified that no contest is fabricated and no clean-lobby bonus (`+4.0`) is awarded.
2. **Final Safety Invariance**:
   - Proved `finalSafety === round(basePerformance + lowPickEdge + lobbyAdjustment)` is identical with and without live screen state.
3. **Live Direction Separation**:
   - Proved `liveDirection === finalSafety + liveOwnedAffinity + liveShopOpportunity`. When screen intelligence is absent, `liveDirection === finalSafety`.
4. **Governed Coverage Damping**:
   - 100% coverage: factor `1.0` (3.0 pts).
   - 80% coverage: factor `1.0` (3.0 pts).
   - 60% coverage: factor `1.0` (3.0 pts).
   - 50% coverage: factor `50/60` (2.5 pts).
   - 30% coverage: factor `0.5` (1.5 pts).
   - 0% coverage: `0.0 pts`.
5. **Shop Opportunity Reactivity**:
   - Shop reroll immediately updates shop opportunity with zero lag.
6. **Freshness Decay & Wall-Clock Error Aging**:
   - Modifiers decay smoothly between 2.5s and 5.0s.
   - Elapsed wall-clock time ages the frame even if polling errors occur; by $\ge 5.0\text{s}$, modifiers are zero.
7. **Zero After TFT Closes**:
   - Window closure resets all live modifiers to `0.0` immediately.
8. **Comp Flip Capability via Live Direction**:
   - Comp A: Final Safety `80.0`, no owned units.
   - Comp B: Final Safety `75.0`, holding Comp B core pieces + shop piece (`+5.5` live boost) reaches Live Direction `80.5`, taking #1 rank while Final Safety of both comps remains invariant.
   - Selected active plan pointer remains strictly immutable.
9. **Interactive Recompute Budget**:
   - 25-comp recomputation measured at `< 1 ms` against the governed interactive regression budget of `< 16 ms`.

### Environment B — Normal / Ranked TFT (PvP Complete Fusion)
1. **Contested Comp Remains Penalized**:
   - Comp A suffers heavy lobby contest ($-18.0$ penalty). With $+3.0$ live owned/shop pieces, net penalty remains $-15.0$ in Live Direction.
   - Strong lobby pressure is never erased by live owned pieces.
2. **Uncontested Alternative Gains Relative Lead**:
   - Comp B faces clean lobby and gains modest live affinity, establishing an $11.5$-point relative lead in Live Direction.
3. **Coexistence & Transparency**:
   - Opponent scouting route intelligence and computer vision screen intelligence coexist cleanly in the UI breakdown with full explanations.

---

## Quality Gate Verification

All quality gates pass cleanly on `codex/m12-final-companion`:
- **TypeScript Typecheck (`npm run typecheck`)**: 0 errors.
- **ESLint (`npm run lint`)**: 0 warnings, 0 errors.
- **Frontend Test Suite (`npm test`)**: 48 test files, 640 tests passing (including 11 dedicated tests in `src/test/m14dLiveFusion.test.ts`).
- **Production Build (`npm run build`)**: Clean Vite bundle compiled.
- **Native Rust Tests (`cargo test --manifest-path src-tauri/Cargo.toml --lib -j 1`)**: 82 passed, 0 failed.

---

## Conclusion
Milestone M14D.1 successfully hardens the M14D live strategy integration. Final Safety is fully restored to its strategic definition, Live Direction cleanly isolates real-time computer vision guidance, coverage damping follows the governed formula, and stale-state polling degradation is robustly bounded.
