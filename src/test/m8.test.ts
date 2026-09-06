import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationState } from '../services/application';
import {
  createRecommendations,
  endPlanSession,
  loadApplication,
  lockPlanSession,
  savePlanSessionManualState,
  switchPlanSession,
} from '../services/application';
import { staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import {
  createPlanSession,
  evaluatePlanSessionCompatibility,
  snapshotIsIntact,
} from '../services/planSession';
import { defaultSettings, MemoryRepository } from '../storage/repository';
import { teamPlanner } from '../rules/teamPlanner';
import { data, NOW } from './fixtures';

afterEach(() => vi.restoreAllMocks());

const appState = (): ApplicationState => ({
  data: structuredClone(data),
  ...createRecommendations(data, defaultSettings, NOW),
  settings: defaultSettings,
  activeSession: null,
  source: 'Bundled snapshot',
  assets: {},
});

describe('M8 selected-plan match workflow', () => {
  it('enforces one active session in the repository, not only the UI', async () => {
    const state = appState();
    const repo = new MemoryRepository();
    const first = createPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      state.portfolio,
      null,
      NOW,
      'session-a',
    );
    const second = createPlanSession(
      state.portfolio.plans[1].candidate.playbook.id,
      state,
      state.portfolio,
      null,
      NOW,
      'session-b',
    );
    await repo.createPlanSession(first);
    await expect(repo.createPlanSession(second)).rejects.toThrow('already exists');
    expect(
      (await repo.listPlanSessions()).filter((session) => session.state === 'active'),
    ).toHaveLength(1);
  });

  it('freezes the exact portfolio, scoring, evidence, static display data, and fingerprint', async () => {
    const state = appState();
    const repo = new MemoryRepository();
    const selectedId = state.portfolio.plans[0].candidate.playbook.id;
    const originalScore = state.portfolio.plans[0].candidate.score;
    const session = await lockPlanSession(selectedId, state, repo, null, NOW);
    state.portfolio.plans[0].candidate.score = 0;
    state.data.items[0].name = 'Later static refresh';
    const stored = (await repo.getActivePlanSession())!;
    expect(stored.snapshot.candidate.score).toBe(originalScore);
    expect(stored.snapshot.staticData.items[0].name).not.toBe('Later static refresh');
    expect(stored.snapshot.portfolio.plans).toHaveLength(3);
    expect(stored.snapshotFingerprint).toBe(session.snapshotFingerprint);
    expect(snapshotIsIntact(stored)).toBe(true);
    const tampered = structuredClone(stored);
    tampered.snapshot.candidate.score = 1;
    await expect(repo.updatePlanSession(tampered)).rejects.toThrow('fingerprint');
  });

  it('keeps lobby/meta/recommendation refreshes outside immutable history', async () => {
    const state = appState();
    const repo = new MemoryRepository();
    const selectedId = state.portfolio.plans[0].candidate.playbook.id;
    await lockPlanSession(selectedId, state, repo, null, NOW);
    const before = await repo.getActivePlanSession();
    const recalculated = createRecommendations(
      state.data,
      { ...state.settings, personalWeight: 0.1 },
      '2026-09-06T12:30:00.000Z',
    );
    expect(recalculated.portfolio.generatedAt).not.toBe(before?.snapshot.portfolio.generatedAt);
    expect((await repo.getActivePlanSession())?.snapshot).toEqual(before?.snapshot);
  });

  it('resumes from local storage after a simulated application restart', async () => {
    const state = appState();
    const repo = new MemoryRepository();
    await repo.set('static', state.data);
    const session = await lockPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      repo,
      null,
      NOW,
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const restarted = await loadApplication(repo);
    expect(restarted.activeSession?.id).toBe(session.id);
    expect(restarted.activeSession?.snapshot.playbook.title).toBe(session.snapshot.playbook.title);
    expect(restarted.activeSession?.compatibility.state).toBe('current');
  });

  it('upgrades the M7 selection pointer once and never resurrects it after end', async () => {
    const state = appState();
    const repo = new MemoryRepository();
    await repo.set('static', state.data);
    await repo.set('selection', {
      id: 'legacy-selection',
      playbookId: state.portfolio.plans[0].candidate.playbook.id,
      set: state.data.version.set,
      patch: state.data.version.patch,
      sourceVersion: state.data.version.sourceVersion,
      selectedAt: NOW,
      snapshot: state.portfolio,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const migrated = await loadApplication(repo);
    expect(migrated.activeSession?.id).toBe('legacy-selection');
    expect(await repo.get('selection')).toBeNull();
    await endPlanSession(migrated, repo, '2026-09-06T12:05:00.000Z');
    const restarted = await loadApplication(repo);
    expect(restarted.activeSession).toBeNull();
    expect(await repo.listPlanSessions()).toHaveLength(1);
  });

  it('switches explicitly, resets manual state, and preserves linked history', async () => {
    const state = appState();
    const repo = new MemoryRepository();
    const first = await lockPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      repo,
      null,
      NOW,
    );
    const withFirst = { ...state, activeSession: first };
    const firstEdge = first.snapshot.playbook.strategy.decisionMap.edges.find(
      (edge) => edge.from === first.snapshot.playbook.strategy.decisionMap.rootNodeId,
    )!;
    const advanced = await savePlanSessionManualState(
      withFirst,
      repo,
      {
        stageId: first.snapshot.playbook.strategy.stages[0].id,
        decisionNodeId: firstEdge.to,
        decisionPathEdgeIds: [firstEdge.id],
      },
      '2026-09-06T12:01:00.000Z',
    );
    const nextId = first.snapshot.portfolio.plans[1].candidate.playbook.id;
    const next = await switchPlanSession(
      nextId,
      { ...state, activeSession: advanced },
      first.snapshot.portfolio,
      repo,
      null,
      '2026-09-06T12:02:00.000Z',
    );
    const history = await repo.listPlanSessions();
    const old = history.find((session) => session.id === first.id)!;
    expect(old).toMatchObject({
      state: 'ended',
      endReason: 'replaced',
      replacedBySessionId: next.id,
    });
    expect(next.replacesSessionId).toBe(first.id);
    expect(next.manualState.decisionPathEdgeIds).toEqual([]);
    expect(next.manualState.pivotTargetId).toBeNull();
    expect(history.filter((session) => session.state === 'active')).toHaveLength(1);
  });

  it('persists valid manual progress and ends without deleting M9 history', async () => {
    const state = appState();
    const repo = new MemoryRepository();
    const active = await lockPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      repo,
      null,
      NOW,
    );
    const root = active.snapshot.playbook.strategy.decisionMap.rootNodeId;
    const updated = await savePlanSessionManualState(
      { ...state, activeSession: active },
      repo,
      { stageId: active.snapshot.playbook.strategy.stages[0].id, decisionNodeId: root },
      '2026-09-06T12:03:00.000Z',
    );
    expect((await repo.getActivePlanSession())?.manualState).toEqual(updated.manualState);
    const ended = await endPlanSession(
      { ...state, activeSession: updated },
      repo,
      '2026-09-06T12:04:00.000Z',
    );
    expect(await repo.getActivePlanSession()).toBeNull();
    expect((await repo.listPlanSessions())[0]).toMatchObject({
      id: ended.id,
      state: 'ended',
      endReason: 'ended-without-result',
      endedAt: '2026-09-06T12:04:00.000Z',
      reconciliation: { matchId: null },
    });
    await expect(
      repo.updatePlanSession({
        ...ended,
        state: 'active',
        endedAt: null,
        endReason: null,
      }),
    ).rejects.toThrow('cannot be reactivated');
  });

  it('preserves a stale snapshot and evaluates compatibility separately', async () => {
    const state = appState();
    const session = createPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      state.portfolio,
      null,
      NOW,
      'stale-session',
    );
    const changed = structuredClone(state.data);
    changed.items[0].name = 'Semantically changed item';
    expect(staticSetCompatibilityFingerprint(changed)).not.toBe(
      session.snapshot.staticCompatibilityFingerprint,
    );
    const current = createRecommendations(changed, state.settings, NOW);
    const compatibility = evaluatePlanSessionCompatibility(session, changed, current, NOW);
    expect(compatibility.state).toBe('stale');
    expect(compatibility.reasons.join(' ')).toContain('static-data fingerprint changed');
    expect(session.snapshot.playbook.title).toBe(state.portfolio.plans[0].candidate.playbook.title);
    expect(snapshotIsIntact(session)).toBe(true);
  });

  it('persists no API credential material and keeps Team Planner fail closed', () => {
    const state = appState() as ApplicationState & { apiKey?: string };
    state.apiKey = 'RGAPI-should-never-be-stored';
    state.settings = { ...state.settings, riotId: 'Strategist#M8' };
    const session = createPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      state.portfolio,
      null,
      NOW,
      'sanitized-session',
    );
    expect(JSON.stringify(session)).not.toContain('RGAPI-');
    expect(session.accountContext).toEqual({ riotId: 'Strategist#M8', platform: 'EUW1' });
    expect(session.snapshot.teamPlanner).toBeNull();
    expect(teamPlanner.supportStatus({ set: 18 })).toMatchObject({
      state: 'unverified',
      manualPasteVerified: false,
    });
    expect(teamPlanner.encode(session.snapshot.playbook.target).ok).toBe(false);
  });
});
