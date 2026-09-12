import type {
  TFTKnowledgeSnapshot,
  CurrentGameState,
  IntelligenceModel,
  ObservedProfile,
} from './intelligence';
export type ID = string;
export type EvidenceLabel = 'Proven' | 'Variant' | 'Emerging' | 'Experimental';
export type Verification =
  | 'verified'
  | 'measured'
  | 'fixture'
  | 'curated'
  | 'seeded'
  | 'unverified';
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
  knowledge?: TFTKnowledgeSnapshot;
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
export type StrategyFactStatus = 'sourced' | 'derived' | 'inherited' | 'unavailable' | 'stale';
export interface StrategySource {
  id: ID;
  url: string;
  title: string;
  reviewedAt: string;
  sourceVersion: string;
  scope: string;
  note: string;
}
export interface StrategyFact<T> {
  value: T | null;
  status: StrategyFactStatus;
  sourceIds: ID[];
  note: string;
  inheritedFrom?: ID;
}
export type StrategyCoverageKey =
  | 'stageBoards'
  | 'rollLevel'
  | 'items'
  | 'augments'
  | 'replacements'
  | 'positioning'
  | 'warningsPivots';
export interface StrategyCoverage {
  fields: Record<StrategyCoverageKey, StrategyFactStatus>;
  supported: number;
  total: number;
}
export interface StrategyStageUnit {
  championId: ID;
  slot: 'core' | 'flex' | 'temporary';
  role: 'carry' | 'tank' | 'holder' | 'support' | 'none';
}
export interface StrategyStageState {
  id: ID;
  label: string;
  timing: StrategyFact<string>;
  targetLevel: StrategyFact<number>;
  roster: StrategyFact<StrategyStageUnit[]>;
  instruction: StrategyFact<string>;
  entryCondition: StrategyFact<string>;
  exitCondition: StrategyFact<string>;
  nextStateIds: ID[];
}
export type RollMilestoneKind = 'hold' | 'roll' | 'slow-roll' | 'push-level' | 'stabilize' | 'cap';
export interface RollMilestone {
  id: ID;
  kind: RollMilestoneKind;
  label: string;
  timing: string | null;
  targetLevel: number | null;
  stayCondition: string | null;
  leaveCondition: string | null;
  nextObjective: boolean;
}
export type StrategyItemKind = 'primary' | 'alternative' | 'flexible';
export interface StrategyItemGroup {
  kind: StrategyItemKind;
  itemIds: ID[];
  fact: StrategyFact<string>;
}
export interface StrategyItemHolder {
  holderId: ID;
  role: 'carry' | 'tank' | 'temporary-holder';
  groups: StrategyItemGroup[];
  temporaryHolderIds: ID[];
  componentIds: ID[];
  fact: StrategyFact<string>;
}
export type AugmentBranchCategory =
  | 'trait/emblem'
  | 'combat'
  | 'economy'
  | 'leveling'
  | 'item/component'
  | 'reroll'
  | 'special/comp-specific';
export interface StrategyAugmentBranch {
  id: ID;
  category: AugmentBranchCategory;
  augmentIds: ID[];
  signal: StrategyFact<string>;
  consequence: StrategyFact<string>;
}
export interface TraitDelta {
  traitId: ID;
  before: number;
  after: number;
  delta: number;
}
export interface StrategyReplacement {
  id: ID;
  targetUnitId: ID;
  substituteUnitId: ID;
  role: StrategyFact<string>;
  traitDelta: TraitDelta[];
  capacityDelta: number;
  boardLegal: boolean;
  strength: StrategyFact<string>;
}
export type DecisionConditionKind =
  | 'manual-core-signal'
  | 'manual-item-direction'
  | 'manual-augment-category'
  | 'manual-economy-tempo'
  | 'lobby-contest'
  | 'manual-level-roll'
  | 'manual-missing-unit'
  | 'navigation';
export interface StrategyDecisionNode {
  id: ID;
  label: string;
  kind: 'question' | 'action';
  fact: StrategyFact<string>;
}
export interface StrategyDecisionEdge {
  id: ID;
  from: ID;
  to: ID;
  label: string;
  conditionKind: DecisionConditionKind;
  fact: StrategyFact<string>;
}
export interface StrategyDecisionMap {
  rootNodeId: ID | null;
  nodes: StrategyDecisionNode[];
  edges: StrategyDecisionEdge[];
  status: StrategyFactStatus;
  note: string;
}
export type FormationBand = 'front' | 'mid' | 'back';
export interface ExactHexPosition {
  championId: ID;
  row: number;
  column: number;
}
export interface CoarseFormationPosition {
  championId: ID;
  band: FormationBand;
  side: 'left' | 'center' | 'right' | 'any';
}
export interface StrategyPositioning {
  precision: 'exact' | 'coarse' | 'unverified';
  exact: StrategyFact<ExactHexPosition[]>;
  coarse: StrategyFact<CoarseFormationPosition[]>;
  note: string;
}
export interface StrategyGuidance {
  schemaVersion: 1;
  guidanceVersion: string;
  reviewedAt: string;
  set: number;
  staticSourceFingerprint: string;
  targetBoardFingerprint: string;
  registryFingerprint: string;
  freshness: {
    state: 'current' | 'stale';
    reasons: string[];
  };
  sources: StrategySource[];
  coverage: StrategyCoverage;
  watchUnits: StrategyFact<ID[]>;
  stages: StrategyStageState[];
  rollPlan: StrategyFact<RollMilestone[]>;
  itemHolders: StrategyItemHolder[];
  augmentBranches: StrategyAugmentBranch[];
  replacements: StrategyReplacement[];
  warnings: StrategyFact<string[]>;
  decisionMap: StrategyDecisionMap;
  positioning: StrategyPositioning;
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
  observed?: ObservedProfile;
  naming?: { version: string; evidence: string[] };
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
  strategy: StrategyGuidance;
  discovery?: { clusterId: ID; parentFamilyId: ID | null };
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

export type ClassificationState = 'classified' | 'ambiguous' | 'unclassified';
export interface CompClassification {
  state: ClassificationState;
  familyId: ID | null;
  score: number;
  runnerUpFamilyId: ID | null;
  runnerUpScore: number;
  margin: number;
  coreRecall: number;
  boardSimilarity: number;
  rolePresence: number;
  sizeFit: number;
  classifierVersion: string;
}
export interface MetaObservation {
  matchId: ID;
  puuid: string;
  completedAt: string;
  placement: number;
  classification: CompClassification;
}

export type DiscoveryLifecycleState =
  | 'Experimental'
  | 'Emerging'
  | 'Variant'
  | 'Proven'
  | 'Stale'
  | 'Retired';

export interface CanonicalBoardUnit {
  championId: ID;
  cost: number;
  traitIds: ID[];
  stars: number | null;
  ordinaryCopies: number | null;
}

export interface CanonicalBoard {
  schemaVersion: 1;
  modelVersion: string;
  set: number;
  capacity: number;
  boardSize: number;
  units: CanonicalBoardUnit[];
  traitIds: ID[];
  fingerprint: string;
}

export interface CanonicalizationResult {
  state: 'canonical' | 'invalid';
  board: CanonicalBoard | null;
  unresolvedUnitIds: ID[];
  reasons: string[];
}

export interface BoardSimilarity {
  value: number;
  unitStructure: number;
  boardSize: number;
  traits: number;
  starPattern: number;
  modelVersion: string;
}

export interface DiscoveryObservation {
  observationId: ID;
  matchId: ID;
  completedAt: string;
  placement: number;
  board: CanonicalBoard;
}

export interface ClusterUnitPrevalence {
  championId: ID;
  observations: number;
  prevalence: number;
}

export interface AdoptionAcceleration {
  recentFrequency: number;
  priorFrequency: number;
  delta: number;
  recentBoards: number;
  priorBoards: number;
  recentClusterBoards: number;
  priorClusterBoards: number;
  mature: boolean;
}

export type ClusterRelationState =
  | 'known-family'
  | 'variant-candidate'
  | 'emerging-candidate'
  | 'noise/insufficient';

export interface VariantDiff {
  sharedCore: ID[];
  consistentlyAdded: ID[];
  consistentlyOmitted: ID[];
  structuralDistance: number;
  capacityDelta: number;
}

export interface ClusterRelation {
  state: ClusterRelationState;
  familyId: ID | null;
  similarity: number;
  runnerUpFamilyId: ID | null;
  runnerUpSimilarity: number;
  margin: number;
  certainty: number;
  diff: VariantDiff | null;
  modelVersion: string;
}

export interface LifecycleTransition {
  previousState: DiscoveryLifecycleState | null;
  newState: DiscoveryLifecycleState;
  at: string;
  evidenceModelVersion: string;
  drivers: string[];
}

export interface DiscoveryClusterStats {
  games: number;
  uniqueMatches: number;
  effectiveSample: number;
  averagePlacement: number;
  topFour: BinomialEstimate;
  wins: BinomialEstimate;
  freshestGameAt: string;
  ageDays: number;
  cohesion: number;
  separation: number;
  confidence: number;
  adoption: AdoptionAcceleration;
}

export interface DiscoveryCluster {
  id: ID;
  memberFingerprints: string[];
  representative: CanonicalBoard;
  unitPrevalence: ClusterUnitPrevalence[];
  stats: DiscoveryClusterStats;
  relation: ClusterRelation;
  lifecycle: DiscoveryLifecycleState;
  transitions: LifecycleTransition[];
  recommendationEligible: boolean;
  recommendationGateReasons: string[];
}

export interface DiscoveryConfigSnapshot {
  minimumClusterSupport: number;
  neighborhoodSimilarity: number;
  blockingUnitCount: number;
  maximumBlockSize: number;
  maximumCandidatePairs: number;
  relationKnownThreshold: number;
  relationVariantThreshold: number;
  relationMinimumMargin: number;
  emergingMinimumGames: number;
  variantMinimumGames: number;
  minimumConfidence: number;
  maximumAgeDays: number;
  minimumCohesion: number;
  accelerationRecentDays: number;
  accelerationPriorDays: number;
}

export interface DiscoveryDataset {
  id: ID;
  schemaVersion: 1;
  set: number;
  state: 'complete' | 'partial' | 'unavailable' | 'incompatible';
  sourceType: 'riot-api' | 'fixture';
  source: string;
  generatedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  boardsAnalyzed: number;
  invalidBoards: number;
  clusterCount: number;
  knownFamilyClusters: number;
  variantClusters: number;
  emergingClusters: number;
  experimentalClusters: number;
  noiseBoards: number;
  candidatePairsCompared: number;
  candidatePairBudgetReached: boolean;
  oversizedBlocksSkipped: number;
  clusters: DiscoveryCluster[];
  noiseObservationIds: ID[];
  canonicalModelVersion: string;
  similarityModelVersion: string;
  clusteringModelVersion: string;
  relationModelVersion: string;
  lifecycleModelVersion: string;
  statisticsVersion: string;
  staticSourceVersion: string;
  familyDefinitionsFingerprint: string;
  sampleDefinitionFingerprint: string;
  configurationFingerprint: string;
  derivationFingerprint: string;
  config: DiscoveryConfigSnapshot;
  patchRelevance: 'unavailable';
  errors: string[];
}

export interface CompRegistryEntry {
  id: ID;
  sourceKind: 'curated' | 'discovered' | 'external';
  externalId?: string;
  externalRelation?: 'strong' | 'variant';
  lifecycle: DiscoveryLifecycleState;
  playbook: Playbook;
  structuralFingerprint: string;
  clusterId: ID | null;
  parentFamilyId: ID | null;
  recommendationEligible: boolean;
  support: number | null;
  effectiveSample: number | null;
  trendDelta: number | null;
  provenance: Provenance;
}

export interface DiscoveryRefreshStatus {
  state: 'idle' | 'refreshing' | 'complete' | 'partial' | 'unavailable' | 'incompatible';
  lastRefreshAt: string | null;
  activeDatasetId: ID | null;
  message: string;
}
export interface BinomialEstimate {
  raw: number;
  shrunk: number;
  lower: number;
  upper: number;
}
export interface FamilyMetaStats {
  familyId: ID;
  games: number;
  uniqueMatches: number;
  rawFrequency: number;
  weightedFrequency: number;
  averagePlacement: number;
  weightedAveragePlacement: number;
  shrunkAveragePlacement: number;
  averagePlacementStandardError: number;
  topFour: BinomialEstimate;
  wins: BinomialEstimate;
  botFour: BinomialEstimate;
  placementCounts: Record<string, number>;
  effectiveSample: number;
  averageClassifierScore: number;
  averageClassifierMargin: number;
  freshestGameAt: string;
  ageDays: number;
  confidence: number;
  measuredStrength: number;
  measuredFloor: number;
  measuredCeiling: number;
  quality: 'eligible' | 'insufficient';
}
export interface AggregateMetaDataset {
  statisticsPopulation?: 'verified-rank' | 'discovery-lobby';
  discoveryFamilyStats?: FamilyMetaStats[];
  intelligence?: IntelligenceModel;
  verifiedRank?: {
    version: 1;
    membership: string[];
    fetchedAt: string;
    tiers: string[];
    complete: boolean;
    observations: MetaObservation[];
    familyStats: FamilyMetaStats[];
  };
  scope?: {
    version: 1;
    key: string;
    windowDays: number;
    collectionStartedAt: string;
    collectionEndedAt: string;
    population: string;
    mode: string;
    pendingMatches: number;
  };
  id: ID;
  schemaVersion: 1;
  set: number;
  state: 'complete' | 'partial' | 'unavailable';
  sourceType: 'riot-api' | 'fixture';
  source: string;
  platform: string;
  regionalRoute: string;
  rankCohort: string[];
  collectedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  cohortPlayersConsidered: number;
  uniqueCohortPlayers: number;
  uniqueParticipants: number;
  discoveredMatchIds: number;
  fetchedMatchPayloads: number;
  currentSetMatches: number;
  uniqueMatches: number;
  currentSetBoards: number;
  classifiedBoards: number;
  ambiguousBoards: number;
  unclassifiedBoards: number;
  coverage: number;
  observations: MetaObservation[];
  familyStats: FamilyMetaStats[];
  classifierVersion: string;
  statisticsVersion: string;
  familyDefinitionsFingerprint: string;
  staticSourceVersion: string;
  sampleDefinitionFingerprint: string;
  derivationFingerprint: string;
  patchRelevance: 'unavailable';
  telemetry: RiotTelemetry;
  errors: string[];
}
export interface LadderPlayer {
  puuid: string;
  summonerId?: string;
  tier: 'CHALLENGER' | 'GRANDMASTER' | 'MASTER';
  leaguePoints: number;
}
export interface RecommendationCandidate {
  fusion?: import('../strategy/evidenceFusion').FusedEstimate;
  scenarios?: { id: string; fit: number; evidence: string }[];
  playbook: Playbook;
  score: number;
  components: ScoreComponent[];
  confidence: Confidence;
  reasons: string[];
  contest: CandidateContest;
  /** Present only when the candidate was ranked by the normal Home model. */
  home?: HomeScoreBreakdown;
}

export interface HomeRecommendationModelConfig {
  top4Weight: number;
  averagePlacementWeight: number;
  winRateWeight: number;
  lowPickQualityGate: number;
  lowPickQualityRamp: number;
  lowPickMinimumReliability: number;
  lowPickCurve: number;
  maxLowPickBonus: number;
  maxPopularityPenalty: number;
  maxCleanLobbyBonus: number;
  maxMediumContestPenalty: number;
  maxHighContestPenalty: number;
  lobbyCoverageExponent: number;
}

export interface HomeScoreMetric {
  raw: number | null;
  normalized: number;
  shrunk: number;
}

export interface HomeScoreBreakdown {
  modelVersion: string;
  config: HomeRecommendationModelConfig;
  configFingerprint: string;
  basePerformance: number;
  lowPickEdge: number;
  lobbyAdjustment: number;
  liveOwnedAffinity?: number;
  liveShopOpportunity?: number;
  liveDirection?: number;
  liveSummary?: string;
  finalSafety: number;
  reliability: number;
  evidenceSource: string;
  evidenceSample: number | null;
  top4: HomeScoreMetric;
  averagePlacement: HomeScoreMetric;
  winRate: HomeScoreMetric;
  pickRate: { value: number; unit: 'percent' | 'provider-display' } | null;
  basePerformancePercentile: number | null;
  popularityPercentile: number | null;
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
  riotId?: string;
  generatedAt: string;
  sourceMatchIds: ID[];
  set: number;
  patch: string;
  derivationVersion: string;
  relevantGames: number;
  effectiveSample: number;
  unitEvidence: OpponentUnitEvidence[];
  unitFrequency: Record<ID, number>;
  traitFrequency: Record<ID, number>;
  augmentFrequency: Record<ID, number>;
  placement: {
    games: number;
    average: number | null;
    topFourRate: number | null;
  };
  patchRelevance: {
    status: 'same' | 'mixed' | 'different' | 'unavailable';
    comparableGames: number;
    samePatchGames: number | null;
    note: string;
  };
  unresolvedIds: {
    units: ID[];
    items: ID[];
    traits: ID[];
    augments: ID[];
  };
  repeatedUnitCandidates: ID[];
  freshness: 'fresh' | 'cached' | 'stale';
  familyFrequency?: Record<ID, number>;
  styleFrequency?: Record<string, number>;
  placementByFamily?: Record<ID, number>;
  forceIndex?: number;
  flexIndex?: number;
  classification: {
    family: 'unavailable';
    style: 'unavailable';
    note: string;
  };
  confidenceFactors: {
    sampleCoverage: number;
    recencyQuality: number;
    modeQuality: number;
    patchQuality: number | null;
  };
  confidence: number;
  historicalBoards?: OpponentHistoricalBoard[];
  routeAffinities?: OpponentRouteAffinity[];
}

export type RouteMatchClassification = 'strong' | 'plausible' | 'weak' | 'none';

export interface CanonicalRouteSignature {
  compId: string;
  snapshotId: string;
  set: number;
  patch: string | null;
  hotfix: string | null;
  finalRoster: string[];
  coreUnits: string[];
  carryAnchors: string[];
  tankAnchors: string[];
  flexUnits: string[];
  style: string;
  contestElasticity: number;
  hasVerifiedCore: boolean;
  provenance: {
    source: string;
    status: string;
    version?: string;
  };
}

export interface BoardRouteMatch {
  matchId: string;
  compId: string;
  similarity: number;
  coreRecall: number;
  anchorRecall: number;
  carryAnchorRecall: number;
  tankAnchorRecall: number;
  targetRecall: number;
  targetJaccard: number;
  flexOverlap: number;
  evidenceQuality: number;
  classification: RouteMatchClassification;
}

export interface OpponentRouteAffinity {
  compId: string;
  weightedSimilarity: number;
  recentFiveSimilarity: number;
  strongMatches: number;
  recentStrongMatches: number;
  plausibleMatches: number;
  /** Historical behavioral signal reflecting repeated route alignment across analyzed games. Not a probability of future choice. */
  affinity: number;
  confidence: number;
  evidenceGames: number;
  commitment: 'high' | 'moderate' | 'low' | 'none';
}

export interface OpponentHistoricalBoard {
  matchId: ID;
  completedAt: string;
  ordinal: number;
  weight: number;
  placement: number;
  championIds: ID[];
}

export type UnitTrend = 'rising' | 'stable' | 'falling' | 'unavailable';

export interface OpponentUnitEvidence {
  championId: ID;
  gamesAppeared: number;
  sampleGames: number;
  rawPresenceRate: number;
  weightedPresence: number;
  recentFiveAppearances: number;
  recentWindowGames: number;
  recentFiveRate: number;
  priorAppearances: number;
  priorWindowGames: number;
  priorWindowRate: number | null;
  trendDelta: number | null;
  trend: UnitTrend;
  historicalCopyDemand: {
    status: 'verified-ordinary' | 'unavailable';
    evidenceGames: number;
    evidenceCoverage: number;
    weightedAverageFinalCopies: number | null;
    weightedDemand: number | null;
    note: string;
  };
}

export interface LobbyUnitPressureSource {
  puuid: string;
  riotId?: string;
  confidence: number;
  weightedPresence: number;
  recentFiveRate: number;
  trendDelta: number | null;
  weightedHistoricalCopyDemand: number | null;
}

export interface LobbyUnitPressureEvidence {
  championId: ID;
  opponentsWithEvidence: number;
  equivalentHistoricalUsers: number;
  recentSpikeEquivalentUsers: number;
  historicalCopyEquivalentUsers: number;
  totalEquivalentUsers: number;
  normalizedPressure: number;
  evidenceCoverage: number;
  sourceOpponents: LobbyUnitPressureSource[];
}

export interface CandidateContestUnit {
  championId: ID;
  criticality: number;
  role: 'carry' | 'tank' | 'support' | 'unassigned';
  membership: 'core' | 'flex';
  lobbyPressure: number;
  equivalentHistoricalUsers: number;
  contribution: number;
}

export interface CandidateRouteOpponent {
  puuid: string;
  riotId?: string;
  confidence: number;
  routeOverlap: number;
  stronglyMatchingBoards: number;
  recentFiveStrongMatches: number;
  recentWindowGames: number;
  totalBoards: number;
  affinity?: number;
  plausibleMatches?: number;
  specializationLabel?: 'high' | 'moderate' | 'low' | 'none';
  matchSummary?: string;
}

export interface CandidateRouteEvidence {
  routeContest: number;
  opponentsWithRouteMatch: number;
  matchingOpponents: CandidateRouteOpponent[];
  summary: string;
  modelVersion?: string;
  pressureLevel?: 'Low' | 'Medium' | 'High';
  explanationDetails?: string[];
}

export interface CandidateContest {
  state: 'Unavailable' | 'Low' | 'Medium' | 'High';
  value: number | null;
  lobbyFit: number | null;
  evidenceCoverage: number;
  contestElasticity: number;
  styleFactor: number;
  pressuredUnits: CandidateContestUnit[];
  note: string;
  provenance: 'unavailable' | 'seeded-criticality-and-m4-history';
  unitContest?: number | null;
  routeContest?: number | null;
  routeEvidence?: CandidateRouteEvidence | null;
}
export interface RiotTelemetry {
  requestsAttempted: number;
  cacheHits: number;
  retries: number;
  rateLimitWaits: number;
  rateLimitWaitMs: number;
  uniqueMatchDetailsFetched: number;
  sharedMatchesDeduplicated: number;
}
export interface LobbyPressure {
  state: 'complete' | 'partial' | 'unavailable';
  expectedOpponents: number;
  requestedOpponents: number;
  resolvedOpponents: number;
  profilesCompleted: number;
  profiles: OpponentProfile[];
  unitPressure: LobbyUnitPressureEvidence[];
  unitPressureVersion: string;
  coverage: number;
  relevantGamesAvailable: number;
  relevantGamesTarget: number;
  freshProfiles: number;
  cachedProfiles: number;
  acquisitionMs: number;
  derivationMs: number;
  elapsedMs: number;
  telemetry: RiotTelemetry;
  fetchedAt: string;
  errors: string[];
}
export type LobbyScanStage =
  | 'idle'
  | 'detected'
  | 'scanning'
  | 'complete'
  | 'partial-complete'
  | 'not-in-game'
  | 'failed';

export interface LobbyScanProgress {
  opponentsAnalyzed: number;
  opponentsTotal: number;
  matchesProcessed: number;
  message?: string;
}

export interface LobbyScanState {
  stage: LobbyScanStage;
  opponentsAnalyzed: number;
  opponentsTotal: number;
  matchesProcessed: number;
  relevantGamesAvailable: number;
  relevantGamesTarget: number;
  coverage: number;
  lobby: LobbyPressure | null;
  error?: string;
  reason?: string;
  isProvisional: boolean;
  tftDetected?: boolean;
}
export interface PersonalProfile {
  schemaVersion?: 1;
  modelVersion?: string;
  set: number;
  patch: string;
  effectiveGames: number;
  familyAffinity: Record<ID, number>;
  generatedAt: string;
  sourceReviewIds?: ID[];
  confidence?: number;
  minimumEvidenceGames?: number;
  families?: PersonalFamilyEvidence[];
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
export interface MatchTrait {
  id: ID;
  count: number;
  style: number | null;
  tierCurrent: number | null;
  tierTotal: number | null;
  unresolved: boolean;
}
export interface MatchUnit {
  championId: ID;
  items: ID[];
  stars: number;
  rarity: number | null;
  rawName: string | null;
  unresolvedUnit: boolean;
  unresolvedItems: ID[];
}
export interface MatchParticipant {
  puuid: string;
  placement: number;
  level: number;
  units: MatchUnit[];
  traits: MatchTrait[];
  augmentIds: ID[];
  unresolvedAugmentIds: ID[];
  riotId?: string;
  /** Synthetic fixtures may carry classifier output. Native M3 normalization never sets it. */
  familyId?: ID;
  /** Synthetic fixtures may carry classifier output. Native M3 normalization never sets it. */
  style?: string;
}
export interface CompletedMatch {
  id: ID;
  set: number;
  setCoreName: string | null;
  /** Raw `info.game_version`: Riot documents this as the game client version. */
  riotGameVersion: string;
  /** Product TFT content patch only when supplied by a verified mapping or fixture. */
  tftContentPatch: string | null;
  tftContentPatchSource: 'verified-mapping' | 'fixture' | 'unavailable';
  dataVersion: string;
  gameTimestamp: string;
  /** Riot documents `game_datetime` only as a Unix timestamp, without start/end semantics. */
  gameTimestampSemantics?: 'riot-game-datetime-unspecified' | 'fixture-completed-at';
  /** Documented `game_length` in seconds when present in the completed-match DTO. */
  gameDurationSeconds?: number | null;
  completedAt: string;
  queueId: number | null;
  gameType: string | null;
  mapId: number | null;
  endOfGameResult: string | null;
  modeSupport: 'supported' | 'unsupported' | 'unverified';
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
export const PLAN_SESSION_SCHEMA_VERSION = 1 as const;
export type PlanSessionState = 'active' | 'ended';
export type PlanSessionEndReason = 'ended-without-result' | 'replaced' | 'completed';
export interface PlanSessionCompatibility {
  state: 'current' | 'stale';
  evaluatedAt: string;
  reasons: string[];
}
export interface PlanSessionManualState {
  currentGameHistory?: CurrentGameState[];
  currentGame?: CurrentGameState;
  stageId: ID | null;
  decisionNodeId: ID | null;
  decisionPathEdgeIds: ID[];
  pivotTargetId: ID | null;
  updatedAt: string;
}
export interface PlanSessionEvidenceSnapshot {
  aggregateMeta: {
    datasetId: ID;
    derivationFingerprint: string;
    sampleDefinitionFingerprint: string;
    collectedAt: string;
  } | null;
  metaFamilyStats: FamilyMetaStats[];
  discovery: {
    datasetId: ID;
    derivationFingerprint: string;
    sampleDefinitionFingerprint: string;
    generatedAt: string;
  } | null;
  discoveryClusters: DiscoveryCluster[];
  lobby: {
    state: LobbyPressure['state'];
    coverage: number;
    expectedOpponents: number;
    resolvedOpponents: number;
    relevantGamesAvailable: number;
    relevantGamesTarget: number;
    unitPressureVersion: string;
    fetchedAt: string;
  } | null;
}
export interface VerifiedTeamPlannerSnapshot {
  codecVersion: string;
  set: number;
  code: string;
  fixtureIds: ID[];
  manualPasteVerifiedAt: string;
}
export interface PlanSessionSnapshot {
  calibration?: {
    engine: string;
    homeModel?: {
      version: string;
      config: HomeRecommendationModelConfig;
      configFingerprint: string;
    };
    baselines?: Record<string, { id: string; score: number; average: number | null }[]>;
    externalHash: string | null;
    knowledgePatch: string | null;
    initialState: CurrentGameState | null;
  };
  knowledgeFingerprint?: string;
  playbook: Playbook;
  candidate: RecommendationCandidate;
  portfolio: RecommendationPortfolio;
  selectedRank: number;
  portfolioCandidateIds: ID[];
  registry: {
    id: ID;
    sourceKind: CompRegistryEntry['sourceKind'];
    lifecycle: DiscoveryLifecycleState;
    structuralFingerprint: string;
  };
  staticData: StaticData;
  staticCompatibilityFingerprint: string;
  strategy: {
    schemaVersion: number;
    guidanceVersion: string;
    status: StrategyGuidance['freshness']['state'];
    staticSourceFingerprint: string;
    targetBoardFingerprint: string;
    registryFingerprint: string;
  };
  evidence: PlanSessionEvidenceSnapshot;
  teamPlanner: VerifiedTeamPlannerSnapshot | null;
}
export interface PlanSession {
  schemaVersion: typeof PLAN_SESSION_SCHEMA_VERSION;
  id: ID;
  state: PlanSessionState;
  lockedAt: string;
  endedAt: string | null;
  endReason: PlanSessionEndReason | null;
  replacesSessionId: ID | null;
  replacedBySessionId: ID | null;
  selectedPlaybookId: ID;
  selectedFamilyId: ID;
  accountContext: { riotId: string; platform: string } | null;
  snapshot: PlanSessionSnapshot;
  snapshotFingerprint: string;
  manualState: PlanSessionManualState;
  compatibility: PlanSessionCompatibility;
  reconciliation: { matchId: ID | null };
}

export type ReconciliationState = 'unmatched' | 'candidate' | 'matched' | 'ambiguous' | 'rejected';
export interface ReconciliationCandidate {
  matchId: ID;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  participantPuuid: string;
  placement: number;
  gameTimestamp: string;
  gameDurationSeconds: number | null;
  timestampSemantics: 'riot-game-datetime-unspecified' | 'fixture-completed-at';
  evidence: {
    key: 'account' | 'platform' | 'timing' | 'mode' | 'set';
    state: 'matched' | 'compatible' | 'unverified' | 'rejected';
    weight: number;
    detail: string;
  }[];
  reasons: string[];
}
export interface ReconciliationAuditEvent {
  at: string;
  action: 'checked' | 'auto-matched' | 'confirmed' | 'rejected' | 'unlinked';
  matchId: ID | null;
  note: string;
}
export interface MatchReconciliation {
  schemaVersion: 1;
  modelVersion: string;
  chainId: ID;
  sessionIds: ID[];
  terminalSessionId: ID;
  state: ReconciliationState;
  matchId: ID | null;
  candidates: ReconciliationCandidate[];
  accountPuuid: string | null;
  platform: string | null;
  checkedAt: string;
  decidedAt: string | null;
  decision: 'automatic' | 'manual' | 'rejected' | null;
  audit: ReconciliationAuditEvent[];
}

export interface SelectedFinalBoardRelation {
  state: 'same-family' | 'pivot-destination' | 'other-family' | 'unknown' | 'unavailable';
  classification: CompClassification;
  canonicalFinal: CanonicalBoard | null;
  canonicalTarget: CanonicalBoard | null;
  similarity: BoardSimilarity | null;
  selectedCorePresent: ID[];
  selectedCoreMissing: ID[];
  finalUnitsAdded: ID[];
  targetCapacity: number;
  finalBoardSize: number | null;
}
export interface ReviewBaselineEvidence {
  state: 'available' | 'unavailable';
  familyId: ID | null;
  datasetId: ID | null;
  derivationFingerprint: string | null;
  games: number;
  confidence: number;
  expectedPlacement: number | null;
  placementResidual: number | null;
  expectedTopFour: number | null;
  note: string;
}
export interface PostGameReview {
  schemaVersion: 1;
  reviewVersion: string;
  id: ID;
  chainId: ID;
  sessionIds: ID[];
  terminalSessionId: ID;
  matchId: ID;
  set: number;
  createdAt: string;
  matchFingerprint: string;
  staticFingerprint: string;
  selectedTargetFingerprint: string;
  classifierVersion: string;
  canonicalModelVersion: string;
  similarityModelVersion: string;
  participant: {
    puuid: string;
    placement: number;
    level: number;
    augmentIds: ID[];
    augmentEvidence: 'validated' | 'unavailable';
    itemIds: ID[];
    itemEvidence: 'validated' | 'unavailable';
  };
  selectedPlan: { playbookId: ID; familyId: ID; title: string };
  switchChain: { sessionId: ID; playbookId: ID; familyId: ID; title: string }[];
  relation: SelectedFinalBoardRelation;
  baseline: ReviewBaselineEvidence;
  summary: string[];
  adjustment: string;
  evidenceGaps: string[];
  attribution: {
    eligible: boolean;
    familyId: ID | null;
    confidence: number;
    reasons: string[];
  };
  derivationFingerprint: string;
}
export interface PersonalFamilyEvidence {
  familyId: ID;
  games: number;
  effectiveGames: number;
  averageResidual: number;
  shrunkResidual: number;
  affinity: number;
  confidence: number;
  matchIds: ID[];
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
  contractVersion: string;
  formatVersion: string | null;
  reason: string;
  mappingVerified: boolean;
  fixtureVerified: boolean;
  manualPasteVerified: boolean;
  knownGoodFixtureIds: ID[];
}
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// ==================================================
// M13D — Personal Match Observations & Intelligence
// ==================================================

export type CompClassificationState = 'classified' | 'ambiguous' | 'unclassified' | 'incompatible-set';

export interface NearestCompCandidate {
  compId: string;
  compTitle: string;
  affinity: number;
  coreRecall: number;
  targetRecall: number;
  targetJaccard: number;
  matchedUnits: string[];
  missingUnits: string[];
  extraUnits: string[];
  coreMatched: string[];
  coreMissing: string[];
  carryAnchorMatched: boolean;
  tankAnchorMatched: boolean;
  explanationTags: string[];
}

export interface PersonalCompClassification {
  state: CompClassificationState;
  compId: string | null;
  compTitle: string | null;
  confidence: number;
  runnerUpCompId: string | null;
  runnerUpScore: number;
  candidateCompIds: string[];
  finalBoardHash: string;
  classifierVersion: string;
  reasons: string[];
  nearestMatches?: NearestCompCandidate[];
  closestComp?: NearestCompCandidate | null;
}

export interface PostGameBoardAnalysis {
  classification: PersonalCompClassification;
  closestComp: NearestCompCandidate | null;
  runnerUpComp: NearestCompCandidate | null;
  nearestMatches: NearestCompCandidate[];
  technicalDetails: {
    classifierVersion: string;
    bestAffinity: number;
    runnerUpAffinity: number;
    coreRecall: number;
    anchorRecall: number;
    targetRecall: number;
    targetJaccard: number;
    frontlineDampingApplied: boolean;
    quadraticCoreDampingApplied: boolean;
    winnerMargin: number;
    clearedGates: boolean;
  } | null;
}

export interface PersonalMatchUnit {
  championId: string;
  stars?: number | null;
  items?: string[];
}

export interface PersonalMatchObservation {
  matchId: string;
  accountPuuid: string;
  set: number;
  patch: string | null;
  riotGameVersion: string | null;
  gameTimestamp: string;
  placement: number;
  level: number;
  queueId: number | null;
  gameType: string | null;
  classifiedCompId: string | null;
  classificationState: CompClassificationState;
  classificationConfidence: number;
  classificationModelVersion: string;
  candidateCompIds?: string[];
  runnerUpCompId?: string | null;
  finalBoardHash: string;
  units: PersonalMatchUnit[];
  createdAt: string;
  updatedAt: string;
}

export type PersonalMatchCorrectionState = 'canonical' | 'unclassified' | 'cleared';

export interface PersonalMatchCorrection {
  matchId: string;
  canonicalCompId: string | null;
  state: PersonalMatchCorrectionState;
  createdAt: string;
  updatedAt: string;
}

export type PersonalSampleConfidence = 'VERY LIMITED' | 'LIMITED' | 'DEVELOPING' | 'MEANINGFUL';

export interface PersonalCompPerformance {
  compId: string;
  compTitle: string;
  games: number;
  averagePlacement: number;
  top4Count: number;
  top4Rate: number;
  winCount: number;
  winRate: number;
  bestPlacement: number;
  recentPlacements: number[];
  lastPlayed: string;
  sampleConfidence: PersonalSampleConfidence;
  evidenceAdjustedEstimate: number;
  classificationConfidenceAvg: number;
}

export interface PersonalHistorySummary {
  currentSet: number;
  currentSetGames: number;
  archivedOldSetGames: number;
  currentSetAveragePlacement: number | null;
  currentSetTop4Rate: number | null;
  currentSetWinRate: number | null;
  mostPlayedComp: { compId: string; compTitle: string; games: number } | null;
  strongestObserved: { compId: string; compTitle: string; games: number; averagePlacement: number; top4Rate: number; sampleConfidence: PersonalSampleConfidence } | null;
  weakerObserved: { compId: string; compTitle: string; games: number; averagePlacement: number; top4Rate: number; sampleConfidence: PersonalSampleConfidence } | null;
}

export type MatchRecommendationLinkState = 'linked' | 'candidate' | 'ambiguous' | 'none';

export interface MatchRecommendationLink {
  matchId?: string;
  state: MatchRecommendationLinkState;
  sessionId?: string;
  recommendedPlaybookId?: string;
  recommendedPlaybookTitle?: string;
  recommendedRank?: number;
  contestState?: string;
  finalSafety?: number;
  actualClassifiedCompId?: string | null;
  actualPlacement: number;
  summaryStatement: string;
  details: string[];
}

export interface PersonalHistoryRefreshStatus {
  matchesFound: number;
  newMatchesFetched: number;
  cachedMatchesReused: number;
  lastUpdated: string;
  message?: string;
}

export interface CalibrationV2Bucket {
  key: string;
  category: 'rank' | 'safety' | 'confidence' | 'contest' | 'pressure' | 'comp' | 'followed' | 'evidence';
  games: number;
  averagePlacement: number;
  top4Rate: number;
  winRate: number;
}

export interface CalibrationV2Evaluation {
  version: 'calibration-v2';
  totalOutcomes: number;
  buckets: CalibrationV2Bucket[];
  weightsChanged: false;
  limitations: string[];
}

