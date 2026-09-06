import type {
  CompletedMatch,
  DiscoveryDataset,
  Playbook,
  StaticData,
  MatchParticipant,
} from '../domain/models';
import type {
  EvidenceScope,
  IntelligenceModel,
  ObservedEstimate,
  ObservedProfile,
} from '../domain/intelligence';
import { familyDefinitionsFingerprint, stableFingerprint } from '../domain/fingerprint';
import { canonicalizeFinalBoard } from './canonicalBoard';
import { classifyFinalBoard, COMP_CLASSIFIER } from './compClassifier';
import { META_STATISTICS } from './metaStatistics';
import { BOARD_OPTIMIZER } from './boardOptimizer';

export const OBSERVED_MODEL = {
  version: 'observed-v2-ranked-queue-family-join',
  minimumMatches: 20,
  prior: 20,
  halfLifeDays: 14,
  maximumTriples: 24,
} as const;
interface Row {
  id: string;
  matchId: string;
  at: string;
  participant: MatchParticipant;
  fingerprint: string;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const counts = (values: (string | number)[]) => {
  const result: Record<string, number> = {};
  for (const v of values) result[v] = (result[v] ?? 0) + 1;
  return result;
};
function combinations<T>(values: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return values.flatMap((v, i) =>
    combinations(values.slice(i + 1), size - 1).map((rest) => [v, ...rest]),
  );
}
/** Match-clustered effective sample: eight participants in one lobby never become eight independent games. */
export function observedEstimate(rows: Row[], denominator: number, now: string): ObservedEstimate {
  const weights = rows.map((r) =>
    Math.exp((-Math.log(2) * Math.max(0, Date.parse(now) - Date.parse(r.at))) / (14 * 86400000)),
  );
  const total = sum(weights);
  const n = new Set(rows.map((r) => r.matchId)).size;
  const effectiveSample = Math.min(n, total ** 2 / Math.max(1e-9, sum(weights.map((w) => w * w))));
  const avg = total ? sum(rows.map((r, i) => r.participant.placement * weights[i])) / total : 4.5;
  const rate = (predicate: (p: number) => boolean, prior: number) =>
    ((sum(rows.map((r, i) => (predicate(r.participant.placement) ? weights[i] : 0))) /
      Math.max(1e-9, total)) *
      effectiveSample +
      prior * 20) /
    (effectiveSample + 20);
  const p = rate((p) => p <= 4, 0.5),
    z = 1.96,
    d = 1 + (z * z) / Math.max(1, effectiveSample);
  const center = (p + (z * z) / (2 * Math.max(1, effectiveSample))) / d;
  const spread =
    (z *
      Math.sqrt(
        (p * (1 - p)) / Math.max(1, effectiveSample) +
          (z * z) / (4 * Math.max(1, effectiveSample) ** 2),
      )) /
    d;
  const freshness = rows.length
    ? Math.exp(
        -Math.max(0, Date.parse(now) - Math.max(...rows.map((r) => Date.parse(r.at)))) /
          (21 * 86400000),
      )
    : 0;
  const confidence = (effectiveSample / (effectiveSample + 30)) * freshness;
  const eligible = n >= OBSERVED_MODEL.minimumMatches && confidence >= 0.35;
  return {
    sample: rows.length,
    uniqueMatches: n,
    effectiveSample,
    confidence,
    eligible,
    frequency: rows.length / Math.max(1, denominator),
    average: rows.length ? (avg * effectiveSample + 4.5 * 20) / (effectiveSample + 20) : null,
    top4: rows.length ? p : null,
    win: rows.length ? rate((p) => p === 1, 0.125) : null,
    bot4: rows.length ? rate((p) => p >= 5, 0.5) : null,
    top4Interval: rows.length
      ? [Math.max(0, center - spread), Math.min(1, center + spread)]
      : [0, 1],
  };
}
function buckets(rows: Row[], keys: (r: Row) => string[]) {
  const map = new Map<string, Row[]>();
  for (const row of rows)
    for (const key of new Set(keys(row))) {
      const values = map.get(key) ?? [];
      values.push(row);
      map.set(key, values);
    }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}
const unitIds = (r: Row) => [...new Set(r.participant.units.map((u) => u.championId))].sort();

function profile(
  id: string,
  rows: Row[],
  population: Row[],
  scope: EvidenceScope,
  data: StaticData,
  now: string,
  focusChampion?: string,
): ObservedProfile {
  const estimate = observedEstimate(rows, population.length, now);
  const unitRows = buckets(rows, unitIds);
  const units = unitRows.map(([id, subset]) => {
    const e = observedEstimate(subset, rows.length, now);
    return {
      id,
      estimate: e,
      role:
        e.frequency >= 0.8
          ? ('core' as const)
          : e.frequency >= 0.25
            ? ('flex' as const)
            : ('situational' as const),
      stars: counts(
        subset.flatMap((r) =>
          r.participant.units.filter((u) => u.championId === id).map((u) => u.stars),
        ),
      ),
    };
  });
  const structures = (size: number) =>
    buckets(rows, (r) => combinations(unitIds(r).slice(0, 12), size).map((ids) => ids.join('|')))
      .slice(0, size === 3 ? 24 : 80)
      .map(([key, subset]) => ({
        ids: key.split('|'),
        estimate: observedEstimate(subset, rows.length, now),
      }));
  const itemLookup = new Map(data.items.map((i) => [i.id, i]));
  const items = unitRows
    .filter(([holder]) => !focusChampion || holder === focusChampion)
    .flatMap(([holder, holderRows]) =>
      buckets(holderRows, (r) =>
        r.participant.units
          .filter((u) => u.championId === holder)
          .flatMap((u) => {
            const ids = u.items
              .filter((id) => itemLookup.get(id)?.category === 'combined')
              .sort()
              .slice(0, 3);
            return [1, 2, 3].flatMap((size) => combinations(ids, size).map((ids) => ids.join('|')));
          }),
      )
        .slice(0, 24)
        .map(([key, subset]) => {
          const ids = key.split('|');
          const allHolders = rows.filter((r) =>
            r.participant.units.some((u) => ids.every((i) => u.items.includes(i))),
          ).length;
          return {
            holder,
            ids,
            components: ids.flatMap((id) => itemLookup.get(id)?.components ?? []),
            estimate: observedEstimate(subset, holderRows.length, now),
            concentration: subset.length / Math.max(1, allHolders),
          };
        }),
    );
  const augments = buckets(focusChampion ? [] : rows, (r) =>
    r.participant.augmentIds.filter((id) =>
      data.augments.some((a) => a.id === id && a.liveStatus !== 'disabled'),
    ),
  ).map(([id, subset]) => {
    const estimate = observedEstimate(subset, rows.length, now);
    const global = population.filter((r) => r.participant.augmentIds.includes(id));
    return {
      id,
      tier: data.augments.find((a) => a.id === id)?.tier ?? null,
      categories: data.knowledge?.entities[id]?.tags.map((t) => t.tag) ?? [],
      estimate,
      association:
        estimate.eligible && global.length >= 20
          ? estimate.frequency / Math.max(0.001, global.length / Math.max(1, population.length))
          : null,
    };
  });
  const itemDiversity = items.filter((i) => i.ids.length >= 2 && i.estimate.eligible).length;
  const augmentDiversity = augments.filter((a) => a.estimate.eligible).length;
  const feature = (value: number, derivation: string) => ({
    value: estimate.eligible ? Math.min(100, Math.max(0, value)) : null,
    sample: estimate.sample,
    confidence: estimate.confidence,
    fallback: 50,
    derivation: `observed-v1: ${derivation}`,
  });
  const core = units.filter((u) => u.role === 'core');
  const stars =
    core.reduce((s, u) => s + (u.stars['3'] ?? 0) / Math.max(1, u.estimate.sample), 0) /
    Math.max(1, core.length);
  const rarity =
    core.reduce((s, u) => s + (data.champions.find((c) => c.id === u.id)?.cost ?? 0), 0) /
    Math.max(1, core.length);
  return {
    id,
    version: 'observed-v1',
    fingerprint: stableFingerprint({
      id,
      rows: rows.map((r) => r.id).sort(),
      scope,
      knowledge: data.knowledge?.fingerprint,
      version: OBSERVED_MODEL,
    }),
    scope,
    provenance: 'Completed ranked final boards; conditional associations, not causal effects.',
    estimate,
    units,
    levels: counts(rows.map((r) => r.participant.level)),
    capacities: {},
    variants: buckets(focusChampion ? [] : rows, (r) => [unitIds(r).join('|')])
      .slice(0, 8)
      .map(([key, subset]) => ({
        ids: key.split('|'),
        estimate: observedEstimate(subset, rows.length, now),
      })),
    pairs: focusChampion ? [] : structures(2),
    triples: focusChampion ? [] : structures(3),
    items,
    augments,
    itemDiversity,
    augmentDiversity,
    augmentConcentration: Math.max(0, ...augments.map((a) => a.estimate.frequency)),
    features: {
      itemFlex: feature(
        itemDiversity ? (100 * itemDiversity) / (itemDiversity + 4) : 50,
        'supported conditional package diversity',
      ),
      augmentFlex: feature(
        augmentDiversity ? (100 * augmentDiversity) / (augmentDiversity + 6) : 50,
        'supported augment diversity',
      ),
      fragility: feature(
        (40 * core.length) / Math.max(1, units.length) + 35 * stars + (25 * rarity) / 5,
        'core concentration, observed stars and rarity; heuristic burden',
      ),
      availability: feature(
        100 - 55 * stars - (45 * rarity) / 5,
        'observed stars and rarity; no shop or acquisition timing',
      ),
      floor: feature((estimate.top4 ?? 0.5) * 100, 'shrunk observed Top 4'),
      ceiling: feature((estimate.win ?? 0.125) * 100, 'shrunk observed first-place frequency'),
      contestElasticity: {
        value: null,
        sample: estimate.sample,
        confidence: 0,
        fallback: 0.7,
        derivation: 'Unavailable: no conditional saturation/performance evidence',
      },
    },
    unavailable: [
      'Early/stage boards',
      'Roll/acquisition timing',
      'Positioning',
      'Bench/shop/economy history',
      'Causal item or champion power',
      'Capacity bonuses not established by final level',
    ],
  };
}

export function deriveIntelligence(
  matches: CompletedMatch[],
  families: Playbook[],
  discovery: DiscoveryDataset,
  data: StaticData,
  now: string,
  context: {
    region?: string;
    ranks?: string[];
    membership?: string[];
    cohort?: EvidenceScope['cohort'];
    windowDays?: number;
  } = {},
): IntelligenceModel {
  const eligibleMatches = [
    ...new Map(
      matches
        .filter(
          (m) =>
            m.set === data.version.set &&
            Date.parse(m.completedAt) >= Date.parse(now) - (context.windowDays ?? 21) * 86400000 &&
            m.modeSupport !== 'unsupported' &&
            (m.queueId === 1100 || m.source.startsWith('fixture:')) &&
            Date.parse(m.completedAt) <= Date.parse(now),
        )
        .map((m) => [m.id, m]),
    ).values(),
  ].sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id));
  // Unknown content patches are partitioned by exact client version, never invisibly pooled.
  const latest = eligibleMatches[0];
  const patch = data.knowledge?.balancePatch ?? latest?.tftContentPatch ?? null;
  const selected = eligibleMatches.filter((m) =>
    patch
      ? m.tftContentPatch === patch
      : m.tftContentPatch === null && m.riotGameVersion === latest?.riotGameVersion,
  );
  const rows: Row[] = [];
  const membership = new Set(context.membership ?? []);
  for (const m of selected)
    for (const p of m.participants) {
      if (context.cohort === 'verified-rank' && !membership.has(p.puuid)) continue;
      if (p.placement < 1 || p.placement > 8) continue;
      const canonical = canonicalizeFinalBoard(p, m.set, data).board;
      if (canonical)
        rows.push({
          id: `${m.id}:${p.puuid}`,
          matchId: m.id,
          at: m.completedAt,
          participant: p,
          fingerprint: canonical.fingerprint,
        });
    }
  const dedup = [...new Map(rows.map((r) => [r.id, r])).values()];
  const scope: EvidenceScope = {
    set: data.version.set,
    patch,
    clientVersions: [...new Set(selected.map((m) => m.riotGameVersion))].sort(),
    cohort: context.cohort ?? 'discovery-lobby',
    ranks: context.ranks ?? [],
    region: context.region ?? 'fixture/unavailable',
    windowStart: selected.at(-1)?.completedAt ?? null,
    windowEnd: latest?.completedAt ?? null,
    freshness: now,
  };
  const profiles: IntelligenceModel['profiles'] = {};
  const classified = new Map(
    dedup.map((r) => [r.id, classifyFinalBoard(r.participant, families, data)]),
  );
  for (const family of families) {
    // Relation family IDs name playbooks; classifier IDs name the underlying family.
    // Union the actual member rows with classifier evidence, never sum profile counts.
    const relatedMembers = new Set(
      discovery.clusters
        .filter(
          (c) =>
            c.relation.state === 'known-family' &&
            [family.id, family.family.id].includes(c.relation.familyId ?? '') &&
            c.relation.certainty >= 0.72,
        )
        .flatMap((c) => c.memberFingerprints),
    );
    profiles[family.id] = profile(
      family.id,
      dedup.filter(
        (r) =>
          (classified.get(r.id)?.state === 'classified' &&
            classified.get(r.id)?.familyId === family.family.id) ||
          relatedMembers.has(r.fingerprint),
      ),
      dedup,
      scope,
      data,
      now,
    );
  }
  for (const cluster of discovery.clusters) {
    const members = new Set(cluster.memberFingerprints);
    profiles[`discovered-${cluster.id}`] = profile(
      `discovered-${cluster.id}`,
      dedup.filter((r) => members.has(r.fingerprint)),
      dedup,
      scope,
      data,
      now,
    );
  }
  const champions: IntelligenceModel['champions'] = {};
  for (const champion of data.champions) {
    champions[champion.id] = profile(
      champion.id,
      dedup.filter((r) => unitIds(r).includes(champion.id)),
      dedup,
      scope,
      data,
      now,
      champion.id,
    );
    champions[champion.id].familyMembership = Object.values(profiles)
      .map((p) => ({
        id: p.id,
        sample: p.units.find((u) => u.id === champion.id)?.estimate.sample ?? 0,
      }))
      .filter((p) => p.sample > 0);
  }
  const verifiedChampions: IntelligenceModel['verifiedChampions'] = context.membership
    ? {}
    : undefined;
  if (verifiedChampions) {
    const verifiedRows = dedup.filter((r) => membership.has(r.participant.puuid));
    for (const champion of data.champions)
      verifiedChampions[champion.id] = profile(
        champion.id,
        verifiedRows.filter((r) => unitIds(r).includes(champion.id)),
        verifiedRows,
        { ...scope, cohort: 'verified-rank' },
        data,
        now,
        champion.id,
      );
  }
  const graph = buckets(dedup, (r) => combinations(unitIds(r), 2).map((ids) => ids.join('|'))).map(
    ([key, subset]) => {
      const ids = key.split('|');
      const a = data.champions.find((c) => c.id === ids[0])!,
        b = data.champions.find((c) => c.id === ids[1])!;
      const ranges = ids.map((id) => data.knowledge?.entities[id]?.stats.range);
      return {
        ids,
        estimate: observedEstimate(subset, dedup.length, now),
        conditional: ids.map(
          (id) => (subset.length + 1) / ((champions[id]?.estimate.sample ?? 0) + 20),
        ) as [number, number],
        sharedTraits: a.traitIds.filter((t) => b.traitIds.includes(t)),
        roleComplementarity:
          ranges.every((r) => r !== undefined) && ranges[0]! <= 1 !== ranges[1]! <= 1,
      };
    },
  );
  return {
    version: 'intelligence-v1',
    derivationVersion: OBSERVED_MODEL.version,
    entityFingerprints: data.knowledge?.entityFingerprints,
    fingerprint: stableFingerprint({
      scope,
      membership: context.membership ? [...new Set(context.membership)].sort() : null,
      rows: dedup.map((r) => [r.id, r.participant]),
      discovery: discovery.derivationFingerprint,
      knowledge: data.knowledge?.fingerprint,
      staticSource: data.version.sourceVersion,
      semantics: data.knowledge?.semanticVersion,
      families: familyDefinitionsFingerprint(families),
      classifier: COMP_CLASSIFIER,
      statistics: META_STATISTICS,
      optimizer: BOARD_OPTIMIZER,
      model: OBSERVED_MODEL,
    }),
    knowledgeFingerprint: data.knowledge?.fingerprint ?? data.version.sourceVersion,
    generatedAt: now,
    scope,
    profiles,
    champions,
    verifiedChampions,
    graph,
    excludedBoards: matches.reduce((s, m) => s + m.participants.length, 0) - dedup.length,
  };
}

export function friendlyCompName(ids: string[], data: StaticData, observed?: ObservedProfile) {
  const ranked = [...ids].sort((a, b) => {
    const holders = (id: string) =>
      observed?.items
        .filter((i) => i.holder === id && i.ids.length === 1)
        .reduce((s, i) => s + i.estimate.sample, 0) ?? 0;
    return holders(b) - holders(a) || a.localeCompare(b);
  });
  const names = ranked
    .slice(0, 2)
    .map((id) => data.champions.find((c) => c.id === id)?.name)
    .filter(Boolean);
  return {
    name: names.length ? `${names.join(' & ')} Formation` : 'Observed formation',
    version: 'comp-name-v1',
    evidence: ranked
      .slice(0, 2)
      .map((id) => `Observed member ${id}${observed ? '; holder frequency breaks ties' : ''}`),
  };
}
