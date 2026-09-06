import type { Playbook } from './models';

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
