import type {
  LobbyPressure,
  LobbyScanState,
  RecommendationCandidate,
} from '../domain/models';

export type { LobbyScanStage, LobbyScanProgress, LobbyScanState } from '../domain/models';

export function createIdleScanState(): LobbyScanState {
  return {
    stage: 'idle',
    opponentsAnalyzed: 0,
    opponentsTotal: 0,
    matchesProcessed: 0,
    relevantGamesAvailable: 0,
    relevantGamesTarget: 0,
    coverage: 0,
    lobby: null,
    isProvisional: false,
  };
}

export function startScan(previous?: LobbyScanState): LobbyScanState {
  // Immediately clear stale previous-lobby evidence as already implemented.
  void previous;
  return {
    stage: 'scanning',
    opponentsAnalyzed: 0,
    opponentsTotal: 7,
    matchesProcessed: 0,
    relevantGamesAvailable: 0,
    relevantGamesTarget: 0,
    coverage: 0,
    lobby: null,
    isProvisional: true,
    reason: 'Analyzing lobby…',
  };
}

export function updateScanProgress(
  current: LobbyScanState,
  progress: {
    opponentsAnalyzed: number;
    opponentsTotal?: number;
    matchesProcessed?: number;
    message?: string;
  },
): LobbyScanState {
  return {
    ...current,
    stage: 'scanning',
    opponentsAnalyzed: progress.opponentsAnalyzed,
    opponentsTotal: progress.opponentsTotal ?? current.opponentsTotal ?? 7,
    matchesProcessed: progress.matchesProcessed ?? current.matchesProcessed,
    reason: progress.message ?? current.reason,
    isProvisional: true,
  };
}

export function completeScan(
  lobby: LobbyPressure,
  options?: { timedOut?: boolean; errors?: string[] },
): LobbyScanState {
  const matchesProcessed =
    lobby.telemetry.uniqueMatchDetailsFetched + lobby.telemetry.cacheHits;
  const opponentsAnalyzed = lobby.profilesCompleted;
  const opponentsTotal = lobby.expectedOpponents;

  if (opponentsAnalyzed === 0) {
    return failScan(options?.errors?.[0] ?? 'No opponent profiles could be retrieved.');
  }

  // 7/7 opponents analyzed conclusively
  if (opponentsAnalyzed >= 7) {
    return {
      stage: 'complete',
      opponentsAnalyzed,
      opponentsTotal,
      matchesProcessed,
      relevantGamesAvailable: lobby.relevantGamesAvailable,
      relevantGamesTarget: lobby.relevantGamesTarget,
      coverage: lobby.coverage,
      lobby,
      isProvisional: false,
    };
  }

  // Usable partial-complete: at least 6/7 opponent profiles are usable
  // OR the existing scan has conclusively finished with fewer due to provider failure
  return {
    stage: 'partial-complete',
    opponentsAnalyzed,
    opponentsTotal,
    matchesProcessed,
    relevantGamesAvailable: lobby.relevantGamesAvailable,
    relevantGamesTarget: lobby.relevantGamesTarget,
    coverage: lobby.coverage,
    lobby,
    isProvisional: false,
    reason:
      opponentsAnalyzed >= 6
        ? `Partial lobby data (${opponentsAnalyzed}/${opponentsTotal} opponents)`
        : `Partial lobby data (${opponentsAnalyzed}/${opponentsTotal} opponents analyzed · confidence incomplete)`,
  };
}

export function notInGameScan(reason?: string): LobbyScanState {
  return {
    stage: 'not-in-game',
    opponentsAnalyzed: 0,
    opponentsTotal: 0,
    matchesProcessed: 0,
    relevantGamesAvailable: 0,
    relevantGamesTarget: 0,
    coverage: 0,
    lobby: null,
    isProvisional: false,
    reason: reason ?? 'No active TFT game detected',
  };
}

export function failScan(error?: string): LobbyScanState {
  return {
    stage: 'failed',
    opponentsAnalyzed: 0,
    opponentsTotal: 0,
    matchesProcessed: 0,
    relevantGamesAvailable: 0,
    relevantGamesTarget: 0,
    coverage: 0,
    lobby: null,
    isProvisional: false,
    error: error ?? 'Lobby scan failed',
  };
}

/**
 * Resolves the visible Home ranking.
 * Avoids flicker/reordering while individual opponent requests finish.
 * During scanning, recommendations are explicitly provisional and the UI does not
 * publish a partial result as final.
 */
export function resolveHomeRanking(
  baselineCandidates: RecommendationCandidate[],
  liveCandidates: RecommendationCandidate[] | null,
  scanState: LobbyScanState,
): {
  candidates: RecommendationCandidate[];
  isFinalLobbyAware: boolean;
  isProvisional: boolean;
  statusText: string;
} {
  switch (scanState.stage) {
    case 'complete':
      return {
        candidates: liveCandidates ?? baselineCandidates,
        isFinalLobbyAware: true,
        isProvisional: false,
        statusText: `LOBBY ANALYSIS READY · ${scanState.opponentsAnalyzed}/${scanState.opponentsTotal} opponents`,
      };
    case 'partial-complete':
      return {
        candidates: liveCandidates ?? baselineCandidates,
        isFinalLobbyAware: scanState.opponentsAnalyzed >= 6,
        isProvisional: false,
        statusText:
          scanState.opponentsAnalyzed >= 6
            ? `PARTIAL — ${scanState.opponentsAnalyzed}/${scanState.opponentsTotal} opponents`
            : `PARTIAL LOBBY DATA · ${scanState.opponentsAnalyzed}/${scanState.opponentsTotal} opponents`,
      };
    case 'scanning':
      return {
        // Recommendations remain stable until completion; global/meta recommendations stay visible
        candidates: baselineCandidates,
        isFinalLobbyAware: false,
        isProvisional: true,
        statusText: `ANALYZING LOBBY · ${scanState.opponentsAnalyzed}/${scanState.opponentsTotal} opponents`,
      };
    case 'not-in-game':
      return {
        candidates: baselineCandidates,
        isFinalLobbyAware: false,
        isProvisional: false,
        statusText: 'NO CURRENT LOBBY',
      };
    case 'failed':
      return {
        candidates: baselineCandidates,
        isFinalLobbyAware: false,
        isProvisional: false,
        statusText: 'LOBBY SCAN FAILED',
      };
    case 'idle':
    default:
      return {
        candidates: baselineCandidates,
        isFinalLobbyAware: false,
        isProvisional: false,
        statusText: 'NO CURRENT LOBBY',
      };
  }
}
