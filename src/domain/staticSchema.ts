import { z } from 'zod';
import type { StaticData } from './models';
const status = z.enum(['verified', 'curated', 'seeded', 'unverified']);
const provenance = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  publishedAt: z.string().optional(),
  patch: z.string().nullable(),
  status,
  note: z.string(),
  hash: z.string().optional(),
});
const ids = z.array(z.string());
const art = z.string().nullable();
export const staticDataSchema = z.object({
  version: z.object({
    set: z.literal(18),
    name: z.string(),
    patch: z.string(),
    sourceVersion: z.string(),
    schemaVersion: z.literal(1),
    patchVerified: z.boolean(),
    provenance,
  }),
  champions: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        cost: z.number().int().nonnegative(),
        traitIds: ids,
        icon: art,
        splash: art,
        set: z.literal(18),
        role: z.string().optional(),
        plannerId: z.string().optional(),
      }),
    )
    .min(1),
  traits: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      icon: art,
      breakpoints: z.array(z.number()),
      counting: z.enum(['unverified', 'unique-unit']),
      provenance,
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      icon: art,
      components: ids,
      category: z.enum(['component', 'combined', 'other']),
      set: z.literal(18),
      availability: status,
    }),
  ),
  augments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      icon: art,
      set: z.literal(18),
      availability: status,
      requiredTraits: ids,
      tier: z.string().optional(),
      category: z.string().optional(),
    }),
  ),
  warnings: z.array(z.string()),
});
export function isStaticData(input: unknown): input is StaticData {
  return staticDataSchema.safeParse(input).success;
}
