import { z } from 'zod';
import type { StaticData, ActiveSetVersion, Augment, Provenance } from '../domain/models';
import auditedRules from '../../data/rules/set18.json';

const unit = z.object({
  apiName: z.string(),
  name: z.string(),
  cost: z.number().int().nonnegative(),
  traits: z.array(z.string()),
  squareIcon: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
});
const trait = z.object({
  apiName: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  effects: z.array(z.object({ minUnits: z.number().int().positive().nullable() })),
});
const item = z.object({
  apiName: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  composition: z.array(z.string()),
  isAugment: z.boolean(),
  associatedTraits: z.array(z.string()).optional(),
});
const payload = z.object({ items: z.array(z.unknown()), setData: z.array(z.unknown()) });
const identity = z.object({ number: z.number(), mutator: z.string() });
const recordId = z.object({ apiName: z.string() });
const setSchema = z.object({
  number: z.number(),
  mutator: z.string(),
  name: z.string(),
  champions: z.array(z.unknown()),
  traits: z.array(trait),
  items: z.array(z.string()),
  augments: z.array(z.string()),
});
export const STATIC_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
export const ACTIVE_SET = {
  set: 18,
  name: 'Enchanted Wilds',
  patch: '18.1',
  mutator: 'TFTSet18',
  checkedAt: '2026-09-06',
  source:
    'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-1/',
};

export function assetUrl(path?: string | null): string | null {
  if (!path || !/^assets\/[a-z0-9_./-]+\.(tex|dds|png)$/i.test(path) || path.includes('..'))
    return null;
  return `https://raw.communitydragon.org/latest/game/${path.toLowerCase().replace(/\.(tex|dds)$/, '.png')}`;
}

export function normalizeCommunityDragon(input: unknown, provenance: Provenance): StaticData {
  const raw = payload.parse(input);
  // Never use max(set number) or the last set: payload includes revivals and alternate modes.
  const selected = raw.setData.find((s) => {
    const parsed = identity.safeParse(s);
    return (
      parsed.success &&
      parsed.data.number === ACTIVE_SET.set &&
      parsed.data.mutator === ACTIVE_SET.mutator
    );
  });
  if (!selected)
    throw new Error(
      'Verified active-set roster is absent. A new set requires a reviewed manifest.',
    );
  const set = setSchema.parse(selected);
  // Validate active entities after selection. Null legacy placeholders must not break Set 18 refresh.
  const sourceUnits = set.champions
    .filter((c) => recordId.parse(c).apiName.startsWith('DA_'))
    .map((c) => unit.parse(c));
  const relevantIds = new Set([...set.items, ...set.augments].filter((id) => id.startsWith('DA_')));
  const sourceItems = raw.items
    .filter((i) => relevantIds.has(recordId.parse(i).apiName))
    .map((i) => item.parse(i));
  if (
    !sourceUnits.some((c) => c.apiName === 'DA_18_Xayah') ||
    !sourceUnits.some((c) => c.apiName === 'DA_Fiddlesticks18')
  )
    throw new Error('Set 18 identity probes failed.');
  const traits = set.traits.map((t) => ({
    id: t.apiName,
    name: t.name,
    icon: assetUrl(t.icon),
    breakpoints: [
      ...new Set(t.effects.map((e) => e.minUnits).filter((n): n is number => n !== null)),
    ].sort((a, b) => a - b),
    counting: 'unique-unit' as const,
    availability: t.effects.some((effect) => effect.minUnits !== null)
      ? ('verified' as const)
      : ('unavailable' as const),
    provenance,
  }));
  const traitIds = new Map(traits.map((t) => [t.name, t.id]));
  const champions = sourceUnits.map((c) => ({
    id: c.apiName,
    name: c.name,
    cost: c.cost,
    traitIds: c.traits.map((name) => {
      const id = traitIds.get(name);
      if (!id) throw new Error(`Unresolved trait: ${name}`);
      return id;
    }),
    icon: assetUrl(c.squareIcon),
    splash: assetUrl(c.icon),
    set: set.number,
    shopStatus: auditedRules.board.disallowedUnitApiNames.includes(c.apiName)
      ? ('placeholder' as const)
      : auditedRules.board.exclusiveUnitGroups.some((group) =>
            group.unitApiNames.includes(c.apiName),
          )
        ? ('runtime-variant' as const)
        : ('pool' as const),
    boardEligible: !auditedRules.board.disallowedUnitApiNames.includes(c.apiName),
    provenance,
    ...(c.role ? { role: c.role } : {}),
  }));
  if (new Set(champions.map((c) => c.id)).size !== champions.length)
    throw new Error('Duplicate champion identifiers');
  const items = sourceItems
    .filter((i) => !i.isAugment && set.items.includes(i.apiName))
    .map((i) => ({
      id: i.apiName,
      name: i.name,
      icon: assetUrl(i.icon),
      components: i.composition,
      category: i.apiName.startsWith('DA_Component_')
        ? ('component' as const)
        : i.composition.length
          ? ('combined' as const)
          : ('other' as const),
      set: set.number,
      availability: 'verified' as const,
      provenance,
    }));
  const augments = sourceItems
    .filter((i) => i.isAugment && set.augments.includes(i.apiName))
    .map((i) => {
      const override =
        auditedRules.augmentAvailability.overrides[
          i.apiName as keyof typeof auditedRules.augmentAvailability.overrides
        ];
      return {
        id: i.apiName,
        name: i.name,
        icon: assetUrl(i.icon),
        set: set.number,
        availability: 'unverified' as const,
        presentInExport: true,
        liveStatus: (override?.liveStatus ?? 'unverified') as Augment['liveStatus'],
        requiredTraits: [],
        provenance: override
          ? {
              source: auditedRules.sources.riotPatch181.url,
              fetchedAt: auditedRules.scope.verifiedAt,
              patch: auditedRules.scope.patch,
              status: 'verified' as const,
              note: override.reason,
            }
          : provenance,
      };
    });
  const version: ActiveSetVersion = {
    set: set.number,
    name: ACTIVE_SET.name,
    patch: ACTIVE_SET.patch,
    sourceVersion: provenance.hash ?? provenance.publishedAt ?? provenance.fetchedAt,
    schemaVersion: 2,
    patchVerified: false,
    parityStatus: auditedRules.parity.status as 'known-stale',
    provenance,
  };
  return {
    version,
    champions,
    traits,
    items,
    augments,
    warnings: [
      `Static export date: ${provenance.publishedAt ?? 'unavailable'}; official hotfix evidence runs through ${auditedRules.parity.liveEvidenceThrough}. Combat-value parity is known stale.`,
      'Augment export presence is verified; live availability remains unverified except official overrides.',
      `Provider internal set name is ${set.name}; display name verified from Riot patch notes.`,
      'Board capacity, shop odds, pools, XP, interest, normal trait counting, Lux Avatar and Elder Dragon exceptions are audited in the Set 18 rules fixture.',
    ],
  };
}

export interface StaticProvider {
  fetch(signal?: AbortSignal): Promise<StaticData>;
}
export class CommunityDragonProvider implements StaticProvider {
  async fetch(signal?: AbortSignal): Promise<StaticData> {
    const response = await fetch(STATIC_URL, { signal: signal ?? AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`Static refresh failed (${response.status})`);
    const input: unknown = await response.json();
    return normalizeCommunityDragon(input, {
      source: STATIC_URL,
      fetchedAt: new Date().toISOString(),
      publishedAt: response.headers.get('last-modified') ?? undefined,
      patch: null,
      status: 'verified',
      note: 'Live static export; exact TFT hotfix parity unverified.',
    });
  }
}
