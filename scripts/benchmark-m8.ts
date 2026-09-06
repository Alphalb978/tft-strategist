import { performance } from 'node:perf_hooks';
import { createRecommendations } from '../src/services/application';
import {
  createPlanSession,
  endSessionRecord,
  updateManualState,
} from '../src/services/planSession';
import { defaultSettings, MemoryRepository } from '../src/storage/repository';
import { data } from '../src/test/fixtures';

const now = '2026-09-06T12:00:00.000Z';
const result = createRecommendations(data, defaultSettings, now);
const state = {
  data,
  ...result,
  source: 'Bundled snapshot' as const,
  settings: defaultSettings,
  activeSession: null,
  notices: result.notices,
  assets: {},
};
const iterations = 40;

const lockStart = performance.now();
for (let index = 0; index < iterations; index++)
  createPlanSession(
    result.portfolio.plans[0].candidate.playbook.id,
    state,
    result.portfolio,
    null,
    now,
    `benchmark-${index}`,
  );
const lockMs = (performance.now() - lockStart) / iterations;

const repository = new MemoryRepository();
const first = createPlanSession(
  result.portfolio.plans[0].candidate.playbook.id,
  state,
  result.portfolio,
  null,
  now,
  'benchmark-active',
);
const persistStart = performance.now();
await repository.createPlanSession(first);
const persistMs = performance.now() - persistStart;

const resumeStart = performance.now();
for (let index = 0; index < 250; index++) await repository.getActivePlanSession();
const resumeMs = (performance.now() - resumeStart) / 250;

const manualStart = performance.now();
for (let index = 0; index < 250; index++)
  updateManualState(first, { stageId: first.snapshot.playbook.strategy.stages[0].id }, now);
const manualMs = (performance.now() - manualStart) / 250;

const destination = createPlanSession(
  result.portfolio.plans[1].candidate.playbook.id,
  state,
  result.portfolio,
  null,
  now,
  'benchmark-destination',
  first.id,
);
const previous = endSessionRecord(first, 'replaced', now, destination.id);
const switchStart = performance.now();
await repository.replacePlanSession(previous, destination);
const switchMs = performance.now() - switchStart;

const snapshotBytes = Buffer.byteLength(JSON.stringify(first.snapshot), 'utf8');
const measurements = { lockMs, persistMs, resumeMs, manualMs, switchMs, snapshotBytes };
console.log(JSON.stringify(measurements, null, 2));
if (lockMs > 50 || persistMs > 50 || resumeMs > 5 || manualMs > 5 || switchMs > 75)
  throw new Error('M8 local-session benchmark exceeded its deterministic fixture budget.');
