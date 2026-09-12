import { describe, expect, it } from 'vitest';
import type { LobbyPressure, OpponentProfile } from '../domain/models';
import {
  calculateFreshnessFactor,
  calculateOwnedAffinity,
  calculateShopOpportunity,
  deriveLiveScreenModifiers,
  type LiveScreenState,
} from '../strategy/liveScreenFusion';
import { scoreCandidate } from '../strategy/scoring';
import {
  scoreHomeCandidates,
  lobbyAdjustment,
  DEFAULT_HOME_RECOMMENDATION_CONFIG,
} from '../strategy/homeScoring';
import type { ScreenShopStatus } from '../services/screenShop';
import type { ScreenOwnedUnitsStatus } from '../services/screenOwnedUnits';
import { data, playbooks } from './fixtures';

function createMockShop(slots: { championId: string | null; confidence?: number; stable?: boolean }[]): ScreenShopStatus {
  return {
    available: true,
    detected: true,
    frameAgeMs: 50,
    processingTimeMs: 10,
    recognitionVersion: 'shop-vision-v1',
    generation: 1,
    shopRegion: { x: 448, y: 920, width: 1000, height: 154 },
    slots: slots.map((s, index) => ({
      index,
      championId: s.championId,
      championName: s.championId ? s.championId.replace('TFT18_', '') : null,
      cost: 4,
      confidence: s.confidence ?? 0.95,
      stable: s.stable ?? true,
      rect: { x: 448 + index * 200, y: 920, width: 192, height: 154 },
    })),
  };
}

function createMockOwned(
  known: { championId: string; count?: number; confidence?: number }[],
  coverage = 1.0,
): ScreenOwnedUnitsStatus {
  return {
    available: true,
    detected: true,
    frameGeneration: 1,
    frameAgeMs: 50,
    processingTimeMs: 12,
    recognitionVersion: 'board-vision-v1',
    benchLayoutVersion: 'tft-bench-1080p-v1',
    boardLayoutVersion: 'tft-board-1080p-v1',
    identityCoverage: coverage,
    knownOwned: known.map((k) => ({
      championId: k.championId,
      championName: k.championId.replace('TFT18_', ''),
      knownTrackCount: k.count ?? 1,
      knownCopyEquivalent: k.count ?? 1,
      confidence: k.confidence ?? 0.95,
    })),
    bench: [],
    board: [],
  };
}

function createMockOpponent(puuid: string, now: string): OpponentProfile {
  return {
    puuid,
    riotId: `Opponent#${puuid}`,
    generatedAt: now,
    sourceMatchIds: [],
    set: 18,
    patch: '18.1',
    derivationVersion: 'm4-v1',
    effectiveSample: 10,
    relevantGames: 10,
    confidenceFactors: {
      sampleCoverage: 1.0,
      modeQuality: 1.0,
      patchQuality: 1.0,
      recencyQuality: 1.0,
    },
    compFrequencies: [],
    recurringUnits: [],
    recurringHolders: [],
    styleTendencies: { rerollTendency: 0.3, tempoTendency: 0.5, fast8Tendency: 0.2 },
    flexIndex: 0.5,
    forceIndex: 0.5,
    recentPlacements: [1, 2, 3, 4],
    avgPlacement: 2.5,
    top4Rate: 1.0,
    winRate: 0.25,
  } as unknown as OpponentProfile;
}

describe('D13 — Real Validation (M14D)', () => {
  const compA = playbooks[0];
  const compB = playbooks[1];
  const coreA = compA.family.core[0];
  const coreB = compB.family.core[0];

  describe('A) Tocker’s Trials Environment (Solo PvE)', () => {
    it('calculates owned-unit affinity with matching core and target pieces', () => {
      const owned = createMockOwned([
        { championId: coreB, count: 3 }, // 2-star core unit
      ]);

      const affinityB = calculateOwnedAffinity(compB, owned, 1.0, data);
      expect(affinityB.score).toBeGreaterThan(0);
      // 1.5 core base + 1.0 star bonus = 2.5
      expect(affinityB.score).toBe(2.5);
      expect(affinityB.label).toContain('2★');

      // Comp A has zero matching units
      const affinityA = calculateOwnedAffinity(compA, owned, 1.0, data);
      expect(affinityA.score).toBe(0);
    });

    it('applies governed identity-coverage damping formula', () => {
      // compB has core units. 2 core units held => rawScore = 1.5 + 1.5 = 3.0
      const core1 = compB.family.core[0];
      const core2 = compB.family.core[1] ?? compB.target.units[1]?.championId;

      // 100% coverage => factor 1.0 (no damping) -> 3.0
      const cov100 = createMockOwned([{ championId: core1, count: 1 }, { championId: core2, count: 1 }], 1.0);
      expect(calculateOwnedAffinity(compB, cov100, 1.0, data).score).toBe(3.0);

      // 80% coverage => factor 1.0 (no damping, >= 60%) -> 3.0
      const cov80 = createMockOwned([{ championId: core1, count: 1 }, { championId: core2, count: 1 }], 0.8);
      expect(calculateOwnedAffinity(compB, cov80, 1.0, data).score).toBe(3.0);

      // 60% coverage => factor 1.0 (no damping, >= 60%) -> 3.0
      const cov60 = createMockOwned([{ championId: core1, count: 1 }, { championId: core2, count: 1 }], 0.6);
      expect(calculateOwnedAffinity(compB, cov60, 1.0, data).score).toBe(3.0);

      // 50% coverage => factor 50/60 (0.83333...) -> 3.0 * (50/60) = 2.5
      const cov50 = createMockOwned([{ championId: core1, count: 1 }, { championId: core2, count: 1 }], 0.5);
      expect(calculateOwnedAffinity(compB, cov50, 1.0, data).score).toBe(2.5);

      // 30% coverage => factor 30/60 = 0.5 -> 3.0 * 0.5 = 1.5
      const cov30 = createMockOwned([{ championId: core1, count: 1 }, { championId: core2, count: 1 }], 0.3);
      expect(calculateOwnedAffinity(compB, cov30, 1.0, data).score).toBe(1.5);

      // 0% coverage => zero owned contribution
      const cov0 = createMockOwned([{ championId: core1, count: 1 }, { championId: core2, count: 1 }], 0.0);
      expect(calculateOwnedAffinity(compB, cov0, 1.0, data).score).toBe(0.0);
    });

    it('calculates immediate shop opportunity and updates when shop changes', () => {
      const shopWithB = createMockShop([
        { championId: coreB },
        { championId: null },
        { championId: null },
        { championId: null },
        { championId: null },
      ]);

      const shopRerolled = createMockShop([
        { championId: coreA },
        { championId: null },
        { championId: null },
        { championId: null },
        { championId: null },
      ]);

      const oppBInitial = calculateShopOpportunity(compB, shopWithB, 1.0, data);
      expect(oppBInitial.score).toBe(1.5);

      // Shop rerolled -> coreB disappears, boost immediately returns to 0 for Comp B
      const oppBRerolled = calculateShopOpportunity(compB, shopRerolled, 1.0, data);
      expect(oppBRerolled.score).toBe(0);

      // Comp A now receives shop opportunity
      const oppARerolled = calculateShopOpportunity(compA, shopRerolled, 1.0, data);
      expect(oppARerolled.score).toBe(1.5);
    });

    it('decays freshness smoothly between 2.5s and 5.0s and expires at >=5.0s', () => {
      const freshLive: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 500,
        shopStatus: createMockShop([{ championId: coreB }]),
        ownedStatus: createMockOwned([{ championId: coreB }]),
      };

      const agingLive: LiveScreenState = {
        ...freshLive,
        frameAgeMs: 3750, // Halfway between 2500 and 5000
      };

      const expiredLive: LiveScreenState = {
        ...freshLive,
        frameAgeMs: 5000,
      };

      const longExpiredLive: LiveScreenState = {
        ...freshLive,
        frameAgeMs: 6000,
      };

      const closedTftLive: LiveScreenState = {
        available: false,
        detected: false,
        frameAgeMs: 99999,
        shopStatus: null,
        ownedStatus: null,
      };

      expect(calculateFreshnessFactor(freshLive)).toBe(1.0);
      expect(calculateFreshnessFactor(agingLive)).toBeCloseTo(0.5, 1);
      expect(calculateFreshnessFactor(expiredLive)).toBe(0.0);
      expect(calculateFreshnessFactor(longExpiredLive)).toBe(0.0);
      expect(calculateFreshnessFactor(closedTftLive)).toBe(0.0);

      // Closed TFT returns live modifiers to zero
      const closedModifiers = deriveLiveScreenModifiers(compB, closedTftLive, data);
      expect(closedModifiers.total).toBe(0);
      expect(closedModifiers.ownedAffinity).toBe(0);
      expect(closedModifiers.shopOpportunity).toBe(0);
    });

    it('ensures elapsed wall-clock time causes stale decay even if polling fails repeatedly', () => {
      const t0 = Date.now();
      const snapshot: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 200,
        shopStatus: createMockShop([{ championId: coreB }]),
        ownedStatus: createMockOwned([{ championId: coreB }]),
        lastUpdated: new Date(t0).toISOString(),
      };

      // At t0: fresh (factor 1.0)
      expect(calculateFreshnessFactor(snapshot, t0)).toBe(1.0);

      // 3.5s later without new poll: decaying
      const t1 = t0 + 3500;
      expect(calculateFreshnessFactor(snapshot, t1)).toBeLessThan(1.0);
      expect(calculateFreshnessFactor(snapshot, t1)).toBeGreaterThan(0.0);

      // 5.5s later without new poll: expired (zero contribution)
      const t2 = t0 + 5500;
      expect(calculateFreshnessFactor(snapshot, t2)).toBe(0.0);
    });

    it('handles live screen service lifecycle: polling failures advance stale age, >=5s zeroes modifiers, and recovery restores evidence', () => {
      // 1. Initial fresh state emitted by service
      const freshState: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 100,
        shopStatus: createMockShop([{ championId: coreB }]),
        ownedStatus: createMockOwned([{ championId: coreB, count: 1 }]),
        lastUpdated: new Date().toISOString(),
      };
      expect(calculateFreshnessFactor(freshState)).toBe(1.0);
      expect(deriveLiveScreenModifiers(compB, freshState, data).total).toBeGreaterThan(0);

      // 2. Simulated status polling failure over 6 seconds
      const t0 = Date.now();
      const failedStateAt6s: LiveScreenState = {
        ...freshState,
        available: false,
        detected: false,
        frameAgeMs: 6100,
        lastUpdated: new Date(t0 + 6000).toISOString(),
      };
      expect(calculateFreshnessFactor(failedStateAt6s)).toBe(0.0);
      expect(deriveLiveScreenModifiers(compB, failedStateAt6s, data).total).toBe(0.0);

      // 3. Successful polling recovery
      const recoveredState: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 50,
        shopStatus: createMockShop([{ championId: coreB }]),
        ownedStatus: createMockOwned([{ championId: coreB, count: 1 }]),
        lastUpdated: new Date(t0 + 7000).toISOString(),
      };
      expect(calculateFreshnessFactor(recoveredState)).toBe(1.0);
      expect(deriveLiveScreenModifiers(compB, recoveredState, data).total).toBeGreaterThan(0);
    });

    it('strictly preserves neutral lobby without fabricating contest or awarding clean bonus', () => {
      // In Tocker's Trials, lobby has 0 opponents or is undefined
      const emptyLobby = {
        profiles: [],
        coverage: 0,
        state: 'unavailable',
        relevantGamesAvailable: 0,
        unitPressure: [],
      } as unknown as LobbyPressure;

      const candidateNoLobby = scoreCandidate(compA, {
        data,
        version: data.version,
        now: new Date().toISOString(),
        lobby: undefined,
      });

      const candidateEmptyLobby = scoreCandidate(compA, {
        data,
        version: data.version,
        now: new Date().toISOString(),
        lobby: emptyLobby,
      });

      expect(candidateNoLobby.contest.state).toBe('Unavailable');
      expect(candidateNoLobby.contest.evidenceCoverage).toBe(0);
      expect(lobbyAdjustment(candidateNoLobby.contest, DEFAULT_HOME_RECOMMENDATION_CONFIG)).toBe(0);

      expect(candidateEmptyLobby.contest.state).toBe('Unavailable');
      expect(candidateEmptyLobby.contest.evidenceCoverage).toBe(0);
      expect(lobbyAdjustment(candidateEmptyLobby.contest, DEFAULT_HOME_RECOMMENDATION_CONFIG)).toBe(0);
    });

    it('strictly preserves Final Safety formula while separating Live Direction', () => {
      const now = new Date().toISOString();

      const baseRecs = scoreHomeCandidates([compA, compB], {
        data,
        now,
        config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      });

      const liveScreen: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 100,
        shopStatus: createMockShop([{ championId: compB.family.core[0] }]),
        ownedStatus: createMockOwned([
          { championId: compB.family.core[0], count: 3 }, // 2-star = 2.5
        ]),
      };

      const liveRecs = scoreHomeCandidates([compA, compB], {
        data,
        now,
        config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
        liveScreen,
      });

      const baseB = baseRecs.find((r) => r.playbook.id === compB.id)!;
      const liveB = liveRecs.find((r) => r.playbook.id === compB.id)!;

      // 1. Final Safety formula: round(basePerformance + lowPickEdge + lobbyAdjustment)
      const expectedFinalSafety = Math.round(
        (baseB.home!.basePerformance + baseB.home!.lowPickEdge + baseB.home!.lobbyAdjustment) * 10,
      ) / 10;
      expect(baseB.home?.finalSafety).toBe(expectedFinalSafety);

      // 2. Final Safety MUST NOT change from live owned/shop state
      expect(liveB.home?.finalSafety).toBe(baseB.home?.finalSafety);

      // 3. Live Direction contains live additions
      expect(liveB.home?.liveOwnedAffinity).toBe(2.5);
      expect(liveB.home?.liveShopOpportunity).toBe(1.5);
      expect(liveB.home?.liveDirection).toBe(
        Math.round((liveB.home!.finalSafety + liveB.home!.liveOwnedAffinity! + liveB.home!.liveShopOpportunity!) * 10) / 10,
      );

      // 4. No screen state => Live Direction exactly equals Final Safety
      expect(baseB.home?.liveDirection).toBe(baseB.home?.finalSafety);
    });

    it('demonstrates live comp preference flip via Live Direction while keeping selected plan immutable', () => {
      const now = new Date().toISOString();

      // User has selected Comp A
      const userSelectedPlanId = compA.id;

      // Comp A vs Comp B on Home
      const baseline = scoreHomeCandidates([compA, compB], {
        data,
        now,
        config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      });
      const baseA = baseline.find((r) => r.playbook.id === compA.id)!;
      const baseB = baseline.find((r) => r.playbook.id === compB.id)!;

      // Player owns 2 core pieces for Comp B + sees Comp B core in shop
      const liveScreen: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 100,
        shopStatus: createMockShop([{ championId: compB.family.core[0] }]),
        ownedStatus: createMockOwned([
          { championId: compB.family.core[0], count: 3 }, // 2-star = 2.5
          { championId: compB.family.core[1] ?? compB.target.units[1]?.championId, count: 1 }, // 1.5
        ]), // Total owned = 4.0, Shop = 1.5 -> Live boost = +5.5
      };

      const liveHome = scoreHomeCandidates([compA, compB], {
        data,
        now,
        config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
        liveScreen,
      });

      const liveA = liveHome.find((r) => r.playbook.id === compA.id)!;
      const liveB = liveHome.find((r) => r.playbook.id === compB.id)!;

      // Comp B Live Direction increased by its live modifiers (+5.5)
      expect(liveB.home?.liveOwnedAffinity).toBeGreaterThanOrEqual(2.5);
      expect(liveB.home?.liveShopOpportunity).toBe(1.5);
      expect(liveB.home?.liveDirection).toBeGreaterThan(baseB.home!.liveDirection!);
      expect(liveB.score).toBeGreaterThan(baseB.score);
      expect(liveA.score).toBe(baseA.score);

      // Final Safety remains strictly unchanged
      expect(liveB.home?.finalSafety).toBe(baseB.home?.finalSafety);
      expect(liveA.home?.finalSafety).toBe(baseA.home?.finalSafety);

      // Selected active plan remains immutable
      expect(userSelectedPlanId).toBe(compA.id);
    });

    it('recomputes candidate recommendations within interactive budget (<16ms for 25 comps)', () => {
      const comps = playbooks.slice(0, 25);

      const liveScreen: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 100,
        shopStatus: createMockShop([{ championId: coreA }]),
        ownedStatus: createMockOwned([{ championId: coreA, count: 2 }]),
      };

      const t0 = performance.now();
      const rescored = scoreHomeCandidates(comps, {
        data,
        now: new Date().toISOString(),
        config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
        liveScreen,
      });
      const elapsed = performance.now() - t0;

      expect(rescored.length).toBe(comps.length);
      expect(elapsed).toBeLessThan(16);
    });
  });

  describe('B) Normal / Ranked TFT Environment (PvP Complete Fusion)', () => {
    it('validates complete 4-factor fusion: global meta + lobby contest + owned units + current shop', () => {
      const now = new Date().toISOString();

      // Full 7-opponent PvP lobby with heavy pressure on Comp A's core units
      const pvpLobby = {
        profiles: Array.from({ length: 7 }, (_, i) => createMockOpponent(`opp-${i + 1}`, now)),
        coverage: 1.0,
        state: 'complete',
        relevantGamesAvailable: 70,
        unitPressure: [
          {
            championId: coreA,
            opponentsWithEvidence: 3,
            equivalentHistoricalUsers: 3.5,
            recentSpikeEquivalentUsers: 0,
            historicalCopyEquivalentUsers: 0,
            totalEquivalentUsers: 3.5,
            normalizedPressure: 0.95,
            evidenceCoverage: 1.0,
            sourceOpponents: [],
          },
        ],
      } as unknown as LobbyPressure;

      // Player holds 1 copy of coreA (+1.5 owned), and coreA is in shop (+1.5 shop)
      const liveScreen: LiveScreenState = {
        available: true,
        detected: true,
        frameAgeMs: 100,
        shopStatus: createMockShop([{ championId: coreA }]),
        ownedStatus: createMockOwned([{ championId: coreA, count: 1 }]),
      };

      const results = scoreHomeCandidates([compA, compB], {
        data,
        now,
        config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
        lobby: pvpLobby,
        liveScreen,
      });

      const candidateA = results.find((r) => r.playbook.id === compA.id)!;
      const candidateB = results.find((r) => r.playbook.id === compB.id)!;

      // 1. Contested comp remains penalized despite player holding owned pieces
      expect(candidateA.home?.lobbyAdjustment).toBeLessThan(0);
      expect(candidateA.home?.liveOwnedAffinity).toBe(1.5);
      expect(candidateA.home?.liveShopOpportunity).toBe(1.5);

      // Final Safety excludes live state; Live Direction includes it
      expect(candidateA.home?.finalSafety).toBe(
        Math.round(
          (candidateA.home!.basePerformance + candidateA.home!.lowPickEdge + candidateA.home!.lobbyAdjustment) * 10,
        ) / 10,
      );
      expect(candidateA.home?.liveDirection).toBe(
        Math.round((candidateA.home!.finalSafety + 3.0) * 10) / 10,
      );

      // Even with +3.0 live modifiers, the contest penalty keeps pressure
      expect(candidateA.home?.lobbyAdjustment).toBeLessThanOrEqual(-5);

      // 2. Uncontested comp gains relative value from clean lobby
      expect(candidateB.home?.lobbyAdjustment).toBeGreaterThanOrEqual(0);

      // 3. Live owned state does not erase strong lobby pressure
      expect(candidateB.home?.liveDirection).toBeGreaterThan(candidateA.home!.liveDirection!);
      expect(candidateB.score).toBeGreaterThan(candidateA.score);

      // 4. Opponent data and screen data coexist correctly in breakdown
      expect(candidateA.home?.basePerformance).toBeGreaterThan(0);
      expect(candidateA.home?.liveOwnedAffinity).toBe(1.5);
      expect(candidateA.home?.liveShopOpportunity).toBe(1.5);
      expect(candidateA.reasons.some((r) => r.includes('live'))).toBe(true);
    });
  });
});
