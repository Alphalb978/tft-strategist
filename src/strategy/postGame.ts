import { stableFingerprint, staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import type {
  CompletedMatch,
  MatchReconciliation,
  PlanSession,
  PostGameReview,
  ReconciliationCandidate,
  StaticData,
  Playbook,
  PostGameSummary,
  SelectedPlan,
} from '../domain/models';
import { compareCanonicalBoards, BOARD_SIMILARITY_MODEL } from './boardSimilarity';
import { canonicalizeBoard, canonicalizeFinalBoard, CANONICAL_BOARD_MODEL } from './canonicalBoard';
import { classifyFinalBoard, COMP_CLASSIFIER } from './compClassifier';

export const POST_GAME_RECONCILIATION = {
  version: 'postgame-reconciliation-v1',
  candidateThreshold: 0.72,
  automaticThreshold: 0.86,
  automaticMargin: 0.12,
  recentMatchHorizon: 5,
  timingToleranceMinutes: 20,
} as const;
export const POST_GAME_REVIEW_VERSION = 'postgame-review-v1';

export interface SessionChain {
  id: string;
  sessions: PlanSession[];
  terminal: PlanSession;
}

export function postGameReviewIsCurrent(review: PostGameReview, chain: SessionChain) {
  const terminal = chain.terminal;
  const expected = stableFingerprint({
    reviewVersion: POST_GAME_REVIEW_VERSION,
    matchId: review.matchId,
    terminalSnapshot: terminal.snapshotFingerprint,
    classifierVersion: COMP_CLASSIFIER.version,
    canonicalVersion: CANONICAL_BOARD_MODEL.version,
    similarityVersion: BOARD_SIMILARITY_MODEL.version,
    baseline: review.baseline.derivationFingerprint,
  });
  return (
    review.reviewVersion === POST_GAME_REVIEW_VERSION &&
    review.classifierVersion === COMP_CLASSIFIER.version &&
    review.canonicalModelVersion === CANONICAL_BOARD_MODEL.version &&
    review.similarityModelVersion === BOARD_SIMILARITY_MODEL.version &&
    review.selectedTargetFingerprint === terminal.snapshot.strategy.targetBoardFingerprint &&
    review.staticFingerprint === staticSetCompatibilityFingerprint(terminal.snapshot.staticData) &&
    review.derivationFingerprint === expected
  );
}

export function reconstructSessionChains(sessions: PlanSession[]): SessionChain[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const visited = new Set<string>();
  const chains: SessionChain[] = [];
  for (const root of [...sessions]
    .filter((session) => !session.replacesSessionId || !byId.has(session.replacesSessionId))
    .sort((a, b) => Date.parse(b.lockedAt) - Date.parse(a.lockedAt) || a.id.localeCompare(b.id))) {
    const chain: PlanSession[] = [];
    let current: PlanSession | undefined = root;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);
      current = current.replacedBySessionId ? byId.get(current.replacedBySessionId) : undefined;
    }
    chains.push({ id: root.id, sessions: chain, terminal: chain.at(-1)! });
  }
  for (const orphan of sessions.filter((session) => !visited.has(session.id)))
    chains.push({ id: orphan.id, sessions: [orphan], terminal: orphan });
  return chains;
}

const minutes = (milliseconds: number) => milliseconds / 60_000;
const validTime = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

function timingEvidence(chain: SessionChain, match: CompletedMatch) {
  const anchor = validTime(match.gameTimestamp ?? match.completedAt);
  const locked = validTime(chain.sessions[0].lockedAt);
  const ended = validTime(chain.terminal.endedAt);
  if (anchor === null || locked === null)
    return { state: 'rejected' as const, score: 0, detail: 'Timing evidence is malformed.' };
  const durationMs = Math.max(0, match.gameDurationSeconds ?? 0) * 1_000;
  // Riot documents game_datetime only as a Unix timestamp. Compare both possible
  // interpretations and never claim a precise start/end that the DTO does not establish.
  const lockDelta = Math.min(Math.abs(anchor - locked), Math.abs(anchor - durationMs - locked));
  const endDelta =
    ended === null ? 0 : Math.min(Math.abs(anchor - ended), Math.abs(anchor + durationMs - ended));
  const tolerance = POST_GAME_RECONCILIATION.timingToleranceMinutes;
  const plausible =
    minutes(lockDelta) <= 70 + tolerance && (ended === null || minutes(endDelta) <= 100);
  const score = plausible
    ? 0.75 * Math.exp(-minutes(lockDelta) / 35) +
      0.25 * (ended === null ? 0.5 : Math.exp(-minutes(endDelta) / 45))
    : 0;
  return {
    state: plausible ? ('compatible' as const) : ('rejected' as const),
    score,
    detail: `Riot game_datetime has unspecified start/end semantics; nearest lock delta ${minutes(lockDelta).toFixed(1)} min${ended === null ? '' : `, nearest end delta ${minutes(endDelta).toFixed(1)} min`}.`,
  };
}

export function rankReconciliationCandidates(
  chain: SessionChain,
  matches: CompletedMatch[],
  accountPuuid: string,
  platform: string,
): ReconciliationCandidate[] {
  return matches
    .flatMap((match): ReconciliationCandidate[] => {
      const participant = match.participants.find((entry) => entry.puuid === accountPuuid);
      if (
        !participant ||
        match.set !== chain.terminal.snapshot.playbook.set ||
        match.modeSupport === 'unsupported'
      )
        return [];
      const timing = timingEvidence(chain, match);
      if (timing.state === 'rejected') return [];
      const platformMatch = match.id
        .toLocaleUpperCase('en-US')
        .startsWith(`${platform.toLocaleUpperCase('en-US')}_`);
      const modeScore = match.modeSupport === 'supported' ? 1 : 0.55;
      const score = Math.min(
        1,
        0.4 + 0.2 + 0.2 * timing.score + 0.1 * modeScore + 0.1 * (platformMatch ? 1 : 0.35),
      );
      const timestampSemantics = match.gameTimestampSemantics ?? 'riot-game-datetime-unspecified';
      return [
        {
          matchId: match.id,
          score,
          confidence: score >= 0.86 ? 'high' : score >= 0.75 ? 'medium' : 'low',
          participantPuuid: accountPuuid,
          placement: participant.placement,
          gameTimestamp: match.gameTimestamp,
          gameDurationSeconds: match.gameDurationSeconds ?? null,
          timestampSemantics,
          evidence: [
            {
              key: 'account',
              state: 'matched',
              weight: 0.4,
              detail: 'Resolved PUUID is present in the immutable match payload.',
            },
            {
              key: 'set',
              state: 'matched',
              weight: 0.2,
              detail: `Match and terminal plan are Set ${match.set}.`,
            },
            {
              key: 'timing',
              state: timing.state,
              weight: 0.2,
              detail: timing.detail,
            },
            {
              key: 'mode',
              state: match.modeSupport === 'supported' ? 'matched' : 'unverified',
              weight: 0.1,
              detail:
                match.modeSupport === 'supported'
                  ? 'Normalized mode is supported.'
                  : 'Normalized mode compatibility is unverified.',
            },
            {
              key: 'platform',
              state: platformMatch ? 'matched' : 'unverified',
              weight: 0.1,
              detail: platformMatch
                ? 'Match ID prefix matches the configured platform.'
                : 'Match ID does not expose matching platform evidence.',
            },
          ],
          reasons: [
            'Exact account participation and set compatibility are required.',
            timing.detail,
            ...(match.modeSupport === 'unverified' ? ['Queue/mode support is unverified.'] : []),
          ],
        },
      ];
    })
    .filter((candidate) => candidate.score >= POST_GAME_RECONCILIATION.candidateThreshold)
    .sort((a, b) => b.score - a.score || a.matchId.localeCompare(b.matchId));
}

export function reconcileCandidateCheck(
  chain: SessionChain,
  matches: CompletedMatch[],
  accountPuuid: string,
  platform: string,
  now = new Date().toISOString(),
  previous?: MatchReconciliation | null,
): MatchReconciliation {
  if (previous?.state === 'matched') return previous;
  const candidates = rankReconciliationCandidates(chain, matches, accountPuuid, platform);
  const first = candidates[0];
  const second = candidates[1];
  const automatic = Boolean(
    first &&
      first.score >= POST_GAME_RECONCILIATION.automaticThreshold &&
      (!second || first.score - second.score >= POST_GAME_RECONCILIATION.automaticMargin),
  );
  const state = automatic
    ? 'matched'
    : candidates.length > 1
      ? 'ambiguous'
      : candidates.length
        ? 'candidate'
        : 'unmatched';
  return {
    schemaVersion: 1,
    modelVersion: POST_GAME_RECONCILIATION.version,
    chainId: chain.id,
    sessionIds: chain.sessions.map((session) => session.id),
    terminalSessionId: chain.terminal.id,
    state,
    matchId: automatic ? first!.matchId : null,
    candidates,
    accountPuuid,
    platform,
    checkedAt: now,
    decidedAt: automatic ? now : null,
    decision: automatic ? 'automatic' : null,
    audit: [
      ...(previous?.audit ?? []),
      {
        at: now,
        action: 'checked',
        matchId: null,
        note: `${candidates.length} plausible completed match candidate(s).`,
      },
      ...(automatic
        ? [
            {
              at: now,
              action: 'auto-matched' as const,
              matchId: first!.matchId,
              note: 'Unique candidate cleared the score and margin gates.',
            },
          ]
        : []),
    ],
  };
}

export function decideReconciliation(
  reconciliation: MatchReconciliation,
  action: 'confirm' | 'reject' | 'unlink',
  matchId: string | null,
  now = new Date().toISOString(),
): MatchReconciliation {
  if (action === 'confirm') {
    if (!matchId || !reconciliation.candidates.some((candidate) => candidate.matchId === matchId))
      throw new Error('Only a ranked candidate can be confirmed.');
    return {
      ...reconciliation,
      state: 'matched',
      matchId,
      decidedAt: now,
      decision: 'manual',
      audit: [
        ...reconciliation.audit,
        {
          at: now,
          action: 'confirmed',
          matchId,
          note: 'User explicitly confirmed this candidate.',
        },
      ],
    };
  }
  if (action === 'reject')
    return {
      ...reconciliation,
      state: 'rejected',
      matchId: null,
      decidedAt: now,
      decision: 'rejected',
      audit: [
        ...reconciliation.audit,
        {
          at: now,
          action: 'rejected',
          matchId,
          note: 'User explicitly rejected the proposed match link.',
        },
      ],
    };
  if (reconciliation.state !== 'matched')
    throw new Error('Only a matched reconciliation can be unlinked.');
  return {
    ...reconciliation,
    state: 'unmatched',
    matchId: null,
    decidedAt: now,
    decision: null,
    candidates: [],
    audit: [
      ...reconciliation.audit,
      {
        at: now,
        action: 'unlinked',
        matchId: reconciliation.matchId,
        note: 'User explicitly removed the match link.',
      },
    ],
  };
}

export function derivePostGameReview(
  chain: SessionChain,
  reconciliation: MatchReconciliation,
  match: CompletedMatch,
  families: Playbook[],
  now = new Date().toISOString(),
): PostGameReview {
  if (reconciliation.state !== 'matched' || reconciliation.matchId !== match.id)
    throw new Error('A review requires a matched reconciliation.');
  const terminal = chain.terminal;
  const data: StaticData = terminal.snapshot.staticData;
  const participant = match.participants.find(
    (entry) => entry.puuid === reconciliation.accountPuuid,
  );
  if (!participant) throw new Error('The reconciled participant is absent from the match.');
  const compatibleFamilies = families.filter((family) => family.set === match.set);
  const classification = classifyFinalBoard(participant, compatibleFamilies, data);
  const finalCanonical = canonicalizeFinalBoard(participant, match.set, data);
  const targetCanonical = canonicalizeBoard(terminal.snapshot.playbook.target, data);
  const similarity =
    finalCanonical.board && targetCanonical.board
      ? compareCanonicalBoards(targetCanonical.board, finalCanonical.board)
      : null;
  const finalIds = new Set(participant.units.map((unit) => unit.championId));
  const targetIds = new Set(terminal.snapshot.playbook.target.units.map((unit) => unit.championId));
  const selectedCorePresent = terminal.snapshot.playbook.family.core.filter((id) =>
    finalIds.has(id),
  );
  const selectedCoreMissing = terminal.snapshot.playbook.family.core.filter(
    (id) => !finalIds.has(id),
  );
  const finalUnitsAdded = [...finalIds].filter((id) => !targetIds.has(id)).sort();
  const linkedPivotFamilies = new Set(
    terminal.snapshot.playbook.pivots.flatMap((pivot) => {
      const destination = terminal.snapshot.portfolio.plans.find(
        (plan) => plan.candidate.playbook.id === pivot.destination,
      );
      return destination ? [destination.candidate.playbook.family.id] : [];
    }),
  );
  const relationState =
    classification.state !== 'classified'
      ? 'unknown'
      : classification.familyId === terminal.selectedFamilyId
        ? 'same-family'
        : classification.familyId && linkedPivotFamilies.has(classification.familyId)
          ? 'pivot-destination'
          : 'other-family';
  const metaIdentity = terminal.snapshot.evidence.aggregateMeta;
  const stat = terminal.snapshot.evidence.metaFamilyStats.find(
    (entry) => entry.familyId === classification.familyId && entry.quality === 'eligible',
  );
  const baselineAvailable = Boolean(
    stat && metaIdentity && match.set === terminal.snapshot.playbook.set,
  );
  const baseline = baselineAvailable
    ? {
        state: 'available' as const,
        familyId: stat!.familyId,
        datasetId: metaIdentity!.datasetId,
        derivationFingerprint: metaIdentity!.derivationFingerprint,
        games: stat!.games,
        confidence: stat!.confidence,
        expectedPlacement: stat!.shrunkAveragePlacement,
        placementResidual: stat!.shrunkAveragePlacement - participant.placement,
        expectedTopFour: stat!.topFour.shrunk,
        note: 'Compatible lock-time M5 family baseline; residual is expected placement minus observed placement.',
      }
    : {
        state: 'unavailable' as const,
        familyId: classification.familyId,
        datasetId: null,
        derivationFingerprint: null,
        games: 0,
        confidence: 0,
        expectedPlacement: null,
        placementResidual: null,
        expectedTopFour: null,
        note: 'No compatible, eligible lock-time M5 family baseline is available.',
      };
  const itemIds = participant.units.flatMap((unit) => unit.items);
  const knownItems = new Set(data.items.map((item) => item.id));
  const knownAugments = new Set(
    data.augments.filter((augment) => augment.presentInExport).map((augment) => augment.id),
  );
  const itemEvidence = participant.units.every(
    (unit) => unit.unresolvedItems.length === 0 && unit.items.every((id) => knownItems.has(id)),
  )
    ? 'validated'
    : 'unavailable';
  const augmentEvidence =
    participant.unresolvedAugmentIds.length === 0 &&
    participant.augmentIds.every((id) => knownAugments.has(id))
      ? 'validated'
      : 'unavailable';
  const attributionConfidence =
    classification.state === 'classified' &&
    classification.familyId === terminal.selectedFamilyId &&
    similarity
      ? Math.min(
          1,
          0.45 * classification.score +
            0.25 * Math.min(1, classification.margin / 0.2) +
            0.3 * similarity.value,
        )
      : 0;
  const attributionEligible = baseline.state === 'available' && attributionConfidence >= 0.65;
  const evidenceGaps = [
    ...(finalCanonical.state === 'invalid' ? finalCanonical.reasons : []),
    ...(itemEvidence === 'unavailable'
      ? ['Final item IDs could not all be validated against the saved static snapshot.']
      : []),
    ...(augmentEvidence === 'unavailable'
      ? ['Final augment IDs could not all be validated against the saved static snapshot.']
      : []),
    ...(baseline.state === 'unavailable' ? [baseline.note] : []),
    'Completed-match data does not expose shop, bench, exact economy, round-by-round positioning, or acquisition opportunities.',
  ];
  const relationText =
    relationState === 'same-family'
      ? `The final board classified as the terminal ${terminal.snapshot.playbook.title} family.`
      : classification.state === 'classified'
        ? `The final board classified as ${classification.familyId}; it was not attributed to the terminal selected family.`
        : `The final board classification remained ${classification.state}; no family outcome was attributed.`;
  const suffix =
    participant.placement === 1
      ? 'st'
      : participant.placement === 2
        ? 'nd'
        : participant.placement === 3
          ? 'rd'
          : 'th';
  const summary = [
    `${participant.placement}${suffix} place · terminal plan ${terminal.snapshot.playbook.title}.`,
    ...(chain.sessions.length > 1
      ? [
          `Switch chain: ${chain.sessions.map((session) => session.snapshot.playbook.title).join(' → ')}. Result attribution uses only the terminal route.`,
        ]
      : []),
    relationText,
    `${selectedCorePresent.length}/${terminal.snapshot.playbook.family.core.length} selected core units were present in the final board${selectedCoreMissing.length ? `; ${selectedCoreMissing.length} were absent` : ''}.`,
    ...(similarity
      ? [
          `Selected target versus final-board structural similarity: ${Math.round(similarity.value * 100)}%.`,
        ]
      : []),
    ...(baseline.state === 'available'
      ? [
          `Placement was ${Math.abs(baseline.placementResidual!).toFixed(1)} places ${baseline.placementResidual! >= 0 ? 'better than' : 'below'} the compatible ${baseline.expectedPlacement!.toFixed(2)} family baseline.`,
        ]
      : []),
  ];
  const adjustment =
    selectedCoreMissing.length >= 2 && similarity && similarity.value >= 0.72
      ? `Final board evidence omitted ${selectedCoreMissing.length} source-defined core units while remaining structurally close to the terminal route; review that target-board transition.`
      : 'No evidence-backed adjustment identified.';
  const derivationFingerprint = stableFingerprint({
    reviewVersion: POST_GAME_REVIEW_VERSION,
    matchId: match.id,
    terminalSnapshot: terminal.snapshotFingerprint,
    classifierVersion: COMP_CLASSIFIER.version,
    canonicalVersion: CANONICAL_BOARD_MODEL.version,
    similarityVersion: BOARD_SIMILARITY_MODEL.version,
    baseline: baseline.derivationFingerprint,
  });
  return {
    schemaVersion: 1,
    reviewVersion: POST_GAME_REVIEW_VERSION,
    id: `${chain.id}:${match.id}:${derivationFingerprint}`,
    chainId: chain.id,
    sessionIds: chain.sessions.map((session) => session.id),
    terminalSessionId: terminal.id,
    matchId: match.id,
    set: match.set,
    createdAt: now,
    matchFingerprint: stableFingerprint(match),
    staticFingerprint: staticSetCompatibilityFingerprint(data),
    selectedTargetFingerprint: terminal.snapshot.strategy.targetBoardFingerprint,
    classifierVersion: COMP_CLASSIFIER.version,
    canonicalModelVersion: CANONICAL_BOARD_MODEL.version,
    similarityModelVersion: BOARD_SIMILARITY_MODEL.version,
    participant: {
      puuid: participant.puuid,
      placement: participant.placement,
      level: participant.level,
      augmentIds: [...participant.augmentIds],
      augmentEvidence,
      itemIds,
      itemEvidence,
    },
    selectedPlan: {
      playbookId: terminal.selectedPlaybookId,
      familyId: terminal.selectedFamilyId,
      title: terminal.snapshot.playbook.title,
    },
    switchChain: chain.sessions.map((session) => ({
      sessionId: session.id,
      playbookId: session.selectedPlaybookId,
      familyId: session.selectedFamilyId,
      title: session.snapshot.playbook.title,
    })),
    relation: {
      state: finalCanonical.state === 'invalid' ? 'unavailable' : relationState,
      classification,
      canonicalFinal: finalCanonical.board,
      canonicalTarget: targetCanonical.board,
      similarity,
      selectedCorePresent,
      selectedCoreMissing,
      finalUnitsAdded,
      targetCapacity: terminal.snapshot.playbook.target.capacity,
      finalBoardSize: finalCanonical.board?.boardSize ?? null,
    },
    baseline,
    summary,
    adjustment,
    evidenceGaps,
    attribution: {
      eligible: attributionEligible,
      familyId: attributionEligible ? terminal.selectedFamilyId : null,
      confidence: attributionConfidence,
      reasons: attributionEligible
        ? [
            'Final board confidently classified as the terminal family and has a compatible M5 baseline.',
          ]
        : [
            'Family attribution requires a confident terminal-family match and compatible M5 baseline.',
          ],
    },
    derivationFingerprint,
  };
}

/** Backward-compatible M1 summary. M9 callers use the versioned review model above. */
export function summarizeCompletedMatch(
  match: CompletedMatch,
  puuid: string,
  playbook: Playbook,
  selection?: SelectedPlan,
): PostGameSummary {
  const player = match.participants.find((participant) => participant.puuid === puuid);
  if (!player) throw new Error('Player absent from completed match');
  const sameSet = match.set === playbook.set;
  const found = playbook.family.core.filter((id) =>
    player.units.some((unit) => unit.championId === id),
  ).length;
  return {
    matchId: match.id,
    selectedPlanId: selection?.id,
    placement: player.placement,
    observations: sameSet
      ? [`Final board contains ${found} of ${playbook.family.core.length} intended core units.`]
      : ['Selected plan is from a different set; comparison unavailable.'],
    possibleMismatches:
      sameSet && found < playbook.family.core.length
        ? ['Final board differs from the selected core. This may reflect an intentional pivot.']
        : [],
    nextAdjustment:
      'Review the final board alongside your selected playbook; completed history cannot explain every decision.',
    provenance: {
      source: match.source,
      fetchedAt: match.completedAt,
      patch: match.tftContentPatch,
      status: 'verified',
      note: 'End-state comparison only; no causal attribution.',
    },
  };
}
