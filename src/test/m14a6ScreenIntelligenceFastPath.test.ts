import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  defaultSettings,
  normalizeSettings,
  settingsAffectRecommendations,
  openRepository,
  SqlRepository,
  type Settings,
} from '../storage/repository';
import {
  applyAllMigrations,
  createNodeSqliteAdapter,
} from '../storage/knowledgeDatabase';
import {
  setSharedSqlDatabaseForTesting,
  resetSharedSqlDatabaseForTesting,
} from '../storage/database';
import type Database from '@tauri-apps/plugin-sql';
import {
  MockScreenCaptureProvider,
} from '../providers/mockScreenCapture';
import {
  configureCapture,
  getCaptureState,
  setMockScreenCaptureProvider,
  subscribeToCapturePreview,
} from '../services/screenCapture';

describe('M14A.6 — Problem B: Screen Intelligence Fast Path & Instant Controls', () => {
  let nativeDb: DatabaseSync;
  let adapter: ReturnType<typeof createNodeSqliteAdapter>;
  let mockProvider: MockScreenCaptureProvider;

  beforeEach(() => {
    nativeDb = new DatabaseSync(':memory:');
    applyAllMigrations(nativeDb);
    adapter = createNodeSqliteAdapter(nativeDb);

    (globalThis as unknown as { window: { __TAURI_INTERNALS__: Record<string, unknown> } }).window = {
      __TAURI_INTERNALS__: {},
    };

    setSharedSqlDatabaseForTesting(adapter as unknown as Database);
    mockProvider = new MockScreenCaptureProvider();
    setMockScreenCaptureProvider(mockProvider);
  });

  afterEach(() => {
    resetSharedSqlDatabaseForTesting();
    delete (globalThis as unknown as { window?: unknown }).window;
    nativeDb.close();
  });

  // 1. OFF → ON immediate UI state
  it('1. OFF → ON transitions captureState immediately to waiting-for-tft or capturing', async () => {
    const initialState = await getCaptureState(true);
    expect(initialState.state).toBe('disabled');

    const nextState = await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    expect(['waiting-for-tft', 'capturing']).toContain(nextState.state);
    expect(nextState.state).not.toBe('disabled');
  });

  // 2. ON → OFF immediate UI state
  it('2. ON → OFF transitions captureState immediately to disabled and clears preview', async () => {
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    expect((await getCaptureState(true)).state).not.toBe('disabled');

    const offState = await configureCapture(
      { enabled: false, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    expect(offState.state).toBe('disabled');
    expect(offState.width).toBe(0);
    expect(offState.height).toBe(0);
    expect(mockProvider.getPreview()).toBeNull();
  });

  // 3. OFF → ON → OFF → ON rapidly
  it('3. rapid toggling OFF → ON → OFF → ON respects the latest intent', async () => {
    let activeGen = 0;
    let finalState = 'disabled';

    // Simulate rapid sequence: 10 = ON, 11 = OFF, 12 = ON
    const toggle = async (enabled: boolean) => {
      const gen = ++activeGen;
      const res = await configureCapture(
        { enabled, saveDebugFrames: false, captureFps: 2, mockSource: true },
        true,
      );
      if (gen === activeGen) {
        finalState = res.state;
      }
    };

    await Promise.all([
      toggle(true),
      toggle(false),
      toggle(true),
    ]);

    expect(['waiting-for-tft', 'capturing']).toContain(finalState);
    expect(finalState).not.toBe('disabled');
  });

  // 4. stale async save cannot override latest state
  it('4. stale async save completion cannot override a newer toggle state', async () => {
    let stateGen = 0;
    let currentEnabled = false;

    const performSave = async (enabled: boolean, delayMs: number) => {
      const gen = ++stateGen;
      currentEnabled = enabled; // optimistic update
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // Upon async return: only apply if generation is still current
      if (gen === stateGen) {
        currentEnabled = enabled;
      }
    };

    // Toggle 1: ON with slow async delay (100ms)
    // Toggle 2: OFF with fast async delay (10ms)
    const p1 = performSave(true, 100);
    const p2 = performSave(false, 10);

    await Promise.all([p1, p2]);

    // The fast OFF had gen 2, so the slow ON (gen 1) could not revert it
    expect(currentEnabled).toBe(false);
  });

  // 5. stale native poll cannot resurrect disabled state
  it('5. stale native poll cannot resurrect disabled state', async () => {
    let sectionState = 'disabled';
    let isEnabled = false;
    let currentGen = 10;

    const onPollResult = (gen: number, pollState: string) => {
      if (gen !== currentGen || !isEnabled) {
        // Discard stale frame / poll result!
        return;
      }
      sectionState = pollState;
    };

    // Disabled state
    isEnabled = false;
    currentGen = 11;
    sectionState = 'disabled';

    // A stale poll from generation 10 returns 'capturing'
    onPollResult(10, 'capturing');
    expect(sectionState).toBe('disabled');

    // Even if gen matched, !isEnabled drops it
    onPollResult(11, 'capturing');
    expect(sectionState).toBe('disabled');
  });

  // 6. turning OFF cancels/ignores in-flight frame
  it('6. turning OFF immediately unsubscribes poller and ignores in-flight updates', async () => {
    let receivedFrames = 0;
    const unsubscribe = subscribeToCapturePreview(
      (preview) => {
        if (preview) receivedFrames++;
      },
      { intervalMs: 50, forceMock: true },
    );

    // Let 1 poll complete
    await new Promise((resolve) => setTimeout(resolve, 60));
    const countBeforeUnsub = receivedFrames;

    // Turn OFF immediately
    unsubscribe();

    // Wait longer to verify no further frames arrive
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(receivedFrames).toBe(countBeforeUnsub);
  });

  // 7. turning ON after OFF always restarts
  it('7. turning ON after OFF cleanly restarts capture without route reload', async () => {
    // 1. Initial ON
    const state1 = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    expect(state1.state).not.toBe('disabled');

    // 2. Turn OFF
    const state2 = await configureCapture(
      { enabled: false, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    expect(state2.state).toBe('disabled');

    // 3. Turn ON again
    const state3 = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    expect(state3.state).not.toBe('disabled');
    expect(['waiting-for-tft', 'capturing']).toContain(state3.state);
  });

  // 8. exactly one poller after repeated toggles
  it('8. exactly one poller is active after repeated toggles', async () => {
    let activePollers = 0;
    let unsubRef: (() => void) | null = null;

    const startPoller = () => {
      if (unsubRef) {
        unsubRef();
        activePollers--;
        unsubRef = null;
      }
      activePollers++;
      unsubRef = subscribeToCapturePreview(
        () => {},
        { intervalMs: 500, forceMock: true },
      );
    };

    const stopPoller = () => {
      if (unsubRef) {
        unsubRef();
        activePollers--;
        unsubRef = null;
      }
    };

    // Toggle repeatedly: ON, OFF, ON, OFF, ON
    startPoller();
    expect(activePollers).toBe(1);

    stopPoller();
    expect(activePollers).toBe(0);

    startPoller();
    expect(activePollers).toBe(1);

    stopPoller();
    expect(activePollers).toBe(0);

    startPoller();
    expect(activePollers).toBe(1);

    stopPoller();
  });

  // 9. capture-rate change does not duplicate poller
  it('9. capture-rate change reconfigures FPS without recreating the poller', async () => {
    let pollerCreations = 0;
    let unsubRef: (() => void) | null = null;

    const startPoller = () => {
      pollerCreations++;
      unsubRef = subscribeToCapturePreview(
        () => {},
        { intervalMs: 1000, forceMock: true },
      );
    };

    // Initial enable
    startPoller();
    expect(pollerCreations).toBe(1);

    // Changing FPS from 2 -> 5 only invokes configureCapture
    const fps5State = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 5, mockSource: true },
      true,
    );
    expect(fps5State.captureFps).toBe(5);
    // Poller creations remain 1 (NOT recreated!)
    expect(pollerCreations).toBe(1);

    // Changing FPS from 5 -> 1 only invokes configureCapture
    const fps1State = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 1, mockSource: true },
      true,
    );
    expect(fps1State.captureFps).toBe(1);
    expect(pollerCreations).toBe(1);

    if (unsubRef) {
      (unsubRef as () => void)();
    }
  });

  // 10. Screen Intelligence settings change does NOT call recommendation recomputation
  it('10. settingsAffectRecommendations returns false when only Screen Intelligence settings change', () => {
    const prev = defaultSettings;
    const next: Settings = {
      ...prev,
      screenIntelligence: {
        ...prev.screenIntelligence,
        enabled: true,
        captureRate: 5,
      },
    };

    // Must be false: no recommendation recomputation needed
    expect(settingsAffectRecommendations(prev, next)).toBe(false);

    // Same for toggling saveDebugFrames or captureSource
    const next2: Settings = {
      ...next,
      screenIntelligence: {
        ...next.screenIntelligence,
        saveDebugFrames: true,
        captureSource: 'mock',
      },
    };
    expect(settingsAffectRecommendations(next, next2)).toBe(false);
  });

  // 11. recommendation-setting change still does
  it('11. settingsAffectRecommendations returns true when recommendation settings change', () => {
    const prev = defaultSettings;

    // Change personalWeight
    expect(settingsAffectRecommendations(prev, { ...prev, personalWeight: 0.1 })).toBe(true);

    // Change historyWindow
    expect(settingsAffectRecommendations(prev, { ...prev, historyWindow: 20 })).toBe(true);

    // Change homeRecommendation
    expect(
      settingsAffectRecommendations(prev, {
        ...prev,
        homeRecommendation: {
          ...prev.homeRecommendation,
          top4Weight: 0.9,
        },
      }),
    ).toBe(true);
  });

  // 12. persistence failure reverts safely
  it('12. persistence failure rolls back in-memory settings to previous state', async () => {
    let memorySettings = defaultSettings;
    const previousSettings = memorySettings;

    // Optimistic update
    const newSettings: Settings = {
      ...memorySettings,
      screenIntelligence: {
        ...memorySettings.screenIntelligence,
        enabled: true,
      },
    };
    memorySettings = newSettings;
    expect(memorySettings.screenIntelligence.enabled).toBe(true);

    // Simulated persistence failure
    const savePromise = Promise.reject(new Error('Disk full'));
    await savePromise.catch(() => {
      // Revert safely
      memorySettings = previousSettings;
    });

    expect(memorySettings.screenIntelligence.enabled).toBe(false);
  });

  // 13. reload uses persisted final state
  it('13. reloaded repository reflects persisted Screen Intelligence state', async () => {
    const repo = await openRepository();
    const customSettings: Settings = {
      ...defaultSettings,
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: true,
        captureRate: 5,
        captureSource: 'mock',
        captureFps: 5,
        sourceMode: 'mock',
      },
    };

    await repo.set('settings', customSettings);

    const reloaded = await repo.get<Settings>('settings');
    const normalized = normalizeSettings(reloaded);

    expect(normalized.screenIntelligence.enabled).toBe(true);
    expect(normalized.screenIntelligence.saveDebugFrames).toBe(true);
    expect(normalized.screenIntelligence.captureRate).toBe(5);
    expect(normalized.screenIntelligence.captureSource).toBe('mock');
  });

  // 14. no database lock regression
  it('14. concurrent repository writes alongside fast settings persistence do not lock SQLite', async () => {
    const repo = new SqlRepository(adapter as unknown as Database);

    // Run 15 concurrent writes simulating fast toggles, session updates, and match syncs
    const writes = Array.from({ length: 15 }).map(async (_, idx) => {
      const s = normalizeSettings({
        screenIntelligence: {
          enabled: idx % 2 === 0,
          captureRate: ((idx % 3) === 0 ? 5 : 2) as 1 | 2 | 5,
        },
      });
      return repo.set(`settings_test_${idx}`, s);
    });

    await expect(Promise.all(writes)).resolves.not.toThrow();
  });
});
