import type { Board, Provenance } from './models';

export interface EntityMechanics {
  abilityVariables: unknown[];
  availabilityGaps: string[];
  sourceClass: string | null;
  traitAssociations: string[];
  description: string | null;
  rawDescription: string | null;
  unresolvedTokens: string[];
  stats: Record<string, number>;
  effects: Record<string, unknown>;
  abilityName: string | null;
  breakpoints: {
    minimum: number | null;
    maximum: number | null;
    effects: Record<string, unknown>;
  }[];
  restrictions: string[];
  sourceTags: string[];
  tags: { tag: string; evidence: string; kind: 'mechanically-derived' }[];
  provenance: Provenance;
}
export interface TFTKnowledgeSnapshot {
  version: 'knowledge-v1';
  semanticVersion: 'semantic-v1';
  set: number;
  identity: string;
  balancePatch: string | null;
  fingerprint: string;
  fetchedAt: string;
  source: string;
  parity: 'current' | 'known-stale' | 'unverified';
  officialEvidence: string[];
  entities: Record<string, EntityMechanics>;
  entityFingerprints: Record<string, string>;
  coverage: {
    kind: 'champion' | 'trait' | 'item' | 'augment';
    id: string;
    state: 'normalized' | 'excluded';
    reason: string;
    asset: 'available' | 'unavailable';
  }[];
}
export interface CurrentGameState {
  version: 1;
  set: number;
  stage: string;
  level: number;
  levelKnown?: boolean;
  health: 'healthy' | 'pressured' | 'critical';
  economy: 'strong' | 'normal' | 'weak';
  copies: Record<string, number>;
  components: string[];
  items: string[];
  augments: string[];
  augmentCategory: string | null;
  board: string[];
  updatedAt: string;
}
export interface EvidenceScope {
  set: number;
  patch: string | null;
  clientVersions: string[];
  cohort: 'discovery-lobby' | 'verified-rank';
  ranks: string[];
  region: string;
  windowStart: string | null;
  windowEnd: string | null;
  freshness: string;
}
export interface ObservedEstimate {
  sample: number;
  uniqueMatches: number;
  effectiveSample: number;
  confidence: number;
  eligible: boolean;
  frequency: number;
  average: number | null;
  top4: number | null;
  win: number | null;
  bot4: number | null;
  top4Interval: [number, number];
}
export interface ObservationFeature {
  value: number | null;
  sample: number;
  confidence: number;
  fallback: number;
  derivation: string;
}
export interface ObservedProfile {
  familyMembership?: { id: string; sample: number }[];
  id: string;
  version: 'observed-v1';
  fingerprint: string;
  scope: EvidenceScope;
  provenance: string;
  estimate: ObservedEstimate;
  units: {
    id: string;
    estimate: ObservedEstimate;
    role: 'core' | 'flex' | 'situational';
    stars: Record<string, number>;
  }[];
  levels: Record<string, number>;
  capacities: Record<string, number>;
  variants: { ids: string[]; estimate: ObservedEstimate }[];
  pairs: { ids: string[]; estimate: ObservedEstimate }[];
  triples: { ids: string[]; estimate: ObservedEstimate }[];
  items: {
    holder: string;
    ids: string[];
    components: string[];
    estimate: ObservedEstimate;
    concentration: number;
  }[];
  augments: {
    id: string;
    tier: string | null;
    categories: string[];
    estimate: ObservedEstimate;
    association: number | null;
  }[];
  itemDiversity: number;
  augmentDiversity: number;
  augmentConcentration: number;
  features: Record<string, ObservationFeature>;
  unavailable: string[];
}
export interface IntelligenceModel {
  derivationVersion?: string;
  verifiedChampions?: Record<string, ObservedProfile>;
  entityFingerprints?: Record<string, string>;
  version: 'intelligence-v1';
  fingerprint: string;
  knowledgeFingerprint: string;
  generatedAt: string;
  scope: EvidenceScope;
  profiles: Record<string, ObservedProfile>;
  champions: Record<string, ObservedProfile>;
  graph: {
    ids: string[];
    estimate: ObservedEstimate;
    conditional: [number, number];
    sharedTraits: string[];
    roleComplementarity: boolean;
  }[];
  excludedBoards: number;
}
export interface BoardAlternative {
  label: string;
  board: Board;
  evidence: 'Observed' | 'Experimental';
  score: number;
  components: { label: string; value: number }[];
  version: string;
}
