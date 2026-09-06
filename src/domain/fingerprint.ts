import type { Playbook, StaticData } from './models';

/** Deterministic, non-cryptographic fingerprint for versioned derived data. */
export function stableFingerprint(value: unknown): string {
  const stable = (input: unknown): string => {
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    if (input && typeof input === 'object')
      return `{${Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
        .join(',')}}`;
    return JSON.stringify(input);
  };
  let hash = 2166136261;
  for (const character of stable(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function familyDefinitionsFingerprint(playbooks: Playbook[]) {
  return stableFingerprint(
    playbooks
      .map((playbook) => ({
        id: playbook.family.id,
        core: [...playbook.family.core].sort(),
        board: playbook.target.units.map((unit) => unit.championId).sort(),
        roles: playbook.roles.map((role) => `${role.role}:${role.championId}`).sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/**
 * Identifies the normalized, gameplay-semantic static set consumed by strategy guidance.
 * Transport/cache provenance, display art, warnings, and collection order are intentionally
 * excluded: none of them changes whether a reviewed strategy fact still targets the same set.
 */
export function staticSetCompatibilityFingerprint(data: StaticData) {
  const byId = <T extends { id: string }>(left: T, right: T) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return stableFingerprint({
    version: 'static-set-compatibility-v1',
    set: data.version.set,
    patch: data.version.patch,
    schemaVersion: data.version.schemaVersion,
    champions: data.champions
      .map((champion) => ({
        id: champion.id,
        name: champion.name,
        cost: champion.cost,
        traitIds: [...champion.traitIds].sort(),
        set: champion.set,
        role: champion.role ?? null,
        plannerId: champion.plannerId ?? null,
        shopStatus: champion.shopStatus,
        boardEligible: champion.boardEligible,
      }))
      .sort(byId),
    traits: data.traits
      .map((trait) => ({
        id: trait.id,
        name: trait.name,
        breakpoints: [...trait.breakpoints].sort((left, right) => left - right),
        counting: trait.counting,
        availability: trait.availability,
      }))
      .sort(byId),
    items: data.items
      .map((item) => ({
        id: item.id,
        name: item.name,
        components: [...item.components].sort(),
        category: item.category,
        set: item.set,
        availability: item.availability,
      }))
      .sort(byId),
    augments: data.augments
      .map((augment) => ({
        id: augment.id,
        name: augment.name,
        tier: augment.tier ?? null,
        category: augment.category ?? null,
        set: augment.set,
        availability: augment.availability,
        presentInExport: augment.presentInExport,
        liveStatus: augment.liveStatus,
        requiredTraits: [...augment.requiredTraits].sort(),
      }))
      .sort(byId),
  });
}
