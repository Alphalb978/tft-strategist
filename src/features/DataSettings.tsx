import { RiotApiSettings } from './RiotApiSettings';
import { compactCount, compactRank } from '../components/intelligenceDisplay';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { externalStatus } from '../providers/externalMeta';
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
import { RecommendationLab } from './RecommendationLab';
import {
  ScreenIntelligenceSection,
  ScreenIntelligenceErrorBoundary,
} from './ScreenIntelligenceSection';
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
  onRebuildIntelligence,
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
  onLobby: (lobby: LobbyPressure | null) => void;
  onRebuildIntelligence?: () => void;
}) {
  const [externalRefresh, setExternalRefresh] = useState('');
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
      <section className="panel external-meta-settings" aria-label="External Meta status">
        <h2>External Meta · MetaTFT</h2>
        <button
          className="secondary"
          disabled={externalRefresh === 'Refreshing…'}
          onClick={async () => {
            if (!isTauri()) {
              setExternalRefresh('Run Refresh MetaTFT Data.cmd, then reload this preview.');
              return;
            }
            setExternalRefresh('Refreshing…');
            try {
              await invoke('refresh_external_meta');
              location.reload();
            } catch (error) {
              setExternalRefresh(`Failed · last good snapshot retained. ${String(error)}`);
            }
          }}
        >
          Refresh MetaTFT Data
        </button>
        {externalRefresh && <p role="status">{externalRefresh}</p>}
        <p>{state.externalNotice ?? externalStatus(state.external, state.data)}</p>
        <p>
          {state.external
            ? `Set ${state.external.manifest.scope.set} · Patch ${state.external.manifest.scope.patch}${state.external.manifest.scope.hotfix ?? ''} · ${compactRank(state.external.manifest.scope.rank)} · ${state.external.manifest.scope.window ?? 'Unknown window'} · ${compactCount(state.external.manifest.population)} analyzed boards · ${state.external.comps.length} mapped comps`
            : 'Run Refresh MetaTFT Data.cmd in the project folder, then reload.'}
        </p>
        {state.external && (
          <details>
            <summary>Update times, scope and evidence</summary>
            <p>
              Provider updated: {state.external.manifest.providerUpdated ?? 'Unknown'} · Local
              refresh: {new Date(state.external.manifest.retrievedAt).toLocaleString()}
            </p>
            <p>
              Snapshot {state.external.manifest.contentHash} · {state.external.manifest.scope.rank}{' '}
              · {state.external.manifest.scope.window}
            </p>
            {state.external.manifest.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
        )}
        <p className="fine-print">
          Refresh weekly or after a patch. Failed refreshes retain the last good snapshot.
        </p>
      </section>
      <RiotApiSettings provider={riotProvider} settings={state.settings} />
      <Appearance />
      <RecommendationLab settings={state.settings} onSave={onSave} />
      <ScreenIntelligenceErrorBoundary>
        <ScreenIntelligenceSection
          settings={state.settings}
          onSave={onSave}
          fixturePreview={fixturePreview}
        />
      </ScreenIntelligenceErrorBoundary>
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
            <br />
            Knowledge: {state.data.knowledge?.version ?? 'Awaiting static refresh'} ·{' '}
            {state.data.knowledge?.fingerprint ?? 'Unavailable'}
            <br />
            Entity coverage:{' '}
            {state.data.knowledge?.coverage.filter((e) => e.state === 'normalized').length ??
              0}{' '}
            normalized ·{' '}
            {state.data.knowledge?.coverage.filter((e) => e.state === 'excluded').length ?? 0}{' '}
            explicitly excluded
            <br />
            Intelligence: {state.meta?.intelligence?.generatedAt ?? 'Awaiting meta derivation'}
            <br />
            Verified rank sample: {state.meta?.verifiedRank?.observations.length ?? 0} participants
            explicitly in known ladder membership
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
          <button
            onClick={onRebuildIntelligence}
            disabled={metaRefreshing || !state.meta || !state.discovery}
          >
            Rebuild intelligence from cached matches
          </button>
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
