export type ID = string;
export type EvidenceLabel = 'Proven' | 'Variant' | 'Emerging' | 'Experimental';
export type Verification = 'verified' | 'curated' | 'seeded' | 'unverified';
export interface Provenance {
  source: string;
  fetchedAt: string;
  publishedAt?: string;
  patch: string | null;
  status: Verification;
  note: string;
  hash?: string;
}
export interface ActiveSetVersion {
  set: number;
  name: string;
  patch: string;
  sourceVersion: string;
  schemaVersion: 2;
  patchVerified: boolean;
  parityStatus: 'current' | 'known-stale' | 'unverified';
  provenance: Provenance;
}
export interface Champion {
  id: ID;
  name: string;
  cost: number;
  traitIds: ID[];
  icon: string | null;
  splash: string | null;
  set: number;
  role?: string;
  plannerId?: string;
  shopStatus: 'pool' | 'runtime-variant' | 'placeholder';
  boardEligible: boolean;
  provenance: Provenance;
}
export interface Trait {
  id: ID;
  name: string;
  icon: string | null;
  breakpoints: number[];
  counting: 'unverified' | 'unique-unit';
  availability: 'verified' | 'unavailable';
  provenance: Provenance;
}
export interface Item {
  id: ID;
  name: string;
  icon: string | null;
  components: ID[];
  category: 'component' | 'combined' | 'other';
  set: number;
  availability: Verification;
  provenance: Provenance;
}
export interface Augment {
  id: ID;
  name: string;
  icon: string | null;
  set: number;
  tier?: string;
  category?: string;
  availability: Verification;
  presentInExport: boolean;
  liveStatus: 'enabled' | 'disabled' | 'unverified';
  requiredTraits: ID[];
  provenance: Provenance;
}
export interface StaticData {
  version: ActiveSetVersion;
  champions: Champion[];
  traits: Trait[];
  items: Item[];
  augments: Augment[];
  warnings: string[];
}
export interface BoardUnit {
  championId: ID;
  items: ID[];
  stars?: number;
  position?: { row: number; column: number };
  slot: 'core' | 'flex' | 'temporary';
}
export interface Board {
  id: ID;
  set: number;
  targetLevel: number;
  capacity: number;
  units: BoardUnit[];
  requiredUnits: ID[];
  augmentIds: ID[];
  traitClaims: { traitId: ID; breakpoint: number }[];
  provenance: Provenance;
}
export interface Guidance<T> {
  value: T | null;
  status: Verification;
  note: string;
  source?: string;
}
export interface StageBoard {
  stage: 'early' | 'mid' | 'stabilization' | 'final';
  label: string;
  board: Guidance<Board>;
  instruction: Guidance<string>;
  temporaryHolders: ID[];
}
export interface ItemPlan {
  holder: ID;
  priorities: ID[];
  alternatives: Guidance<ID[]>;
  temporaryHolder?: ID;
  provenance: Provenance;
}
export interface AugmentBranch {
  category: string;
  augmentIds: ID[];
  signal: string;
  change: Guidance<string>;
}
export interface DecisionNode {
  id: ID;
  label: string;
  kind: 'question' | 'action';
  provenance: Provenance;
}
export interface DecisionEdge {
  from: ID;
  to: ID;
  condition: string;
}
export interface Pivot {
  destination: ID;
  trigger: Guidance<string>;
  sharedItems: ID[];
  sharedEarlyUnits: ID[];
  transitionCost: Guidance<number>;
  abandonedUnits: ID[];
  destinationStage: string;
}
export interface CompFamily {
  id: ID;
  name: string;
  core: ID[];
}
export interface CompVariant {
  id: ID;
  name: string;
  board: Board;
  evidence: EvidenceLabel;
  provenance: Provenance;
}
export type FeatureKey =
  | 'meta'
  | 'floor'
  | 'ceiling'
  | 'itemFlex'
  | 'augmentFlex'
  | 'transition'
  | 'tempo'
  | 'availability'
  | 'fragility';
export interface StrategyFeatures {
  values: Record<FeatureKey, number>;
  provenance: Provenance;
  itemCoverage: string[];
  openingCoverage: string[];
  style: string;
  contestElasticity: number;
  unitCriticality: Record<ID, number>;
}
export interface Playbook {
  id: ID;
  family: CompFamily;
  set: number;
  patch: string;
  title: string;
  subtitle: string;
  hero: ID;
  evidence: EvidenceLabel;
  provenance: Provenance;
  sampleSize?: number;
  target: Board;
  stages: StageBoard[];
  roles: { championId: ID; role: 'carry' | 'tank' | 'support' }[];
  items: ItemPlan[];
  components: ID[];
  augments: AugmentBranch[];
  playSignals: Guidance<string[]>;
  avoidSignals: Guidance<string[]>;
  levelPlan: Guidance<string>;
  decisionMap: { nodes: DecisionNode[]; edges: DecisionEdge[] };
  replacements: Guidance<{ from: ID; to: ID; tradeoff: string }[]>;
  pivots: Pivot[];
  variants: CompVariant[];
  features: StrategyFeatures;
  planner: TeamPlannerSupport;
}
export interface Confidence {
  level: 'Low' | 'Medium' | 'High';
  value: number;
  drivers: { label: string; factor: number }[];
}
export interface ScoreComponent {
  key: string;
  label: string;
  input: number | null;
  weight: number;
  contribution: number;
  status: Verification | 'unavailable';
}
export interface RecommendationCandidate {
  playbook: Playbook;
  score: number;
  components: ScoreComponent[];
  confidence: Confidence;
  reasons: string[];
  contest: { state: 'Unavailable' | 'Low' | 'Medium' | 'High'; value: number | null };
}
export interface RecommendationPortfolio {
  plans: { candidate: RecommendationCandidate; role: string }[];
  objective: number;
  interactions: { label: string; value: number }[];
  generatedAt: string;
  version: string;
}
export interface OpponentProfile {
  puuid: string;
  generatedAt: string;
  sourceMatchIds: ID[];
  set: number;
  patch: string;
  derivationVersion: string;
  relevantGames: number;
  effectiveSample: number;
  familyFrequency: Record<ID, number>;
  unitFrequency: Record<ID, number>;
  forceIndex: number;
  flexIndex: number;
  styleFrequency: Record<string, number>;
  placementByFamily: Record<ID, number>;
  confidence: number;
}
export interface LobbyPressure {
  state: 'complete' | 'partial' | 'unavailable';
  expectedOpponents: number;
  profiles: OpponentProfile[];
  coverage: number;
  fetchedAt: string;
  errors: string[];
}
export interface PersonalProfile {
  set: number;
  patch: string;
  effectiveGames: number;
  familyAffinity: Record<ID, number>;
  generatedAt: string;
  insights: {
    kind: 'strength' | 'weakness';
    text: string;
    confidence: Confidence;
    matchIds: ID[];
  }[];
}
export interface RiotIdentity {
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: string;
  routing: string;
}
export interface MatchParticipant {
  puuid: string;
  placement: number;
  level: number;
  units: BoardUnit[];
  augmentIds: ID[];
  familyId?: ID;
  style?: string;
}
export interface CompletedMatch {
  id: ID;
  set: number;
  patch: string;
  completedAt: string;
  participants: MatchParticipant[];
  source: string;
}
export interface SelectedPlan {
  id: ID;
  playbookId: ID;
  set: number;
  patch: string;
  sourceVersion: string;
  selectedAt: string;
  matchId?: ID;
  snapshot: RecommendationPortfolio;
}
export interface PostGameSummary {
  matchId: ID;
  selectedPlanId?: ID;
  placement: number;
  observations: string[];
  possibleMismatches: string[];
  nextAdjustment: string;
  provenance: Provenance;
}
export interface TeamPlannerSupport {
  state: 'unverified' | 'unsupported' | 'supported';
  reason: string;
  mappingVerified: boolean;
  fixtureVerified: boolean;
  manualPasteVerified: boolean;
}
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
