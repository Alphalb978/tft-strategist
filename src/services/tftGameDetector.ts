import type { LeagueClientLobby, RiotProvider } from '../providers/riot';

export type DetectorState = 'NO_GAME' | 'DETECTED' | 'SCANNING' | 'SCANNED' | 'CLEARED';

export interface DetectedGameSession {
  sessionFingerprint: string;
  queueId?: number;
  queueType?: string;
  ranked: boolean;
  participantCount: number;
}

export interface TftGameDetectorCallbacks {
  onDetected: (session: DetectedGameSession) => void;
  onScan: (session: DetectedGameSession) => Promise<void>;
  onGameEnded: () => void;
}

export interface TftGameDetectorOptions {
  pollIntervalMs?: number;
  initialState?: DetectorState;
  initialFingerprint?: string | null;
}

export function createSessionFingerprint(lobby: LeagueClientLobby): string {
  const puuids = lobby.participants
    .map((p) => p.localPuuid.trim())
    .filter(Boolean)
    .sort()
    .join(',');
  const queue = lobby.queueId ?? lobby.queueType ?? 'tft';
  return `${queue}:${puuids || 'session'}`;
}

export class TftGameDetector {
  private state: DetectorState = 'NO_GAME';
  private currentFingerprint: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly provider: RiotProvider | (() => RiotProvider | null),
    private readonly callbacks: TftGameDetectorCallbacks,
    options: TftGameDetectorOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2500;
    if (options.initialState) this.state = options.initialState;
    if (options.initialFingerprint !== undefined) this.currentFingerprint = options.initialFingerprint;
  }

  private getProvider(): RiotProvider | null {
    if (typeof this.provider === 'function') {
      return this.provider();
    }
    return this.provider;
  }

  public getState(): DetectorState {
    return this.state;
  }

  public getCurrentFingerprint(): string | null {
    return this.currentFingerprint;
  }

  public getPollIntervalMs(): number {
    return this.pollIntervalMs;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkNow().catch(() => {});
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isPolling = false;
  }

  public onManualClear(): void {
    if (this.currentFingerprint !== null) {
      this.state = 'CLEARED';
    }
  }

  public async onManualScan(): Promise<void> {
    const provider = this.getProvider();
    if (!provider?.leagueClientLobby) return;

    // Refresh current local gameflow info if possible
    const result = await provider.leagueClientLobby({ deadlineAt: Date.now() + 3_000 });
    if (result.ok && result.value.activeForScouting) {
      const fingerprint = createSessionFingerprint(result.value);
      this.currentFingerprint = fingerprint;
      const session: DetectedGameSession = {
        sessionFingerprint: fingerprint,
        queueId: result.value.queueId,
        queueType: result.value.queueType,
        ranked: result.value.rankedTftDetected,
        participantCount: result.value.participantCount,
      };
      this.state = 'SCANNING';
      try {
        await this.callbacks.onScan(session);
      } finally {
        if (this.state === 'SCANNING') {
          this.state = 'SCANNED';
        }
      }
    }
  }

  public async checkNow(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const provider = this.getProvider();
      if (!provider?.leagueClientLobby) {
        this.handleInactive();
        return;
      }

      const result = await provider.leagueClientLobby({ deadlineAt: Date.now() + 3_000 });
      if (!result.ok) {
        this.handleInactive();
        return;
      }

      const lobby = result.value;
      if (!lobby.activeForScouting) {
        this.handleInactive();
        return;
      }

      // At this point: TFT game is InProgress
      const fingerprint = createSessionFingerprint(lobby);

      // If fingerprint changed while in active game (e.g. game 1 ended, game 2 started without idle poll):
      if (this.currentFingerprint !== null && this.currentFingerprint !== fingerprint) {
        this.handleInactive();
      }

      // If no game is currently latched, start detection & scanning flow
      if (this.state === 'NO_GAME') {
        this.currentFingerprint = fingerprint;
        this.state = 'DETECTED';

        const session: DetectedGameSession = {
          sessionFingerprint: fingerprint,
          queueId: lobby.queueId,
          queueType: lobby.queueType,
          ranked: lobby.rankedTftDetected,
          participantCount: lobby.participantCount,
        };

        this.callbacks.onDetected(session);

        this.state = 'SCANNING';
        try {
          await this.callbacks.onScan(session);
        } finally {
          if (this.state === 'SCANNING') {
            this.state = 'SCANNED';
          }
        }
        return;
      }

      // If state is already DETECTED, SCANNING, SCANNED, or CLEARED for the same session:
      // do nothing. ZERO public network calls, ZERO duplicate scans.
    } finally {
      this.isPolling = false;
    }
  }

  private handleInactive(): void {
    if (this.state !== 'NO_GAME' || this.currentFingerprint !== null) {
      this.state = 'NO_GAME';
      this.currentFingerprint = null;
      this.callbacks.onGameEnded();
    }
  }
}
