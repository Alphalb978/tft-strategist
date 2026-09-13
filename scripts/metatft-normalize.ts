import { z } from 'zod';
import type { StaticData } from '../src/domain/models';
import type { CompDifficulty, ExternalSnapshot } from '../src/domain/externalMeta';
import { entityMapper, externalHash, validateExternal } from '../src/providers/externalMeta';
const definitions = z.object({
  results: z.object({
    data: z.object({
      cluster_id: z.number().int(),
      tft_set: z.string(),
      cluster_details: z.record(
        z.string(),
        z.object({
          units_string: z.string(),
          name: z.array(z.object({ name: z.string() })),
          levelling: z.string().optional(),
          builds: z
            .array(
              z.object({
                cluster: z.string(),
                unit: z.string(),
                buildName: z.array(z.string()).min(1),
                count: z.number().int().nonnegative(),
              }),
            )
            .optional(),
        }),
      ),
    }),
  }),
});
const stats = z.object({
  updated: z.number().optional(),
  tft_set: z.string(),
  cluster_id: z.number().int(),
  queue_id: z.number(),
  filter_adjustment: z.object({ override_applied: z.boolean(), rank_filter: z.string() }),
  results: z.array(
    z.object({
      cluster: z.string(),
      places: z.array(z.number().int().nonnegative()),
      count: z.number().int().optional(),
    }),
  ),
});

export interface PublicCompRow {
  providerCompId: string;
  tier: string | null;
  difficulty: string | null;
  levelingStyle: string | null;
  packages: Array<{ holder: string; items: string[] }>;
}

export function normalizeProviderDifficulty(value: unknown): CompDifficulty {
  if (typeof value !== 'string') return 'unknown';
  switch (value.trim().toLowerCase()) {
    case 'easy':
      return 'easy';
    case 'medium':
      return 'medium';
    case 'hard':
      return 'hard';
    default:
      return 'unknown';
  }
}

export function normalizeProviderTier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[SABCDF](?:[+-])?$/.test(normalized) ? normalized : null;
}

/** Explicit visible provider labels only. Numeric provider difficulty is intentionally ignored. */
export function publicCompMetadata(
  text: string,
  providerCompId: string,
  name: string,
  levelingStyle: string | undefined,
): PublicCompRow | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const matches = lines.flatMap((line, index) => (line === name ? [index] : []));
  if (matches.length !== 1) return undefined;
  const index = matches[0];
  const nearby = lines.slice(index + 1, index + 5);
  const difficultyLabels = nearby.filter((entry) => /^(Easy|Medium|Hard)$/i.test(entry));
  const explicitDifficulty = difficultyLabels.length === 1 ? difficultyLabels[0] : null;
  return {
    providerCompId,
    tier: normalizeProviderTier(lines[index - 1]),
    difficulty: explicitDifficulty,
    levelingStyle: levelingStyle && nearby.includes(levelingStyle) ? levelingStyle : null,
    packages: [],
  };
}
/** Only a named, visible public row; never relabel normalized participant-board share. */
export function publicPickRate(text: string, name: string) {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const starts = lines.flatMap((line, index) => (line === name ? [index] : []));
  if (starts.length !== 1) return undefined;
  const row = lines.slice(starts[0] + 1, starts[0] + 100);
  const avg = row.indexOf('Avg Place'),
    pick = row.indexOf('Pick Rate');
  if (avg < 0 || pick !== avg + 2 || !/^\d+(?:\.\d+)?$/.test(row[avg + 1] ?? '')) return undefined;
  const match = /^(\d+(?:\.\d+)?)(%)?$/.exec(row[pick + 1] ?? '');
  if (!match || Number(match[1]) > 100) return undefined;
  return {
    value: Number(match[1]),
    unit: match[2] ? ('percent' as const) : ('provider-display' as const),
    source: 'public-page' as const,
  };
}
export function normalizePublicComps(
  raw: {
    definitions: unknown;
    stats: unknown;
    statsUrl: string;
    patch: unknown;
    pageText: string;
    pageComps?: PublicCompRow[];
    lookup: unknown;
  },
  data: StaticData,
  now = new Date().toISOString(),
): ExternalSnapshot {
  const d = definitions.parse(raw.definitions).results.data,
    parsed = stats.parse(raw.stats),
    s = parsed.results;
  const patch = z
    .object({ patch: z.string(), b_patch_version: z.string().optional() })
    .parse(raw.patch);
  const lookup = z
    .object({
      units: z.array(
        z.object({
          apiName: z.string(),
          name: z.string().nullable(),
          assetNames: z.array(z.string()).optional(),
        }),
      ),
      traits: z.array(z.object({ apiName: z.string(), name: z.string() })),
    })
    .parse(raw.lookup);
  const mapper = entityMapper(data.champions),
    itemMapper = entityMapper(data.items),
    names = new Map<string, string>(),
    itemNames = new Map<string, string>();
  for (const u of lookup.units)
    if (u.name) for (const alias of [u.apiName, ...(u.assetNames ?? [])]) names.set(alias, u.name);
  for (const t of lookup.traits) names.set(t.apiName, t.name);
  const lookupItems = z
    .array(
      z.object({
        apiName: z.string(),
        name: z.string().nullable(),
        assetNames: z.array(z.string()).optional(),
      }),
    )
    .parse((raw.lookup as { items?: unknown }).items);
  for (const item of lookupItems)
    if (item.name)
      for (const alias of [item.apiName, ...(item.assetNames ?? [])])
        itemNames.set(alias, item.name);
  const map = (id: string) => mapper(id) ?? mapper(names.get(id) ?? id);
  const mapItem = (id: string) => itemMapper(id) ?? itemMapper(itemNames.get(id) ?? id);
  const params = new URL(raw.statsUrl).searchParams;
  if (
    parsed.tft_set !== d.tft_set ||
    parsed.cluster_id !== d.cluster_id ||
    parsed.queue_id !== 1100 ||
    parsed.filter_adjustment.override_applied ||
    parsed.filter_adjustment.rank_filter !== params.get('rank')
  )
    throw new Error('Public filters changed; scope cannot be assumed');
  const population = s.find((r) => r.cluster === '')?.places[0] ?? null;
  const warnings = [
    'Definition metadata has independent filters. Item packages are accepted only when the structured cluster build agrees with the same rendered public comp row.',
    'Positioning unavailable in captured public response. Pick rate normalized as participant-board share, not provider per-lobby pick rate.',
    'Augment performance unavailable; no fabricated rows.',
  ];
  let unmapped = 0;
  let packageAttempts = 0;
  let unmappedPackages = 0;
  const rendered = new Map((raw.pageComps ?? []).map((row) => [row.providerCompId, row]));
  const comps = s
    .filter((r) => r.cluster && r.cluster !== '-1')
    .flatMap((row) => {
      const def = d.cluster_details[row.cluster];
      if (!def) throw new Error('Definition/stat cluster join failed');
      const externalIds = def.units_string.split(',').map((s) => s.trim());
      const units = externalIds.map(map);
      if (units.some((id) => !id)) {
        unmapped++;
        warnings.push(
          `Unmapped comp ${row.cluster}: ${externalIds.filter((_, i) => !units[i]).join(', ')}`,
        );
        return [];
      }
      if (
        row.places.length !== 9 ||
        row.places.slice(0, 8).reduce((a, b) => a + b, 0) !== row.places[8] ||
        row.count !== row.places[8]
      )
        throw new Error('Placement histogram schema changed');
      const n = row.count;
      if (!n) return [];
      const pickRate = publicPickRate(
        raw.pageText,
        def.name.map((n) => names.get(n.name) ?? n.name).join(' '),
      );
      const name = def.name.map((n) => names.get(n.name) ?? n.name).join(' ');
      const pageComp =
        rendered.get(row.cluster) ??
        publicCompMetadata(raw.pageText, row.cluster, name, def.levelling);
      const difficulty = normalizeProviderDifficulty(pageComp?.difficulty);
      const providerTier = normalizeProviderTier(pageComp?.tier);
      const levelingStyle = pageComp?.levelingStyle ?? def.levelling ?? null;
      const provenanceBase = {
        source: 'MetaTFT' as const,
        providerCompId: row.cluster,
        set: Number(d.tft_set.replace('TFTSet', '')),
        patch: patch.patch,
        hotfix: patch.b_patch_version ?? null,
      };
      const packages: ExternalSnapshot['comps'][number]['packages'] = [];
      for (const visible of pageComp?.packages ?? []) {
        packageAttempts++;
        const visibleHolder = map(visible.holder);
        const visibleItems = visible.items.map(mapItem);
        const matchingBuild = def.builds?.find((build) => {
          const buildHolder = map(build.unit);
          const buildItems = build.buildName.map(mapItem);
          return (
            build.cluster === row.cluster &&
            buildHolder &&
            buildHolder === visibleHolder &&
            buildItems.every(Boolean) &&
            JSON.stringify(buildItems) === JSON.stringify(visibleItems)
          );
        });
        if (
          !visibleHolder ||
          !units.includes(visibleHolder) ||
          visibleItems.some((id) => !id) ||
          !matchingBuild
        ) {
          unmappedPackages++;
          warnings.push(
            `Skipped unverified item package for comp ${row.cluster}: ${visible.holder} / ${visible.items.join(', ')}`,
          );
          continue;
        }
        packages.push({
          holder: visibleHolder,
          items: visibleItems as string[],
          ...provenanceBase,
          evidence: 'structured-build+public-comp-row' as const,
        });
      }
      return [
        {
          id: row.cluster,
          name,
          units: units as string[],
          core: [],
          ...(pickRate ? { pickRate } : {}),
          style: levelingStyle,
          providerTier,
          difficulty,
          levelingStyle,
          metadataProvenance: {
            ...(providerTier
              ? { tier: { ...provenanceBase, evidence: 'public-comp-row' as const } }
              : {}),
            ...(difficulty !== 'unknown'
              ? { difficulty: { ...provenanceBase, evidence: 'public-comp-row' as const } }
              : {}),
            ...(levelingStyle
              ? {
                  levelingStyle: {
                    ...provenanceBase,
                    evidence: pageComp?.levelingStyle
                      ? ('public-comp-row' as const)
                      : ('public-definition' as const),
                  },
                }
              : {}),
          },
          tier: null,
          stats: {
            sampleMethod: 'provider-histogram' as const,
            playRateMethod: 'participant-board-share' as const,
            sample: n,
            average: row.places.slice(0, 8).reduce((sum, count, i) => sum + count * (i + 1), 0) / n,
            top4: row.places.slice(0, 4).reduce((a, b) => a + b, 0) / n,
            win: row.places[0] / n,
            playRate: population ? n / population : null,
          },
          positions: [],
          packages,
        },
      ];
    });
  if (unmapped / Math.max(1, s.length - 1) > 0.1)
    throw new Error('Unmapped comp ratio exceeds 10%; snapshot quarantined');
  if (packageAttempts && unmappedPackages / packageAttempts > 0.1)
    throw new Error('Unverified item-package ratio exceeds 10%; snapshot quarantined');
  const snapshot: ExternalSnapshot = {
    manifest: {
      schemaVersion: 1,
      provider: 'MetaTFT',
      retrievedAt: now,
      sourceUrls: ['https://www.metatft.com/comps'],
      scope: {
        set: Number(d.tft_set.replace('TFTSet', '')),
        patch: patch.patch,
        hotfix: patch.b_patch_version ?? null,
        queue: Number(params.get('queue')) || null,
        rank: params.get('rank'),
        window: params.get('days') ? `Last ${params.get('days')} days` : null,
        region: null,
      },
      providerUpdated: parsed.updated
        ? new Date(parsed.updated > 1e12 ? parsed.updated : parsed.updated * 1000).toISOString()
        : (raw.pageText.match(/Last Updated:\s*([^\n]+)/)?.[1] ?? null),
      population,
      collectorVersion: 'public-page-v2',
      normalizerVersion: 'comps-v2',
      contentHash: '',
      warnings,
    },
    comps,
    units: [],
    items: [],
    traits: [],
    augments: [],
  };
  snapshot.manifest.contentHash = externalHash(snapshot);
  return validateExternal(snapshot, data);
}

export function addPublicEntities(
  snapshot: ExternalSnapshot,
  kind: 'units' | 'items' | 'traits',
  raw: unknown,
  lookupRaw: unknown,
  data: StaticData,
) {
  const response = z
    .object({
      tft_set: z.string(),
      queue_id: z.number(),
      updated: z.number(),
      filter_adjustment: z.object({ override_applied: z.boolean(), rank_filter: z.string() }),
      games: z.array(
        z.object({ patch: z.string(), b_patch_version: z.string(), count: z.number().positive() }),
      ),
      results: z.array(
        z.object({
          unit: z.string().optional(),
          itemName: z.string().optional(),
          trait: z.string().optional(),
          places: z.array(z.number().int().nonnegative()).length(8),
        }),
      ),
    })
    .parse(raw);
  const scope = snapshot.manifest.scope;
  if (
    response.tft_set !== `TFTSet${scope.set}` ||
    response.queue_id !== scope.queue ||
    response.filter_adjustment.override_applied ||
    response.filter_adjustment.rank_filter !== scope.rank ||
    response.games.some((g) => g.patch !== scope.patch || g.b_patch_version !== scope.hotfix)
  )
    throw new Error(`Incompatible ${kind} scope`);
  const lookup = z.record(z.string(), z.unknown()).parse(lookupRaw);
  const aliases = z
    .array(
      z.object({
        apiName: z.string(),
        name: z.string().nullable(),
        assetNames: z.array(z.string()).optional(),
      }),
    )
    .parse(lookup[kind]);
  const catalog = kind === 'units' ? data.champions : data[kind],
    mapper = entityMapper(catalog),
    names = new Map<string, string>();
  for (const e of aliases)
    if (e.name) for (const id of [e.apiName, ...(e.assetNames ?? [])]) names.set(id, e.name);
  const population = response.games.reduce((s, g) => s + g.count, 0),
    rows = new Map<string, ExternalSnapshot['units'][number]>();
  let unmapped = 0;
  for (const row of response.results) {
    const externalId = row.unit ?? row.itemName ?? row.trait;
    if (!externalId) throw new Error('Missing entity identifier');
    const base = kind === 'traits' ? externalId.replace(/_\d+$/, '') : externalId;
    const id = mapper(base) ?? mapper(names.get(base) ?? base);
    if (!id) {
      unmapped++;
      snapshot.manifest.warnings.push(`Unmapped ${kind}: ${externalId}`);
      continue;
    }
    if (
      externalId !== id &&
      kind !== 'traits' &&
      response.results.some((r) => (r.unit ?? r.itemName) === id)
    ) {
      snapshot.manifest.warnings.push(
        `Excluded alternate alias ${externalId}; canonical ${id} has a separate row. No pooling.`,
      );
      continue;
    }
    const sample = row.places.reduce((a, b) => a + b, 0);
    if (!sample) continue;
    const stats = {
      sample,
      average: row.places.reduce((s, n, i) => s + n * (i + 1), 0) / sample,
      top4: row.places.slice(0, 4).reduce((a, b) => a + b, 0) / sample,
      win: row.places[0] / sample,
      playRate: sample <= population ? sample / population : null,
    };
    if (kind === 'traits') {
      const entity = rows.get(id) ?? {
        id,
        name: catalog.find((e) => e.id === id)!.name,
        tier: null,
        stats: { sample: null, average: null, top4: null, win: null, playRate: null },
        conditions: [],
      };
      entity.conditions!.push({
        label: `Provider trait level ${externalId.match(/_(\d+)$/)?.[1] ?? 'unknown'} (not a verified breakpoint)`,
        stats,
      });
      rows.set(id, entity);
    } else {
      if (rows.has(id)) throw new Error(`Duplicate mapped entity ${kind}: ${id} / ${externalId}`);
      rows.set(id, { id, name: catalog.find((e) => e.id === id)!.name, tier: null, stats });
    }
  }
  if (unmapped / Math.max(1, response.results.length) > 0.1)
    throw new Error(`Unmapped ${kind} ratio exceeds 10%`);
  snapshot[kind] = [...rows.values()];
  snapshot.manifest.sourceUrls.push(`https://www.metatft.com/${kind}`);
  snapshot.manifest.warnings.push(
    `${kind}: ${population} provider population; updated ${new Date(response.updated).toISOString()}. Marginal associations are selection-biased.`,
  );
  snapshot.manifest.contentHash = externalHash(snapshot);
  return validateExternal(snapshot, data);
}
