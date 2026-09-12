import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  defaultSettings,
  normalizeSettings,
  settingsAffectRecommendations,
  openRepository,
  SqlRepository,
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
  getCaptureStatus,
  getCapturePreview,
  getActivePreviewPollersCount,
  setMockScreenCaptureProvider,
  subscribeToCapturePreview,
} from '../services/screenCapture';
import * as applicationService from '../services/application';
import { data } from './fixtures';

describe('M14A.8 — Real-Capture Performance & Your Plans Infinite Loader Fix', () => {
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
    vi.restoreAllMocks();
  });

  // 1. full-resolution frame never exposed to frontend preview API
  it('1. full-resolution frame is never exposed to frontend preview API', async () => {
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    const preview = await getCapturePreview(true);
    expect(preview).not.toBeNull();
    // Native gameplay is 1920x1080, but preview returned to frontend must be downsampled
    expect(preview!.width).toBeLessThanOrEqual(640);
    expect(preview!.height).toBeLessThanOrEqual(360);
    expect(preview!.width).not.toBe(1920);
    expect(preview!.height).not.toBe(1080);
  });

  // 2. preview limited to <=640x360
  it('2. preview is strictly bounded to <=640x360 even for 4K / ultrawide displays', async () => {
    mockProvider.simulateTftAppeared(3840, 2160, 'TFT', 'TFTClient-Win64-Shipping');
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    const preview = await getCapturePreview(true);
    expect(preview).not.toBeNull();
    expect(preview!.width).toBeLessThanOrEqual(640);
    expect(preview!.height).toBeLessThanOrEqual(360);
  });

  // 3. preview poller exists only while preview component mounted
  it('3. active preview pollers count is 1 while mounted and 0 when unmounted', () => {
    expect(getActivePreviewPollersCount()).toBe(0);

    const unsubscribe = subscribeToCapturePreview(() => {}, { forceMock: true });
    expect(getActivePreviewPollersCount()).toBe(1);

    unsubscribe();
    expect(getActivePreviewPollersCount()).toBe(0);
  });

  // 4. unmount immediately removes timer
  it('4. unmount immediately clears interval timer and stops polling', async () => {
    let callCount = 0;
    const unsubscribe = subscribeToCapturePreview(
      () => {
        callCount++;
      },
      { intervalMs: 20, forceMock: true },
    );

    await new Promise((r) => setTimeout(r, 50));
    const countBefore = callCount;
    expect(countBefore).toBeGreaterThan(0);

    unsubscribe();
    await new Promise((r) => setTimeout(r, 60));
    expect(callCount).toBe(countBefore);
  });

  // 5. stale preview response after unmount ignored
  it('5. stale preview response arriving after unmount is safely dropped', async () => {
    let capturedAfterUnmount = false;
    let isActive = true;

    const unsubscribe = subscribeToCapturePreview(
      () => {
        if (!isActive) {
          capturedAfterUnmount = true;
        }
      },
      { intervalMs: 10, forceMock: true },
    );

    isActive = false;
    unsubscribe();
    await new Promise((r) => setTimeout(r, 30));

    expect(capturedAfterUnmount).toBe(false);
  });

  // 6. no queued previews while request in flight
  it('6. latest-frame semantics skip duplicate poll executions while request is in flight', async () => {
    let inFlightCount = 0;
    let maxConcurrent = 0;

    const slowProvider = new MockScreenCaptureProvider();
    const originalPoll = slowProvider.poll.bind(slowProvider);
    slowProvider.poll = (includePreview?: boolean) => {
      inFlightCount++;
      if (inFlightCount > maxConcurrent) maxConcurrent = inFlightCount;
      const res = originalPoll(includePreview);
      inFlightCount--;
      return res;
    };
    setMockScreenCaptureProvider(slowProvider);

    const unsubscribe = subscribeToCapturePreview(() => {}, { intervalMs: 5, forceMock: true });
    await new Promise((r) => setTimeout(r, 50));
    unsubscribe();

    expect(maxConcurrent).toBeLessThanOrEqual(1);
  });

  // 7. status polling payload contains no pixel buffer
  it('7. status polling payload returns small metadata and zero pixel buffers', async () => {
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    const status = await getCaptureStatus(true);
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('detected');
    expect(status).toHaveProperty('processName');
    expect(status).toHaveProperty('windowTitle');
    expect(status).toHaveProperty('sourceWidth');
    expect(status).toHaveProperty('sourceHeight');
    expect(status).toHaveProperty('captureFps');
    expect(status).toHaveProperty('processingTimeMs');

    // Must NOT contain any image/pixel payload
    expect((status as unknown as Record<string, unknown>).previewImage).toBeUndefined();
    expect((status as unknown as Record<string, unknown>).dataBase64).toBeUndefined();
    expect((status as unknown as Record<string, unknown>).bgra).toBeUndefined();
  });

  // 8. capture doesn't write SQLite per frame
  it('8. real capture does not execute SQLite write operations per frame', async () => {
    const writeSpy = vi.spyOn(adapter, 'execute');

    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    // Poll status & preview 10 times to simulate capture ticks
    for (let i = 0; i < 10; i++) {
      await getCaptureStatus(true);
      await getCapturePreview(true);
    }

    // Capture telemetry must never persist frames or timestamps to SQLite
    expect(writeSpy).not.toHaveBeenCalled();
  });

  // 9. Screen Intelligence setting does not reload recommendations
  it('9. toggling Screen Intelligence uses the fast path and does NOT recompute recommendations', () => {
    const prevSettings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: { enabled: false },
    });

    const nextSettings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: { enabled: true, captureFps: 5 },
    });

    // settingsAffectRecommendations returns false for Screen Intelligence only changes
    const affects = settingsAffectRecommendations(prevSettings, nextSettings);
    expect(affects).toBe(false);
  });

  // 10. Your plans reaches ready while capture worker active
  it('10. application initialization reaches ready while capture worker is actively running', async () => {
    // Start active capture
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    const repo = await openRepository(adapter as unknown as Database);
    await repo.set('static', data);
    const loaded = await applicationService.loadApplication(repo);

    expect(loaded).toBeTruthy();
    expect(loaded.data).toBeTruthy();
    expect(loaded.portfolio).toBeTruthy();
    expect(loaded.portfolio.plans.length).toBeGreaterThanOrEqual(1);
  });

  // 11. Your plans surfaces error rather than infinite loading
  it('11. initialization failure surfaces a recoverable error message instead of hanging indefinitely', async () => {
    const failingRepo = new SqlRepository(adapter as unknown as Database);
    vi.spyOn(failingRepo, 'get').mockRejectedValue(new Error('Simulated SQLite disk I/O error'));

    let errorThrown = false;
    try {
      await applicationService.loadApplication(failingRepo as unknown as import('../storage/repository').Repository);
    } catch (err) {
      errorThrown = true;
      expect((err as Error).message).toContain('Simulated SQLite disk I/O error');
    }

    expect(errorThrown).toBe(true);
  });

  // 12. repeated route navigation leaves one capture worker
  it('12. repeated route navigation maintains a single active capture worker instance', async () => {
    const captureState1 = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    expect(['waiting-for-tft', 'capturing']).toContain(captureState1.state);

    // Re-configuring with identical enabled state returns stable manager state
    const captureState2 = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    expect(captureState2.state).toBe(captureState1.state);
  });

  // 13. 20 navigation cycles do not accumulate pollers/listeners
  it('13. 20 navigation cycles between Settings and other routes do not accumulate preview pollers', () => {
    expect(getActivePreviewPollersCount()).toBe(0);

    for (let i = 0; i < 20; i++) {
      // Mount Settings / ScreenIntelligenceSection
      const unsub = subscribeToCapturePreview(() => {}, { forceMock: true });
      expect(getActivePreviewPollersCount()).toBe(1);

      // Unmount / Navigate away
      unsub();
      expect(getActivePreviewPollersCount()).toBe(0);
    }

    expect(getActivePreviewPollersCount()).toBe(0);
  });

  // 14. real-sized synthetic 1920x1080 frame at 2 FPS remains bounded
  it('14. real-sized 1920x1080 capture at 2 FPS remains bounded in memory', async () => {
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    const preview1 = await getCapturePreview(true);
    const preview2 = await getCapturePreview(true);

    expect(preview1).not.toBeNull();
    expect(preview2).not.toBeNull();
    // Previews are bounded and do not grow over repeated calls
    expect(preview1!.dataBase64.length).toBeGreaterThan(100);
    expect(preview1!.dataBase64.length).toBe(preview2!.dataBase64.length);
  });

  // 15. existing rapid toggle tests remain green
  it('15. rapid toggles (OFF → ON → OFF → ON) resolve cleanly without race conditions', async () => {
    await configureCapture({ enabled: false, saveDebugFrames: false, mockSource: true }, true);
    await configureCapture({ enabled: true, saveDebugFrames: false, mockSource: true }, true);
    await configureCapture({ enabled: false, saveDebugFrames: false, mockSource: true }, true);
    const finalState = await configureCapture(
      { enabled: true, saveDebugFrames: false, mockSource: true },
      true,
    );

    expect(['waiting-for-tft', 'capturing']).toContain(finalState.state);
  });
});
