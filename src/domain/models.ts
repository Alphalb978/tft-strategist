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
  playbook: Playbook;
  score: number;
  components: ScoreComponent[];
  confidence: Confidence;
  reasons: string[];
  contest: CandidateContest;
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
