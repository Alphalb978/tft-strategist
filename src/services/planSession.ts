import {
  candidatePlannerCode,
  teamPlanner,
  TEAM_PLANNER_CONTRACT_VERSION,
} from '../rules/teamPlanner';
import {
  planSessionSnapshotFingerprint,
  staticSetCompatibilityFingerprint,
} from '../domain/fingerprint';
import type { ApplicationState } from './application';
import type {
  LobbyPressure,
  PlanSession,
  PlanSessionCompatibility,
  PlanSessionManualState,
  RecommendationPortfolio,
  SelectedPlan,
  StaticData,
} from '../domain/models';
import { PLAN_SESSION_SCHEMA_VERSION } from '../domain/models';
import { validatePlaybook } from '../rules/validation';
import type { Repository } from '../storage/repository';
import { traverseDecisionMap } from '../strategy/playbookIntelligence';

export const PLAN_SESSION_VERSION = 'match-plan-session-v1';

const clone = <T>(value: T): T => structuredClone(value);

export function isPlanSession(value: unknown): value is PlanSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PlanSession>;
  return (
    session.schemaVersion === PLAN_SESSION_SCHEMA_VERSION &&
    typeof session.id === 'string' &&
    (session.state === 'active' || session.state === 'ended') &&
    typeof session.selectedPlaybookId === 'string' &&
    typeof session.snapshotFingerprint === 'string' &&
    Boolean(
      session.snapshot?.playbook && session.snapshot?.candidate && session.snapshot?.portfolio,
    )
  );
}

export function snapshotFingerprint(session: Pick<PlanSession, 'snapshot'>) {
  return planSessionSnapshotFingerprint(session.snapshot);
}

export function snapshotIsIntact(session: PlanSession) {
  return snapshotFingerprint(session) === session.snapshotFingerprint;
}

export function evaluatePlanSessionCompatibility(
  session: PlanSession,
  data: StaticData,
  state: Pick<ApplicationState, 'registry'>,
  evaluatedAt = new Date().toISOString(),
): PlanSessionCompatibility {
  const reasons: string[] = [];
  const selected = session.snapshot.playbook;
  const current = state.registry.find((entry) => entry.id === session.snapshot.registry.id);
  if (!snapshotIsIntact(session)) reasons.push('The immutable lock snapshot fingerprint changed.');
  if (data.version.set !== selected.set) reasons.push('The active set changed.');
  if (staticSetCompatibilityFingerprint(data) !== session.snapshot.staticCompatibilityFingerprint)
    reasons.push('The active static-data fingerprint changed.');
  if (!current) reasons.push('The locked registry entry is not available in current data.');
  else {
    if (current.structuralFingerprint !== session.snapshot.registry.structuralFingerprint)
      reasons.push('The registry board fingerprint changed.');
    if (
      current.playbook.strategy.guidanceVersion !== session.snapshot.strategy.guidanceVersion ||
      current.playbook.strategy.targetBoardFingerprint !==
        session.snapshot.strategy.targetBoardFingerprint ||
      current.playbook.strategy.registryFingerprint !==
        session.snapshot.strategy.registryFingerprint
    )
      reasons.push('The strategy guidance target or version changed.');
    if (current.playbook.strategy.freshness.state !== 'current')
      reasons.push('Current strategy guidance is stale.');
  }
  return { state: reasons.length ? 'stale' : 'current', evaluatedAt, reasons };
}

function initialManualState(playbookId: string, portfolio: RecommendationPortfolio, now: string) {
  const playbook = portfolio.plans.find((plan) => plan.candidate.playbook.id === playbookId)!
    .candidate.playbook;
  return {
    stageId: playbook.strategy.stages.at(-1)?.id ?? null,
    decisionNodeId: playbook.strategy.decisionMap.rootNodeId,
    decisionPathEdgeIds: [],
    pivotTargetId: null,
    updatedAt: now,
  } satisfies PlanSessionManualState;
}

export function createPlanSession(
  playbookId: string,
  state: ApplicationState,
  portfolio: RecommendationPortfolio,
  lobby: LobbyPressure | null,
  now = new Date().toISOString(),
  id: string = crypto.randomUUID(),
  replacesSessionId: string | null = null,
): PlanSession {
  const selectedRank = portfolio.plans.findIndex(
    (plan) => plan.candidate.playbook.id === playbookId,
  );
  if (selectedRank < 0) throw new Error('Plan is not in this portfolio.');
  const candidate = portfolio.plans[selectedRank].candidate;
  const registry = state.registry.find((entry) => entry.playbook.id === playbookId);
  if (!registry) throw new Error('Plan is not in the validated comp registry.');
  const errors = validatePlaybook(candidate.playbook, state.data).filter(
    (issue) => issue.severity === 'error',
  );
  if (errors.length)
    throw new Error(
      `Plan is not legal at lock time: ${errors.map((issue) => issue.message).join(' ')}`,
    );
  if (candidate.playbook.strategy.freshness.state !== 'current')
    throw new Error('Plan strategy guidance is stale and cannot be locked.');
  const portfolioFamilyIds = new Set(
    portfolio.plans.map((plan) => plan.candidate.playbook.family.id),
  );
  const portfolioClusterIds = new Set(
    portfolio.plans.flatMap((plan) =>
      plan.candidate.playbook.discovery?.clusterId
        ? [plan.candidate.playbook.discovery.clusterId]
        : [],
    ),
  );
  const snapshot = clone({
    playbook: candidate.playbook,
    candidate,
    portfolio,
    selectedRank: selectedRank + 1,
    portfolioCandidateIds: portfolio.plans.map((plan) => plan.candidate.playbook.id),
    registry: {
      id: registry.id,
      sourceKind: registry.sourceKind,
      lifecycle: registry.lifecycle,
      structuralFingerprint: registry.structuralFingerprint,
    },
    staticData: state.data,
    staticCompatibilityFingerprint: staticSetCompatibilityFingerprint(state.data),
    strategy: {
      schemaVersion: candidate.playbook.strategy.schemaVersion,
      guidanceVersion: candidate.playbook.strategy.guidanceVersion,
      status: candidate.playbook.strategy.freshness.state,
      staticSourceFingerprint: candidate.playbook.strategy.staticSourceFingerprint,
      targetBoardFingerprint: candidate.playbook.strategy.targetBoardFingerprint,
      registryFingerprint: candidate.playbook.strategy.registryFingerprint,
    },
    evidence: {
      aggregateMeta: state.meta
        ? {
            datasetId: state.meta.id,
            derivationFingerprint: state.meta.derivationFingerprint,
            sampleDefinitionFingerprint: state.meta.sampleDefinitionFingerprint,
            collectedAt: state.meta.collectedAt,
          }
        : null,
      metaFamilyStats:
        state.meta?.familyStats.filter((stat) => portfolioFamilyIds.has(stat.familyId)) ?? [],
      discovery: state.discovery
        ? {
            datasetId: state.discovery.id,
            derivationFingerprint: state.discovery.derivationFingerprint,
            sampleDefinitionFingerprint: state.discovery.sampleDefinitionFingerprint,
            generatedAt: state.discovery.generatedAt,
          }
        : null,
      discoveryClusters:
        state.discovery?.clusters.filter((cluster) => portfolioClusterIds.has(cluster.id)) ?? [],
      lobby: lobby
        ? {
            state: lobby.state,
            coverage: lobby.coverage,
            expectedOpponents: lobby.expectedOpponents,
            resolvedOpponents: lobby.resolvedOpponents,
            relevantGamesAvailable: lobby.relevantGamesAvailable,
            relevantGamesTarget: lobby.relevantGamesTarget,
            unitPressureVersion: lobby.unitPressureVersion,
            fetchedAt: lobby.fetchedAt,
          }
        : null,
    },
    teamPlanner: (() => {
      const code = candidatePlannerCode(candidate.playbook.target, state.data);
      const support = teamPlanner.supportStatus(state.data.version);
      return code.ok && support.state === 'supported'
        ? {
            codecVersion: TEAM_PLANNER_CONTRACT_VERSION,
            set: state.data.version.set,
            code: code.value,
            fixtureIds: support.knownGoodFixtureIds,
            manualPasteVerifiedAt: '2026-09-06',
          }
        : null;
    })(),
  });
  const partial = {
    schemaVersion: PLAN_SESSION_SCHEMA_VERSION,
    id,
    state: 'active' as const,
    lockedAt: now,
    endedAt: null,
    endReason: null,
    replacesSessionId,
    replacedBySessionId: null,
    selectedPlaybookId: candidate.playbook.id,
    selectedFamilyId: candidate.playbook.family.id,
    accountContext: state.settings.riotId
      ? { riotId: state.settings.riotId, platform: state.settings.riotPlatform }
      : null,
    snapshot,
    snapshotFingerprint: '',
    manualState: initialManualState(playbookId, portfolio, now),
    compatibility: { state: 'current' as const, evaluatedAt: now, reasons: [] },
    reconciliation: { matchId: null },
  };
  return { ...partial, snapshotFingerprint: snapshotFingerprint(partial) };
}

export function updateManualState(
  session: PlanSession,
  change: Partial<
    Pick<
      PlanSessionManualState,
      'stageId' | 'decisionNodeId' | 'decisionPathEdgeIds' | 'pivotTargetId'
    >
  >,
  now = new Date().toISOString(),
): PlanSession {
  if (session.state !== 'active') throw new Error('Only an active session can be updated.');
  const manualState = { ...session.manualState, ...change, updatedAt: now };
  const playbook = session.snapshot.playbook;
  if (
    manualState.stageId !== null &&
    !playbook.strategy.stages.some((stage) => stage.id === manualState.stageId)
  )
    throw new Error('Manual stage is not part of the locked playbook.');
  let decisionNodeId = playbook.strategy.decisionMap.rootNodeId;
  for (const edgeId of manualState.decisionPathEdgeIds) {
    if (!decisionNodeId) throw new Error('Decision path cannot continue without a root node.');
    const next = traverseDecisionMap(playbook.strategy.decisionMap, decisionNodeId, edgeId);
    if (!next) throw new Error('Decision path is not valid for the locked playbook.');
    decisionNodeId = next.id;
  }
  if (manualState.decisionNodeId !== decisionNodeId)
    throw new Error('Decision node does not match the persisted Decision Map path.');
  if (
    manualState.pivotTargetId !== null &&
    !session.snapshot.portfolioCandidateIds.includes(manualState.pivotTargetId)
  )
    throw new Error('Pivot target is not part of the locked portfolio.');
  return clone({
    ...session,
    manualState,
  });
}

export function endSessionRecord(
  session: PlanSession,
  reason: PlanSession['endReason'],
  now: string,
  replacedBySessionId: string | null = null,
): PlanSession {
  if (session.state !== 'active') throw new Error('Only an active session can end.');
  return clone({
    ...session,
    state: 'ended',
    endedAt: now,
    endReason: reason,
    replacedBySessionId,
  });
}

export function upgradeLegacySelection(
  legacy: SelectedPlan,
  state: ApplicationState,
  now = legacy.selectedAt,
): PlanSession | null {
  if (!legacy.snapshot?.plans?.some((plan) => plan.candidate.playbook.id === legacy.playbookId))
    return null;
  try {
    return createPlanSession(legacy.playbookId, state, legacy.snapshot, null, now, legacy.id);
  } catch {
    return null;
  }
}

export async function persistCompatibility(
  repository: Repository,
  session: PlanSession,
  compatibility: PlanSessionCompatibility,
) {
  const updated = clone({ ...session, compatibility });
  await repository.updatePlanSession(updated);
  return updated;
}
