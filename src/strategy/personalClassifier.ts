import type {
  MatchParticipant,
  NearestCompCandidate,
  PersonalCompClassification,
  Playbook,
  PostGameBoardAnalysis,
  StaticData,
} from '../domain/models';
import type { RuntimeKnowledgeCatalog } from '../services/knowledgeCatalog';
import { canonicalizeFinalBoard } from './canonicalBoard';
import { loadPlaybooks } from '../providers/playbooks';


export const PERSONAL_COMP_CLASSIFIER_VERSION = 'personal-comp-classifier-v2';

export const CLASSIFIER_CONFIG = {
  weights: {
    core: 0.35,
    targetRecall: 0.25,
    targetJaccard: 0.15,
    anchors: 0.20,
    sizeFit: 0.05,
  },
  thresholds: {
    minimumScore: 0.55,
    minimumCoreRecall: 0.40,
    ambiguityMargin: 0.06,
    frontlineDamping: 0.55,
    ambiguousCompetitorScore: 0.50,
  },
} as const;

interface ScoredCandidateInternal {
  compId: string;
  compTitle: string;
  score: number;
  coreRecall: number;
  targetRecall: number;
  targetJaccard: number;
  anchorRecall: number;
  carryOverlap: number;
  carryAnchorsCount: number;
  tankOverlap: number;
  tankAnchorsCount: number;
  frontlineDampingApplied: boolean;
  quadraticCoreDampingApplied: boolean;
  clearsGates: boolean;
  candidateObj: NearestCompCandidate;
}

export function evaluateSingleCandidateInternal(
  boardUnitIds: Set<string>,
  playbook: Playbook,
): ScoredCandidateInternal {
  const compId = playbook.id;
  const compTitle = playbook.title;
  const coreUnits = new Set(playbook.family.core);
  const targetUnits = new Set(playbook.target.units.map((u) => u.championId));
  const carryAnchors = playbook.roles
    .filter((r) => r.role === 'carry')
    .map((r) => r.championId);
  const tankAnchors = playbook.roles
    .filter((r) => r.role === 'tank')
    .map((r) => r.championId);

  const coreOverlap = [...coreUnits].filter((id) => boardUnitIds.has(id)).length;
  const coreRecall = coreUnits.size > 0 ? coreOverlap / coreUnits.size : 0;

  const targetOverlap = [...targetUnits].filter((id) => boardUnitIds.has(id)).length;
  const targetRecall = targetUnits.size > 0 ? targetOverlap / targetUnits.size : 0;

  const unionSize = new Set([...boardUnitIds, ...targetUnits]).size;
  const targetJaccard = unionSize > 0 ? targetOverlap / unionSize : 0;

  const carryOverlap = carryAnchors.filter((id) => boardUnitIds.has(id)).length;
  const carryRecall = carryAnchors.length > 0 ? carryOverlap / carryAnchors.length : 1;

  const tankOverlap = tankAnchors.filter((id) => boardUnitIds.has(id)).length;
  const tankRecall = tankAnchors.length > 0 ? tankOverlap / tankAnchors.length : 1;

  const anchorRecall =
    carryAnchors.length > 0 && tankAnchors.length > 0
      ? carryRecall * 0.65 + tankRecall * 0.35
      : carryAnchors.length > 0
        ? carryRecall
        : tankRecall;

  const sizeFit =
    1 -
    Math.abs(boardUnitIds.size - targetUnits.size) /
      Math.max(boardUnitIds.size, targetUnits.size, 1);

  let score =
    CLASSIFIER_CONFIG.weights.core * coreRecall +
    CLASSIFIER_CONFIG.weights.targetRecall * targetRecall +
    CLASSIFIER_CONFIG.weights.targetJaccard * targetJaccard +
    CLASSIFIER_CONFIG.weights.anchors * anchorRecall +
    CLASSIFIER_CONFIG.weights.sizeFit * sizeFit;

  let frontlineDampingApplied = false;
  if (carryAnchors.length > 0 && carryOverlap === 0) {
    score *= CLASSIFIER_CONFIG.thresholds.frontlineDamping;
    frontlineDampingApplied = true;
  }

  let quadraticCoreDampingApplied = false;
  if (coreRecall < 0.35) {
    score *= Math.pow(coreRecall / 0.35, 2);
    quadraticCoreDampingApplied = true;
  }

  const clearsGates =
    score >= CLASSIFIER_CONFIG.thresholds.minimumScore &&
    coreRecall >= CLASSIFIER_CONFIG.thresholds.minimumCoreRecall &&
    (carryAnchors.length === 0 || carryOverlap > 0);

  const matchedUnits = playbook.target.units
    .filter((u) => boardUnitIds.has(u.championId))
    .map((u) => u.championId);
  const missingUnits = playbook.target.units
    .filter((u) => !boardUnitIds.has(u.championId))
    .map((u) => u.championId);
  const extraUnits = [...boardUnitIds].filter((id) => !targetUnits.has(id));
  const coreMatched = [...coreUnits].filter((id) => boardUnitIds.has(id));
  const coreMissing = [...coreUnits].filter((id) => !boardUnitIds.has(id));
  const carryAnchorMatched = carryAnchors.length === 0 || carryOverlap > 0;
  const tankAnchorMatched = tankAnchors.length === 0 || tankOverlap > 0;

  const explanationTags: string[] = [];
  if (coreUnits.size > 0) {
    explanationTags.push(`Core ${coreMatched.length}/${coreUnits.size}`);
  }
  if (carryAnchors.length > 0) {
    explanationTags.push(carryAnchorMatched ? 'Carry Matched' : 'Carry Missing');
  }
  if (tankAnchors.length > 0) {
    explanationTags.push(tankAnchorMatched ? 'Tank Matched' : 'Tank Missing');
  }
  if (extraUnits.length > 0) {
    explanationTags.push(`${extraUnits.length} Extra/Splash`);
  }
  if (missingUnits.length > 0) {
    explanationTags.push(`Missing ${missingUnits.length}`);
  }

  const candidateObj: NearestCompCandidate = {
    compId,
    compTitle,
    affinity: Math.round(score * 100) / 100,
    coreRecall: Math.round(coreRecall * 100) / 100,
    targetRecall: Math.round(targetRecall * 100) / 100,
    targetJaccard: Math.round(targetJaccard * 100) / 100,
    matchedUnits,
    missingUnits,
    extraUnits,
    coreMatched,
    coreMissing,
    carryAnchorMatched,
    tankAnchorMatched,
    explanationTags,
  };

  return {
    compId,
    compTitle,
    score,
    coreRecall,
    targetRecall,
    targetJaccard,
    anchorRecall,
    carryOverlap,
    carryAnchorsCount: carryAnchors.length,
    tankOverlap,
    tankAnchorsCount: tankAnchors.length,
    frontlineDampingApplied,
    quadraticCoreDampingApplied,
    clearsGates,
    candidateObj,
  };
}

export function evaluatePlaybookCandidate(
  boardUnitIds: Set<string>,
  playbook: Playbook,
): NearestCompCandidate {
  return evaluateSingleCandidateInternal(boardUnitIds, playbook).candidateObj;
}

function evaluateCandidates(
  boardUnitIds: Set<string>,
  candidatePool: NonNullable<RuntimeKnowledgeCatalog['playbooks']>,
): ScoredCandidateInternal[] {
  return candidatePool
    .map((playbook) => evaluateSingleCandidateInternal(boardUnitIds, playbook))
    .sort((a, b) => b.score - a.score || a.compId.localeCompare(b.compId));
}

export function classifyPersonalBoard(
  participant: MatchParticipant,
  set: number,
  catalog: RuntimeKnowledgeCatalog | null,
  staticData: StaticData,
): PersonalCompClassification {
  const normalizedSet = typeof set === 'number' ? set : Number.parseInt(String(set), 10);
  const targetSet =
    typeof staticData.version.set === 'number'
      ? staticData.version.set
      : Number.parseInt(String(staticData.version.set), 10);

  if (!Number.isFinite(normalizedSet) || normalizedSet !== targetSet) {
    return {
      state: 'incompatible-set',
      compId: null,
      compTitle: null,
      confidence: 0,
      runnerUpCompId: null,
      runnerUpScore: 0,
      candidateCompIds: [],
      finalBoardHash: '',
      classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
      reasons: [`Match is Set ${set}, incompatible with active Set ${staticData.version.set}.`],
      nearestMatches: [],
      closestComp: null,
    };
  }

  const canonical = canonicalizeFinalBoard(participant, normalizedSet, staticData);
  if (!canonical.board || canonical.board.units.length === 0) {
    return {
      state: 'unclassified',
      compId: null,
      compTitle: null,
      confidence: 0,
      runnerUpCompId: null,
      runnerUpScore: 0,
      candidateCompIds: [],
      finalBoardHash: '',
      classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
      reasons: ['Final board has no legal canonical units in the active set.'],
      nearestMatches: [],
      closestComp: null,
    };
  }

  const finalBoardHash = canonical.board.fingerprint;
  const boardUnitIds = new Set(canonical.board.units.map((u) => u.championId));

  const candidatePool = (
    catalog?.playbooks && catalog.playbooks.length > 0
      ? catalog.playbooks
      : loadPlaybooks(staticData)
  ).filter(
    (p) => (typeof p.set === 'number' ? p.set : Number.parseInt(String(p.set), 10)) === normalizedSet,
  );
  if (candidatePool.length === 0) {
    return {
      state: 'unclassified',
      compId: null,
      compTitle: null,
      confidence: 0,
      runnerUpCompId: null,
      runnerUpScore: 0,
      candidateCompIds: [],
      finalBoardHash,
      classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
      reasons: ['No canonical comp definitions available in the knowledge catalog.'],
      nearestMatches: [],
      closestComp: null,
    };
  }


  const scoredCandidates = evaluateCandidates(boardUnitIds, candidatePool);

  const top = scoredCandidates[0];
  const runnerUp = scoredCandidates[1];
  const nearestMatches = scoredCandidates.slice(0, 3).map((c) => c.candidateObj);
  const closestComp = top ? top.candidateObj : null;

  if (!top || !top.clearsGates) {
    const reasons: string[] = [];
    if (!top) {
      reasons.push('No matching canonical comps found.');
    } else {
      if (top.carryAnchorsCount > 0 && top.carryOverlap === 0) {
        reasons.push(`Missing carry anchor for closest comp "${top.compTitle}".`);
      }
      if (top.coreRecall < CLASSIFIER_CONFIG.thresholds.minimumCoreRecall) {
        reasons.push(
          `Core unit recall (${Math.round(top.coreRecall * 100)}%) below minimum threshold (${Math.round(CLASSIFIER_CONFIG.thresholds.minimumCoreRecall * 100)}%).`,
        );
      }
      if (top.score < CLASSIFIER_CONFIG.thresholds.minimumScore) {
        reasons.push(
          `Overall affinity (${Math.round(top.score * 100)} / 100) below minimum classification threshold (${Math.round(CLASSIFIER_CONFIG.thresholds.minimumScore * 100)} / 100).`,
        );
      }
      if (reasons.length === 0) {
        reasons.push('Board did not clear minimum core recall or score gates for any canonical comp.');
      }
    }

    return {
      state: 'unclassified',
      compId: null,
      compTitle: null,
      confidence: top ? Math.round(top.score * 100) / 100 : 0,
      runnerUpCompId: runnerUp ? runnerUp.compId : null,
      runnerUpScore: runnerUp ? Math.round(runnerUp.score * 100) / 100 : 0,
      candidateCompIds: [],
      finalBoardHash,
      classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
      reasons,
      nearestMatches,
      closestComp,
    };
  }

  const runnerUpIsCompetitor =
    runnerUp &&
    (runnerUp.clearsGates || runnerUp.score >= CLASSIFIER_CONFIG.thresholds.ambiguousCompetitorScore);
  const margin = runnerUpIsCompetitor ? top.score - runnerUp.score : 1.0;

  if (runnerUpIsCompetitor && margin < CLASSIFIER_CONFIG.thresholds.ambiguityMargin) {
    return {
      state: 'ambiguous',
      compId: null,
      compTitle: null,
      confidence: Math.round(top.score * 100) / 100,
      runnerUpCompId: runnerUp.compId,
      runnerUpScore: Math.round(runnerUp.score * 100) / 100,
      candidateCompIds: [top.compId, runnerUp.compId],
      finalBoardHash,
      classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
      reasons: [
        `Ambiguous match between "${top.compTitle}" (${Math.round(top.score * 100)} / 100 affinity) and "${runnerUp.compTitle}" (${Math.round(runnerUp.score * 100)} / 100 affinity). Both share substantial comp structure within ${Math.round(margin * 100)} affinity margin.`,
      ],
      nearestMatches,
      closestComp,
    };
  }

  const variantNote =
    top.candidateObj.extraUnits.length > 0
      ? ` with ${top.candidateObj.extraUnits.length} splash/flex unit(s)`
      : '';

  return {
    state: 'classified',
    compId: top.compId,
    compTitle: top.compTitle,
    confidence: Math.round(top.score * 100) / 100,
    runnerUpCompId: runnerUp ? runnerUp.compId : null,
    runnerUpScore: runnerUp ? Math.round(runnerUp.score * 100) / 100 : 0,
    candidateCompIds: [top.compId],
    finalBoardHash,
    classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
    reasons: [
      `Confidently classified as "${top.compTitle}" with ${Math.round(top.score * 100)} / 100 affinity${variantNote}.`,
    ],
    nearestMatches,
    closestComp,
  };
}

export function projectBoardAnalysis(
  units: { championId: string; stars?: number | null; items?: string[] }[],
  set: number,
  catalog: RuntimeKnowledgeCatalog | null,
  staticData: StaticData,
  level = units.length,
): PostGameBoardAnalysis {
  const normalizedSet = typeof set === 'number' ? set : Number.parseInt(String(set), 10);
  const targetSet =
    typeof staticData.version.set === 'number'
      ? staticData.version.set
      : Number.parseInt(String(staticData.version.set), 10);

  const participant: MatchParticipant = {
    puuid: 'projected-player',
    placement: 1,
    level,
    units: units.map((u) => ({
      championId: u.championId,
      stars: u.stars ?? 1,
      items: u.items ?? [],
      rarity: null,
      rawName: null,
      unresolvedUnit: false,
      unresolvedItems: [],
    })),
    traits: [],
    augmentIds: [],
    unresolvedAugmentIds: [],
  };

  const classification = classifyPersonalBoard(participant, normalizedSet, catalog, staticData);

  if (!Number.isFinite(normalizedSet) || normalizedSet !== targetSet) {
    return {
      classification,
      closestComp: null,
      runnerUpComp: null,
      nearestMatches: [],
      technicalDetails: null,
    };
  }

  const canonical = canonicalizeFinalBoard(participant, normalizedSet, staticData);
  if (!canonical.board || canonical.board.units.length === 0) {
    return {
      classification,
      closestComp: null,
      runnerUpComp: null,
      nearestMatches: [],
      technicalDetails: null,
    };
  }

  const boardUnitIds = new Set(canonical.board.units.map((u) => u.championId));
  const candidatePool = (
    catalog?.playbooks && catalog.playbooks.length > 0
      ? catalog.playbooks
      : loadPlaybooks(staticData)
  ).filter(
    (p) => (typeof p.set === 'number' ? p.set : Number.parseInt(String(p.set), 10)) === normalizedSet,
  );
  if (candidatePool.length === 0) {
    return {
      classification,
      closestComp: null,
      runnerUpComp: null,
      nearestMatches: [],
      technicalDetails: null,
    };
  }


  const scoredCandidates = evaluateCandidates(boardUnitIds, candidatePool);
  const top = scoredCandidates[0];
  const runnerUp = scoredCandidates[1];
  const nearestMatches = scoredCandidates.slice(0, 3).map((c) => c.candidateObj);
  const closestComp = top ? top.candidateObj : null;
  const runnerUpComp = runnerUp ? runnerUp.candidateObj : null;

  const runnerUpIsCompetitor =
    runnerUp &&
    (runnerUp.clearsGates || runnerUp.score >= CLASSIFIER_CONFIG.thresholds.ambiguousCompetitorScore);
  const winnerMargin = runnerUpIsCompetitor ? top.score - runnerUp.score : 1.0;

  const technicalDetails = top
    ? {
        classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
        bestAffinity: Math.round(top.score * 100) / 100,
        runnerUpAffinity: runnerUp ? Math.round(runnerUp.score * 100) / 100 : 0,
        coreRecall: Math.round(top.coreRecall * 100) / 100,
        anchorRecall: Math.round(top.anchorRecall * 100) / 100,
        targetRecall: Math.round(top.targetRecall * 100) / 100,
        targetJaccard: Math.round(top.targetJaccard * 100) / 100,
        frontlineDampingApplied: top.frontlineDampingApplied,
        quadraticCoreDampingApplied: top.quadraticCoreDampingApplied,
        winnerMargin: Math.round(winnerMargin * 100) / 100,
        clearedGates: top.clearsGates,
      }
    : null;

  return {
    classification,
    closestComp,
    runnerUpComp,
    nearestMatches,
    technicalDetails,
  };
}
