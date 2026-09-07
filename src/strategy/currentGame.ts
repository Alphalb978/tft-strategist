import { z } from 'zod';
import type { CurrentGameState } from '../domain/intelligence';
import type {
  Playbook,
  StaticData,
  ScoreComponent,
  RecommendationCandidate,
} from '../domain/models';

export const currentGameSchema = z.object({
  version: z.literal(1),
  set: z.number().int(),
  stage: z.string().regex(/^$|^[1-9]-[1-9]$/),
  levelKnown: z.boolean().optional(),
  level: z.number().int().min(1).max(10),
  health: z.enum(['healthy', 'pressured', 'critical']),
  economy: z.enum(['strong', 'normal', 'weak']),
  copies: z.record(z.string(), z.number().int().min(0).max(9)),
  components: z.array(z.string()).max(30),
  items: z.array(z.string()).max(30),
  augments: z.array(z.string()).max(3),
  augmentCategory: z.string().nullable(),
  board: z.array(z.string()).max(10),
  updatedAt: z.string(),
});
export function emptyCurrentGame(set: number, now: string): CurrentGameState {
  return {
    version: 1,
    set,
    stage: '',
    level: 1,
    levelKnown: false,
    health: 'healthy',
    economy: 'normal',
    copies: {},
    components: [],
    items: [],
    augments: [],
    augmentCategory: null,
    board: [],
    updatedAt: now,
  };
}
export function validateCurrentGame(input: unknown, data: StaticData): CurrentGameState {
  const game = currentGameSchema.parse(input);
  if (
    game.set !== data.version.set ||
    [...Object.keys(game.copies), ...game.board].some(
      (id) => !data.champions.some((c) => c.id === id && c.boardEligible),
    ) ||
    game.components.some(
      (id) => !data.items.some((i) => i.id === id && i.category === 'component'),
    ) ||
    game.items.some((id) => !data.items.some((i) => i.id === id)) ||
    game.augments.some(
      (id) => !data.augments.some((a) => a.id === id && a.liveStatus !== 'disabled'),
    )
  )
    throw new Error('Current-game entities do not belong to the active catalog.');
  return game;
}
export function targetGap(plan: Playbook, game?: CurrentGameState) {
  const owned = new Set([
    ...(game?.board ?? []),
    ...Object.entries(game?.copies ?? {})
      .filter(([, n]) => n > 0)
      .map(([id]) => id),
  ]);
  const target = plan.target.units.map((u) => u.championId);
  return {
    retained: target.filter((id) => owned.has(id)),
    missingCore: plan.family.core.filter((id) => !owned.has(id)),
    availableFlex: target.filter((id) => !plan.family.core.includes(id)),
    levelGap:
      game && (game.levelKnown ?? game.level > 1)
        ? Math.max(0, plan.target.targetLevel - game.level)
        : null,
    transitionBurden: game?.board.length
      ? 1 - game.board.filter((id) => target.includes(id)).length / game.board.length
      : null,
  };
}
export function contextualContributions(
  plan: Playbook,
  game?: CurrentGameState,
  data?: StaticData,
): ScoreComponent[] {
  if (!game || game.set !== plan.set) return [];
  const result: ScoreComponent[] = [];
  const add = (
    key: string,
    label: string,
    value: number,
    status: ScoreComponent['status'] = 'seeded',
  ) => {
    if (value)
      result.push({
        key: `context-${key}`,
        label,
        input: value,
        weight: 1,
        contribution: value,
        status,
      });
  };
  const gap = targetGap(plan, game);
  const copies = plan.family.core.reduce(
    (s, id) => s + Math.min(3, Math.max(0, (game.copies[id] ?? 0) - 1)),
    0,
  );
  const namedCopies = plan.family.core
    .filter((id) => (game.copies[id] ?? 0) > 1)
    .map(
      (id) => `${game.copies[id]} ${data?.champions.find((c) => c.id === id)?.name ?? id} copies`,
    )
    .join(', ');
  add('copies', namedCopies || 'Owned core copies retained', Math.min(4, copies));
  add(
    'board',
    `${gap.retained.length} owned target units retained`,
    Math.min(4, gap.retained.length * 0.65),
  );
  const supportedItems = new Set([
    ...plan.items.flatMap((i) => i.priorities),
    ...(plan.observed?.items.filter((i) => i.estimate.eligible).flatMap((i) => i.ids) ?? []),
  ]);
  const supportedComponents = new Set([
    ...plan.components,
    ...(data?.items.filter((i) => supportedItems.has(i.id)).flatMap((i) => i.components) ?? []),
  ]);
  add(
    'items',
    `Supported item direction: ${[...game.items.filter((id) => supportedItems.has(id)), ...game.components.filter((id) => supportedComponents.has(id))].map((id) => data?.items.find((i) => i.id === id)?.name ?? id).join(', ')}`,
    Math.min(
      4,
      game.items.filter((id) => supportedItems.has(id)).length * 1.5 +
        game.components.filter((id) => supportedComponents.has(id)).length * 0.5,
    ),
  );
  add(
    'augments',
    'Comp-conditioned observed augment association',
    Math.min(
      3,
      (plan.observed?.augments.filter(
        (a) => a.estimate.eligible && (a.association ?? 0) > 1 && game.augments.includes(a.id),
      ).length ?? 0) * 1.5,
    ),
    'measured',
  );
  if (gap.levelGap && (plan.levelPlan.status === 'curated' || plan.observed?.estimate.eligible))
    add(
      'economy',
      `Target is ${gap.levelGap} levels away · ${game.economy} economy`,
      game.economy === 'weak' ? -Math.min(4, gap.levelGap) : game.economy === 'strong' ? 1 : 0,
    );
  if (game.health === 'critical' && gap.transitionBurden !== null)
    add('health', 'Critical health · owned-board transition burden', -4 * gap.transitionBurden);
  return result;
}
export function strategicScenarios(
  plan: Playbook,
  game?: CurrentGameState,
  data?: StaticData,
  contest?: RecommendationCandidate['contest'],
): NonNullable<RecommendationCandidate['scenarios']> {
  const scenarios: NonNullable<RecommendationCandidate['scenarios']> = [];
  const add = (id: string, fit: number, evidence: string) => {
    if (fit > 0) scenarios.push({ id, fit: Math.min(1, fit), evidence });
  };
  const supported = [
    ...plan.items.flatMap((i) => i.priorities),
    ...(plan.observed?.items.filter((i) => i.estimate.eligible).flatMap((i) => i.ids) ?? []),
  ];
  for (const [tag, label] of [
    ['physical', 'AD item route'],
    ['spell', 'AP item route'],
  ])
    add(
      label,
      supported.some((id) => data?.knowledge?.entities[id]?.tags.some((t) => t.tag === tag))
        ? 1
        : 0,
      'Named static effect on a sourced or observed item direction',
    );
  const context = contextualContributions(plan, game, data);
  add(
    'Current item fit',
    context.find((c) => c.key === 'context-items')?.contribution ?? 0,
    'Manual items meet supported item direction',
  );
  add(
    'Reroll copy option',
    /reroll|slow roll/i.test(plan.levelPlan.value ?? '') &&
      context.some((c) => c.key === 'context-copies')
      ? 1
      : 0,
    'Curated roll guidance and owned core copies',
  );
  add(
    'High-cap route',
    game?.economy === 'strong' &&
      plan.target.targetLevel >= 9 &&
      plan.levelPlan.status === 'curated'
      ? 1
      : 0,
    'Sourced high-level target and manual strong economy',
  );
  add(
    'Stabilization option',
    game?.health === 'critical' &&
      game.board.length &&
      (targetGap(plan, game).transitionBurden ?? 1) <= 0.25
      ? 1
      : 0,
    'At least 75% of manual board retained; no exact stabilization timing implied',
  );
  add(
    'Flexible item route',
    (plan.observed?.features.itemFlex.value ??
      (plan.features.provenance.status === 'curated' ? plan.features.values.itemFlex : 0)) / 100,
    'Supported package diversity or curated flexibility',
  );
  add(
    'Low-contest fallback',
    contest?.state === 'Low' ? 1 : 0,
    'Historical opponent unit pressure',
  );
  return scenarios;
}
