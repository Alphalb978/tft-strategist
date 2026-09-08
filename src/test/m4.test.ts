import { describe, expect, it } from 'vitest';
import type {
  CompletedMatch,
  LobbyPressure,
  OpponentProfile,
  RecommendationCandidate,
} from '../domain/models';
import { FixtureRiotProvider } from '../providers/riot';
import { deriveOpponent, scanLobby } from '../services/scouting';
import { MemoryHistoryStore } from '../storage/history';
import {
  deriveLobbyUnitPressure,
  gameRecencyWeight,
  M4_UNIT_MODEL,
} from '../strategy/lobbyPressure';
import { optimizePortfolio } from '../strategy/portfolio';
import { contestFor, scoreCandidate } from '../strategy/scoring';
import { data, match, NOW, playbooks } from './fixtures';

const unitId = playbooks[0].hero;
const alternateUnitId = playbooks[0].target.units.find(
  (unit) => unit.championId !== unitId,
)!.championId;

function unitSeries(
  puuid: string,
  presences: boolean[],
  stars: number[] = [],
  championId = unitId,
): CompletedMatch[] {
  return presences.map((present, index) => {
    const value = match(`m4-${puuid}-${index}`, [puuid], null);
    value.completedAt = new Date(Date.parse(NOW) - index * 86_400_000).toISOString();
    value.gameTimestamp = value.completedAt;
    value.participants[0].units = present
      ? [
          {
            championId,
            items: [],
            stars: stars[index] ?? 1,
            rarity: null,
            rawName: null,
            unresolvedUnit: false,
            unresolvedItems: [],
          },
        ]
      : [];
    return value;
  });
}

function completeLobby(
  profiles: OpponentProfile[],
  unitIds = [unitId, alternateUnitId],
): LobbyPressure {
  const unitPressure = deriveLobbyUnitPressure(profiles, unitIds);
  return {
    state: 'complete',
    expectedOpponents: 7,
    requestedOpponents: 7,
    resolvedOpponents: profiles.length,
    profilesCompleted: profiles.length,
    profiles,
    unitPressure,
    unitPressureVersion: M4_UNIT_MODEL.version,
    coverage: 1,
    relevantGamesAvailable: profiles.reduce((sum, profile) => sum + profile.relevantGames, 0),
    relevantGamesTarget: 140,
    freshProfiles: profiles.length,
    cachedProfiles: 0,
    acquisitionMs: 0,
    derivationMs: 0,
    elapsedMs: 0,
    telemetry: {
      requestsAttempted: 0,
      cacheHits: 0,
      retries: 0,
      rateLimitWaits: 0,
      rateLimitWaitMs: 0,
      uniqueMatchDetailsFetched: 0,
      sharedMatchesDeduplicated: 0,
    },
    fetchedAt: NOW,
    errors: [],
  };
}

describe('M4 opponent unit-history derivation', () => {
  it('defaults to 10 relevant games while preserving 15 and 20 targets', async () => {
    const source = Array.from({ length: 20 }, (_, index) => match(`default-${index}`, ['a'], null));
    const defaultResult = await scanLobby(
      ['a'],
      new FixtureRiotProvider(source, []),
      new MemoryHistoryStore(),
      { set: 18, patch: '18.1', now: NOW },
    );
    expect(defaultResult.relevantGamesTarget).toBe(10);
    expect(defaultResult.profiles[0].relevantGames).toBe(10);
    for (const target of [15, 20] as const) {
      const result = await scanLobby(
        ['a'],
        new FixtureRiotProvider(source, []),
        new MemoryHistoryStore(),
        { set: 18, patch: '18.1', now: NOW, historyWindow: target },
      );
      expect(result.relevantGamesTarget).toBe(target);
      expect(result.profiles[0].relevantGames).toBe(target);
    }
  });

  it('smoothly gives newer games more weight without one game dominating twenty', () => {
    const weights = Array.from({ length: 20 }, (_, index) =>
      gameRecencyWeight(index, new Date(Date.parse(NOW) - index * 86_400_000).toISOString(), NOW),
    );
    expect(weights.every((weight, index) => index === 0 || weight < weights[index - 1])).toBe(true);
    expect(weights.slice(0, 5).reduce((a, b) => a + b) / 5).toBeGreaterThan(
      2 * (weights.slice(15).reduce((a, b) => a + b) / 5),
    );
    expect(weights[0] / weights.reduce((a, b) => a + b)).toBeLessThan(0.1);
  });

  it('tracks a 4/5 recent spike separately from the prior window', () => {
    const pattern = [
      true,
      true,
      true,
      true,
      false,
      ...Array(6).fill(false),
      true,
      ...Array(8).fill(false),
    ];
    const evidence = deriveOpponent('a', unitSeries('a', pattern), 18, '18.1', NOW, 20).unitEvidence[0];
    expect(evidence).toMatchObject({
      gamesAppeared: 5,
      sampleGames: 20,
      recentFiveAppearances: 4,
      recentWindowGames: 5,
      recentFiveRate: 0.8,
      priorAppearances: 1,
      priorWindowGames: 15,
      trend: 'rising',
    });
    expect(evidence.trendDelta).toBeCloseTo(0.8 - 1 / 15);
  });

  it('keeps a historically common unit while its last-five trend falls', () => {
    const pattern = [...Array(5).fill(false), ...Array(15).fill(true)];
    const evidence = deriveOpponent('a', unitSeries('a', pattern), 18, '18.1', NOW, 20).unitEvidence[0];
    expect(evidence.gamesAppeared).toBe(15);
    expect(evidence.weightedPresence).toBeGreaterThan(0);
    expect(evidence.recentFiveAppearances).toBe(0);
    expect(evidence.trend).toBe('falling');
  });

  it('retains correct raw and weighted presence for a known fixture', () => {
    const source = unitSeries('a', [true, false, true, false]);
    const profile = deriveOpponent('a', source, 18, '18.1', NOW, 4);
    const weights = source.map((game, index) => gameRecencyWeight(index, game.completedAt, NOW));
    const evidence = profile.unitEvidence[0];
    expect(evidence.rawPresenceRate).toBe(0.5);
    expect(evidence.weightedPresence).toBeCloseTo(
      (weights[0] + weights[2]) / weights.reduce((sum, value) => sum + value),
      8,
    );
    expect(profile.unitFrequency[unitId]).toBeCloseTo(evidence.weightedPresence, 8);
  });

  it('uses verified ordinary star-copy math and fails closed for unsupported evidence', () => {
    const source = unitSeries('a', [true, true, true, true], [1, 2, 3, 4]);
    const profile = deriveOpponent('a', source, 18, '18.1', NOW, 4, 'fresh', undefined, {
      copyEligibleUnitIds: new Set([unitId]),
      staticSourceVersion: data.version.sourceVersion,
    });
    const evidence = profile.unitEvidence[0];
    const weights = source.map((game, index) => gameRecencyWeight(index, game.completedAt, NOW));
    expect(evidence.historicalCopyDemand.status).toBe('verified-ordinary');
    expect(evidence.historicalCopyDemand.evidenceGames).toBe(3);
    expect(evidence.historicalCopyDemand.evidenceCoverage).toBe(0.75);
    expect(evidence.historicalCopyDemand.weightedAverageFinalCopies).toBeCloseTo(
      (weights[0] + 3 * weights[1] + 9 * weights[2]) / (weights[0] + weights[1] + weights[2]),
      8,
    );
    const unsupported = deriveOpponent('a', source, 18, '18.1', NOW, 4, 'fresh', undefined, {
      copyEligibleUnitIds: new Set(),
    }).unitEvidence[0];
    expect(unsupported.historicalCopyDemand).toMatchObject({
      status: 'unavailable',
      evidenceGames: 0,
      weightedAverageFinalCopies: null,
      weightedDemand: null,
    });
  });
});

describe('M4 lobby pressure, candidate fit, and portfolio exposure', () => {
  const profiles = Array.from({ length: 7 }, (_, index) => {
    const profile = deriveOpponent(
      `p${index}`,
      unitSeries(`p${index}`, Array(20).fill(true)),
      18,
      '18.1',
      NOW,
    );
    return { ...profile, confidence: 1 };
  });

  it('aggregates seven profiles into deterministic equivalent historical users', () => {
    const [pressure] = deriveLobbyUnitPressure(profiles, [unitId]);
    expect(pressure.opponentsWithEvidence).toBe(7);
    expect(pressure.equivalentHistoricalUsers).toBe(7);
    expect(pressure.totalEquivalentUsers).toBe(7);
    expect(pressure.normalizedPressure).toBe(1);
    expect(pressure.sourceOpponents).toHaveLength(7);
  });

  it('makes equivalent low-confidence evidence contribute less pressure', () => {
    const high = deriveLobbyUnitPressure(profiles, [unitId])[0];
    const low = deriveLobbyUnitPressure(
      profiles.map((profile) => ({ ...profile, confidence: 0.2 })),
      [unitId],
    )[0];
    expect(low.equivalentHistoricalUsers).toBeCloseTo(1.4);
    expect(low.normalizedPressure).toBeLessThan(high.normalizedPressure);
    expect(low.evidenceCoverage).toBeCloseTo(0.2);
  });

  it('penalizes a critical carry overlap much more than a low-criticality flex overlap', () => {
    const lobby = completeLobby(profiles);
    const core = structuredClone(playbooks[0]);
    core.family.core = [unitId];
    core.roles = [{ championId: unitId, role: 'carry' }];
    core.features.unitCriticality = { [unitId]: 1 };
    const flex = structuredClone(core);
    flex.family.core = [];
    flex.roles = [{ championId: unitId, role: 'support' }];
    flex.features.unitCriticality = { [unitId]: 0.25 };
    expect(contestFor(core, lobby).value!).toBeGreaterThan(8 * contestFor(flex, lobby).value!);
  });

  it('can change candidate ordering through the explicit lobby component', () => {
    const pressured = structuredClone(playbooks[0]);
    pressured.id = 'pressured';
    pressured.features.values.itemFlex = 80;
    pressured.family.core = [unitId];
    pressured.roles = [{ championId: unitId, role: 'carry' }];
    pressured.features.unitCriticality = { [unitId]: 1 };
    const alternate = structuredClone(pressured);
    alternate.id = 'alternate';
    alternate.features.values.itemFlex = 79;
    alternate.family.core = [alternateUnitId];
    alternate.roles = [{ championId: alternateUnitId, role: 'carry' }];
    alternate.features.unitCriticality = { [alternateUnitId]: 1 };
    const context = { version: data.version, now: NOW };
    expect(scoreCandidate(pressured, context).score).toBeGreaterThan(
      scoreCandidate(alternate, context).score,
    );
    const lobby = completeLobby(profiles);
    expect(scoreCandidate(pressured, { ...context, lobby }).score).toBeLessThan(
      scoreCandidate(alternate, { ...context, lobby }).score,
    );
  });

  it('reduces redundant high-pressure exposure when an alternative exists', () => {
    const lobby = completeLobby(profiles);
    const makeCandidate = (
      id: string,
      score: number,
      exposed: boolean,
    ): RecommendationCandidate => {
      const playbook = structuredClone(playbooks[0]);
      playbook.id = id;
      playbook.family.id = id;
      playbook.family.core = [`unique-${id}`];
      playbook.features.itemCoverage = [id];
      playbook.features.openingCoverage = [id];
      playbook.features.style = id;
      playbook.roles = [];
      playbook.features.unitCriticality = { [exposed ? unitId : alternateUnitId]: 1 };
      return { ...scoreCandidate(playbook, { version: data.version, now: NOW, lobby }), score };
    };
    const result = optimizePortfolio(
      [
        makeCandidate('A', 90, true),
        makeCandidate('B', 89, true),
        makeCandidate('C', 88, true),
        makeCandidate('D', 87, false),
      ],
      NOW,
    );
    expect(result.plans.map((plan) => plan.candidate.playbook.id)).toContain('D');
    expect(
      result.interactions.find((interaction) => interaction.label.includes('pressured-unit'))!
        .value,
    ).toBeLessThan(0);
  });
});
