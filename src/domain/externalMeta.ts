import { z } from 'zod';
export const externalScopeSchema = z.object({
  set: z.number().int(),
  patch: z.string().nullable(),
  hotfix: z.string().nullable(),
  queue: z.number().int().nullable(),
  rank: z.string().nullable(),
  window: z.string().nullable(),
  region: z.string().nullable(),
});
export const externalStatsSchema = z.object({
  sampleMethod: z.enum(['provider-histogram', 'derived-approximate', 'unknown']).optional(),
  playRateMethod: z.enum(['participant-board-share', 'unknown']).optional(),
  sample: z.number().int().nonnegative().nullable(),
  average: z.number().min(1).max(8).nullable(),
  top4: z.number().min(0).max(1).nullable(),
  win: z.number().min(0).max(1).nullable(),
  playRate: z.number().min(0).max(1).nullable(),
});
export const positionSchema = z.object({
  championId: z.string(),
  row: z.number().int().min(0).max(3),
  column: z.number().int().min(0).max(6),
});
export const compDifficultySchema = z.enum(['easy', 'medium', 'hard', 'unknown']);
export type CompDifficulty = z.infer<typeof compDifficultySchema>;
export type DifficultyPreference = CompDifficulty | 'anything';

const externalFieldProvenanceSchema = z.object({
  source: z.literal('MetaTFT'),
  providerCompId: z.string(),
  set: z.number().int(),
  patch: z.string(),
  hotfix: z.string().nullable(),
  evidence: z.enum(['public-comp-row', 'public-definition']),
});
const entity = z.object({
  id: z.string(),
  name: z.string(),
  stats: externalStatsSchema,
  tier: z.string().nullable(),
  conditions: z.array(z.object({ label: z.string(), stats: externalStatsSchema })).optional(),
});
export const externalSnapshotSchema = z.object({
  manifest: z.object({
    schemaVersion: z.literal(1),
    provider: z.literal('MetaTFT'),
    retrievedAt: z.iso.datetime(),
    sourceUrls: z.array(z.url()).min(1),
    scope: externalScopeSchema,
    providerUpdated: z.string().nullable(),
    collectorVersion: z.string(),
    normalizerVersion: z.string(),
    contentHash: z.string(),
    warnings: z.array(z.string()),
    population: z.number().int().positive().nullable(),
  }),
  comps: z.array(
    entity.extend({
      pickRate: z
        .object({
          value: z.number().finite().nonnegative().max(100),
          unit: z.enum(['percent', 'provider-display']),
          source: z.literal('public-page'),
        })
        .optional(),
      units: z.array(z.string()).min(1).max(28),
      core: z.array(z.string()),
      style: z.string().nullable(),
      providerTier: z.string().nullable().optional(),
      difficulty: compDifficultySchema.optional(),
      levelingStyle: z.string().nullable().optional(),
      metadataProvenance: z
        .object({
          tier: externalFieldProvenanceSchema.optional(),
          difficulty: externalFieldProvenanceSchema.optional(),
          levelingStyle: externalFieldProvenanceSchema.optional(),
        })
        .optional(),
      positions: z.array(positionSchema),
      packages: z.array(
        z.object({
          holder: z.string(),
          items: z.array(z.string()).min(1),
          source: z.string(),
          providerCompId: z.string().optional(),
          set: z.number().int().optional(),
          patch: z.string().optional(),
          hotfix: z.string().nullable().optional(),
          evidence: z.literal('structured-build+public-comp-row').optional(),
        }),
      ),
    }),
  ),
  units: z.array(entity),
  items: z.array(entity),
  traits: z.array(entity),
  augments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tier: z.string().nullable(),
      sourceType: z.literal('external-reference'),
    }),
  ),
});
export type ExternalSnapshot = z.infer<typeof externalSnapshotSchema>;
export type ExternalComp = ExternalSnapshot['comps'][number];
export type ExternalScope = z.infer<typeof externalScopeSchema>;
export type ExternalStats = z.infer<typeof externalStatsSchema>;
export type HexPosition = z.infer<typeof positionSchema>;
