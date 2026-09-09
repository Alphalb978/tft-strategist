import type {
  MatchParticipant,
  PersonalCompClassification,
  StaticData,
} from '../domain/models';
import type { RuntimeKnowledgeCatalog } from '../services/knowledgeCatalog';
import { canonicalizeFinalBoard } from './canonicalBoard';

export const PERSONAL_COMP_CLASSIFIER_VERSION = 'personal-comp-classifier-v1';

export const CLASSIFIER_CONFIG = {
  weights: {
    core: 0.45,
    targetJaccard: 0.30,
    anchors: 0.20,
    sizeFit: 0.05,
  },
  thresholds: {
    minimumScore: 0.58,
    minimumCoreRecall: 0.45,
    ambiguityMargin: 0.08,
    frontlineDamping: 0.60,
  },
} as const;

export function classifyPersonalBoard(
  participant: MatchParticipant,
  set: number,
  catalog: RuntimeKnowledgeCatalog | null,
  staticData: StaticData,
): PersonalCompClassification {
  if (set !== staticData.version.set) {
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
    };
  }

  const canonical = canonicalizeFinalBoard(participant, set, staticData);
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
    };
  }

  const finalBoardHash = canonical.board.fingerprint;
  const boardUnitIds = new Set(canonical.board.units.map((u) => u.championId));

  const candidatePool = (catalog?.playbooks ?? []).filter((p) => p.set === set);
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
    };
  }

  const scoredCandidates = candidatePool
    .map((playbook) => {
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
      const unionSize = new Set([...boardUnitIds, ...targetUnits]).size;
      const targetJaccard = unionSize > 0 ? targetOverlap / unionSize : 0;

      const carryOverlap = carryAnchors.filter((id) => boardUnitIds.has(id)).length;
      const carryRecall = carryAnchors.length > 0 ? carryOverlap / carryAnchors.length : 1;

      const tankOverlap = tankAnchors.filter((id) => boardUnitIds.has(id)).length;
      const tankRecall = tankAnchors.length > 0 ? tankOverlap / tankAnchors.length : 1;

      const anchorRecall = (carryRecall + tankRecall) / 2;
      const sizeFit =
        1 -
        Math.abs(boardUnitIds.size - targetUnits.size) /
          Math.max(boardUnitIds.size, targetUnits.size, 1);

      let score =
        CLASSIFIER_CONFIG.weights.core * coreRecall +
        CLASSIFIER_CONFIG.weights.targetJaccard * targetJaccard +
        CLASSIFIER_CONFIG.weights.anchors * anchorRecall +
        CLASSIFIER_CONFIG.weights.sizeFit * sizeFit;

      // Frontline-only damping: If the comp defines carry anchors but none are on board,
      // damp the score significantly to prevent generic frontline/tank overlap from matching.
      if (carryAnchors.length > 0 && carryOverlap === 0) {
        score *= CLASSIFIER_CONFIG.thresholds.frontlineDamping;
      }

      // If core recall is below 40%, damp score quadratically
      if (coreRecall < 0.40) {
        score *= Math.pow(coreRecall / 0.40, 2);
      }

      const clearsGates =
        score >= CLASSIFIER_CONFIG.thresholds.minimumScore &&
        coreRecall >= CLASSIFIER_CONFIG.thresholds.minimumCoreRecall &&
        (carryAnchors.length === 0 || carryOverlap > 0);

      return {
        compId,
        compTitle,
        score,
        coreRecall,
        targetJaccard,
        carryOverlap,
        carryAnchorsCount: carryAnchors.length,
        clearsGates,
      };
    })
    .sort((a, b) => b.score - a.score || a.compId.localeCompare(b.compId));

  const top = scoredCandidates[0];
  const runnerUp = scoredCandidates[1];

  if (!top || !top.clearsGates) {
    return {
      state: 'unclassified',
      compId: null,
      compTitle: null,
      confidence: top ? Math.round(top.score * 100) / 100 : 0,
      runnerUpCompId: null,
      runnerUpScore: 0,
      candidateCompIds: [],
      finalBoardHash,
      classifierVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
      reasons: ['Board did not clear minimum core recall or score gates for any canonical comp.'],
    };
  }

  const margin = runnerUp && runnerUp.clearsGates ? top.score - runnerUp.score : 1.0;
  if (runnerUp && runnerUp.clearsGates && margin < CLASSIFIER_CONFIG.thresholds.ambiguityMargin) {
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
        `Ambiguous match between "${top.compTitle}" (${(top.score * 100).toFixed(0)}%) and "${runnerUp.compTitle}" (${(runnerUp.score * 100).toFixed(0)}%).`,
      ],
    };
  }

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
    reasons: [`Confidently classified as "${top.compTitle}" with ${(top.score * 100).toFixed(0)}% affinity.`],
  };
}
