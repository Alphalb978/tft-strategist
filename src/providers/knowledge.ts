import { stableFingerprint } from '../domain/fingerprint';
import type { EntityMechanics, TFTKnowledgeSnapshot } from '../domain/intelligence';
import type { StaticData } from '../domain/models';
import identityManifest from '../../data/rules/active-set.json';

const record = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const text = (x: unknown) => (typeof x === 'string' ? x : null);
const numeric = (x: unknown) =>
  Object.fromEntries(
    Object.entries(record(x)).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
export const SET_IDENTITY = identityManifest;

/** A reviewed identity, never ordering or maximum-set heuristics. Balance is a separate input. */
export function resolveActiveSet(sets: unknown[], manifest = SET_IDENTITY) {
  const selected = sets.filter(
    (s) => record(s).number === manifest.set && record(s).mutator === manifest.mutator,
  );
  if (selected.length !== 1)
    throw new Error(
      'Active standard set is absent or ambiguous; a reviewed identity manifest is required.',
    );
  const source = record(selected[0]);
  const units = Array.isArray(source.champions) ? source.champions : [];
  if (!manifest.probes.every((id) => units.some((u) => record(u).apiName === id)))
    throw new Error('Active-set identity probes failed.');
  return selected[0];
}

function mechanics(source: Record<string, unknown>, data: StaticData): EntityMechanics {
  const ability = record(source.ability);
  const rawDescription = text(ability.desc) ?? text(source.desc);
  const effects = record(source.effects);
  const stats = numeric(source.stats);
  const values = { ...numeric(effects), ...stats };
  const description =
    rawDescription
      ?.replace(/@([A-Za-z0-9_]+)(\*100)?@/g, (token, key: string, percent: string) =>
        values[key] === undefined
          ? token
          : String(Math.round(values[key] * (percent ? 100 : 1) * 1000) / 1000),
      )
      .replace(/<[^>]*>/g, ' ')
      .replace(/%i:[^%]+%/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? null;
  const tags: EntityMechanics['tags'] = [];
  const add = (tag: string, evidence: string) => {
    if (!tags.some((t) => t.tag === tag))
      tags.push({ tag, evidence, kind: 'mechanically-derived' });
  };
  const sourceTagMap: Record<string, string> = {
    AttackDamage: 'physical',
    AbilityPower: 'spell',
    AttackSpeed: 'attack-speed',
    Mana: 'mana',
    Heal: 'sustain',
    Health: 'health',
    CritChance: 'crit',
    Consumable: 'consumable',
    component: 'component',
  };
  for (const sourceTag of Array.isArray(source.tags) ? source.tags : [])
    if (typeof sourceTag === 'string' && sourceTagMap[sourceTag])
      add(sourceTagMap[sourceTag], `Structured source tag: ${sourceTag}`);
  // Positive mechanic clauses only; never champion names, model memory, or opaque hashes.
  const d = description ?? '';
  const patterns: [string, RegExp][] = [
    ['physical', /deal[^.]*physical damage/i],
    ['spell', /deal[^.]*magic damage/i],
    ['crowd-control', /\b(stun|knock up|knock back)\b/i],
    ['sustain', /\b(heal|omnivamp|lifesteal)\b/i],
    ['durability', /\b(shield|damage reduction)\b/i],
    ['attack-speed', /gain[^.]*attack speed/i],
    ['mana', /gain[^.]*mana/i],
    ['sunder', /reduce[^.]*armor/i],
    ['shred', /reduce[^.]*magic resist/i],
    ['anti-heal', /\b(wound|wounds)\b/i],
    ['economy', /\b(gain|earn)[^.]*gold/i],
    ['leveling', /\b(gain|earn)[^.]*experience/i],
    ['reroll', /\b(free reroll|free refresh)/i],
    ['item', /gain[^.]*(component|item anvil)/i],
    ['trait', /\bemblem\b/i],
  ];
  for (const [tag, regex] of patterns) {
    const match = d.match(regex);
    if (match) add(tag, `description: ${match[0]}`);
  }
  for (const [key, tag] of Object.entries({
    AD: 'physical',
    AP: 'spell',
    AS: 'attack-speed',
    Armor: 'armor',
    MR: 'magic-resist',
    Health: 'health',
    Mana: 'mana',
    CritChance: 'crit',
  }))
    if ((values[key] ?? 0) > 0) add(tag, `source effect ${key}=${values[key]}`);
  if (stats.range !== undefined)
    add(stats.range <= 1 ? 'melee' : 'ranged', `source range=${stats.range}`);
  return {
    traitAssociations: Array.isArray(source.associatedTraits)
      ? source.associatedTraits.filter((id): id is string => typeof id === 'string')
      : [],
    abilityVariables: Array.isArray(ability.variables) ? ability.variables : [],
    availabilityGaps: [
      ...(!rawDescription ? ['Effect description absent from structured source'] : []),
      ...(description?.includes('@') ? ['Some effect values unresolved in structured source'] : []),
      ...(!Object.keys(stats).length && source.ability ? ['Base stats unavailable'] : []),
    ],
    sourceClass:
      text(source.itemClass) ??
      text(source.category) ??
      (Array.isArray(source.tags) && source.tags.includes('component') ? 'component' : null),
    rawDescription,
    description,
    unresolvedTokens: [...new Set(description?.match(/@[^@]+@/g) ?? [])],
    stats,
    effects,
    abilityName: text(ability.name),
    breakpoints: Array.isArray(source.effects)
      ? source.effects.map((e) => ({
          minimum: typeof record(e).minUnits === 'number' ? (record(e).minUnits as number) : null,
          maximum: typeof record(e).maxUnits === 'number' ? (record(e).maxUnits as number) : null,
          effects: record(record(e).variables),
        }))
      : [],
    restrictions: [
      ...(source.unique === true ? ['Source marks this entity unique'] : []),
      ...(Array.isArray(source.incompatibleTraits)
        ? source.incompatibleTraits
            .filter((x): x is string => typeof x === 'string')
            .map((x) => `Incompatible trait: ${x}`)
        : []),
    ],
    sourceTags: Array.isArray(source.tags)
      ? source.tags.filter((x): x is string => typeof x === 'string')
      : [],
    tags,
    provenance: data.version.provenance,
  };
}

export function compileKnowledge(input: unknown, data: StaticData): TFTKnowledgeSnapshot {
  const raw = record(input);
  const selected = record(resolveActiveSet(Array.isArray(raw.setData) ? raw.setData : []));
  if (selected.number !== data.version.set)
    throw new Error('Knowledge cannot cross set identities.');
  const sources = new Map<string, Record<string, unknown>>();
  for (const x of [
    ...(Array.isArray(raw.items) ? raw.items : []),
    ...(Array.isArray(selected.champions) ? selected.champions : []),
    ...(Array.isArray(selected.traits) ? selected.traits : []),
  ]) {
    const entity = record(x);
    if (typeof entity.apiName === 'string') {
      if (sources.has(entity.apiName))
        throw new Error(`Duplicate knowledge entity ${entity.apiName}`);
      sources.set(entity.apiName, entity);
    }
  }
  const groups = {
    champion: data.champions,
    trait: data.traits,
    item: data.items,
    augment: data.augments,
  };
  const entities: TFTKnowledgeSnapshot['entities'] = {};
  const coverage: TFTKnowledgeSnapshot['coverage'] = [];
  for (const [kind, normalized] of Object.entries(groups)) {
    const expected =
      kind === 'champion'
        ? (selected.champions as unknown[]).map((x) => record(x).apiName)
        : kind === 'trait'
          ? (selected.traits as unknown[]).map((x) => record(x).apiName)
          : (selected[kind === 'item' ? 'items' : 'augments'] as unknown[]);
    for (const id of expected) {
      if (typeof id !== 'string') throw new Error('Active entity is missing an ID.');
      const entity = normalized.find((e) => e.id === id);
      const source = sources.get(id);
      if (entity && source) {
        if (!entity.name.trim()) throw new Error(`Entity ${id} has no display name.`);
        entities[id] = mechanics(source, data);
        coverage.push({
          kind: kind as TFTKnowledgeSnapshot['coverage'][number]['kind'],
          id,
          state: 'normalized',
          reason: 'Selected structured-source entity',
          asset: entity.icon ? 'available' : 'unavailable',
        });
      } else
        coverage.push({
          kind: kind as TFTKnowledgeSnapshot['coverage'][number]['kind'],
          id,
          state: 'excluded',
          reason: !source
            ? 'Referenced entity absent from structured export'
            : 'Outside reviewed provider namespace or entity class',
          asset: 'unavailable',
        });
    }
  }
  const entityFingerprints = Object.fromEntries(
    Object.entries(entities).map(([id, entity]) => {
      const { provenance, ...value } = entity;
      void provenance;
      return [id, stableFingerprint({ source: sources.get(id), ...value })];
    }),
  );
  return {
    version: 'knowledge-v1',
    semanticVersion: 'semantic-v1',
    set: data.version.set,
    identity: SET_IDENTITY.mutator,
    balancePatch: data.version.provenance.patch,
    fingerprint: stableFingerprint({
      set: data.version.set,
      patch: data.version.provenance.patch,
      entityFingerprints,
      version: 'knowledge-v1/semantic-v1',
    }),
    fetchedAt: data.version.provenance.fetchedAt,
    source: data.version.provenance.source,
    parity: data.version.parityStatus,
    officialEvidence: [data.version.provenance.note, 'data/rules/set18.json'],
    entities,
    entityFingerprints,
    coverage,
  };
}

export function knowledgeDelta(previous: TFTKnowledgeSnapshot, next: TFTKnowledgeSnapshot) {
  const changed = [
    ...new Set([
      ...Object.keys(previous.entityFingerprints),
      ...Object.keys(next.entityFingerprints),
    ]),
  ]
    .filter((id) => previous.entityFingerprints[id] !== next.entityFingerprints[id])
    .sort();
  return {
    setChanged: previous.set !== next.set,
    changed,
    compatible: previous.set === next.set && previous.balancePatch === next.balancePatch,
    retainedRawMatches: true,
  };
}
