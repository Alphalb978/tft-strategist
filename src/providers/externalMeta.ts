import { externalSnapshotSchema, type ExternalSnapshot } from '../domain/externalMeta';
import type { StaticData } from '../domain/models';
import { stableFingerprint } from '../domain/fingerprint';

export type ExternalValidationCode =
  | 'content-hash'
  | 'set-mismatch'
  | 'patch-mismatch'
  | 'hotfix-mismatch'
  | 'future-timestamp'
  | 'partial-snapshot'
  | 'entity-mapping'
  | 'snapshot-validation';

export class ExternalValidationError extends Error {
  constructor(
    public readonly code: ExternalValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalValidationError';
  }
}

export type ExternalStatusKind =
  | 'unavailable'
  | 'compatible'
  | 'stale'
  | 'set-mismatch'
  | 'patch-mismatch'
  | 'hotfix-mismatch';

export interface ExternalStatusDetail {
  kind: ExternalStatusKind;
  message: string;
  usable: boolean;
}

export function reviewedPatch(data: StaticData) {
  return data.knowledge?.balancePatch ?? data.version.patch;
}

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
export function hotfixParity(
  internal: string | null | undefined,
  external: string | null | undefined,
) {
  return internal == null || external == null
    ? 'unverified'
    : internal === external
      ? 'compatible'
      : 'incompatible';
}
export function externalStatus(
  snapshot: ExternalSnapshot | null | undefined,
  data: StaticData,
  now = new Date().toISOString(),
) {
  return externalStatusDetail(snapshot, data, now).message;
}

export function externalStatusDetail(
  snapshot: ExternalSnapshot | null | undefined,
  data: StaticData,
  now = new Date().toISOString(),
): ExternalStatusDetail {
  if (!snapshot)
    return {
      kind: 'unavailable',
      message: 'MetaTFT evidence unavailable · no compatible snapshot',
      usable: false,
    };
  const expectedPatch = reviewedPatch(data);
  const receivedPatch = snapshot.manifest.scope.patch;
  if (snapshot.manifest.scope.set !== data.version.set)
    return {
      kind: 'set-mismatch',
      message: `MetaTFT data is Set ${snapshot.manifest.scope.set} · Strategist is validated for Set ${data.version.set}`,
      usable: false,
    };
  if (!receivedPatch || receivedPatch !== expectedPatch)
    return {
      kind: 'patch-mismatch',
      message: `MetaTFT data is Patch ${receivedPatch ?? 'unknown'} · Strategist is validated for ${expectedPatch}`,
      usable: false,
    };
  if (
    hotfixParity(data.knowledge?.balanceHotfix, snapshot.manifest.scope.hotfix) ===
    'incompatible'
  )
    return {
      kind: 'hotfix-mismatch',
      message: `MetaTFT hotfix ${snapshot.manifest.scope.hotfix ?? 'unknown'} is incompatible with the reviewed app hotfix`,
      usable: false,
    };
  const stale = Date.parse(now) - Date.parse(snapshot.manifest.retrievedAt) > 7 * 86400000;
  const hotfixUnverified =
    hotfixParity(data.knowledge?.balanceHotfix, snapshot.manifest.scope.hotfix) === 'unverified';
  return {
    kind: stale ? 'stale' : 'compatible',
    message: `MetaTFT · Patch ${receivedPatch}${snapshot.manifest.scope.hotfix ?? ''} · Updated ${snapshot.manifest.retrievedAt}${stale ? ' · stale, reduced confidence' : hotfixUnverified ? ' · hotfix parity unverified' : ''}`,
    usable: true,
  };
}
export function validateExternal(
  input: unknown,
  data: StaticData,
  previous?: ExternalSnapshot | null,
): ExternalSnapshot {
  const s = externalSnapshotSchema.parse(input);
  if (externalHash(s) !== s.manifest.contentHash)
    throw new ExternalValidationError('content-hash', 'Snapshot content hash mismatch');
  const expectedPatch = reviewedPatch(data);
  if (s.manifest.scope.set !== data.version.set)
    throw new ExternalValidationError(
      'set-mismatch',
      `External data set mismatch: app expects Set ${data.version.set}, provider returned Set ${s.manifest.scope.set}. Last good snapshot retained.`,
    );
  if (!s.manifest.scope.patch || s.manifest.scope.patch !== expectedPatch)
    throw new ExternalValidationError(
      'patch-mismatch',
      `External data patch mismatch: app expects ${expectedPatch}, provider returned ${s.manifest.scope.patch ?? 'unknown'}. Last good snapshot retained.`,
    );
  if (
    hotfixParity(data.knowledge?.balanceHotfix, s.manifest.scope.hotfix) === 'incompatible'
  )
    throw new ExternalValidationError(
      'hotfix-mismatch',
      'External data hotfix mismatch. Last good snapshot retained.',
    );
  if (Date.parse(s.manifest.retrievedAt) > Date.now() + 300000)
    throw new ExternalValidationError('future-timestamp', 'Future retrieval timestamp');
  for (const kind of ['comps', 'units', 'items', 'traits', 'augments'] as const) {
    const rows = s[kind];
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new ExternalValidationError('snapshot-validation', `Duplicate ${kind}`);
    if (
      previous &&
      previous.manifest.scope.set === s.manifest.scope.set &&
      rows.length < previous[kind].length * 0.7
    )
      throw new ExternalValidationError(
        'partial-snapshot',
        `Partial scrape: ${kind} count collapsed`,
      );
  }
  if (!s.comps.length)
    throw new ExternalValidationError('partial-snapshot', 'Empty comp scrape');
  for (const c of s.comps) {
    if (
      new Set(c.units).size !== c.units.length ||
      c.units.some((id) => !data.champions.some((e) => e.id === id && e.boardEligible)) ||
      c.core.some((id) => !c.units.includes(id))
    )
      throw new ExternalValidationError(
        'entity-mapping',
        `Unmapped or duplicate champion: ${c.id}`,
      );
    if (
      new Set(c.positions.map((p) => `${p.row}:${p.column}`)).size !== c.positions.length ||
      new Set(c.positions.map((p) => p.championId)).size !== c.positions.length ||
      c.positions.some((p) => !c.units.includes(p.championId))
    )
      throw new ExternalValidationError('snapshot-validation', 'Illegal external positioning');
    if (
      c.packages.some(
        (p) =>
          !c.units.includes(p.holder) || p.items.some((id) => !data.items.some((i) => i.id === id)),
      )
    )
      throw new ExternalValidationError('entity-mapping', 'Unmapped item package');
  }
  for (const kind of ['units', 'items', 'traits', 'augments'] as const) {
    const catalog = kind === 'units' ? data.champions : data[kind];
    if (s[kind].some((row) => !catalog.some((e) => e.id === row.id)))
      throw new ExternalValidationError('entity-mapping', `Unmapped ${kind}`);
  }
  return s;
}
