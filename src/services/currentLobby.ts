import type { RiotIdentity, Result } from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import { parseRiotId } from '../providers/riotId';
import { regionalRouteFor, spectatorTftSupported } from '../providers/riotRouting';
import type { HistoryStore } from '../storage/history';

/** Official identity discovery only. History acquisition remains the M3 scanner. */
export async function discoverCurrentLobby(
  provider: RiotProvider,
  store: HistoryStore,
  riotId: string,
  platform: string,
): Promise<Result<{ own: RiotIdentity; opponents: RiotIdentity[] }, string>> {
  if (!spectatorTftSupported(platform))
    return {
      ok: false,
      error: 'Current-lobby lookup is unsupported on this platform. Use manual opponents.',
    };
  if (!(await provider.connectionStatus()).keyDetected)
    return {
      ok: false,
      error: 'Riot API key unavailable. Cached playbooks still work; configure API access to scan.',
    };
  const parsed = parseRiotId(riotId);
  const options = { deadlineAt: Date.now() + 8_000 };
  const cached = await store.getIdentity(parsed.gameName, parsed.tagLine, platform);
  const own =
    cached && Date.now() - Date.parse(cached.fetchedAt) < 86_400_000
      ? cached
      : await provider.resolveAccount(parsed.gameName, parsed.tagLine, options);
  await store.putIdentity(own, new Date().toISOString());
  const result = await provider.lobby(own, options);
  if (!result.ok)
    return {
      ok: false,
      error:
        result.error === 'not-in-game'
          ? 'No active TFT game found. Try again when a lobby is available, or use manual opponents.'
          : 'Current-lobby lookup is unavailable. Retry or use manual opponents; cached plans still work.',
    };
  const puuids = [...new Set(result.value.filter((id) => id && id !== own.puuid))].slice(0, 7);
  if (!puuids.length)
    return {
      ok: false,
      error:
        'No visible opponent identities were returned. Hidden identities are not inferred. Use manual opponents.',
    };
  // Names are optional. A missing name must not discard an official PUUID.
  const opponents = await Promise.all(
    puuids.map(async (puuid, index): Promise<RiotIdentity> => {
      try {
        return await provider.accountByPuuid(puuid, options);
      } catch {
        return {
          puuid,
          gameName: 'Official participant',
          tagLine: String(index + 1),
          platform,
          routing: regionalRouteFor(platform),
        };
      }
    }),
  );
  return { ok: true, value: { own, opponents } };
}
