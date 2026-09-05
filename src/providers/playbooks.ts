import seed from '../../data/playbooks/set18.json';
import type {
  Board,
  FeatureKey,
  Guidance,
  Playbook,
  Provenance,
  StaticData,
} from '../domain/models';
import { teamPlanner } from '../rules/teamPlanner';
import {
  activeBreakpoint,
  baseCapacityForLevel,
  capacityForBoard,
  traitCount,
} from '../rules/ruleSet';
const unavailable = <T>(note: string): Guidance<T> => ({ value: null, status: 'unverified', note });
export function loadPlaybooks(data: StaticData): Playbook[] {
  if (data.version.set !== seed.set) return [];
  return seed.playbooks.map((s) => {
    const id = (name: string) => {
      const matches = data.champions.filter((c) => c.name === name);
      if (matches.length !== 1) throw new Error(`Cannot resolve current unit ${name}`);
      return matches[0].id;
    };
    const provenance: Provenance = {
      source: s.source,
      fetchedAt: seed.reviewedAt,
      patch: seed.patch,
      status: 'curated',
      note: `${s.sourceTitle}. ${s.notes}`,
    };
    const curated = <T>(value: T): Guidance<T> => ({
      value,
      status: 'curated',
      source: s.source,
      note: 'Public guide, re-audited September 6. Outcome evidence not collected.',
    });
    const core = s.core.map(id);
    const board = (names: string[], stage: string): Board => {
      const targetLevel = names.length;
      const value: Board = {
        id: `${s.id}-${stage}`,
        set: seed.set,
        targetLevel,
        capacity: baseCapacityForLevel(targetLevel) ?? targetLevel,
        units: names.map((name) => ({
          championId: id(name),
          items: [],
          slot: core.includes(id(name)) ? 'core' : stage === 'final' ? 'flex' : 'temporary',
        })),
        requiredUnits: stage === 'final' ? core : [],
        augmentIds: [],
        traitClaims: [],
        provenance,
      };
      value.capacity = capacityForBoard(value, data) ?? value.capacity;
      value.traitClaims = data.traits.flatMap((trait) => {
        if (trait.availability !== 'verified') return [];
        const breakpoint = activeBreakpoint(trait.breakpoints, traitCount(value, data, trait.id));
        return breakpoint === null ? [] : [{ traitId: trait.id, breakpoint }];
      });
      return value;
    };
    const target = board(s.board, 'final');
    const keys: FeatureKey[] = [
      'meta',
      'floor',
      'ceiling',
      'itemFlex',
      'augmentFlex',
      'transition',
      'tempo',
      'availability',
      'fragility',
    ];
    return {
      id: s.id,
      set: seed.set,
      patch: seed.patch,
      family: { id: s.id, name: s.title, core },
      title: s.title,
      subtitle: s.subtitle,
      hero: id(s.hero),
      evidence: 'Experimental',
      provenance,
      target,
      stages: [
        {
          stage: 'early',
          label: 'Early · 4 units',
          board: curated(board(s.early, 'early')),
          instruction: unavailable('Exact opener timing not certified.'),
          temporaryHolders: [],
        },
        {
          stage: 'mid',
          label: 'Mid · 6 units',
          board: curated(board(s.mid, 'mid')),
          instruction: unavailable('Adapt to your actual board; no live state is read.'),
          temporaryHolders: [],
        },
        {
          stage: 'stabilization',
          label: 'Stabilize',
          board: unavailable('No independently verified stabilization board.'),
          instruction: curated(s.levelNote),
          temporaryHolders: [],
        },
        {
          stage: 'final',
          label: `Target · ${target.capacity} units`,
          board: curated(target),
          instruction: curated(s.levelNote),
          temporaryHolders: [],
        },
      ],
      roles: [
        { championId: id(s.carry), role: 'carry' },
        { championId: id(s.tank), role: 'tank' },
      ],
      items: [
        {
          holder: id(s.carry),
          priorities: s.items,
          alternatives: unavailable('Item alternatives not verified.'),
          provenance,
        },
        {
          holder: id(s.tank),
          priorities: s.tankItems,
          alternatives: unavailable('Item alternatives not verified.'),
          provenance,
        },
      ],
      components: s.components,
      augments: [
        {
          category: s.augmentCategory,
          augmentIds: [],
          signal: s.signals.at(-1)!,
          change: curated(s.augmentChange),
        },
      ],
      playSignals: curated(s.signals),
      avoidSignals: unavailable(
        'No verified avoid thresholds; do not treat this example as a force recommendation.',
      ),
      levelPlan: curated(s.levelNote),
      decisionMap: {
        nodes: [
          { id: 'signal', label: s.signals[0], kind: 'question', provenance },
          { id: 'route', label: s.style, kind: 'action', provenance },
          {
            id: 'reassess',
            label: 'Reassess your other plans',
            kind: 'action',
            provenance: {
              ...provenance,
              status: 'seeded',
              note: 'Application navigation, not TFT strategy advice.',
            },
          },
        ],
        edges: [
          { from: 'signal', to: 'route', condition: 'Guide signal fits' },
          { from: 'signal', to: 'reassess', condition: 'Signal absent' },
        ],
      },
      replacements: unavailable('Specific substitutes and their trait tradeoffs need evidence.'),
      pivots: [],
      variants: [
        {
          id: `${s.id}-standard`,
          name: 'Source board',
          board: target,
          evidence: 'Experimental',
          provenance,
        },
      ],
      features: {
        values: Object.fromEntries(keys.map((k, i) => [k, s.features[i]])) as Record<
          FeatureKey,
          number
        >,
        provenance: {
          source: 'local:seed18-v1',
          fetchedAt: seed.reviewedAt,
          patch: seed.patch,
          status: 'seeded',
          note: 'Demonstration score inputs, not measured gameplay statistics.',
        },
        itemCoverage: s.coverage,
        openingCoverage: s.opening,
        style: s.style,
        contestElasticity: 0.7,
        unitCriticality: Object.fromEntries(
          target.units.map((u) => [u.championId, core.includes(u.championId) ? 1 : 0.25]),
        ),
      },
      planner: teamPlanner.supportStatus(data.version),
    } satisfies Playbook;
  });
}
