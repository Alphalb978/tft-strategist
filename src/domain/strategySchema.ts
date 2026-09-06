import { z } from 'zod';

const source = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  reviewedAt: z.string().datetime(),
  sourceVersion: z.string().min(1),
  scope: z.string().min(1),
  note: z.string().min(1),
});

const sourcedText = z.object({
  value: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
  note: z.string().min(1),
});

const stage = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  timing: sourcedText.nullable(),
  targetLevel: z.number().int().min(1).max(10).nullable(),
  units: z.array(
    z.object({
      name: z.string().min(1),
      slot: z.enum(['core', 'flex', 'temporary']),
      role: z.enum(['carry', 'tank', 'holder', 'support', 'none']),
    }),
  ),
  instruction: sourcedText.nullable(),
  entryCondition: sourcedText.nullable(),
  exitCondition: sourcedText.nullable(),
  nextStateIds: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)).min(1),
});

const rollMilestone = z.object({
  id: z.string().min(1),
  kind: z.enum(['hold', 'roll', 'slow-roll', 'push-level', 'stabilize', 'cap']),
  label: z.string().min(1),
  timing: z.string().min(1).nullable(),
  targetLevel: z.number().int().min(1).max(10).nullable(),
  stayCondition: z.string().min(1).nullable(),
  leaveCondition: z.string().min(1).nullable(),
  nextObjective: z.boolean(),
});

const itemHolder = z.object({
  holder: z.string().min(1),
  role: z.enum(['carry', 'tank', 'temporary-holder']),
  groups: z.array(
    z.object({
      kind: z.enum(['primary', 'alternative', 'flexible']),
      itemIds: z.array(z.string().min(1)).min(1),
      sourceIds: z.array(z.string().min(1)).min(1),
      note: z.string().min(1),
    }),
  ),
  temporaryHolders: z.array(z.string().min(1)),
  componentIds: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)).min(1),
  note: z.string().min(1),
});

const augmentBranch = z.object({
  id: z.string().min(1),
  category: z.enum([
    'trait/emblem',
    'combat',
    'economy',
    'leveling',
    'item/component',
    'reroll',
    'special/comp-specific',
  ]),
  signal: sourcedText,
  consequence: sourcedText,
});

const decisionNode = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['question', 'action']),
  sourceIds: z.array(z.string().min(1)),
  status: z.enum(['sourced', 'derived']),
  note: z.string().min(1),
});

const decisionEdge = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().min(1),
  conditionKind: z.enum([
    'manual-core-signal',
    'manual-item-direction',
    'manual-augment-category',
    'manual-economy-tempo',
    'lobby-contest',
    'manual-level-roll',
    'manual-missing-unit',
    'navigation',
  ]),
  sourceIds: z.array(z.string().min(1)),
  status: z.enum(['sourced', 'derived']),
  note: z.string().min(1),
});

const entry = z.object({
  familyId: z.string().min(1),
  expectedTarget: z.object({
    unitNames: z.array(z.string().min(1)).min(1),
    capacity: z.number().int().min(1).max(10),
  }),
  expectedCore: z.array(z.string().min(1)).min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
  watchUnits: z.array(z.string().min(1)),
  stages: z.array(stage),
  rollPlan: z
    .object({
      milestones: z.array(rollMilestone).min(1),
      sourceIds: z.array(z.string().min(1)).min(1),
      note: z.string().min(1),
    })
    .nullable(),
  itemHolders: z.array(itemHolder),
  augmentBranches: z.array(augmentBranch),
  warnings: z
    .object({
      values: z.array(z.string().min(1)).min(1),
      sourceIds: z.array(z.string().min(1)).min(1),
      note: z.string().min(1),
    })
    .nullable(),
  decisionMap: z
    .object({
      rootNodeId: z.string().min(1),
      nodes: z.array(decisionNode).min(2),
      edges: z.array(decisionEdge).min(1),
      note: z.string().min(1),
    })
    .nullable(),
  positioning: z
    .object({
      precision: z.enum(['exact', 'coarse']),
      exact: z.array(
        z.object({
          unitName: z.string().min(1),
          row: z.number().int().min(0).max(3),
          column: z.number().int().min(0).max(6),
        }),
      ),
      coarse: z.array(
        z.object({
          unitName: z.string().min(1),
          band: z.enum(['front', 'mid', 'back']),
          side: z.enum(['left', 'center', 'right', 'any']),
        }),
      ),
      sourceIds: z.array(z.string().min(1)).min(1),
      note: z.string().min(1),
    })
    .nullable(),
});

export const strategySeedSchema = z.object({
  schemaVersion: z.literal(1),
  guidanceVersion: z.string().min(1),
  set: z.number().int().positive(),
  staticSourceFingerprint: z.string().min(1),
  reviewedAt: z.string().datetime(),
  sourceReviewVersion: z.string().min(1),
  sources: z.array(source).min(1),
  entries: z.array(entry).min(1),
});

export type StrategySeed = z.infer<typeof strategySeedSchema>;
export type StrategySeedEntry = StrategySeed['entries'][number];
