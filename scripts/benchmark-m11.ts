import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import raw from '../data/fixtures/cdragon-set18.json';
import { data, playbooks, NOW } from '../src/test/fixtures';
import { compileKnowledge } from '../src/providers/knowledge';
import { deriveIntelligence } from '../src/strategy/observedIntelligence';
import { optimizeBoards } from '../src/strategy/boardOptimizer';
import { buildCompRegistry } from '../src/services/compRegistry';
import { discoveryFor, intelligenceMatches, unknownCore } from '../src/test/m11Fixtures';
import { validateBoard } from '../src/rules/validation';
const startKnowledge = performance.now();
for (let i = 0; i < 10; i++) compileKnowledge(raw, data);
const knowledgeMs = (performance.now() - startKnowledge) / 10;
const matches = intelligenceMatches(2500); // 5,000 boards; no network.
for (let i = 0; i < matches.length; i++) {
  if (i % 5 === 0) continue;
  const family = playbooks[i % playbooks.length];
  matches[i].participants = matches[i].participants.map((p) => ({
    ...p,
    level: family.target.targetLevel,
    units: family.target.units.map((u, index) => ({
      ...p.units[0],
      championId: u.championId,
      stars: u.stars ?? 2,
      items: index === 0 ? p.units[0].items : [],
    })),
  }));
}
const discovery = discoveryFor(matches);
const startObserved = performance.now();
const model = deriveIntelligence(matches, playbooks, discovery, data, NOW);
const observedMs = performance.now() - startObserved;
const entry = buildCompRegistry(playbooks, data, discovery, model).find(
  (e) => e.sourceKind === 'discovered',
)!;
const startSearch = performance.now();
const boards = optimizeBoards({
  data,
  plan: entry.playbook,
  intelligence: model,
  desired: unknownCore.slice(0, 3),
});
const optimizerMs = performance.now() - startSearch;
const summary = {
  knowledgeMs,
  normalizedEntities: Object.keys(data.knowledge!.entities).length,
  observedMs,
  boards: 5000,
  profiles: Object.keys(model.profiles).length,
  championProfiles: Object.keys(model.champions).length,
  graphEdges: model.graph.length,
  modelBytes: JSON.stringify(model).length,
  optimizerMs,
  alternatives: boards.length,
  legal: boards.every((b) => validateBoard(b.board, data).length === 0),
  thresholds: { knowledgeMs: 1000, observedMs: 20000, optimizerMs: 5000 },
};
await mkdir('artifacts/m11', { recursive: true });
await writeFile('artifacts/m11/benchmark.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (
  !summary.legal ||
  !boards.length ||
  knowledgeMs > 1000 ||
  observedMs > 20000 ||
  optimizerMs > 5000
)
  process.exitCode = 1;
