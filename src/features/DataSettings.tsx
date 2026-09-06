import { teamPlanner } from '../rules/teamPlanner';
import { useState } from 'react';
import {
  META_BUDGETS,
  META_COHORTS,
  type MetaSampleConfig,
  type MetaProgress,
} from '../services/metaPipeline';
import { RIOT_PLATFORMS } from '../providers/riotRouting';
import { Database, ExternalLink, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { LobbyPressure } from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import type { ApplicationState } from '../services/application';
import type { HistoryStore } from '../storage/history';
import type { Settings } from '../storage/repository';
import { set18Rules } from '../rules/ruleSet';
import { RiotScouting } from './RiotScouting';
import { Appearance } from './Appearance';
export function DataSettings({
  state,
  mode,
  onSave,
  onRefresh,
  refreshing,
  onMetaRefresh,
  metaRefreshing,
  metaProgress,
  onMetaCancel,
  riotProvider,
  historyStore,
  fixturePreview,
  onLobby,
}: {
  state: ApplicationState;
  mode: string;
  onSave: (s: Settings) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onMetaRefresh: (
    selection: Pick<MetaSampleConfig, 'mode' | 'platform' | 'tiers' | 'windowDays'>,
  ) => void;
  metaProgress: MetaProgress | null;
  onMetaCancel: () => void;
  metaRefreshing: boolean;
  riotProvider: RiotProvider;
  historyStore: HistoryStore;
  fixturePreview: boolean;
  onLobby: (lobby: LobbyPressure) => void;
}) {
  const [collectionMode, setCollectionMode] = useState<keyof typeof META_BUDGETS>('standard');
  const [region, setRegion] = useState(state.settings.riotPlatform);
  const [cohort, setCohort] = useState<keyof typeof META_COHORTS>('Challenger');
  const [days, setDays] = useState<1 | 3 | 7>(7);
  const budget = META_BUDGETS[collectionMode];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PREFERENCES / CONNECTIONS</div>
          <h1>Data & settings</h1>
          <p>Make Strategist yours. Manage your account and data.</p>
        </div>
      </div>
      <Appearance />
      <div className="settings-layout">
        <RiotScouting
          data={state.data}
          assets={state.assets}
          settings={state.settings}
          provider={riotProvider}
          store={historyStore}
          fixturePreview={fixturePreview}
          onSave={onSave}
          onLobby={onLobby}
        />
        <section className="panel">
          <div className="panel-heading">
            <Database size={18} />
            <h2>Active-set data</h2>
            <span className="badge">{state.source}</span>
          </div>
          <div className="data-counts">
            {[
              ['Units', state.data.champions.length],
              ['Traits', state.data.traits.length],
              ['Items', state.data.items.length],
              ['Augments', state.data.augments.length],
            ].map(([label, count]) => (
              <div key={label}>
                <strong>{count}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p>
            Set 18 · Enchanted Wilds · patch 18.1 ·{' '}
            <span className="badge muted">{state.data.version.parityStatus}</span>
          </p>
          <p className="fine-print">
            Fetched {new Date(state.data.version.provenance.fetchedAt).toLocaleString()}
            <br />
            Export date: {state.data.version.provenance.publishedAt ?? 'Unavailable'}
            <br />
            Storage: {mode}
          </p>
          <button className="secondary" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh static source'}
          </button>
          <p>
            <a href={state.data.version.provenance.source} target="_blank" rel="noreferrer">
              CommunityDragon source <ExternalLink size={12} />
            </a>
          </p>
        </section>
        <section className="panel discovery-status" aria-label="Comp discovery refresh status">
          <div className="panel-heading">
            <RefreshCw size={18} className={metaRefreshing ? 'spin' : ''} />
            <h2>Current meta</h2>
          </div>
          {state.meta && (
            <p className="meta-scope-summary">
              <strong>
                {state.meta.sourceType === 'fixture' ? 'Fixture sample' : 'Riot self-collected'} ·{' '}
                {state.meta.platform} · {state.meta.rankCohort.join(' / ')}
              </strong>
              <br />
              {state.meta.currentSetBoards.toLocaleString()} boards ·{' '}
              {Math.round(state.meta.coverage * 100)}% classified ·{' '}
              {state.meta.scope
                ? `Recent ${state.meta.scope.windowDays}d`
                : 'Legacy bounded sample'}
              <br />
              Updated {new Date(state.meta.collectedAt).toLocaleString()} · {state.meta.state}
            </p>
          )}
          {state.discovery ? (
            <>
              <p>
                <strong>{state.discovery.boardsAnalyzed}</strong> boards ·{' '}
                <strong>{state.discovery.clusterCount}</strong> clusters ·{' '}
                <strong>{state.discovery.noiseBoards}</strong> noise
              </p>
              <div className="data-counts discovery-counts">
                {[
                  ['Known', state.discovery.knownFamilyClusters],
                  ['Variants', state.discovery.variantClusters],
                  ['Emerging', state.discovery.emergingClusters],
                  ['Experimental', state.discovery.experimentalClusters],
                ].map(([label, count]) => (
                  <div key={label}>
                    <strong>{count}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <p className="fine-print">
                Last refresh {new Date(state.discovery.generatedAt).toLocaleString()}
                <br />
                Patch relevance unavailable; set membership and recency only.
              </p>
            </>
          ) : (
            <p className="fine-print">
              No discovery evidence yet. Refresh to find repeated boards in a ranked regional
              sample.
            </p>
          )}
          <div className="meta-refresh-controls">
            <label>
              Region
              <select
                aria-label="Meta region"
                disabled={metaRefreshing}
                value={region}
                onChange={(e) => setRegion(e.target.value as typeof region)}
              >
                {RIOT_PLATFORMS.filter((p) => !['PH2', 'TH2'].includes(p)).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Ranked cohort
              <select
                aria-label="Meta rank"
                disabled={metaRefreshing}
                value={cohort}
                onChange={(e) => setCohort(e.target.value as typeof cohort)}
              >
                {Object.keys(META_COHORTS).map((c) => (
                  <option key={c}>{c}</option>
                ))}
                <option disabled>Diamond+ · unavailable</option>
                <option disabled>Emerald+ · unavailable</option>
                <option disabled>Platinum+ · unavailable</option>
              </select>
            </label>
            <label>
              Match window
              <select
                aria-label="Meta window"
                disabled={metaRefreshing}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) as typeof days)}
              >
                {[1, 3, 7].map((d) => (
                  <option key={d} value={d}>
                    Recent {d}d
                  </option>
                ))}
                <option disabled>Current patch · mapping unavailable</option>
              </select>
            </label>
            <label>
              Collection
              <select
                aria-label="Meta collection mode"
                disabled={metaRefreshing}
                value={collectionMode}
                onChange={(e) => setCollectionMode(e.target.value as typeof collectionMode)}
              >
                {Object.keys(META_BUDGETS).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="fine-print">
            Up to {budget.playersPerTier * META_COHORTS[cohort].length} players ·{' '}
            {budget.matchesPerPlayer} recent matches each · {budget.newMatches} new match requests.
            Maximum {Math.round(budget.deadlineMs / 60_000)} minutes; Riot limits may slow
            collection. Retries may add requests.
          </p>
          {metaProgress && (
            <div className="meta-progress" role="status" aria-live="polite">
              <strong>
                {metaRefreshing ? 'Meta refresh' : 'Last refresh'} · {metaProgress.phase}
              </strong>
              <progress
                value={
                  metaProgress.phase === 'players'
                    ? metaProgress.players
                    : metaProgress.cachedMatches + metaProgress.newMatches
                }
                max={Math.max(
                  1,
                  metaProgress.phase === 'players'
                    ? metaProgress.playerTarget
                    : metaProgress.uniqueMatches,
                )}
              />
              <p>
                Players {metaProgress.players} / {metaProgress.playerTarget} · Unique matches{' '}
                {metaProgress.uniqueMatches}
                <br />
                New {metaProgress.newMatches} · Cached {metaProgress.cachedMatches}
                <br />
                Boards {metaProgress.boards} · Classified {metaProgress.classified} · Ambiguous{' '}
                {metaProgress.ambiguous} · Unclassified {metaProgress.unclassified}
              </p>
            </div>
          )}
          <button
            className="secondary"
            onClick={() =>
              onMetaRefresh({
                mode: collectionMode,
                platform: region,
                tiers: [...META_COHORTS[cohort]],
                windowDays: days,
              })
            }
            disabled={metaRefreshing}
          >
            <RefreshCw size={15} className={metaRefreshing ? 'spin' : ''} />
            {metaRefreshing ? 'Refreshing meta…' : 'Refresh meta & discovery'}
          </button>
          {metaRefreshing && (
            <button className="secondary" onClick={onMetaCancel}>
              Cancel meta refresh
            </button>
          )}
          <p className="fine-print">
            Ranked lobbies containing sampled ladder players; other player ranks unverified.
            Requires Riot API access. Existing evidence stays available during refresh.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <SlidersHorizontal size={18} />
            <h2>Recommendation settings</h2>
          </div>
          <label className="setting-label" htmlFor="personal">
            Personal history weight{' '}
            <strong>{Math.round(state.settings.personalWeight * 100)}%</strong>
          </label>
          <input
            id="personal"
            type="range"
            min="5"
            max="10"
            step="1"
            value={state.settings.personalWeight * 100}
            onChange={(e) =>
              onSave({ ...state.settings, personalWeight: Number(e.target.value) / 100 })
            }
          />
          <p className="fine-print">
            Default 5%. Small samples stay neutral; established evidence has a modest influence.
          </p>
          <label className="setting-label" htmlFor="window">
            Opponent history target
          </label>
          <select
            id="window"
            value={state.settings.historyWindow}
            onChange={(e) => onSave({ ...state.settings, historyWindow: Number(e.target.value) })}
          >
            <option value="10">10 recent games</option>
            <option value="15">15 recent games</option>
            <option value="20">20 recent games</option>
          </select>
          <p className="fine-print">Cached matches are reused. Partial results remain usable.</p>
        </section>
        <details>
          <summary>Advanced diagnostics · verification & storage</summary>
          <section className="panel">
            <div className="panel-heading">
              <Database size={18} />
              <h2>Verification ledger</h2>
            </div>
            {[
              ['Board & capacity', set18Rules.board.status],
              ['Trait counting', set18Rules.traits.status],
              ['Shop odds & pools', set18Rules.shop.status],
              ['XP', set18Rules.experience.status],
              ['Interest', set18Rules.economy.status],
              [
                'Team Planner',
                teamPlanner.supportStatus(state.data.version).state === 'supported'
                  ? 'verified'
                  : 'unverified',
              ],
            ].map(([label, status]) => (
              <p className="ledger-row" key={label}>
                <span>{status === 'verified' ? '●' : '○'}</span>
                {label}: {status}
              </p>
            ))}
            {state.data.warnings.map((w) => (
              <p className="ledger-row" key={w}>
                <span>○</span>
                {w}
              </p>
            ))}
            <p className="ledger-row">
              <span>○</span>Scores, risk estimates and optimizer weights are seeded. Boards and item
              directions are public-guide curation.
            </p>
            <p className="ledger-row">
              <span>○</span>Team Planner mapping and wire fixture are audited. Copy remains disabled
              until a generated roster is manually verified in the current TFT client.
            </p>
          </section>
        </details>
      </div>
    </>
  );
}
