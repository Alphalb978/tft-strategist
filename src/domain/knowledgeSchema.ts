import { z } from 'zod';
const strings = z.array(z.string());
const mechanics = z.object({
  description: z.string().nullable(),
  rawDescription: z.string().nullable(),
  unresolvedTokens: strings,
  stats: z.record(z.string(), z.number().finite()),
  effects: z.record(z.string(), z.unknown()),
  abilityName: z.string().nullable(),
  abilityVariables: z.array(z.unknown()),
  availabilityGaps: strings,
  sourceClass: z.string().nullable(),
  traitAssociations: strings,
  breakpoints: z.array(
    z.object({
      minimum: z.number().nullable(),
      maximum: z.number().nullable(),
      effects: z.record(z.string(), z.unknown()),
    }),
  ),
  restrictions: strings,
  sourceTags: strings,
  tags: z.array(
    z.object({ tag: z.string(), evidence: z.string(), kind: z.literal('mechanically-derived') }),
  ),
  provenance: z.object({ source: z.string(), fetchedAt: z.string(), note: z.string() }),
});
export const knowledgeSchema = z.object({
  version: z.literal('knowledge-v1'),
  semanticVersion: z.literal('semantic-v1'),
  set: z.number().int(),
  identity: z.string(),
  balancePatch: z.string().nullable(),
  balanceHotfix: z.string().nullable().optional(),
  fingerprint: z.string(),
  fetchedAt: z.string(),
  source: z.string(),
  parity: z.enum(['current', 'known-stale', 'unverified']),
  officialEvidence: strings,
  entities: z.record(z.string(), mechanics),
  entityFingerprints: z.record(z.string(), z.string()),
  coverage: z.array(
    z.object({
      kind: z.enum(['champion', 'trait', 'item', 'augment']),
      id: z.string(),
      state: z.enum(['normalized', 'excluded']),
      reason: z.string(),
      asset: z.enum(['available', 'unavailable']),
    }),
  ),
});
