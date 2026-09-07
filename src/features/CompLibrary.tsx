import { AdoptionMetric } from '../components/AdoptionMetric';
import { compactCount, compactRank } from '../components/intelligenceDisplay';
import { fusedForPlan, relatedExternal } from '../strategy/evidenceFusion';
import type { ExternalSnapshot } from '../domain/externalMeta';
import { externalStatus } from '../providers/externalMeta';
import { familyRepresentation, familyTrend, metaCohortLabel } from '../strategy/metaCatalog';
import { openRepository } from '../storage/repository';
import type { MetaBundle } from '../services/discoveryRefresh';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import type {
  AggregateMetaDataset,
  CompRegistryEntry,
  DiscoveryDataset,
  Playbook,
  StaticData,
} from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Art, Portrait } from '../components/Art';

export type CompSort =
  | 'name'
  | 'strength'
  | 'placement'
  | 'top4'
  | 'wins'
  | 'confidence'
  | 'sample'
  | 'popularity'
  | 'trend';

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
  registry: CompRegistryEntry[] = [],
  discovery: DiscoveryDataset | null = null,
  external?: ExternalSnapshot | null,
) {
  const stats = new Map(meta?.familyStats.map((value) => [value.familyId, value]) ?? []);
  const clusters = new Map(discovery?.clusters.map((c) => [c.id, c]) ?? []);
  const needle = query.search.trim().toLocaleLowerCase('en-US');
  const value = (playbook: Playbook) => stats.get(playbook.family.id);
  const entries = new Map(registry.map((entry) => [entry.playbook.id, entry]));
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
    const metric = (stat: typeof left, playbook: Playbook) => {
      const fusion = fusedForPlan(playbook, external, data, new Date().toISOString());
      if (fusion.externalWeight >= 30) {
        switch (query.sort) {
          case 'placement':
          case 'strength':
            return -(fusion.average ?? 8);
          case 'top4':
            return fusion.top4;
          case 'wins':
            return fusion.win;
          case 'confidence':
            return fusion.confidence;
          case 'sample':
            return relatedExternal(playbook, external)?.comp.stats.sample ?? null;
          case 'popularity':
            return relatedExternal(playbook, external)?.comp.stats.playRate ?? null;
        }
      }
      const cluster = clusters.get(entries.get(playbook.id)?.clusterId ?? '');
      if (!stat && cluster) {
        if (
          ['strength', 'placement', 'top4', 'wins'].includes(query.sort) &&
          !cluster.recommendationEligible
        )
          return null;
        switch (query.sort) {
          case 'sample':
            return cluster.stats.games;
          case 'confidence':
            return cluster.stats.confidence;
          case 'placement':
            return -cluster.stats.averagePlacement;
          case 'top4':
            return cluster.stats.topFour.raw;
          case 'wins':
            return cluster.stats.wins.raw;
          case 'popularity':
            return meta?.currentSetBoards ? cluster.stats.games / meta.currentSetBoards : null;
          case 'trend':
            return cluster.stats.adoption.mature ? cluster.stats.adoption.delta : null;
          default:
            return null;
        }
      }
      if (!stat) return null;
      if (
        ['strength', 'placement', 'top4', 'wins'].includes(query.sort) &&
        stat.quality !== 'eligible'
      )
        return null;
      switch (query.sort) {
        case 'popularity':
          return meta?.currentSetBoards ? stat.games / meta.currentSetBoards : null;
        case 'trend':
          return meta ? (familyTrend(stat.familyId, meta)?.delta ?? null) : null;
        case 'strength':
          return stat.measuredStrength;
        case 'placement':
          return -stat.averagePlacement;
        case 'top4':
          return stat.topFour.raw;
        case 'wins':
          return stat.wins.raw;
        case 'confidence':
          return stat.confidence;
        case 'sample':
          return stat.games;
        default:
          return null;
      }
    };
    const aMetric = metric(left, a);
    const bMetric = metric(right, b);
    if (aMetric !== null || bMetric !== null) {
      if (aMetric === null) return 1;
      if (bMetric === null) return -1;
      if (aMetric !== bMetric) return bMetric - aMetric;
    }
    return a.title.localeCompare(b.title);
  };
  return playbooks
    .filter((playbook) => !needle || text(playbook).includes(needle))
    .filter((playbook) => {
      if (query.evidence === 'all') return true;
      const entry = entries.get(playbook.id);
      if (query.evidence === 'External') return entry?.sourceKind === 'external';
      if (query.evidence === 'Fused')
        return Boolean(entry?.externalId && entry.sourceKind !== 'external');
      if (query.evidence === 'Discovered') return entry?.sourceKind === 'discovered';
      if (query.evidence === 'Curated') return entry?.sourceKind === 'curated';
      return (entry?.lifecycle ?? playbook.evidence) === query.evidence;
    })
    .filter((playbook) => query.style === 'all' || playbook.features.style.includes(query.style))
    .sort(compare);
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function CompLibrary({
  state,
  onOpen,
  onSelectMeta,
}: {
  state: ApplicationState;
  onSelectMeta?: (bundle: MetaBundle) => void;
  onOpen: (id: string) => void;
}) {
  const [bundles, setBundles] = useState<MetaBundle[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const repo = await openRepository();
      const keys = (await repo.get<string[]>('meta-catalog-index:v1')) ?? [];
      const values = await Promise.all(keys.map((key) => repo.get<MetaBundle>(key)));
      if (alive) setBundles(values.filter((b): b is MetaBundle => b?.version === 1));
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [state.meta]);
  const [query, setQuery] = useState<CompLibraryQuery>({
    search: '',
    evidence: 'all',
    style: 'all',
    sort: 'name',
  });
  const filtered = useMemo(
    () =>
      filterAndSortComps(
        state.playbooks,
        state.data,
        state.meta,
        query,
        state.registry,
        state.discovery,
        state.external,
      ),
    [query, state],
  );
  const stats = new Map(state.meta?.familyStats.map((value) => [value.familyId, value]) ?? []);
  const entries = new Map(state.registry.map((entry) => [entry.playbook.id, entry]));
  const clusters = new Map(state.discovery?.clusters.map((cluster) => [cluster.id, cluster]) ?? []);
  return (
    <>
      <div className="page-heading comps-heading">
        <div>
          <div className="eyebrow">CURRENT META & PLAYBOOKS / SET {state.data.version.set}</div>
          <h1>Comp Library</h1>
          <p>{state.playbooks.length} comps. Search a champion, trait, or route.</p>
        </div>
        <div className="library-count">
          <strong>{filtered.length}</strong>
          <span>shown</span>
        </div>
      </div>
      <section className="meta-catalog-scope" aria-label="External meta scope">
        <strong>
          MetaTFT · {compactCount(state.external?.manifest.population)} analyzed boards · broad
          statistical prior
        </strong>
        <span>
          {externalStatus(state.external, state.data)} ·{' '}
          {compactRank(state.external?.manifest.scope.rank)} ·{' '}
          {state.external?.manifest.scope.window} · Patch {state.external?.manifest.scope.patch}
          {state.external?.manifest.scope.hotfix}
        </span>
        <small>
          Updated {state.external?.manifest.providerUpdated ?? 'Unknown'} · Refreshed{' '}
          {state.external
            ? new Date(state.external.manifest.retrievedAt).toLocaleString()
            : 'Never'}
          . Manage in Data & settings.
        </small>
      </section>
      <div className="meta-catalog-scope">
        <strong>
          {state.meta
            ? `${state.meta.sourceType === 'fixture' ? 'Fixture sample' : 'Direct Riot verification'} · ${state.meta.platform} · ${metaCohortLabel(state.meta.rankCohort)}`
            : 'Direct Riot · no collected sample'}
        </strong>
        {state.meta && (
          <span>
            {state.meta.currentSetBoards.toLocaleString()} boards ·{' '}
            {state.meta.classifiedBoards.toLocaleString()} classified (
            {percent(state.meta.coverage)}) ·{' '}
            {state.meta.scope
              ? `${state.meta.scope.windowDays}d ending ${new Date(state.meta.collectedAt).toLocaleDateString()}`
              : 'Legacy bounded sample'}{' '}
            · Updated {new Date(state.meta.collectedAt).toLocaleString()}
          </span>
        )}
        <div className="meta-scope-selectors">
          {(['platform', 'rankCohort', 'windowDays'] as const).map((field) => {
            const display = (b: MetaBundle) =>
              field === 'platform'
                ? b.meta.platform
                : field === 'rankCohort'
                  ? b.meta.rankCohort.join(' / ')
                  : String(b.meta.scope?.windowDays ?? 'Legacy');
            const current = state.meta
              ? display({ version: 1, meta: state.meta, discovery: state.discovery! })
              : '';
            return (
              <label key={field}>
                {field === 'platform' ? 'Region' : field === 'rankCohort' ? 'Rank' : 'Window'}
                <select
                  aria-label={`Catalog ${field}`}
                  value={current}
                  onChange={(e) => {
                    const selected = bundles.find((b) => display(b) === e.target.value);
                    if (selected) onSelectMeta?.(selected);
                  }}
                >
                  <option value={current}>
                    {current
                      ? field === 'rankCohort'
                        ? metaCohortLabel(current.split(' / '))
                        : field === 'windowDays' && current !== 'Legacy'
                          ? `${current}d`
                          : current
                      : 'No sample'}
                  </option>
                  {[...new Set(bundles.map(display))]
                    .filter((v) => v !== current)
                    .map((v) => (
                      <option key={v} value={v}>
                        {field === 'rankCohort'
                          ? metaCohortLabel(v.split(' / '))
                          : field === 'windowDays' && v !== 'Legacy'
                            ? `${v}d`
                            : v}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </div>
        <small>
          Collect another region, rank or rolling window in Data & settings. Patch mapping
          unavailable. Direct Share is among classified boards; popularity sorting uses share of all
          sampled boards; co-participant ranks are unverified.
        </small>
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
            <option value="all">All sources & states</option>
            <option value="Fused">Fused</option>
            <option value="External">External Reference</option>
            <option value="Discovered">Discovered</option>
            <option value="Curated">Curated</option>
            <option value="Variant">Variant</option>
            <option value="Emerging">Emerging</option>
            <option value="Experimental">Experimental</option>
            <option value="Stale">Stale</option>
            <option value="Retired">Retired</option>
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
            <option value="popularity">Popularity (source share)</option>
            <option value="trend">Trend</option>
          </select>
        </label>
      </div>
      {!state.meta && !state.external && (
        <div className="meta-unavailable">
          Outcome statistics are unavailable. Curated playbooks are ready to explore.
        </div>
      )}
      <div className="library-grid expanded-library">
        {filtered.map((playbook) => {
          const fused = fusedForPlan(
            playbook,
            state.external,
            state.data,
            new Date().toISOString(),
          );
          const stat = stats.get(playbook.family.id);
          const entry = entries.get(playbook.id);
          const cluster = entry?.clusterId ? clusters.get(entry.clusterId) : undefined;
          return (
            <button
              className={`library-card ${entry?.sourceKind === 'discovered' ? 'discovered-card' : ''}`}
              key={playbook.id}
              onClick={() => onOpen(playbook.id)}
            >
              <Art
                url={state.data.champions.find((champion) => champion.id === playbook.hero)!.splash}
                alt={playbook.title}
                assets={state.assets}
              />
              <div className="library-card-copy">
                <span className="eyebrow">{playbook.features.style}</span>
                <h2>{playbook.title}</h2>
                <div className="catalog-roster">
                  {playbook.target.units.map((unit) => {
                    const champion = state.data.champions.find((c) => c.id === unit.championId);
                    return (
                      champion && (
                        <div key={unit.championId}>
                          <Portrait champion={champion} assets={state.assets} compact />
                          <span>
                            {champion.name}{' '}
                            <small>{playbook.family.core.length ? unit.slot : ''}</small>
                          </span>
                        </div>
                      )
                    );
                  })}
                </div>
                {fused.externalWeight >= 30 ? (
                  <div className="library-metrics">
                    <span>
                      <b>{fused.average?.toFixed(2) ?? '—'}</b> avg
                    </span>
                    <span>
                      <b>{fused.top4 == null ? '—' : percent(fused.top4)}</b> top 4
                    </span>
                    <span>
                      <b>{fused.win == null ? '—' : percent(fused.win)}</b> win
                    </span>
                    <AdoptionMetric plan={playbook} state={state} />
                    <span>
                      {fused.confidence >= 0.75
                        ? 'High'
                        : fused.confidence >= 0.5
                          ? 'Medium'
                          : 'Limited'}{' '}
                      evidence
                    </span>
                  </div>
                ) : (cluster &&
                    (cluster.lifecycle === 'Experimental' || cluster.stats.games < 20)) ||
                  (stat && stat.quality !== 'eligible') ? (
                  <div className="library-metrics insufficient">
                    <strong>
                      {cluster?.stats.games ?? stat?.games}{' '}
                      {(cluster?.stats.games ?? stat?.games) === 1 ? 'game' : 'games'} ·
                      Insufficient sample
                    </strong>
                    <span>Outcomes need more evidence</span>
                    <AdoptionMetric plan={playbook} state={state} />
                  </div>
                ) : cluster ? (
                  <div className="library-metrics">
                    <span>
                      <b>{cluster.stats.games}</b> boards
                    </span>
                    <span>
                      <b>{cluster.stats.averagePlacement.toFixed(2)}</b> avg
                    </span>
                    <span>
                      <b>{percent(cluster.stats.topFour.raw)}</b> top 4
                    </span>
                    <span>
                      <b>{percent(cluster.stats.wins.raw)}</b> win
                    </span>
                    <AdoptionMetric plan={playbook} state={state} />
                  </div>
                ) : stat && state.meta ? (
                  <div
                    className="library-metrics"
                    title={`Adjusted avg ${stat.shrunkAveragePlacement.toFixed(2)} · ${percent(stat.confidence)} confidence · Direct Share confidence ${percent(familyRepresentation(stat, state.meta).confidence)} · Direct Share denominator ${state.meta.classifiedBoards} classified boards`}
                  >
                    <span>
                      <b>{stat.games}</b> games
                    </span>
                    <span>
                      <AdoptionMetric plan={playbook} state={state} />
                    </span>
                    <span>
                      <b>{stat.averagePlacement.toFixed(2)}</b> avg
                    </span>
                    <span>
                      <b>{percent(stat.topFour.raw)}</b> top 4
                    </span>
                    <span>
                      <b>{percent(stat.wins.raw)}</b> win
                    </span>
                    <span>{familyTrend(stat.familyId, state.meta)?.direction ?? 'Trend —'}</span>
                  </div>
                ) : (
                  <div className="library-metrics unavailable">Measured outcomes unavailable</div>
                )}
                <small className="guidance-label">
                  {entry?.sourceKind === 'discovered'
                    ? 'Partial guide'
                    : playbook.strategy.coverage.supported === playbook.strategy.coverage.total
                      ? 'Full playbook'
                      : 'Partial guide'}
                </small>
                <span className="badge">
                  {entry?.sourceKind === 'external'
                    ? 'External Reference'
                    : entry?.externalId
                      ? 'Fused'
                      : entry?.sourceKind === 'discovered'
                        ? 'Discovered'
                        : 'Curated'}{' '}
                  ·{' '}
                  {entry?.sourceKind === 'external'
                    ? 'Partial guide'
                    : (entry?.lifecycle ?? playbook.evidence)}
                </span>
              </div>
              <ChevronRight />
            </button>
          );
        })}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <Search />
          <h2>No comps match these filters.</h2>
          <p>Try another champion or clear your filters.</p>
          <button
            className="secondary"
            onClick={() => setQuery({ search: '', evidence: 'all', style: 'all', sort: 'name' })}
          >
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
