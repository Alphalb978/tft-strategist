import { performance } from 'node:perf_hooks';
import { data, NOW } from '../src/test/fixtures';
import { loadPlaybooks } from '../src/providers/playbooks';
import { strategyTargetFingerprint } from '../src/providers/strategyGuidance';
import { validatePlaybook } from '../src/rules/validation';
import { createRecommendations } from '../src/services/application';
import { defaultSettings } from '../src/storage/repository';
import { buildPivotGraph, traverseDecisionMap } from '../src/strategy/playbookIntelligence';

const timed = (label: string, iterations: number, work: () => void) => {
  const started = performance.now();
  for (let index = 0; index < iterations; index++) work();
  const elapsed = performance.now() - started;
  console.log(
    `${label}: ${elapsed.toFixed(2)} ms total · ${(elapsed / iterations).toFixed(4)} ms/op`,
  );
};

let loaded = loadPlaybooks(data);
timed('M7 load all 13 guidance entries', 100, () => {
  loaded = loadPlaybooks(data);
});
const errors = loaded.flatMap((playbook) =>
  validatePlaybook(playbook, data).filter((issue) => issue.severity === 'error'),
);
if (errors.length) throw new Error(`M7 guidance validation failed: ${errors[0].message}`);
timed('M7 validate all guidance', 100, () => {
  for (const playbook of loaded) validatePlaybook(playbook, data);
});

const decisionMap = loaded.find((playbook) => playbook.id === 'solar-elderwood')!.strategy
  .decisionMap;
timed('M7 Decision Map traversal', 100_000, () => {
  traverseDecisionMap(decisionMap, 'core-signal', 'core-yes');
});

const portfolio = createRecommendations(data, defaultSettings, NOW).portfolio;
timed('M7 three-plan pivot graph', 10_000, () => {
  buildPivotGraph(portfolio);
});

const board = loaded[0].target;
timed('M7 board rendering-data fingerprint', 100_000, () => {
  strategyTargetFingerprint(
    board.set,
    board.capacity,
    board.units.map((unit) => unit.championId),
  );
});
