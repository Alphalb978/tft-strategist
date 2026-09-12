# M14D — Trusted Live-State Strategy Integration

## Mission & Purpose
Integrate verified live screen intelligence (M14A window discovery, M14B shop vision, and M14C board/bench owned-unit tracking) into the live recommendation engine without violating core Strategist governance principles.

M14D fuses live client awareness with long-range meta and lobby scouting intelligence so that in-game recommendations dynamically reflect current board ownership and shop opportunities without eroding long-range strategic safety.

## Governing Authority & Hierarchy
1. Explicit current task packet (`tasks/M14D_TRUSTED_LIVE_STATE_STRATEGY_INTEGRATION.md`)
2. `AGENTS.md`
3. `docs/DECISIONS.md`
4. `docs/TFT_KNOWLEDGE.md`
5. `docs/RECOMMENDATION_ENGINE.md`

## Governed Strategy Formula

$$\text{FinalScore} = \text{BaseMeta} + \text{LobbyAdjustment} + (\text{LiveOwnedAffinity} + \text{LiveShopOpportunity}) \times \text{FreshnessFactor}$$

### 1. Zero Lobby Opponents Neutrality
- When 0 opponents exist in the lobby (e.g., Tocker's Trials / PvE, or incomplete scan before lobby participants resolve), `lobbyAdjustment` is **strictly 0.0**.
- The engine must **never fabricate opponent contest** and must **never award clean-lobby bonus** (`+4.0`) when evidence coverage is zero or unavailable.

### 2. Live Owned-Unit Affinity
- Core champion owned: `+1.5 pts` per copy.
- 2-star bonus ($\ge 3$ copies): `+1.0 pts`.
- Non-core target champion owned: `+0.75 pts`.
- Hard ceiling: `+8.0 pts`.
- Coverage damping: When computer vision identification coverage drops below $60\%$, affinity is multiplied by `(identityCoverage / 0.60)`.

### 3. Live Shop Opportunity
- Core champion in shop (confident/stable): `+1.5 pts`.
- Target flex champion in shop: `+0.5 pts`.
- Hard ceiling: `+3.0 pts`.

### 4. Freshness Decay Window
- $\le 2.5\text{s}$: Fresh (`1.0`).
- $2.5\text{s} - 5.0\text{s}$: Smooth linear decay to `0.0`.
- $\ge 5.0\text{s}$ or TFT window closed: `0.0` (clean neutral baseline).

### 5. Pressure Preservation & Selection Invariance
- **Lobby Pressure Invariance**: Live owned state cannot erase strong opponent contest pressure. Heavy lobby penalties (e.g., $-18.0$) remain dominant against modest owned gains ($+3.0$).
- **Plan Invariance**: The user's selected active plan is **never silently switched** by live screen updates. Dynamic re-scoring provides visual advice and alternative ranking without mutating locked decisions.

### 6. Pipeline Terminology
Authoritative documentation must designate this pipeline as **screen intelligence**, **computer vision**, or **live screen recognition/tracking** rather than OCR, as the recognition models operate on multi-zone template matching, health-bar occupancy detection, and color/feature classification.

---

## Validation Protocol & Results

M14D underwent dual-environment real validation:

### Environment A — Tocker's Trials / Solo PvE
- **Zero Opponent Neutrality**: Lobby adjustment evaluated to exactly `0.0`; no contest fabricated, no clean-lobby bonus erroneously granted.
- **Dynamic Live Modifiers**: Core pieces (+1.5) and shop pieces (+1.5) immediately reflected in score breakdown.
- **Coverage Damping**: Damping verified when unit identification coverage fell below 60%.
- **Freshness Decay**: 3.75s stale frame yielded exactly 50% decayed modifiers; window closure returned all modifiers to 0.0.
- **Comp Flip**: Globally stronger Comp A (`80.0`) was overtaken by Comp B (`75.0` base + `6.5` live owned/shop evidence = `81.5`).
- **Latency**: Strategy recomputation measured at `< 1 ms` (well within the $16\text{ ms}$ budget).

### Environment B — Normal / Ranked TFT (PvP Complete Fusion)
- **Pressure Governance**: Heavy lobby pressure ($-18.0$) combined with owned pieces ($+3.0$) maintained a net $-15.0$ penalty on contested comp.
- **Pivot Guidance**: Uncontested alternative gained an `11.5`-point relative lead, transparently advising the player toward open lines.
- **Coexistence**: Opponent route intelligence and computer vision screen intelligence coexisted cleanly in UI score decomposition with full transparency.
