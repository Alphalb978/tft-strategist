import { Database, ExternalLink, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { LobbyPressure } from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import type { ApplicationState } from '../services/application';
import type { HistoryStore } from '../storage/history';
import type { Settings } from '../storage/repository';
import { set18Rules } from '../rules/ruleSet';
import { RiotScouting } from './RiotScouting';
export function DataSettings({
  state,
  mode,
  onSave,
  onRefresh,
  refreshing,
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
  riotProvider: RiotProvider;
  historyStore: HistoryStore;
  fixturePreview: boolean;
  onLobby: (lobby: LobbyPressure) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">KNOW YOUR EVIDENCE</div>
          <h1>Data & settings</h1>
          <p>Every recommendation should be as honest as its inputs.</p>
        </div>
      </div>
      <div className="detail-grid">
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
          <button
            className="secondary"
            onClick={onRefresh}
            disabled={refreshing || !!state.selection}
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            {refreshing
              ? 'Refreshing…'
              : state.selection
                ? 'Unlock plan to refresh'
                : 'Refresh static source'}
          </button>
          <p>
            <a href={state.data.version.provenance.source} target="_blank" rel="noreferrer">
              CommunityDragon source <ExternalLink size={12} />
            </a>
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
            Default 5%. Small samples shrink toward neutral. No personal games are connected yet.
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
          <p className="fine-print">
            Saved locally. Scouting uses bounded concurrency, recency weighting, shared-match
            deduplication, and partial results.
          </p>
        </section>
        <RiotScouting
          data={state.data}
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
            <h2>Verification ledger</h2>
          </div>
          {[
            ['Board & capacity', set18Rules.board.status],
            ['Trait counting', set18Rules.traits.status],
            ['Shop odds & pools', set18Rules.shop.status],
            ['XP', set18Rules.experience.status],
            ['Interest', set18Rules.economy.status],
            ['Team Planner', set18Rules.mechanics.teamPlanner.status],
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
            <span>○</span>Team Planner remains disabled pending ID mapping, fixture and manual
            client paste verification.
          </p>
        </section>
      </div>
    </>
  );
}
