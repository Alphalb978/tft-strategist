import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { LobbyPressure, RiotIdentity, StaticData } from '../domain/models';
import type { RiotConnectionStatus, RiotProvider } from '../providers/riot';
import { parseRiotId } from '../providers/riotId';
import { PREVIEW_OPPONENT_INPUT, PREVIEW_OWN_RIOT_ID } from '../providers/riotPreview';
import {
  accountRouteFor,
  regionalRouteFor,
  RIOT_PLATFORMS,
  spectatorTftSupported,
  type RiotPlatform,
} from '../providers/riotRouting';
import {
  resolveOpponentIdentities,
  scanLobby,
  type OpponentResolution,
} from '../services/scouting';
import type { HistoryStore } from '../storage/history';
import type { Settings } from '../storage/repository';

export function RiotScouting({
  data,
  settings,
  provider,
  store,
  fixturePreview,
  onSave,
  onLobby,
}: {
  data: StaticData;
  settings: Settings;
  provider: RiotProvider;
  store: HistoryStore;
  fixturePreview: boolean;
  onSave: (settings: Settings) => void;
  onLobby: (lobby: LobbyPressure) => void;
}) {
  const [status, setStatus] = useState<RiotConnectionStatus>({
    keyDetected: false,
    source: 'unavailable',
  });
  const [ownInput, setOwnInput] = useState(fixturePreview ? PREVIEW_OWN_RIOT_ID : settings.riotId);
  const [opponents, setOpponents] = useState(fixturePreview ? PREVIEW_OPPONENT_INPUT : '');
  const [ownIdentity, setOwnIdentity] = useState<RiotIdentity | null>(null);
  const [entries, setEntries] = useState<OpponentResolution[]>([]);
  const [result, setResult] = useState<LobbyPressure | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState<'account' | 'manual' | 'discovery' | null>(null);

  useEffect(() => {
    let active = true;
    provider.connectionStatus().then((next) => active && setStatus(next));
    return () => {
      active = false;
    };
  }, [provider]);

  const resolveOwn = async () => {
    setWorking('account');
    setMessage('');
    try {
      const parsed = parseRiotId(ownInput);
      onSave({ ...settings, riotId: parsed.display });
      const identity = await provider.resolveAccount(parsed.gameName, parsed.tagLine, {
        deadlineAt: Date.now() + 8_000,
      });
      await store.putIdentity(identity, new Date().toISOString());
      setOwnIdentity(identity);
      setMessage('Account resolved through the native Riot boundary.');
    } catch (error) {
      setOwnIdentity(null);
      setMessage(error instanceof Error ? error.message : 'Account resolution was unavailable.');
    } finally {
      setWorking(null);
    }
  };

  const runScan = async (identities: RiotIdentity[], requested: number) => {
    if (!identities.length) {
      setMessage('No opponent identities were resolved; no history requests were started.');
      return;
    }
    const now = new Date().toISOString();
    const final = await scanLobby(identities, provider, store, {
      set: data.version.set,
      patch: data.version.patch,
      now,
      historyWindow: settings.historyWindow,
      timeoutMs: 8_000,
      requestedOpponents: requested,
      onWarmResult: (warm) => {
        setResult(warm);
        onLobby(warm);
      },
    });
    setResult(final);
    onLobby(final);
    setMessage(
      final.state === 'complete'
        ? 'Opponent history refresh completed.'
        : 'Scouting finished with the available partial evidence.',
    );
  };

  const scanManual = async () => {
    setWorking('manual');
    setMessage('');
    try {
      const resolved = await resolveOpponentIdentities(
        opponents,
        provider,
        store,
        settings.riotPlatform,
        new Date().toISOString(),
        ownIdentity?.puuid,
        { deadlineAt: Date.now() + 8_000 },
      );
      setEntries(resolved.entries);
      if (resolved.duplicates.length || resolved.overflow)
        setMessage(
          `${resolved.duplicates.length} duplicate entr${resolved.duplicates.length === 1 ? 'y' : 'ies'} ignored${resolved.overflow ? `; ${resolved.overflow} over the seven-opponent limit ignored` : ''}.`,
        );
      await runScan(resolved.resolved, resolved.requested);
    } catch {
      setMessage(
        'Manual opponent resolution was unavailable. Successful cached evidence is retained.',
      );
    } finally {
      setWorking(null);
    }
  };

  const discoverCurrentGame = async () => {
    if (!ownIdentity) return;
    setWorking('discovery');
    setMessage('');
    try {
      const discovery = await provider.lobby(ownIdentity, { deadlineAt: Date.now() + 8_000 });
      if (!discovery.ok) {
        setMessage(
          discovery.error === 'not-in-game'
            ? 'Riot reports that this account is not in an active TFT game.'
            : 'Official current-game discovery is unavailable; use manual Riot IDs.',
        );
        return;
      }
      const identities = await Promise.all(
        discovery.value.map(async (puuid, index): Promise<RiotIdentity> => {
          try {
            return await provider.accountByPuuid(puuid, { deadlineAt: Date.now() + 8_000 });
          } catch {
            return {
              puuid,
              gameName: 'Official participant',
              tagLine: String(index + 1),
              platform: settings.riotPlatform,
              routing: regionalRouteFor(settings.riotPlatform),
            };
          }
        }),
      );
      await runScan(identities, discovery.value.length);
    } finally {
      setWorking(null);
    }
  };

  const nameFor = (id: string) =>
    data.champions.find((unit) => unit.id === id)?.name ??
    data.traits.find((trait) => trait.id === id)?.name ??
    id;

  return (
    <section className="panel riot-panel">
      <div className="panel-heading">
        <Radio size={18} />
        <h2>Riot history & opponent scouting</h2>
        <span className={`badge ${status.keyDetected ? 'success' : 'muted'}`}>
          {fixturePreview
            ? 'Fixture preview'
            : status.keyDetected
              ? 'API key detected'
              : 'API key unavailable'}
        </span>
      </div>
      <div className="riot-connection-grid">
        <div className="riot-account-box">
          <div className="subheading">
            <ShieldCheck size={15} /> Your account
          </div>
          <label className="setting-label" htmlFor="riot-id">
            Riot ID
          </label>
          <div className="input-action">
            <input
              id="riot-id"
              value={ownInput}
              onChange={(event) => setOwnInput(event.target.value)}
              placeholder="gameName#tagLine"
              autoComplete="off"
            />
            <button className="secondary" onClick={resolveOwn} disabled={working !== null}>
              {working === 'account' ? (
                <RefreshCw className="spin" size={14} />
              ) : (
                <Search size={14} />
              )}
              Resolve
            </button>
          </div>
          <label className="setting-label" htmlFor="riot-platform">
            Platform
          </label>
          <select
            id="riot-platform"
            value={settings.riotPlatform}
            onChange={(event) =>
              onSave({ ...settings, riotPlatform: event.target.value as RiotPlatform })
            }
          >
            {RIOT_PLATFORMS.map((platform) => (
              <option value={platform} key={platform}>
                {platform} → {regionalRouteFor(platform)}
              </option>
            ))}
          </select>
          <div className="connection-facts">
            <span>
              Platform <strong>{settings.riotPlatform}</strong>
            </span>
            <span>
              Account route <strong>{accountRouteFor(settings.riotPlatform)}</strong>
            </span>
            <span>
              History route <strong>{regionalRouteFor(settings.riotPlatform)}</strong>
            </span>
            <span>
              Account <strong>{ownIdentity ? 'Resolved' : 'Unresolved'}</strong>
            </span>
          </div>
          <button
            className="text-button spectator-action"
            onClick={discoverCurrentGame}
            disabled={
              !ownIdentity || working !== null || !spectatorTftSupported(settings.riotPlatform)
            }
          >
            <Users size={14} /> Discover via official current-game endpoint
          </button>
          {!spectatorTftSupported(settings.riotPlatform) && (
            <p className="fine-print">
              The current official spectator reference does not list this platform.
            </p>
          )}
          <p className="fine-print">
            Discovery is never automatic. Riot policy restricts opponent-history display during
            gameplay/loading; manual pre-game identities remain the dependable fallback.
          </p>
        </div>
        <div className="riot-opponents-box">
          <div className="subheading">
            <Users size={15} /> Manual opponents · up to seven
          </div>
          <label className="setting-label" htmlFor="opponent-ids">
            One Riot ID per line, or comma-separated
          </label>
          <textarea
            id="opponent-ids"
            rows={7}
            value={opponents}
            onChange={(event) => setOpponents(event.target.value)}
            placeholder={'Opponent One#TAG\nOpponent Two#TAG'}
          />
          <button className="primary scan-button" onClick={scanManual} disabled={working !== null}>
            {working === 'manual' ? <RefreshCw className="spin" size={15} /> : <Radio size={15} />}
            {working === 'manual' ? 'Scanning history…' : 'Resolve & scan history'}
          </button>
          <p className="fine-print">
            Target: {settings.historyWindow} relevant current-set games each · 60 raw-ID horizon ·
            eight-second partial-result budget.
          </p>
        </div>
      </div>
      {entries.length > 0 && (
        <div className="resolution-list" aria-label="Opponent resolution results">
          {entries.map((entry) => (
            <div key={`${entry.input}-${entry.state}`}>
              {entry.state === 'resolved' || entry.state === 'cached' ? (
                <CheckCircle2 size={13} />
              ) : (
                <TriangleAlert size={13} />
              )}
              <span>{entry.input}</span>
              <strong>{entry.state}</strong>
              {entry.error && <small>{entry.error}</small>}
            </div>
          ))}
        </div>
      )}
      {message && <p className="riot-message">{message}</p>}
      {result && (
        <div className="scout-result" aria-live="polite">
          <div className="scout-summary">
            <span className={`scan-state ${result.state}`}>{result.state}</span>
            <div>
              <strong>
                {result.profilesCompleted}/{result.resolvedOpponents} profiles
              </strong>
              <small>
                {result.relevantGamesAvailable}/{result.relevantGamesTarget} relevant games
              </small>
            </div>
            <div>
              <strong>{Math.round(result.coverage * 100)}% coverage</strong>
              <small>
                {result.freshProfiles} fresh · {result.cachedProfiles} cached
              </small>
            </div>
            <div>
              <strong>{Math.round(result.elapsedMs)} ms</strong>
              <small>
                <Clock3 size={11} /> last refresh {new Date(result.fetchedAt).toLocaleTimeString()}
              </small>
            </div>
          </div>
          <div className="scout-metrics">
            <span>{result.telemetry.requestsAttempted} requests</span>
            <span>{result.telemetry.cacheHits} cache hits</span>
            <span>{result.telemetry.uniqueMatchDetailsFetched} match fetches</span>
            <span>{result.telemetry.sharedMatchesDeduplicated} shared refs reused</span>
            <span>{result.telemetry.retries} retries</span>
            <span>{result.telemetry.rateLimitWaits} limit waits</span>
          </div>
          <div className="opponent-profile-grid">
            {result.profiles.map((profile) => (
              <article key={profile.puuid}>
                <div>
                  <strong>{profile.riotId ?? 'Resolved participant'}</strong>
                  <span>{profile.freshness}</span>
                </div>
                <p>
                  {profile.relevantGames} games · {profile.samePatchGames} same patch · avg{' '}
                  {profile.placement.average?.toFixed(1) ?? '—'}
                </p>
                <small>
                  Repeated units:{' '}
                  {profile.repeatedUnitCandidates.slice(0, 3).map(nameFor).join(', ') || 'none yet'}
                </small>
                <div className="confidence-track">
                  <i style={{ width: `${Math.round(profile.confidence * 100)}%` }} />
                </div>
                <em>{Math.round(profile.confidence * 100)}% evidence confidence</em>
              </article>
            ))}
          </div>
          {result.errors.length > 0 && (
            <details className="scout-errors">
              <summary>{result.errors.length} partial-evidence note(s)</summary>
              {result.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
