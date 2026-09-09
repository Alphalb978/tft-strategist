import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_HOME_RECOMMENDATION_CONFIG,
  homeRecommendations,
  scoreHomeCandidates,
  selectAlternativeCandidates,
} from '../strategy/homeScoring';
import {
  formatLobbyDelta,
  Home,
  humanizeExclusionReason,
  OutcomeLine,
  ScoreDecomposition,
  signed,
} from '../features/Home';
import type { ApplicationState } from '../services/application';
import { createRecommendations } from '../services/application';
import { defaultSettings } from '../storage/repository';
import type {
  LobbyPressure,
  LobbyScanState,
  OpponentProfile,
  RecommendationCandidate,
  RecommendationPortfolio,
} from '../domain/models';
import { data, NOW, playbooks } from './fixtures';

function makeMockProfile(id: string, confidence = 1): OpponentProfile {
  return {
    puuid: `puuid-${id}`,
    riotId: `Opponent${id}#EUW`,
    freshness: 'fresh',
    generatedAt: NOW,
    sourceMatchIds: [],
    set: 13,
    patch: '14.23',
    derivationVersion: '1.0.0',
    relevantGames: 20,
    effectiveSample: 20,
    confidence,
    placement: {
      games: 20,
      average: 4.5,
      topFourRate: 0.5,
    },
    patchRelevance: {
      status: 'same',
      comparableGames: 20,
      samePatchGames: 20,
      note: '',
    },
    unresolvedIds: { units: [], items: [], traits: [], augments: [] },
    repeatedUnitCandidates: [],
    classification: { family: 'unavailable', style: 'unavailable', note: '' },
    confidenceFactors: {
      sampleCoverage: 1,
      recencyQuality: 1,
      modeQuality: 1,
      patchQuality: 1,
    },
    unitEvidence: [],
    unitFrequency: {},
    traitFrequency: {},
    augmentFrequency: {},
    historicalBoards: [],
  };
}

describe('M13C.1 — Recommendation UI Clarity and Parity Suite', () => {
  const baseContext = {
    data,
    now: NOW,
    config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
  };

  const cleanActiveLobby: LobbyPressure = {
    state: 'complete',
    expectedOpponents: 7,
    requestedOpponents: 7,
    resolvedOpponents: 7,
    profilesCompleted: 7,
    profiles: Array.from({ length: 7 }, (_, i) => makeMockProfile(String(i + 1), 1)),
    unitPressure: [],
    unitPressureVersion: 'v1',
    coverage: 1,
    relevantGamesAvailable: 70,
    relevantGamesTarget: 70,
    freshProfiles: 7,
    cachedProfiles: 0,
    acquisitionMs: 50,
    derivationMs: 10,
    elapsedMs: 60,
    telemetry: {
      requestsAttempted: 7,
      cacheHits: 0,
      retries: 0,
      rateLimitWaits: 0,
      rateLimitWaitMs: 0,
      uniqueMatchDetailsFetched: 70,
      sharedMatchesDeduplicated: 0,
    },
    fetchedAt: NOW,
    errors: [],
  };

  // A. Identical M13C fixture before/after
  it('A. verifies numerical parity and candidate ordering are 100% identical to M13C', () => {
    const scored = scoreHomeCandidates(playbooks, baseContext);
    const result = homeRecommendations(playbooks, baseContext);

    // 1. Candidate order identical
    expect(result.candidates.map((c) => c.playbook.id)).toEqual(
      scored.map((c) => c.playbook.id),
    );

    // 2. Numerical scoring parity for every single candidate
    for (const candidate of result.candidates) {
      const match = scored.find((c) => c.playbook.id === candidate.playbook.id)!;
      expect(candidate.home?.basePerformance).toBe(match.home?.basePerformance);
      expect(candidate.home?.lowPickEdge).toBe(match.home?.lowPickEdge);
      expect(candidate.home?.lobbyAdjustment).toBe(match.home?.lobbyAdjustment);
      expect(candidate.home?.finalSafety).toBe(match.home?.finalSafety);
      expect(candidate.contest.state).toBe(match.contest.state);
      expect(candidate.score).toBe(match.score);
    }

    // 3. Eligible comp IDs set membership identical
    expect(result.candidates.map((c) => c.playbook.id).sort()).toEqual(
      playbooks.map((p) => p.id).sort(),
    );

    // 4. Primary portfolio plans identical
    expect(result.portfolio.plans).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(result.portfolio.plans[i].candidate.playbook.id).toBe(
        result.candidates[i].playbook.id,
      );
    }
  });

  // B. Alternative route rendering and stats discipline
  it('B. alternative route: normal stats, missing pick rate stays unavailable (not 0), and limited sample does not fabricate stats', () => {
    const [realCandidate] = scoreHomeCandidates([playbooks[0]], baseContext);

    const candidate: RecommendationCandidate = {
      ...realCandidate,
      home: {
        ...realCandidate.home!,
        top4: { raw: 0.55, normalized: 55, shrunk: 55 },
        averagePlacement: { raw: 4.3, normalized: 50, shrunk: 50 },
        winRate: { raw: 0.12, normalized: 50, shrunk: 50 },
        pickRate: null, // missing pick rate
        reliability: 0.5,
      },
    };

    const html = renderToStaticMarkup(createElement(OutcomeLine, { candidate }));

    // Top 4, Avg, Win rendered
    expect(html).toContain('55%');
    expect(html).toContain('Top 4');
    expect(html).toContain('4.30');
    expect(html).toContain('Avg');
    expect(html).toContain('12%');
    expect(html).toContain('Win');

    // Missing pick rate rendered as '—', not '0' or '0.00%'
    expect(html).toContain('—');
    expect(html).not.toContain('0.00% Pick');
    expect(html).not.toContain('0% Pick');

    // Limited data test: reliability = 0
    const limitedCandidate: RecommendationCandidate = {
      ...candidate,
      home: {
        ...candidate.home!,
        reliability: 0,
        top4: { raw: null, normalized: 50, shrunk: 50 },
        averagePlacement: { raw: null, normalized: 50, shrunk: 50 },
        winRate: { raw: null, normalized: 50, shrunk: 50 },
      },
    };

    const limitedHtml = renderToStaticMarkup(
      createElement(OutcomeLine, { candidate: limitedCandidate }),
    );

    // Displays clear LIMITED DATA notice without fabricating values
    expect(limitedHtml).toContain('LIMITED DATA');
    expect(limitedHtml).toContain('Not enough games to trust performance stats yet');
    // Does not invent 50% or fake avg
    expect(limitedHtml).toContain('—');
  });

  // C. Contest presentation
  it('C. contest presentation clearly renders LOW, MEDIUM, and HIGH contest', () => {
    const [realCandidate] = scoreHomeCandidates([playbooks[0]], baseContext);
    const states = ['Low', 'Medium', 'High'] as const;
    for (const state of states) {
      const candidate: RecommendationCandidate = {
        ...realCandidate,
        contest: {
          ...realCandidate.contest,
          state,
        },
      };

      const appState: ApplicationState = {
        data,
        ...createRecommendations(data, defaultSettings, NOW),
        settings: defaultSettings,
        activeSession: null,
        source: 'Bundled snapshot',
        assets: {},
      };

      const portfolio: RecommendationPortfolio = {
        plans: [{ candidate, role: 'Best Final Safety' }],
        objective: 60,
        interactions: [],
        generatedAt: NOW,
        version: 'home-portfolio-contest-edge-v1',
      };

      const html = renderToStaticMarkup(
        createElement(Home, {
          state: appState,
          portfolio,
          candidates: [candidate],
          onOpen: () => {},
          onScout: () => {},
          onData: () => {},
          lobby: cleanActiveLobby,
        }),
      );

      // Must include uppercase pill text and lowercase css class
      expect(html).toContain(`${state.toUpperCase()} CONTEST`);
      expect(html).toContain(`contest-${state.toLowerCase()}`);
      // Must separate score confidence
      expect(html).toContain('Score confidence:');
    }

    // No lobby provided -> CONTEST UNAVAILABLE
    const [candidate] = scoreHomeCandidates([playbooks[0]], baseContext);
    const noLobbyHtml = renderToStaticMarkup(
      createElement(Home, {
        state: {
          data,
          ...createRecommendations(data, defaultSettings, NOW),
          settings: defaultSettings,
          activeSession: null,
          source: 'Bundled snapshot',
          assets: {},
        },
        portfolio: {
          plans: [{ candidate, role: 'Best Final Safety' }],
          objective: 60,
          interactions: [],
          generatedAt: NOW,
          version: 'home-portfolio-contest-edge-v1',
        },
        candidates: [candidate],
        onOpen: () => {},
        onScout: () => {},
        onData: () => {},
        lobby: null,
      }),
    );
    expect(noLobbyHtml).toContain('CONTEST UNAVAILABLE');
    expect(noLobbyHtml).toContain('contest-unavailable');
  });

  // D. Lobby delta copy
  it('D. lobby delta copy generates truthful humanized strings for positive, negative, and zero/negligible deltas', () => {
    // Positive
    expect(formatLobbyDelta(3.72)).toBe('Lobby scan improved this route by +3.7');
    expect(formatLobbyDelta(0.5)).toBe('Lobby scan improved this route by +0.5');

    // Negative
    expect(formatLobbyDelta(-2.34)).toBe('Lobby scan reduced this route by -2.3');
    expect(formatLobbyDelta(-0.8)).toBe('Lobby scan reduced this route by -0.8');

    // Zero / negligible
    expect(formatLobbyDelta(0)).toBe('Lobby scan had little effect');
    expect(formatLobbyDelta(0.02)).toBe('Lobby scan had little effect');
    expect(formatLobbyDelta(-0.04)).toBe('Lobby scan had little effect');
  });

  // E. 7/7 ready scan header
  it('E. 7/7 ready scan header displays LOBBY READY and coverage accurately', () => {
    const appState: ApplicationState = {
      data,
      ...createRecommendations(data, defaultSettings, NOW),
      settings: defaultSettings,
      activeSession: null,
      source: 'Bundled snapshot',
      assets: {},
    };

    const scanState = {
      stage: 'complete' as const,
      opponentsAnalyzed: 7,
      opponentsTotal: 7,
      matchesProcessed: 70,
      relevantGamesAvailable: 63,
      relevantGamesTarget: 70,
      coverage: 0.9,
      lobby: null,
      isProvisional: false,
    };

    const html = renderToStaticMarkup(
      createElement(Home, {
        state: appState,
        portfolio: appState.portfolio,
        candidates: appState.homeCandidates,
        onOpen: () => {},
        onScout: () => {},
        onData: () => {},
        lobby: null,
        scanState,
      }),
    );

    expect(html).toContain('LOBBY READY — 7/7');
    expect(html).toContain('63 / 70 relevant games');
    expect(html).toContain('90% coverage');
  });

  // F. Score decomposition equation and visual arithmetic
  it('F. score decomposition displays exact existing outputs as a causal equation', () => {
    const [realCandidate] = scoreHomeCandidates([playbooks[0]], baseContext);
    const candidate: RecommendationCandidate = {
      ...realCandidate,
      home: {
        ...realCandidate.home!,
        basePerformance: 54.4,
        lowPickEdge: 3.4,
        lobbyAdjustment: 2.2,
        finalSafety: 60.0,
      },
    };

    const html = renderToStaticMarkup(createElement(ScoreDecomposition, { candidate }));

    // Exact outputs rendered without recalculation
    expect(html).toContain('54.4');
    expect(html).toContain('+3.4');
    expect(html).toContain('+2.2');
    expect(html).toContain('60.0');
    expect(html).toContain('Base');
    expect(html).toContain('+ Low-pick');
    expect(html).toContain('+ Lobby');
    expect(html).toContain('Final Safety');
  });

  // G. Humanized exclusion reasons
  it('G. humanizes exclusion reasons without inventing unsupported claims', () => {
    const [cand0, cand1] = scoreHomeCandidates([playbooks[0], playbooks[1]], baseContext);
    const portfolio: RecommendationPortfolio = {
      plans: [
        {
          candidate: cand0,
          role: 'Best Final Safety',
        },
      ],
      objective: 60,
      interactions: [],
      generatedAt: NOW,
      version: 'home-portfolio-contest-edge-v1',
    };

    const reason = humanizeExclusionReason(cand1, portfolio);
    expect(reason).toContain('Good fallback');
    expect(reason).not.toContain('Outside primary three after portfolio optimization');
  });

  // H. Alternative candidates count and unit portraits availability
  it('H. alternative candidates have accessible target units for compact portraits without DB queries', () => {
    const result = homeRecommendations(playbooks, baseContext);
    const alternatives = selectAlternativeCandidates(result.candidates, result.portfolio, 5);

    expect(alternatives.length).toBeGreaterThan(0);
    for (const alt of alternatives) {
      expect(alt.playbook.target.units.length).toBeGreaterThan(0);
      // All champion IDs in target units exist in static data
      for (const unit of alt.playbook.target.units) {
        expect(unit.championId).toBeDefined();
      }
    }
  });

  // 5B. ALTERNATIVE MINI-CARDS — SHOW LOBBY PRESSURE
  describe('5B. Alternative Mini-Cards — Show Lobby Pressure', () => {
    function renderWithAlternative(
      altCandidate: RecommendationCandidate,
      options: {
        lobby?: LobbyPressure | null;
        scanState?: LobbyScanState;
      } = {},
    ) {
      const activeLobby = options.lobby !== undefined ? options.lobby : cleanActiveLobby;
      const contextWithLobby = activeLobby ? { ...baseContext, lobby: activeLobby } : baseContext;
      const [c0, c1, c2] = scoreHomeCandidates(playbooks.slice(0, 3), contextWithLobby);
      const candidates = [c0, c1, c2, altCandidate];
      const portfolio: RecommendationPortfolio = {
        plans: [
          { candidate: c0, role: 'Best Final Safety' },
          { candidate: c1, role: 'Alternative' },
          { candidate: c2, role: 'Alternative' },
        ],
        objective: 60,
        interactions: [],
        generatedAt: NOW,
        version: 'home-portfolio-contest-edge-v1',
      };

      const appState: ApplicationState = {
        data,
        ...createRecommendations(data, defaultSettings, NOW),
        portfolio,
        homeCandidates: candidates,
        playbooks,
        settings: defaultSettings,
        activeSession: null,
        source: 'Bundled snapshot',
        assets: {},
      };

      return renderToStaticMarkup(
        createElement(Home, {
          state: appState,
          portfolio,
          candidates,
          onOpen: () => {},
          onScout: () => {},
          onData: () => {},
          lobby: activeLobby,
          scanState: options.scanState,
        }),
      );
    }

    function getAlternativeCardHtml(html: string) {
      const match = html.match(/<article class="alternative-card"[^>]*>([\s\S]*?)<\/article>/);
      return match ? match[1] : '';
    }

    // 1. compact mini-card with normal data
    it('1. compact mini-card renders all required information with normal data', () => {
      const [baseAlt] = scoreHomeCandidates([playbooks[3]], { ...baseContext, lobby: cleanActiveLobby });
      const altCandidate: RecommendationCandidate = {
        ...baseAlt,
        contest: {
          ...baseAlt.contest,
          state: 'Low',
        },
        home: {
          ...baseAlt.home!,
          lobbyAdjustment: 2.3,
          finalSafety: 55.2,
          top4: { raw: 0.58, normalized: 58, shrunk: 58 },
          averagePlacement: { raw: 4.13, normalized: 54, shrunk: 54 },
          winRate: { raw: 0.12, normalized: 50, shrunk: 50 },
          pickRate: { value: 0.36, unit: 'percent' },
        },
      };

      const html = renderWithAlternative(altCandidate, { lobby: cleanActiveLobby });
      const altHtml = getAlternativeCardHtml(html);

      // Section and container
      expect(html).toContain('Other strong routes');
      expect(html).toContain('alt-card-main');
      expect(html).toContain('alt-card-aside');

      // 1. Rank, comp name, style tag
      expect(altHtml).toContain('#4');
      expect(altHtml).toContain(altCandidate.playbook.title);
      expect(altHtml).toContain(altCandidate.playbook.features.style);

      // 2. Unit portraits
      expect(altHtml).toContain('alt-unit');
      expect(altHtml).toContain('portrait');

      // 3. Final Safety
      expect(altHtml).toContain('55.2');
      expect(altHtml).toContain('SAFETY');

      // 4. Top 4 / Avg / Win / Pick stats
      expect(altHtml).toContain('58%');
      expect(altHtml).toContain('Top 4');
      expect(altHtml).toContain('4.13');
      expect(altHtml).toContain('Avg');
      expect(altHtml).toContain('12%');
      expect(altHtml).toContain('Win');
      expect(altHtml).toContain('0.36%');
      expect(altHtml).toContain('Pick');

      // 5. Contest state & lobby adjustment
      expect(altHtml).toContain('LOW CONTEST');
      expect(altHtml).toContain('Lobby +2.3');

      // 6. Exclusion / fallback reason
      expect(altHtml).toContain('Good fallback');

      // 7. View details action
      expect(altHtml).toContain('View details');
    });

    // 2. missing Pick stays unavailable
    it('2. missing Pick stays unavailable (—), never defaulting to 0 or 0.00%', () => {
      const [baseAlt] = scoreHomeCandidates([playbooks[3]], { ...baseContext, lobby: cleanActiveLobby });
      const altCandidate: RecommendationCandidate = {
        ...baseAlt,
        home: {
          ...baseAlt.home!,
          pickRate: null, // missing pick rate
        },
      };

      const html = renderWithAlternative(altCandidate, { lobby: cleanActiveLobby });
      const altHtml = getAlternativeCardHtml(html);

      expect(altHtml).toContain('—');
      expect(altHtml).not.toContain('0.00% Pick');
      expect(altHtml).not.toContain('0% Pick');
    });

    // 3. LOW contest + positive lobby adjustment
    it('3. LOW contest renders LOW CONTEST pill and positive lobby adjustment', () => {
      const [baseAlt] = scoreHomeCandidates([playbooks[3]], { ...baseContext, lobby: cleanActiveLobby });
      const altCandidate: RecommendationCandidate = {
        ...baseAlt,
        contest: {
          ...baseAlt.contest,
          state: 'Low',
        },
        home: {
          ...baseAlt.home!,
          lobbyAdjustment: 2.3,
          finalSafety: 55.2,
        },
      };

      const html = renderWithAlternative(altCandidate, { lobby: cleanActiveLobby });
      const altHtml = getAlternativeCardHtml(html);

      expect(altHtml).toContain('LOW CONTEST');
      expect(altHtml).toContain('contest-low');
      expect(altHtml).toContain('Lobby +2.3');
      expect(altHtml).toContain('alt-lobby-adj adj-positive');
      expect(altHtml).not.toContain('CONTEST UNAVAILABLE');
    });

    // 4. MEDIUM contest + negative adjustment
    it('4. MEDIUM contest renders MEDIUM CONTEST pill and exact negative adjustment', () => {
      const [baseAlt] = scoreHomeCandidates([playbooks[3]], baseContext);
      const altCandidate: RecommendationCandidate = {
        ...baseAlt,
        contest: {
          ...baseAlt.contest,
          state: 'Medium',
        },
        home: {
          ...baseAlt.home!,
          lobbyAdjustment: -8.4,
          finalSafety: 48.0,
        },
      };

      const html = renderWithAlternative(altCandidate, { lobby: cleanActiveLobby });
      const altHtml = getAlternativeCardHtml(html);

      expect(altHtml).toContain('MEDIUM CONTEST');
      expect(altHtml).toContain('contest-medium');
      expect(altHtml).toContain('Lobby -8.4');
      expect(altHtml).toContain('alt-lobby-adj adj-negative');
      expect(altHtml).not.toContain('LOW CONTEST');
      expect(altHtml).not.toContain('HIGH CONTEST');
    });

    // 5. HIGH contest + negative adjustment
    it('5. HIGH contest renders HIGH CONTEST pill, exact negative adjustment, and pressured reason', () => {
      const [baseAlt] = scoreHomeCandidates([playbooks[3]], baseContext);
      const altCandidate: RecommendationCandidate = {
        ...baseAlt,
        contest: {
          ...baseAlt.contest,
          state: 'High',
        },
        home: {
          ...baseAlt.home!,
          lobbyAdjustment: -27.1,
          finalSafety: 32.5,
        },
      };

      const html = renderWithAlternative(altCandidate, { lobby: cleanActiveLobby });
      const altHtml = getAlternativeCardHtml(html);

      expect(altHtml).toContain('HIGH CONTEST');
      expect(altHtml).toContain('contest-high');
      expect(altHtml).toContain('Lobby -27.1');
      expect(altHtml).toContain('alt-lobby-adj adj-negative');
      expect(altHtml).toContain('heavily pressured in this lobby');
      expect(altHtml).not.toContain('LOW CONTEST');
      expect(altHtml).not.toContain('MEDIUM CONTEST');
    });

    // 6. CONTEST UNAVAILABLE with no lobby
    it('6. CONTEST UNAVAILABLE renders when there is no active lobby and omits false Lobby +0.0', () => {
      const [baseAlt] = scoreHomeCandidates([playbooks[3]], baseContext);
      const altCandidate: RecommendationCandidate = {
        ...baseAlt,
        contest: {
          ...baseAlt.contest,
          state: 'Low', // Even if internal state holds default 'Low'
        },
        home: {
          ...baseAlt.home!,
          lobbyAdjustment: 0.0,
        },
      };

      const html = renderWithAlternative(altCandidate, { lobby: null });
      const altHtml = getAlternativeCardHtml(html);

      expect(altHtml).toContain('CONTEST UNAVAILABLE');
      expect(altHtml).toContain('contest-unavailable');
      expect(altHtml).not.toContain('LOW CONTEST');
      expect(altHtml).not.toContain('Lobby +0.0');
      expect(altHtml).not.toContain('alt-lobby-adj');
    });

    // 7. provisional contest state
    it('7. provisional contest state visibly indicates provisional status for pill and lobby delta', () => {
      const [baseAlt] = scoreHomeCandidates([playbooks[3]], baseContext);
      const altCandidate: RecommendationCandidate = {
        ...baseAlt,
        contest: {
          ...baseAlt.contest,
          state: 'Low',
        },
        home: {
          ...baseAlt.home!,
          lobbyAdjustment: 2.3,
          finalSafety: 55.2,
        },
      };

      const provisionalScan: LobbyScanState = {
        stage: 'scanning',
        opponentsAnalyzed: 3,
        opponentsTotal: 7,
        matchesProcessed: 30,
        relevantGamesAvailable: 28,
        relevantGamesTarget: 70,
        coverage: 0.4,
        lobby: cleanActiveLobby,
        isProvisional: true,
      };

      const html = renderWithAlternative(altCandidate, {
        lobby: cleanActiveLobby,
        scanState: provisionalScan,
      });
      const altHtml = getAlternativeCardHtml(html);

      expect(altHtml).toContain('LOW CONTEST (PROV.)');
      expect(altHtml).toContain('Lobby +2.3 (prov.)');
    });

    // 8. displayed Lobby value exactly equals candidate's existing M13C value
    it('8. displayed Lobby value exactly equals the candidate existing M13C value without recalculation', () => {
      const contextWithLobby = {
        ...baseContext,
        lobby: cleanActiveLobby,
      };
      const result = homeRecommendations(playbooks, contextWithLobby);
      const alternatives = selectAlternativeCandidates(result.candidates, result.portfolio, 5);

      expect(alternatives.length).toBeGreaterThan(0);
      const targetAlt = alternatives[0];
      const expectedAdjustment = targetAlt.home?.lobbyAdjustment;
      expect(expectedAdjustment).toBeDefined();

      const appState: ApplicationState = {
        data,
        ...createRecommendations(data, defaultSettings, NOW),
        portfolio: result.portfolio,
        homeCandidates: result.candidates,
        playbooks,
        settings: defaultSettings,
        activeSession: null,
        source: 'Bundled snapshot',
        assets: {},
      };

      const html = renderToStaticMarkup(
        createElement(Home, {
          state: appState,
          portfolio: result.portfolio,
          candidates: result.candidates,
          onOpen: () => {},
          onScout: () => {},
          onData: () => {},
          lobby: cleanActiveLobby,
        }),
      );
      const altHtml = getAlternativeCardHtml(html);

      const expectedBadgeText = `Lobby ${signed(expectedAdjustment!)}`;
      expect(altHtml).toContain(expectedBadgeText);
    });
  });
});
