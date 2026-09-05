import type { CompletedMatch, RiotIdentity, Result } from '../domain/models';
export interface RiotProvider {
  resolveAccount(
    gameName: string,
    tagLine: string,
    routing: string,
    signal?: AbortSignal,
  ): Promise<RiotIdentity>;
  lobby(
    identity: RiotIdentity,
    signal?: AbortSignal,
  ): Promise<Result<string[], 'unsupported' | 'not-in-game' | 'unavailable'>>;
  recentMatchIds(puuid: string, count: number, signal?: AbortSignal): Promise<string[]>;
  completedMatch(id: string, signal?: AbortSignal): Promise<CompletedMatch>;
}
export class FixtureRiotProvider implements RiotProvider {
  constructor(
    private matches: CompletedMatch[],
    private participants: RiotIdentity[],
  ) {}
  async resolveAccount(gameName: string, tagLine: string): Promise<RiotIdentity> {
    const identity = this.participants.find(
      (p) => p.gameName === gameName && p.tagLine === tagLine,
    );
    if (!identity) throw new Error('Fixture identity not found');
    return identity;
  }
  async lobby(): Promise<Result<string[], 'unsupported'>> {
    return { ok: false, error: 'unsupported' };
  }
  async recentMatchIds(puuid: string, count: number): Promise<string[]> {
    return this.matches
      .filter((m) => m.participants.some((p) => p.puuid === puuid))
      .slice(0, count)
      .map((m) => m.id);
  }
  async completedMatch(id: string): Promise<CompletedMatch> {
    const match = this.matches.find((m) => m.id === id);
    if (!match) throw new Error('Fixture match not found');
    return match;
  }
}
