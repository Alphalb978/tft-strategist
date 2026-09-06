import { useMemo, useState } from 'react';
import { ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import type { AggregateMetaDataset, Playbook, StaticData } from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Art } from '../components/Art';

export type CompSort =
  | 'name'
  | 'strength'
  | 'placement'
  | 'top4'
  | 'wins'
  | 'confidence'
  | 'sample';

export interface CompLibraryQuery {
  search: string;
  evidence: string;
  style: string;
  sort: CompSort;
}

export function filterAndSortComps(
  playbooks: Playbook[],
  data: StaticData,
  meta: AggregateMetaDataset | null,
  query: CompLibraryQuery,
) {
  const stats = new Map(meta?.familyStats.map((value) => [value.familyId, value]) ?? []);
  const needle = query.search.trim().toLocaleLowerCase('en-US');
  const value = (playbook: Playbook) => stats.get(playbook.family.id);
  const text = (playbook: Playbook) => {
    const unitIds = new Set(playbook.target.units.map((unit) => unit.championId));
    const units = data.champions.filter((unit) => unitIds.has(unit.id));
    const traits = new Set(units.flatMap((unit) => unit.traitIds));
    return [
      playbook.title,
      playbook.subtitle,
      ...units.map((unit) => unit.name),
      ...data.traits.filter((trait) => traits.has(trait.id)).map((trait) => trait.name),
    ]
      .join(' ')
      .toLocaleLowerCase('en-US');
  };
  const compare = (a: Playbook, b: Playbook) => {
    const left = value(a);
    const right = value(b);
    const metric = (stat: typeof left) => {
      if (!stat) return null;
      switch (query.sort) {
        case 'strength':
          return stat.measuredStrength;
        case 'placement':
          return -stat.shrunkAveragePlacement;
        case 'top4':
          return stat.topFour.shrunk;
        case 'wins':
          return stat.wins.shrunk;
        case 'confidence':
          return stat.confidence;
        case 'sample':
          return stat.games;
        default:
          return null;
      }
    };
    const aMetric = metric(left);
    const bMetric = metric(right);
    if (aMetric !== null || bMetric !== null) {
      if (aMetric === null) return 1;
      if (bMetric === null) return -1;
      if (aMetric !== bMetric) return bMetric - aMetric;
    }
    return a.title.localeCompare(b.title);
  };
  return playbooks
    .filter((playbook) => !needle || text(playbook).includes(needle))
    .filter((playbook) => query.evidence === 'all' || playbook.evidence === query.evidence)
    .filter((playbook) => query.style === 'all' || playbook.features.style.includes(query.style))
    .sort(compare);
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function CompLibrary({
  state,
  onOpen,
}: {
  state: ApplicationState;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState<CompLibraryQuery>({
    search: '',
    evidence: 'all',
    style: 'all',
    sort: 'name',
  });
  const filtered = useMemo(
    () => filterAndSortComps(state.playbooks, state.data, state.meta, query),
    [query, state],
  );
  const stats = new Map(state.meta?.familyStats.map((value) => [value.familyId, value]) ?? []);
  return (
    <>
      <div className="page-heading comps-heading">
        <div>
          <div className="eyebrow">CURRENT SET · ATTRIBUTED BOARDS</div>
          <h1>Comp Library</h1>
          <p>{state.playbooks.length} legal Set 18 families with source and evidence limits.</p>
        </div>
        <div className="library-count">
          <strong>{filtered.length}</strong>
          <span>shown</span>
        </div>
      </div>
      <div className="comp-controls" aria-label="Comp library controls">
        <label className="comp-search">
          <Search size={16} />
          <span className="sr-only">Search comps, units, or traits</span>
          <input
            aria-label="Search comps, units, or traits"
            placeholder="Search comp, unit, or trait"
            value={query.search}
            onChange={(event) => setQuery({ ...query, search: event.target.value })}
          />
        </label>
        <label>
          <SlidersHorizontal size={15} />
          <span>Evidence</span>
          <select
            aria-label="Evidence filter"
            value={query.evidence}
            onChange={(event) => setQuery({ ...query, evidence: event.target.value })}
          >
            <option value="all">All classes</option>
            <option value="Proven">Proven</option>
            <option value="Variant">Variant</option>
            <option value="Emerging">Emerging</option>
            <option value="Experimental">Experimental</option>
          </select>
        </label>
        <label>
          <span>Style</span>
          <select
            aria-label="Roll style filter"
            value={query.style}
            onChange={(event) => setQuery({ ...query, style: event.target.value })}
          >
            <option value="all">All styles</option>
            <option value="Slow Roll">Slow Roll</option>
            <option value="Fast 8">Fast 8</option>
            <option value="Fast 9">Fast 9</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select
            aria-label="Sort comps"
            value={query.sort}
            onChange={(event) => setQuery({ ...query, sort: event.target.value as CompSort })}
          >
            <option value="name">Name</option>
            <option value="strength">Measured strength</option>
            <option value="placement">Average placement</option>
            <option value="top4">Top 4</option>
            <option value="wins">Win rate</option>
            <option value="confidence">Confidence</option>
            <option value="sample">Sample size</option>
          </select>
        </label>
      </div>
      {!state.meta && (
        <div className="meta-unavailable">
          Outcome statistics are unavailable until a compatible Riot aggregate sample clears the M5
          quality gates. Board definitions remain source-backed; outcome sorting places missing
          values last.
        </div>
      )}
      <div className="library-grid expanded-library">
        {filtered.map((playbook) => {
          const stat = stats.get(playbook.family.id);
          return (
            <button className="library-card" key={playbook.id} onClick={() => onOpen(playbook.id)}>
              <Art
                url={state.data.champions.find((champion) => champion.id === playbook.hero)!.splash}
                alt={playbook.title}
                assets={state.assets}
              />
              <div className="library-card-copy">
                <span className="eyebrow">{playbook.features.style}</span>
                <h2>{playbook.title}</h2>
                <p>{playbook.subtitle}</p>
                {stat ? (
                  <div className="library-metrics">
                    <span>
                      <b>{stat.shrunkAveragePlacement.toFixed(2)}</b> avg
                    </span>
                    <span>
                      <b>{percent(stat.topFour.shrunk)}</b> top 4
                    </span>
                    <span>
                      <b>{percent(stat.wins.shrunk)}</b> win
                    </span>
                    <span>
                      <b>{stat.games}</b> games
                    </span>
                  </div>
                ) : (
                  <div className="library-metrics unavailable">Measured outcomes unavailable</div>
                )}
                <span className="badge">{playbook.evidence} · public board</span>
              </div>
              <ChevronRight />
            </button>
          );
        })}
      </div>
      {!filtered.length && <div className="empty-state">No comps match these filters.</div>}
    </>
  );
}
