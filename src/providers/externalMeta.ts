import { externalSnapshotSchema, type ExternalSnapshot } from '../domain/externalMeta';
import type { StaticData } from '../domain/models';
import { stableFingerprint } from '../domain/fingerprint';
export function externalHash(snapshot: ExternalSnapshot) {
  return stableFingerprint({ ...snapshot, manifest: { ...snapshot.manifest, contentHash: '' } });
}
/** Exact IDs and unambiguous normalized display aliases only; no fuzzy strategic joins. */
export function entityMapper(entities: { id: string; name: string }[]) {
  const aliases = new Map<string, Set<string>>();
  const key = (s: string) =>
    s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  for (const e of entities)
    for (const alias of [e.id, e.name]) {
      const k = key(alias),
        ids = aliases.get(k) ?? new Set<string>();
      ids.add(e.id);
      aliases.set(k, ids);
    }
  return (value: string) => {
    const exact = entities.find((e) => e.id === value);
    if (exact) return exact.id;
    const ids = aliases.get(key(value));
    return ids?.size === 1 ? [...ids][0] : null;
  };
}
export function externalStatus(
  snapshot: ExternalSnapshot | null | undefined,
  data: StaticData,
  now = new Date().toISOString(),
) {
  if (!snapshot) return 'External evidence unavailable';
  if (
    snapshot.manifest.scope.set !== data.version.set ||
    !snapshot.manifest.scope.patch ||
    snapshot.manifest.scope.patch !== (data.knowledge?.balancePatch ?? data.version.patch)
  )
    return 'External meta snapshot incompatible with current patch. Refresh required.';
  return Date.parse(now) - Date.parse(snapshot.manifest.retrievedAt) > 7 * 86400000
    ? 'Stale external snapshot · reduced confidence'
    : 'Compatible external snapshot';
}
export function validateExternal(
  input: unknown,
  data: StaticData,
  previous?: ExternalSnapshot | null,
): ExternalSnapshot {
  const s = externalSnapshotSchema.parse(input);
  if (externalHash(s) !== s.manifest.contentHash) throw new Error('Snapshot content hash mismatch');
  if (externalStatus(s, data).includes('incompatible'))
    throw new Error('Wrong set or patch; last good snapshot retained');
  if (Date.parse(s.manifest.retrievedAt) > Date.now() + 300000)
    throw new Error('Future retrieval timestamp');
  for (const kind of ['comps', 'units', 'items', 'traits', 'augments'] as const) {
    const rows = s[kind];
    if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error(`Duplicate ${kind}`);
    if (
      previous &&
      previous.manifest.scope.set === s.manifest.scope.set &&
      rows.length < previous[kind].length * 0.7
    )
      throw new Error(`Partial scrape: ${kind} count collapsed`);
  }
  if (!s.comps.length) throw new Error('Empty comp scrape');
  for (const c of s.comps) {
    if (
      new Set(c.units).size !== c.units.length ||
      c.units.some((id) => !data.champions.some((e) => e.id === id && e.boardEligible)) ||
      c.core.some((id) => !c.units.includes(id))
    )
      throw new Error(`Unmapped or duplicate champion: ${c.id}`);
    if (
      new Set(c.positions.map((p) => `${p.row}:${p.column}`)).size !== c.positions.length ||
      new Set(c.positions.map((p) => p.championId)).size !== c.positions.length ||
      c.positions.some((p) => !c.units.includes(p.championId))
    )
      throw new Error('Illegal external positioning');
    if (
      c.packages.some(
        (p) =>
          !c.units.includes(p.holder) || p.items.some((id) => !data.items.some((i) => i.id === id)),
      )
    )
      throw new Error('Unmapped item package');
  }
  for (const kind of ['units', 'items', 'traits', 'augments'] as const) {
    const catalog = kind === 'units' ? data.champions : data[kind];
    if (s[kind].some((row) => !catalog.some((e) => e.id === row.id)))
      throw new Error(`Unmapped ${kind}`);
  }
  return s;
}
