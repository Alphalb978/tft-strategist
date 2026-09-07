import { useEffect, useRef, useState } from 'react';
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
import { RiotProviderError, type RiotConnectionStatus, type RiotProvider } from '../providers/riot';
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
import { Art } from '../components/Art';
import { LobbyPressureSummary } from '../components/LobbyPressureSummary';
import { discoverCurrentLobby } from '../services/currentLobby';

export function RiotScouting({
  data,
  assets,
  settings,
  provider,
  store,
  fixturePreview,
  onSave,
  onLobby,
}: {
  data: StaticData;
  assets: Record<string, string>;
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
  const [origin, setOrigin] = useState('');
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void provider
        .connectionStatus()
        .then((next) => active && setStatus(next))
        .catch(() => active && setStatus({ keyDetected: false, source: 'unavailable' }));
    refresh();
    window.addEventListener('riot-credential-status', refresh);
    return () => {
      active = false;
      window.removeEventListener('riot-credential-status', refresh);
    };
  }, [provider, working]);

  const resolveOwn = async () => {
    if (busy.current) return;
    busy.current = true;
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
      setMessage('Account connected. Ready to scan your current lobby.');
    } catch (error) {
      setOwnIdentity(null);
      setMessage(error instanceof Error ? error.message : 'Account resolution was unavailable.');
    } finally {
      busy.current = false;
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
      currentUnitIds: data.champions.filter((unit) => unit.boardEligible).map((unit) => unit.id),
      copyEligibleUnitIds: new Set(
        data.champions
          .filter((unit) => unit.boardEligible && unit.shopStatus === 'pool')
          .map((unit) => unit.id),
      ),
      staticSourceVersion: data.version.sourceVersion,
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
    if (busy.current) return;
    busy.current = true;
    setOrigin('Manual fallback lobby');
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
      const ignoredSelf = resolved.entries.some((entry) => entry.state === 'ignored-self');
      if (!resolved.resolved.length && ignoredSelf) {
        setMessage('Your account was ignored; no opponent history requests were started.');
        return;
      }
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
      busy.current = false;
      setWorking(null);
    }
  };

  const discoverCurrentGame = async () => {
    if (busy.current) return;
    busy.current = true;
    setWorking('discovery');
    setMessage('Finding your current lobby…');
    try {
      const discovery = await discoverCurrentLobby(
        provider,
        store,
        ownInput,
        settings.riotPlatform,
      );
      if (!discovery.ok) {
        setMessage(discovery.error);
        return;
      }
      setOwnIdentity(discovery.value.own);
      onSave({ ...settings, riotId: parseRiotId(ownInput).display });
      setEntries([]);
      setOrigin(
        `Automatically discovered current lobby · ${discovery.value.opponents.length} opponents discovered`,
      );
      setMessage('Loading recent history…');
      await runScan(discovery.value.opponents, 7);
    } catch (error) {
      setMessage(
        (error instanceof RiotProviderError
          ? `${error.message} `
          : 'Lobby scan could not finish. ') +
          'Retry or use manual opponents; cached plans still work.',
      );
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  const championFor = (id: string) => data.champions.find((unit) => unit.id === id);

  return (
    <section className="panel riot-panel">
      <div className="panel-heading">
        <Radio size={18} />
        <h2>Riot account & lobby</h2>
        <span className={`badge ${status.keyDetected ? 'success' : 'muted'}`}>
          {fixturePreview
            ? 'Fixture preview'
            : status.keyDetected
              ? status.status === 'auth'
                ? 'Key expired / invalid'
                : 'API key detected'
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
              disabled={working !== null}
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
            disabled={working !== null}
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
          <details className="connection-details">
            <summary>Connection details</summary>
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
          </details>
          <button
            className="primary spectator-action"
            onClick={discoverCurrentGame}
            disabled={
              !ownInput.trim() || working !== null || !spectatorTftSupported(settings.riotPlatform)
            }
          >
            <Users size={14} />{' '}
            {working === 'discovery' ? 'Scanning current lobby…' : 'Scan current lobby'}
          </button>
          {!spectatorTftSupported(settings.riotPlatform) && (
            <p className="fine-print">
              The current official spectator reference does not list this platform.
            </p>
          )}
          <p className="policy-note">
            Public Riot lookup. Riot policy restricts opponent-history and lobby-stat display during
            gameplay/loading; technical access is not policy approval.
          </p>
        </div>
        <div className="riot-opponents-box">
          <div className="subheading">
            <Users size={15} /> Manual fallback · up to seven opponents
          </div>
          <label className="setting-label" htmlFor="opponent-ids">
            One Riot ID per line, or comma-separated
          </label>
          <textarea
            id="opponent-ids"
            disabled={working !== null}
            rows={4}
            value={opponents}
            onChange={(event) => setOpponents(event.target.value)}
            placeholder={'Opponent One#TAG\nOpponent Two#TAG'}
          />
          <button
            className="secondary scan-button"
            onClick={scanManual}
            disabled={working !== null}
          >
            {working === 'manual' ? <RefreshCw className="spin" size={15} /> : <Radio size={15} />}
            {working === 'manual' ? 'Scanning history…' : 'Resolve & scan history'}
          </button>
          <p className="fine-print">
            Target: {settings.historyWindow} recent games per opponent. Cached results are reused.
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
              <strong>
                {entry.state === 'ignored-self' ? 'your account — ignored' : entry.state}
              </strong>
              {entry.error && <small>{entry.error}</small>}
            </div>
          ))}
        </div>
      )}
      {working && (
        <div className="scan-progress" role="progressbar" aria-label="Scouting in progress" />
      )}
      {origin && <div className="lobby-origin">{origin}</div>}
      {message && (
        <p className="riot-message" role="status">
          {message}
        </p>
      )}
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
              <strong>Historical evidence</strong>
              <small>
                <Clock3 size={11} /> {Math.round(result.elapsedMs)} ms · cache first
              </small>
            </div>
          </div>
          <details>
            <summary>Scan diagnostics</summary>
            <div className="scout-metrics">
              <span>{result.telemetry.requestsAttempted} requests</span>
              <span>{result.telemetry.cacheHits} cache hits</span>
              <span>{result.telemetry.uniqueMatchDetailsFetched} match fetches</span>
              <span>{result.telemetry.sharedMatchesDeduplicated} shared refs reused</span>
              <span>{result.telemetry.retries} retries</span>
              <span>{result.telemetry.rateLimitWaits} limit waits</span>
            </div>
          </details>
          <LobbyPressureSummary lobby={result} data={data} assets={assets} />
          <details>
            <summary>Opponent evidence · {result.profiles.length} profiles</summary>
            <div className="opponent-profile-grid">
              {result.profiles.map((profile) => (
                <article key={profile.puuid}>
                  <div>
                    <strong>{profile.riotId ?? 'Resolved participant'}</strong>
                    <span>{profile.freshness}</span>
                  </div>
                  <p>
                    {profile.relevantGames} games ·{' '}
                    {profile.patchRelevance.status === 'unavailable'
                      ? 'patch relevance unavailable'
                      : `${profile.patchRelevance.samePatchGames}/${profile.patchRelevance.comparableGames} same content patch`}{' '}
                    · avg {profile.placement.average?.toFixed(1) ?? '—'}
                  </p>
                  <div className="unit-signal-preview">
                    {profile.unitEvidence.slice(0, 3).map((unit) => (
                      <span key={unit.championId}>
                        {championFor(unit.championId)?.name ?? unit.championId} ·{' '}
                        {Math.round(unit.weightedPresence * 100)}% · {unit.recentFiveAppearances}/
                        {unit.recentWindowGames} last 5
                      </span>
                    ))}
                  </div>
                  <details className="unit-evidence-details">
                    <summary>
                      Inspect {Math.min(12, profile.unitEvidence.length)} unit signals
                    </summary>
                    <div className="unit-evidence-list">
                      {profile.unitEvidence.slice(0, 12).map((unit) => {
                        const champion = championFor(unit.championId);
                        return (
                          <div key={unit.championId} data-unit-signal={unit.championId}>
                            {champion && (
                              <Art url={champion.icon} alt={champion.name} assets={assets} />
                            )}
                            <span className="unit-signal-name">
                              <strong>{champion?.name ?? unit.championId}</strong>
                              <small title={unit.championId}>{unit.championId}</small>
                            </span>
                            <span>
                              <strong>{Math.round(unit.weightedPresence * 100)}%</strong>
                              <small>weighted history</small>
                            </span>
                            <span>
                              <strong>
                                {unit.gamesAppeared}/{unit.sampleGames}
                              </strong>
                              <small>raw games</small>
                            </span>
                            <span>
                              <strong>
                                {unit.recentFiveAppearances}/{unit.recentWindowGames}
                              </strong>
                              <small>last 5</small>
                            </span>
                            <span className={`trend ${unit.trend}`}>
                              <strong>
                                {unit.trend === 'rising'
                                  ? '↗ rising'
                                  : unit.trend === 'falling'
                                    ? '↘ falling'
                                    : unit.trend === 'stable'
                                      ? '→ stable'
                                      : '— trend'}
                              </strong>
                              <small>
                                {unit.trendDelta === null
                                  ? 'no prior window'
                                  : `${unit.trendDelta >= 0 ? '+' : ''}${Math.round(unit.trendDelta * 100)} pts`}
                              </small>
                            </span>
                            {unit.historicalCopyDemand.weightedAverageFinalCopies !== null && (
                              <span>
                                <strong>
                                  {unit.historicalCopyDemand.weightedAverageFinalCopies.toFixed(1)}
                                </strong>
                                <small>final copies when seen</small>
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                  <div className="confidence-track">
                    <i style={{ width: `${Math.round(profile.confidence * 100)}%` }} />
                  </div>
                  <em>{Math.round(profile.confidence * 100)}% evidence confidence</em>
                  <small>
                    Sample {Math.round(profile.confidenceFactors.sampleCoverage * 100)}% · recency{' '}
                    {Math.round(profile.confidenceFactors.recencyQuality * 100)}% · mode{' '}
                    {Math.round(profile.confidenceFactors.modeQuality * 100)}% · patch{' '}
                    {profile.confidenceFactors.patchQuality === null
                      ? 'unavailable'
                      : `${Math.round(profile.confidenceFactors.patchQuality * 100)}%`}
                  </small>
                </article>
              ))}
            </div>
          </details>
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
