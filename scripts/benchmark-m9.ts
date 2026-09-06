import { performance } from 'node:perf_hooks';
import type { ApplicationState } from '../src/services/application';
import { createRecommendations } from '../src/services/application';
import { createPlanSession } from '../src/services/planSession';
import { loadPostGameHistory } from '../src/services/postGame';
import { MemoryRepository, defaultSettings } from '../src/storage/repository';
import { buildPersonalProfile } from '../src/strategy/personalLearning';
import {
  derivePostGameReview,
  rankReconciliationCandidates,
  reconcileCandidateCheck,
  reconstructSessionChains,
} from '../src/strategy/postGame';
import { scoreCandidate } from '../src/strategy/scoring';
import { data, NOW } from '../src/test/fixtures';

const settings = { ...defaultSettings, riotId: 'Benchmark#M9' };
const state: ApplicationState = {
  data,
  ...createRecommendations(data, settings, NOW),
  settings,
  activeSession: null,
  source: 'Bundled snapshot',
  assets: {},
};
const session = createPlanSession(
  state.portfolio.plans[0].candidate.playbook.id,
  state,
  state.portfolio,
  null,
  '2026-09-05T20:20:00Z',
  'benchmark-chain',
);
const participant = {
  puuid: 'benchmark-puuid',
  placement: 3,
  level: session.snapshot.playbook.target.capacity,
  units: session.snapshot.playbook.target.units.map((unit) => ({
    championId: unit.championId,
    items: [],
    stars: unit.stars ?? 1,
    rarity: null,
    rawName: null,
    unresolvedUnit: false,
    unresolvedItems: [],
  })),
  traits: [],
  augmentIds: [],
  unresolvedAugmentIds: [],
};
const matches = Array.from({ length: 5 }, (_, index) => ({
  id: `EUW1_BENCH_${index}`,
  set: 18,
  setCoreName: 'TFTSet18',
  riotGameVersion: 'fixture',
  tftContentPatch: '18.1',
  tftContentPatchSource: 'fixture' as const,
  dataVersion: 'fixture-v2',
  gameTimestamp: new Date(Date.parse('2026-09-05T21:00:00Z') + index * 120_000).toISOString(),
  gameTimestampSemantics: 'fixture-completed-at' as const,
  gameDurationSeconds: 2100,
  completedAt: '2026-09-05T21:00:00Z',
  queueId: 1100,
  gameType: 'standard',
  mapId: null,
  endOfGameResult: 'complete',
  modeSupport: 'supported' as const,
  participants: [participant],
  source: 'fixture:m9-benchmark',
}));
const chain = reconstructSessionChains([session])[0];

let started = performance.now();
for (let index = 0; index < 2_000; index++)
  rankReconciliationCandidates(chain, matches, 'benchmark-puuid', 'EUW1');
const candidateMs = performance.now() - started;

const reconciliation = {
  ...reconcileCandidateCheck(chain, [matches[0]], 'benchmark-puuid', 'EUW1', NOW),
  state: 'matched' as const,
  matchId: matches[0].id,
  accountPuuid: 'benchmark-puuid',
};
started = performance.now();
let review = derivePostGameReview(chain, reconciliation, matches[0], state.playbooks, NOW);
for (let index = 0; index < 500; index++)
  review = derivePostGameReview(chain, reconciliation, matches[0], state.playbooks, NOW);
const reviewMs = performance.now() - started;

const fixtureReviews = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    ...review,
    id: `${review.id}:${index}`,
    matchId: `personal-${index}`,
    createdAt: new Date(Date.parse(NOW) - index * 3_600_000).toISOString(),
    baseline: {
      ...review.baseline,
      state: 'available' as const,
      confidence: 0.85,
      placementResidual: index % 2 ? 1.2 : -0.3,
    },
    attribution: {
      eligible: true,
      familyId: session.selectedFamilyId,
      confidence: 0.9,
      reasons: [],
    },
  }));
const personal: Record<string, number> = {};
for (const count of [20, 100, 500]) {
  started = performance.now();
  for (let index = 0; index < 100; index++)
    buildPersonalProfile(fixtureReviews(count), 18, '18.1', NOW);
  personal[String(count)] = performance.now() - started;
}
const profile = buildPersonalProfile(fixtureReviews(100), 18, '18.1', NOW);
started = performance.now();
for (let index = 0; index < 5_000; index++)
  scoreCandidate(state.playbooks[index % state.playbooks.length], {
    version: data.version,
    now: NOW,
    personal: profile,
    personalWeight: 0.05,
  });
const scoringMs = performance.now() - started;

const repository = new MemoryRepository();
await repository.createPlanSession(session);
for (const row of fixtureReviews(100)) await repository.putPostGameReview(row);
await repository.putPersonalProfile(profile);
started = performance.now();
for (let index = 0; index < 100; index++) await loadPostGameHistory(repository, 18, '18.1', NOW);
const historyMs = performance.now() - started;

const result = {
  candidateRanking: { operations: 2_000, elapsedMs: Number(candidateMs.toFixed(2)) },
  reviewDerivation: { operations: 500, elapsedMs: Number(reviewMs.toFixed(2)) },
  personalRebuild: Object.fromEntries(
    Object.entries(personal).map(([count, elapsed]) => [
      `${count} games × 100`,
      Number(elapsed.toFixed(2)),
    ]),
  ),
  recommendationScoring: { operations: 5_000, elapsedMs: Number(scoringMs.toFixed(2)) },
  warmHistoryLoad: { operations: 100, elapsedMs: Number(historyMs.toFixed(2)) },
};
console.log(JSON.stringify(result, null, 2));
if (
  candidateMs > 250 ||
  reviewMs > 2_000 ||
  personal['500'] > 500 ||
  scoringMs > 1_500 ||
  historyMs > 500
)
  throw new Error('M9 benchmark exceeded its local deterministic gate.');
