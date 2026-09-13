import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import captured from '../../data/fixtures/metatft-public.json';
import {
  normalizeProviderDifficulty,
  normalizeProviderTier,
  normalizePublicComps,
  publicCompMetadata,
  type PublicCompRow,
} from '../../scripts/metatft-normalize';
import { CompMetaBadges, ExternalCompLineup } from '../components/CompEnrichment';
import type { ExternalSnapshot } from '../domain/externalMeta';
import type { Playbook, RecommendationCandidate, RecommendationPortfolio } from '../domain/models';
import { Home, primaryRecommendationRole } from '../features/Home';
import {
  createRecommendations,
  rescoreHomeRecommendations,
  type ApplicationState,
} from '../services/application';
import { defaultSettings } from '../storage/repository';
import { difficultyPreferenceAdjustment, scoreHomeCandidates } from '../strategy/homeScoring';
import { data, NOW, playbooks } from './fixtures';

function pageRow(overrides: Partial<PublicCompRow> = {}): PublicCompRow {
  return {
    providerCompId: '423000',
    tier: 'S',
    difficulty: 'Easy',
    levelingStyle: 'Fast 8',
    packages: [
      {
        holder: 'Aphelios',
        items: ['DA_Deathblade', 'DA_GuinsoosRageblade', 'DA_KrakensFury'],
      },
    ],
    ...overrides,
  };
}

function normalized(rows?: PublicCompRow[]) {
  return normalizePublicComps({ ...captured, ...(rows ? { pageComps: rows } : {}) }, data, NOW);
}

function exactExternal(
  plans: Playbook[],
  difficulties: Array<'easy' | 'medium' | 'hard' | 'unknown'>,
  averages = plans.map(() => 4),
): ExternalSnapshot {
  const snapshot = normalized();
  snapshot.comps = plans.map((plan, index) => ({
    ...snapshot.comps[index],
    id: `exact-${index}`,
    name: plan.title,
    units: plan.target.units.map((unit) => unit.championId),
    core: plan.family.core,
    difficulty: difficulties[index],
    providerTier: 'A',
    levelingStyle: plan.features.style,
    style: plan.features.style,
    packages: [],
    stats: {
      sampleMethod: 'provider-histogram',
      playRateMethod: 'participant-board-share',
      sample: 20_000,
      average: averages[index],
      top4: averages[index] <= 4 ? 0.7 : 0.35,
      win: averages[index] <= 4 ? 0.2 : 0.04,
      playRate: 0.02,
    },
  }));
  return snapshot;
}

function candidateWithDisplayScores(
  index: number,
  finalSafety: number,
  liveDirection = finalSafety,
  difficultyPreferenceAdjustment = 0,
): RecommendationCandidate {
  const plan = playbooks[index];
  const [candidate] = scoreHomeCandidates([plan], {
    data,
    now: NOW,
    config: defaultSettings.homeRecommendation,
    external: exactExternal([plan], ['unknown']),
    difficultyPreference: 'anything',
  });
  return {
    ...candidate,
    score: liveDirection + difficultyPreferenceAdjustment,
    home: {
      ...candidate.home!,
      finalSafety,
      liveDirection,
      liveOwnedAffinity: Math.max(0, liveDirection - finalSafety),
      liveShopOpportunity: 0,
      difficultyPreferenceAdjustment,
    },
  };
}

describe('MetaTFT explicit comp enrichment ingestion', () => {
  it('1-4 maps only explicit Easy, Medium and Hard labels and fails ambiguous/missing labels to unknown', () => {
    expect(normalizeProviderDifficulty('Easy')).toBe('easy');
    expect(normalizeProviderDifficulty('Medium')).toBe('medium');
    expect(normalizeProviderDifficulty('Hard')).toBe('hard');
    expect(normalizeProviderDifficulty(undefined)).toBe('unknown');
    expect(normalizeProviderDifficulty('Easy / Hard')).toBe('unknown');
    expect(
      publicCompMetadata('S\nExample\nFast 8\nEasy\nHard', '1', 'Example', 'Fast 8')?.difficulty,
    ).toBeNull();
  });

  it('5 captures tier only from an explicit conservative provider label', () => {
    expect(normalizeProviderTier('S')).toBe('S');
    expect(normalizeProviderTier('a+')).toBe('A+');
    expect(normalizeProviderTier('Top')).toBeNull();
    expect(normalizeProviderTier(1)).toBeNull();
  });

  it('6 keeps leveling style scoped to the joined provider comp', () => {
    const comp = normalized([pageRow({ levelingStyle: 'Fast 8' })]).comps.find(
      (entry) => entry.id === '423000',
    );
    expect(comp?.levelingStyle).toBe('Fast 8');
    expect(comp?.metadataProvenance?.levelingStyle?.providerCompId).toBe('423000');
  });

  it('7 maps a rendered package that agrees with the structured build to canonical IDs', () => {
    const comp = normalized([pageRow()]).comps.find((entry) => entry.id === '423000')!;
    expect(comp.packages[0]).toMatchObject({
      holder: 'DA_18_Aphelios',
      items: ['DA_Deathblade', 'DA_GuinsoosRageblade', 'DA_KrakensFury'],
      source: 'MetaTFT',
      providerCompId: '423000',
      set: 18,
      patch: '18.2',
      evidence: 'structured-build+public-comp-row',
    });
  });

  it('8 skips rather than guesses an unmapped package below the safety threshold', () => {
    const rows = Array.from({ length: 10 }, () => pageRow().packages[0]);
    rows.push({ holder: 'NotAChampion', items: ['NotAnItem'] });
    const snapshot = normalized([pageRow({ packages: rows })]);
    const comp = snapshot.comps.find((entry) => entry.id === '423000')!;
    expect(comp.packages.some((pkg) => pkg.holder === 'NotAChampion')).toBe(false);
    expect(
      snapshot.manifest.warnings.some((warning) =>
        warning.includes('Skipped unverified item package'),
      ),
    ).toBe(true);
  });

  it('9 still fails closed for a patch mismatch', () => {
    expect(() =>
      normalizePublicComps({ ...captured, patch: { ...captured.patch, patch: '18.3' } }, data, NOW),
    ).toThrow(/patch mismatch/i);
  });

  it('10 keeps the captured Patch 18.2 snapshot valid', () => {
    const snapshot = normalized();
    expect(snapshot.manifest.scope).toMatchObject({ set: 18, patch: '18.2', queue: 1100 });
    expect(snapshot.comps.length).toBeGreaterThan(40);
  });
});

describe('bounded player difficulty preference', () => {
  it('11-15 produces zero for Anything, mismatches and unknown, and exactly +3 for a match', () => {
    expect(difficultyPreferenceAdjustment('anything', 'easy')).toBe(0);
    expect(difficultyPreferenceAdjustment('easy', 'easy')).toBe(3);
    expect(difficultyPreferenceAdjustment('easy', 'medium')).toBe(0);
    expect(difficultyPreferenceAdjustment('easy', 'hard')).toBe(0);
    expect(difficultyPreferenceAdjustment('easy', 'unknown')).toBe(0);
  });

  it('16-17 never changes Final Safety or Live Direction', () => {
    const external = exactExternal([playbooks[0]], ['easy']);
    const base = scoreHomeCandidates([playbooks[0]], {
      data,
      now: NOW,
      config: defaultSettings.homeRecommendation,
      external,
      difficultyPreference: 'anything',
    })[0];
    const preferred = scoreHomeCandidates([playbooks[0]], {
      data,
      now: NOW,
      config: defaultSettings.homeRecommendation,
      external,
      difficultyPreference: 'easy',
    })[0];
    expect(preferred.home?.finalSafety).toBe(base.home?.finalSafety);
    expect(preferred.home?.liveDirection).toBe(base.home?.liveDirection);
    expect(preferred.score - base.score).toBe(3);
  });

  it('18 can reorder two strategically tied candidates without hiding either', () => {
    const external = exactExternal([playbooks[0], playbooks[1]], ['medium', 'easy']);
    const result = scoreHomeCandidates([playbooks[0], playbooks[1]], {
      data,
      now: NOW,
      config: defaultSettings.homeRecommendation,
      external,
      difficultyPreference: 'easy',
    });
    expect(result).toHaveLength(2);
    expect(result[0].playbook.id).toBe(playbooks[1].id);
    expect(result[0].home?.difficultyPreferenceAdjustment).toBe(3);
  });

  it('19 cannot overpower a large strategic score gap', () => {
    const external = exactExternal([playbooks[0], playbooks[1]], ['easy', 'hard'], [6.8, 2.6]);
    const result = scoreHomeCandidates([playbooks[0], playbooks[1]], {
      data,
      now: NOW,
      config: defaultSettings.homeRecommendation,
      external,
      difficultyPreference: 'easy',
    });
    expect(result[0].playbook.id).toBe(playbooks[1].id);
  });

  it('20 does not silently replace an active session selection', () => {
    const base = createRecommendations(data, defaultSettings, NOW);
    const state = {
      ...base,
      data,
      settings: defaultSettings,
      external: exactExternal(playbooks.slice(0, 2), ['easy', 'hard']),
      activeSession: { selectedPlaybookId: 'locked-plan' },
      source: 'Bundled snapshot' as const,
      assets: {},
      personal: null,
    };
    rescoreHomeRecommendations(state as never, undefined, NOW, null, 'easy');
    expect(state.activeSession.selectedPlaybookId).toBe('locked-plan');
  });
});

describe('Home enrichment labels', () => {
  it('labels a #1 with the highest Final Safety as BEST FINAL SAFETY', () => {
    const leader = candidateWithDisplayScores(0, 60);
    const other = candidateWithDisplayScores(1, 59);
    expect(primaryRecommendationRole(leader, [leader, other])).toBe('BEST FINAL SAFETY');
  });

  it('labels a live-evidence-driven #1 as BEST LIVE DIRECTION', () => {
    const safetyLeader = candidateWithDisplayScores(0, 60);
    const liveLeader = candidateWithDisplayScores(1, 59, 61);
    expect(primaryRecommendationRole(liveLeader, [liveLeader, safetyLeader])).toBe(
      'BEST LIVE DIRECTION',
    );
  });

  it('labels a preference-driven #1 as BEST PREFERRED FIT', () => {
    const safetyLeader = candidateWithDisplayScores(0, 60);
    const preferredLeader = candidateWithDisplayScores(1, 59, 59, 3);
    expect(primaryRecommendationRole(preferredLeader, [preferredLeader, safetyLeader])).toBe(
      'BEST PREFERRED FIT',
    );
  });

  it('derives role labels without altering any candidate score', () => {
    const safetyLeader = candidateWithDisplayScores(0, 60);
    const liveLeader = candidateWithDisplayScores(1, 59, 61);
    const preferredLeader = candidateWithDisplayScores(2, 58.5, 58.5, 3);
    const candidates = [preferredLeader, liveLeader, safetyLeader];
    const before = structuredClone(candidates);
    primaryRecommendationRole(safetyLeader, candidates);
    primaryRecommendationRole(liveLeader, candidates);
    primaryRecommendationRole(preferredLeader, candidates);
    expect(candidates).toEqual(before);
  });

  it('renders leveling style once per main card and names evidence confidence accurately', () => {
    const plan = playbooks[2];
    expect(plan.features.style).toBe('Fast 8');
    const external = exactExternal([plan], ['easy']);
    const [candidate] = scoreHomeCandidates([plan], {
      data,
      now: NOW,
      config: defaultSettings.homeRecommendation,
      external,
      difficultyPreference: 'anything',
    });
    const state: ApplicationState = {
      data,
      ...createRecommendations(data, defaultSettings, NOW),
      external,
      settings: defaultSettings,
      activeSession: null,
      source: 'Bundled snapshot',
      assets: {},
    };
    const portfolio: RecommendationPortfolio = {
      plans: [{ candidate, role: 'Best Final Safety' }],
      objective: candidate.score,
      interactions: [],
      generatedAt: NOW,
      version: 'home-portfolio-contest-edge-v1',
    };
    const html = renderToStaticMarkup(
      createElement(Home, {
        state,
        portfolio,
        candidates: [candidate],
        baselineCandidates: [candidate],
        onOpen: () => {},
        onData: () => {},
        onScout: () => {},
        lobby: null,
      }),
    );
    const card = html.match(/<article class="plan-card primary-plan"[\s\S]*?<\/article>/)?.[0];
    expect(card).toBeDefined();
    expect(card?.match(/Fast 8/g)).toHaveLength(1);
    expect(card).toContain('Evidence confidence:');
    expect(card).not.toContain('Score confidence:');
  });
});

describe('compact enrichment presentation', () => {
  const plan = playbooks[0];
  const external = exactExternal([plan], ['easy']);

  it('21-23 renders known difficulty, explicit tier and leveling style', () => {
    const html = renderToStaticMarkup(createElement(CompMetaBadges, { plan, external }));
    expect(html).toContain('Easy');
    expect(html).toContain('comp-tier');
    expect(html).toContain('A');
    expect(html).toContain(plan.features.style);
  });

  it('24 keeps trusted item icons nested under the correct holder', () => {
    const firstUnit = plan.target.units[0].championId;
    external.comps[0].packages = [
      {
        holder: firstUnit,
        items: [data.items[0].id],
        source: 'MetaTFT',
        providerCompId: external.comps[0].id,
        set: 18,
        patch: '18.2',
        hotfix: '',
        evidence: 'structured-build+public-comp-row',
      },
    ];
    const html = renderToStaticMarkup(
      createElement(ExternalCompLineup, { plan, external, data, assets: {} }),
    );
    expect(html).toContain('is-item-holder');
    expect(html).toContain(
      `${data.champions.find((entry) => entry.id === firstUnit)?.name} recommended items`,
    );
    expect(html).toContain(data.items[0].name);
  });

  it('25 does not create placeholders or fake item rows when packages are missing', () => {
    external.comps[0].packages = [];
    const html = renderToStaticMarkup(
      createElement(ExternalCompLineup, { plan, external, data, assets: {} }),
    );
    expect(html).not.toContain('compact-item-icon');
    expect(html).not.toContain('recommended items');
  });

  it('26 keeps cards usable without any MetaTFT enrichment', () => {
    const html = renderToStaticMarkup(
      createElement(ExternalCompLineup, { plan, external: null, data, assets: {} }),
    );
    expect(html).toContain('Champion lineup and trusted items');
    expect(html).toContain(data.champions.find((entry) => entry.id === plan.hero)?.name);
  });
});
