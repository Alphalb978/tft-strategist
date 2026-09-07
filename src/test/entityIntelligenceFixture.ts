import { data, playbooks, NOW } from './fixtures';
import type { IntelligenceModel, ObservedProfile } from '../domain/intelligence';
const estimate = {
  sample: 50,
  uniqueMatches: 50,
  effectiveSample: 40,
  confidence: 0.7,
  eligible: true,
  frequency: 0.7,
  average: 4,
  top4: 0.6,
  win: 0.15,
  bot4: 0.4,
  top4Interval: [0.4, 0.8] as [number, number],
};
export const id = playbooks[0].hero;
export const itemA = data.items.find((i) => i.category === 'combined')!.id;
export const itemB = data.items.find((i) => i.category === 'combined' && i.id !== itemA)!.id;
export const profile: ObservedProfile = {
  id,
  version: 'observed-v1',
  fingerprint: 'fixture',
  scope: {
    set: 18,
    patch: '18.1',
    clientVersions: [],
    cohort: 'verified-rank',
    ranks: ['MASTER'],
    region: 'EU',
    windowStart: NOW,
    windowEnd: NOW,
    freshness: 'current',
  },
  provenance: 'fixture',
  estimate,
  units: [],
  levels: {},
  capacities: {},
  variants: [],
  pairs: [],
  triples: [],
  items: [{ holder: id, ids: [itemA], components: [], estimate, concentration: 1 }],
  augments: [],
  itemDiversity: 1,
  augmentDiversity: 0,
  augmentConcentration: 0,
  features: {},
  unavailable: [],
};
export const model: IntelligenceModel = {
  version: 'intelligence-v1',
  fingerprint: 'fixture',
  knowledgeFingerprint: data.knowledge!.fingerprint,
  generatedAt: NOW,
  scope: profile.scope,
  profiles: {},
  champions: { [id]: profile },
  graph: [],
  excludedBoards: 0,
};
