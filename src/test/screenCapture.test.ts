import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  defaultSettings,
  defaultScreenIntelligenceSettings,
  normalizeSettings,
  MemoryRepository,
  SqlRepository,
  type Settings,
} from '../storage/repository';
import type Database from '@tauri-apps/plugin-sql';
import { createNodeSqliteAdapter } from '../storage/knowledgeDatabase';
import {
  MockScreenCaptureProvider,
  createDeterministicMockSvg,
} from '../providers/mockScreenCapture';
import {
  configureCapture,
  getCaptureState,
  getLatestPreview,
  pollCapture,
  setMockScreenCaptureProvider,
  subscribeToCapturePreview,
} from '../services/screenCapture';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatMetric,
  ScreenIntelligenceErrorBoundary,
  ScreenIntelligenceSection,
} from '../features/ScreenIntelligenceSection';
import { createRecommendations } from '../services/application';
import { normalizeHomeRecommendationConfig } from '../strategy/homeScoring';
import { data } from './fixtures';

describe('M14A — TFT Screen Intelligence Capture Foundation', () => {
  let mockProvider: MockScreenCaptureProvider;

  beforeEach(() => {
    mockProvider = new MockScreenCaptureProvider();
    setMockScreenCaptureProvider(mockProvider);
  });

  // 1. disabled by default
  it('1. screen intelligence is disabled by default in settings and repository', async () => {
    expect(defaultScreenIntelligenceSettings.enabled).toBe(false);
    expect(defaultSettings.screenIntelligence.enabled).toBe(false);

    const normalized = normalizeSettings({});
    expect(normalized.screenIntelligence.enabled).toBe(false);
    expect(normalized.screenIntelligence.captureFps).toBe(2);
    expect(normalized.screenIntelligence.sourceMode).toBe('auto');

    const repo = new MemoryRepository();
    const loadedSettings = await repo.get<Settings>('settings');
    const effective = normalizeSettings(loadedSettings);
    expect(effective.screenIntelligence.enabled).toBe(false);
  });

  // 2. enabling capture
  it('2. enabling capture transitions state from disabled to waiting-for-tft or capturing', async () => {
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

  // 3. waiting when TFT absent
  it('3. maintains waiting-for-tft state when enabled but TFT window is absent', async () => {
    mockProvider.simulateTftDisappeared();
    const state = await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    expect(state.state).toBe('waiting-for-tft');
    expect(state.width).toBe(0);
    expect(state.height).toBe(0);
    expect(await getLatestPreview(true)).toBeNull();
  });

  // 4. TFT window appears
  it('4. transitions to capturing when TFT window appears', async () => {
    mockProvider.simulateTftDisappeared();
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 3,
        mockSource: true,
      },
      true,
    );
    expect((await getCaptureState(true)).state).toBe('waiting-for-tft');

    mockProvider.simulateTftAppeared(1920, 1080, 'League of Legends (TM) Client');

    const activeState = await getCaptureState(true);
    expect(activeState.state).toBe('capturing');
    expect(activeState.windowTitle).toBe('League of Legends (TM) Client');
    expect(activeState.width).toBe(1920);
    expect(activeState.height).toBe(1080);
  });

  // 5. capture begins
  it('5. capture begins and produces valid frames with timestamp, FPS, and downscaled preview', async () => {
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    const preview = await getLatestPreview(true);
    expect(preview).not.toBeNull();
    // Preview is downscaled to max width 640 for preview UI
    expect(preview!.width).toBe(640);
    expect(preview!.height).toBe(360);
    expect(preview!.timestamp).toBeTruthy();
    expect(preview!.processingTimeMs).toBeGreaterThan(0);
    expect(preview!.dataBase64).toContain('data:image/');

    // Full source resolution is preserved in state
    const state = await getCaptureState(true);
    expect(state.state).toBe('capturing');
    expect(state.width).toBe(1920);
    expect(state.height).toBe(1080);
    expect(state.captureFps).toBe(2);
    expect(state.lastFrameTimestamp).toBeTruthy();
  });

  // 6. TFT window disappears
  it('6. transitions back to waiting-for-tft when TFT window disappears', async () => {
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );
    expect((await getCaptureState(true)).state).toBe('capturing');

    mockProvider.simulateTftDisappeared();

    const state = await getCaptureState(true);
    expect(state.state).toBe('waiting-for-tft');
    expect(state.width).toBe(0);
    expect(state.height).toBe(0);
    expect(await getLatestPreview(true)).toBeNull();
  });

  // 7. capture stops
  it('7. capture stops immediately when disabled', async () => {
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );
    expect((await getCaptureState(true)).state).toBe('capturing');

    const disabledState = await configureCapture(
      {
        enabled: false,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    expect(disabledState.state).toBe('disabled');
    expect(disabledState.captureFps).toBe(0);
    expect(await getLatestPreview(true)).toBeNull();
  });

  // 8. fixture frame dimensions preserved
  it('8. fixture frame dimensions are preserved exactly across resolutions while preview is downscaled', async () => {
    mockProvider.simulateTftAppeared(2560, 1440);
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    let preview = await getLatestPreview(true);
    expect(preview?.width).toBe(640);
    expect(preview?.height).toBe(360);

    let state = await getCaptureState(true);
    expect(state.width).toBe(2560);
    expect(state.height).toBe(1440);

    const telemetry = await pollCapture(true, true);
    expect(telemetry.sourceWidth).toBe(2560);
    expect(telemetry.sourceHeight).toBe(1440);
    expect(telemetry.previewWidth).toBe(640);
    expect(telemetry.previewHeight).toBe(360);

    mockProvider.simulateTftAppeared(1920, 1080);
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    preview = await getLatestPreview(true);
    expect(preview?.width).toBe(640);
    expect(preview?.height).toBe(360);

    state = await getCaptureState(true);
    expect(state.width).toBe(1920);
    expect(state.height).toBe(1080);

    const svg = createDeterministicMockSvg(42, 640, 360);
    const decoded = decodeURIComponent(svg);
    expect(decoded).toContain('width="640"');
    expect(decoded).toContain('height="360"');
  });

  // 9. save-debug-frames disabled by default
  it('9. save-debug-frames is disabled by default in settings and normalized config', () => {
    expect(defaultScreenIntelligenceSettings.saveDebugFrames).toBe(false);
    expect(defaultSettings.screenIntelligence.saveDebugFrames).toBe(false);

    const normalized = normalizeSettings({
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        sourceMode: 'auto',
      },
    });
    expect(normalized.screenIntelligence.saveDebugFrames).toBe(false);
  });

  // 10. capture failure handled safely
  it('10. capture failure is handled safely and surfaces error state without crashing', async () => {
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    mockProvider.simulateCaptureFailure('BitBlt failed to copy window pixels (0x5)');

    const state = await getCaptureState(true);
    expect(state.state).toBe('error');
    expect(state.errorMessage).toContain('BitBlt failed');
    expect(await getLatestPreview(true)).toBeNull();

    const telemetry = await pollCapture(true, true);
    expect(telemetry.state).toBe('error');
    expect(telemetry.errorMessage).toContain('BitBlt failed');
    expect(telemetry.previewImage).toBeUndefined();
  });

  // 11. no Riot API requests added
  it('11. screen intelligence runs strictly locally with zero public Riot API requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    const state = await getCaptureState(true);
    const preview = await getLatestPreview(true);

    expect(state.state).toBe('capturing');
    expect(preview).not.toBeNull();

    // Verify zero network requests were initiated by screen intelligence
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // 12. Home recommendation parity unchanged
  it('12. Home recommendation parity is completely unchanged by screen intelligence', () => {
    const baselineSettings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        enabled: false,
        saveDebugFrames: false,
        captureFps: 2,
        sourceMode: 'auto' as const,
      },
    });

    const enabledSettings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: true,
        captureFps: 5,
        sourceMode: 'mock' as const,
      },
    });

    const now = '2026-09-10T22:00:00.000Z';
    const baselineRecs = createRecommendations(data, baselineSettings, now);
    const enabledRecs = createRecommendations(data, enabledSettings, now);

    // Verify exact portfolio and score equality
    expect(enabledRecs.portfolio.plans.length).toBe(baselineRecs.portfolio.plans.length);
    for (let i = 0; i < baselineRecs.portfolio.plans.length; i++) {
      expect(enabledRecs.portfolio.plans[i].candidate.playbook.id).toBe(
        baselineRecs.portfolio.plans[i].candidate.playbook.id,
      );
      expect(enabledRecs.portfolio.plans[i].candidate.score).toBe(
        baselineRecs.portfolio.plans[i].candidate.score,
      );
    }

    expect(enabledRecs.homeCandidates.length).toBe(baselineRecs.homeCandidates.length);
    for (let i = 0; i < baselineRecs.homeCandidates.length; i++) {
      expect(enabledRecs.homeCandidates[i].playbook.id).toBe(
        baselineRecs.homeCandidates[i].playbook.id,
      );
      expect(enabledRecs.homeCandidates[i].score).toBe(
        baselineRecs.homeCandidates[i].score,
      );
    }
  });

  // 13. Lifecycle: preview subscription and cleanup
  it('13. preview subscription lifecycle works smoothly with unmount cleanup', async () => {
    vi.useFakeTimers();
    let updates = 0;

    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    const unsubscribe = subscribeToCapturePreview(
      (preview, state) => {
        if (preview && state.state === 'capturing') {
          updates += 1;
        }
      },
      { intervalMs: 200, forceMock: true },
    );

    // Initial poll
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toBeGreaterThanOrEqual(1);

    // Next tick
    await vi.advanceTimersByTimeAsync(250);
    expect(updates).toBeGreaterThanOrEqual(2);

    const countBeforeUnsub = updates;
    unsubscribe();

    // After unsubscription, no more updates should be delivered
    await vi.advanceTimersByTimeAsync(500);
    expect(updates).toBe(countBeforeUnsub);

    vi.useRealTimers();
  });

  // 14. Error Boundary safety: catches render error and returns fallback
  it('14. ScreenIntelligenceErrorBoundary safely catches render errors without crashing', () => {
    const errorBoundary = new ScreenIntelligenceErrorBoundary({ children: null });
    expect(errorBoundary.state.hasError).toBe(false);

    const derived = ScreenIntelligenceErrorBoundary.getDerivedStateFromError(
      new Error('Synthetic capture failure'),
    );
    expect(derived.hasError).toBe(true);
    expect(derived.errorMessage).toContain('Synthetic capture failure');
  });

  // 15. IPC compact telemetry payload: no 8MB raw uncompressed frame
  it('15. pollCapture returns compact telemetry payload without raw uncompressed frame buffers', async () => {
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    const telemetryWithPreview = await pollCapture(true, true);
    const jsonStr = JSON.stringify(telemetryWithPreview);
    // Compact preview payload should be well under 100 KB, not ~8 MB uncompressed BGRA
    expect(jsonStr.length).toBeLessThan(100_000);

    const telemetryWithoutPreview = await pollCapture(false, true);
    expect(telemetryWithoutPreview.previewImage).toBeUndefined();
    const tinyJsonStr = JSON.stringify(telemetryWithoutPreview);
    expect(tinyJsonStr.length).toBeLessThan(1_000);
  });

  // 16. formatMetric handles null, undefined, NaN, and finite numbers safely
  it('16. formatMetric formats numbers safely and returns em-dash for null/undefined/NaN', () => {
    expect(formatMetric(null)).toBe('—');
    expect(formatMetric(undefined)).toBe('—');
    expect(formatMetric(NaN)).toBe('—');
    expect(formatMetric(Infinity)).toBe('—');
    expect(formatMetric(-Infinity)).toBe('—');
    expect(formatMetric(0, 1)).toBe('0.0');
    expect(formatMetric(2.56, 1)).toBe('2.6');
    expect(formatMetric(1920, 0)).toBe('1920');
  });

  // 17. telemetry fps = null does not throw during rendering
  it('17. renders safely when telemetry fps is null without throwing or crashing', () => {
    const html = renderToStaticMarkup(
      createElement(
        ScreenIntelligenceErrorBoundary,
        null,
        createElement(ScreenIntelligenceSection, {
          settings: normalizeSettings({
            ...defaultSettings,
            screenIntelligence: {
              enabled: true,
              saveDebugFrames: false,
              captureFps: 2,
              sourceMode: 'mock',
            },
          }),
          onSave: () => {},
        }),
      ),
    );

    expect(html).toContain('Screen intelligence');
    expect(html).not.toContain('Component error');
    expect(html).not.toContain("Cannot read properties of null (reading 'toFixed')");
  });

  // 18. processingMs = null does not throw during rendering (regression test for M14A.1 crash)
  it('18. renders safely when processingMs is null without throwing Cannot read properties of null (reading toFixed)', () => {
    const html = renderToStaticMarkup(
      createElement(
        ScreenIntelligenceErrorBoundary,
        null,
        createElement(ScreenIntelligenceSection, {
          settings: normalizeSettings({
            ...defaultSettings,
            screenIntelligence: {
              enabled: true,
              saveDebugFrames: false,
              captureFps: 2,
              sourceMode: 'auto',
            },
          }),
          onSave: () => {},
        }),
      ),
    );

    expect(html).toContain('Screen intelligence');
    expect(html).not.toContain('Component error');
    expect(html).toContain('Waiting for TFT');
  });

  // 19. width/height missing/null renders em-dash without throwing
  it('19. width and height missing or null renders em-dash without throwing', () => {
    const html = renderToStaticMarkup(
      createElement(
        ScreenIntelligenceErrorBoundary,
        null,
        createElement(ScreenIntelligenceSection, {
          settings: defaultSettings,
          onSave: () => {},
        }),
      ),
    );

    expect(html).toContain('Screen intelligence');
    expect(html).not.toContain('Component error');
    expect(html).toContain('—');
  });

  // 20. waiting-for-tft response renders smoothly
  it('20. waiting-for-tft response renders correctly with waiting status and em-dash metrics', () => {
    mockProvider.simulateTftDisappeared();
    const html = renderToStaticMarkup(
      createElement(
        ScreenIntelligenceErrorBoundary,
        null,
        createElement(ScreenIntelligenceSection, {
          settings: normalizeSettings({
            ...defaultSettings,
            screenIntelligence: {
              enabled: true,
              saveDebugFrames: false,
              captureFps: 2,
              sourceMode: 'mock',
            },
          }),
          onSave: () => {},
        }),
      ),
    );

    expect(html).toContain('Waiting for TFT');
    expect(html).not.toContain('Component error');
  });

  // 21. unavailable response renders with clean banner
  it('21. capture-unavailable or error response renders clean message banner without throwing', () => {
    mockProvider.simulateCaptureFailure('Capture device unavailable');
    const html = renderToStaticMarkup(
      createElement(
        ScreenIntelligenceErrorBoundary,
        null,
        createElement(ScreenIntelligenceSection, {
          settings: normalizeSettings({
            ...defaultSettings,
            screenIntelligence: {
              enabled: true,
              saveDebugFrames: false,
              captureFps: 2,
              sourceMode: 'mock',
            },
          }),
          onSave: () => {},
        }),
      ),
    );

    expect(html).toContain('Screen intelligence');
    expect(html).not.toContain('Component error');
  });

  // 22. first successful frame after null state renders
  it('22. first successful frame after null state renders with valid dimensions and FPS', async () => {
    mockProvider.simulateTftDisappeared();
    await configureCapture(
      {
        enabled: true,
        saveDebugFrames: false,
        captureFps: 2,
        mockSource: true,
      },
      true,
    );

    let telemetry = await pollCapture(true, true);
    expect(telemetry.state).toBe('waiting-for-tft');
    expect(telemetry.sourceWidth).toBe(0);
    expect(telemetry.sourceHeight).toBe(0);

    // Now TFT appears: first successful frame arrives
    mockProvider.simulateTftAppeared(1920, 1080);
    telemetry = await pollCapture(true, true);
    expect(telemetry.state).toBe('capturing');
    expect(telemetry.sourceWidth).toBe(1920);
    expect(telemetry.sourceHeight).toBe(1080);
    expect(telemetry.fps).toBe(2);
    expect(telemetry.processingMs).toBeGreaterThan(0);
    expect(telemetry.previewImage).toBeTruthy();
  });

  // 23. no Error Boundary fallback for expected null telemetry
  it('23. no Error Boundary fallback is triggered for expected null/undefined telemetry fields', () => {
    const rendered = renderToStaticMarkup(
      createElement(
        ScreenIntelligenceErrorBoundary,
        null,
        createElement(ScreenIntelligenceSection, {
          settings: null,
          onSave: () => {},
        }),
      ),
    );

    expect(rendered).toContain('Screen intelligence');
    expect(rendered).not.toContain('Component error');
    expect(rendered).not.toContain('UNAVAILABLE');
  });
});

describe('M14A.3 — Screen Intelligence Settings Persistence & Normalization', () => {
  function createTestSqliteDb() {
    const db = new DatabaseSync(':memory:');
    const url = new URL('../storage/schema.sql', import.meta.url);
    const sql = readFileSync(url, 'utf8');
    db.exec(sql);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlRepository(adapter as unknown as Database);
    return { db, repo };
  }

  // 1. old Settings payload loads with Screen Intelligence defaults
  it('1. old Settings payload loads with Screen Intelligence defaults', () => {
    const oldSettingsPayload = {
      personalWeight: 0.08,
      historyWindow: 15,
      riotId: 'Summoner#EUW',
      riotPlatform: 'EUW1' as const,
      homeRecommendation: { ...defaultSettings.homeRecommendation },
      // Note: NO screenIntelligence key present at all
    };

    const normalized = normalizeSettings(oldSettingsPayload);
    expect(normalized.screenIntelligence).toEqual(defaultScreenIntelligenceSettings);
    expect(normalized.screenIntelligence.enabled).toBe(false);
    expect(normalized.screenIntelligence.saveDebugFrames).toBe(false);
    expect(normalized.screenIntelligence.captureRate).toBe(2);
    expect(normalized.screenIntelligence.captureSource).toBe('auto');
    expect(normalized.screenIntelligence.captureFps).toBe(2);
    expect(normalized.screenIntelligence.sourceMode).toBe('auto');
    expect(normalized.personalWeight).toBe(0.08);
    expect(normalized.historyWindow).toBe(15);
  });

  // 2. enabled=true survives normalizeSettings
  it('2. enabled=true survives normalizeSettings', () => {
    const normalized = normalizeSettings({
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: false,
        captureRate: 2,
        captureSource: 'auto',
        captureFps: 2,
        sourceMode: 'auto',
      },
    });

    expect(normalized.screenIntelligence.enabled).toBe(true);
  });

  // 3. saveDebugFrames survives normalizeSettings
  it('3. saveDebugFrames survives normalizeSettings', () => {
    const normalized = normalizeSettings({
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: true,
        captureRate: 2,
        captureSource: 'auto',
        captureFps: 2,
        sourceMode: 'auto',
      },
    });

    expect(normalized.screenIntelligence.saveDebugFrames).toBe(true);
  });

  // 4. valid captureRate survives
  it('4. valid captureRate survives', () => {
    for (const rate of [1, 2, 5] as const) {
      const normalized = normalizeSettings({
        screenIntelligence: {
          enabled: true,
          saveDebugFrames: false,
          captureRate: rate,
          captureSource: 'auto',
          captureFps: rate,
          sourceMode: 'auto',
        },
      });

      expect(normalized.screenIntelligence.captureRate).toBe(rate);
      expect(normalized.screenIntelligence.captureFps).toBe(rate);
    }
  });

  // 5. invalid captureRate falls back safely
  it('5. invalid captureRate falls back safely', () => {
    const invalidRates = [0, 3, 4, 10, -1, NaN, Infinity, 'fast' as unknown as number];
    for (const invalid of invalidRates) {
      const normalized = normalizeSettings({
        screenIntelligence: {
          enabled: true,
          saveDebugFrames: false,
          captureRate: invalid as 1 | 2 | 5,
          captureSource: 'auto',
          captureFps: invalid,
          sourceMode: 'auto',
        },
      });

      expect(normalized.screenIntelligence.captureRate).toBe(2);
      expect(normalized.screenIntelligence.captureFps).toBe(2);
    }
  });

  // 6. captureSource survives
  it('6. captureSource survives', () => {
    const mockNorm = normalizeSettings({
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: false,
        captureRate: 2,
        captureSource: 'mock',
        captureFps: 2,
        sourceMode: 'mock',
      },
    });
    expect(mockNorm.screenIntelligence.captureSource).toBe('mock');
    expect(mockNorm.screenIntelligence.sourceMode).toBe('mock');

    const autoNorm = normalizeSettings({
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: false,
        captureRate: 2,
        captureSource: 'auto',
        captureFps: 2,
        sourceMode: 'auto',
      },
    });
    expect(autoNorm.screenIntelligence.captureSource).toBe('auto');
    expect(autoNorm.screenIntelligence.sourceMode).toBe('auto');
  });

  // 7. toggle enabled persists through repository roundtrip
  it('7. toggle enabled persists through repository roundtrip', async () => {
    // MemoryRepository
    const memRepo = new MemoryRepository();
    const settingsToSave = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        ...defaultScreenIntelligenceSettings,
        enabled: true,
      },
    });
    await memRepo.set('settings', settingsToSave);
    const loadedMem = await memRepo.get<Settings>('settings');
    expect(loadedMem?.screenIntelligence.enabled).toBe(true);

    // SqlRepository (real SQLite)
    const { repo: sqlRepo } = createTestSqliteDb();
    await sqlRepo.set('settings', settingsToSave);
    const loadedSql = await sqlRepo.get<Settings>('settings');
    expect(loadedSql?.screenIntelligence.enabled).toBe(true);
  });

  // 8. reload preserves enabled state
  it('8. reload preserves enabled state', async () => {
    const db = new DatabaseSync(':memory:');
    const url = new URL('../storage/schema.sql', import.meta.url);
    db.exec(readFileSync(url, 'utf8'));

    // First session: save enabled=true
    const adapter1 = createNodeSqliteAdapter(db);
    const repo1 = new SqlRepository(adapter1 as unknown as Database);
    const settings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        ...defaultScreenIntelligenceSettings,
        enabled: true,
        captureRate: 5,
      },
    });
    await repo1.set('settings', settings);

    // Second session (simulating app reload on existing DB):
    const adapter2 = createNodeSqliteAdapter(db);
    const repo2 = new SqlRepository(adapter2 as unknown as Database);
    const reloadedRaw = await repo2.get<Settings>('settings');
    const reloaded = normalizeSettings(reloadedRaw);

    expect(reloaded.screenIntelligence.enabled).toBe(true);
    expect(reloaded.screenIntelligence.captureRate).toBe(5);
  });

  // 9. disabling persists
  it('9. disabling persists', async () => {
    const { repo } = createTestSqliteDb();

    // Enable first
    await repo.set(
      'settings',
      normalizeSettings({
        ...defaultSettings,
        screenIntelligence: {
          ...defaultScreenIntelligenceSettings,
          enabled: true,
        },
      }),
    );
    expect((await repo.get<Settings>('settings'))?.screenIntelligence.enabled).toBe(true);

    // Disable
    await repo.set(
      'settings',
      normalizeSettings({
        ...defaultSettings,
        screenIntelligence: {
          ...defaultScreenIntelligenceSettings,
          enabled: false,
        },
      }),
    );
    const disabledLoaded = await repo.get<Settings>('settings');
    expect(disabledLoaded?.screenIntelligence.enabled).toBe(false);
  });

  // 10. mock source persists
  it('10. mock source persists', async () => {
    const { repo } = createTestSqliteDb();

    await repo.set(
      'settings',
      normalizeSettings({
        ...defaultSettings,
        screenIntelligence: {
          ...defaultScreenIntelligenceSettings,
          enabled: true,
          captureSource: 'mock',
        },
      }),
    );

    const loaded = await repo.get<Settings>('settings');
    expect(loaded?.screenIntelligence.captureSource).toBe('mock');
    expect(loaded?.screenIntelligence.sourceMode).toBe('mock');
  });

  // 11. no runtime telemetry/frame data stored in settings
  it('11. no runtime telemetry/frame data stored in settings', async () => {
    const { db, repo } = createTestSqliteDb();

    // Attempt to pass telemetry / raw frames into settings payload
    const dirtyPayload = {
      ...defaultSettings,
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: false,
        captureRate: 2 as const,
        captureSource: 'auto' as const,
        captureFps: 2,
        sourceMode: 'auto' as const,
        fps: 60,
        frameSize: [1920, 1080],
        processingTime: 12.5,
        lastFrame: '2026-09-10T23:00:00.000Z',
        windowTitle: 'League of Legends (TM) Client',
        previewImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
      },
    };

    const normalized = normalizeSettings(dirtyPayload);
    await repo.set('settings', normalized);

    // Inspect the raw string stored directly in SQLite settings table
    const rawRow = db.prepare("SELECT value FROM settings WHERE key='settings'").get() as {
      value: string;
    };
    expect(rawRow).toBeDefined();
    const storedJson = rawRow.value;

    expect(storedJson).not.toContain('previewImage');
    expect(storedJson).not.toContain('windowTitle');
    expect(storedJson).not.toContain('frameSize');
    expect(storedJson).not.toContain('processingTime');
    expect(storedJson).not.toContain('base64');
  });

  // 12. recommendation settings remain unchanged
  it('12. recommendation settings remain unchanged', () => {
    const customRecSettings: Settings = {
      personalWeight: 0.09,
      historyWindow: 20,
      riotId: 'Test#123',
      riotPlatform: 'NA1',
      homeRecommendation: {
        ...defaultSettings.homeRecommendation,
        top4Weight: 0.8,
        winRateWeight: 0.2,
      },
      screenIntelligence: {
        enabled: false,
        saveDebugFrames: false,
        captureRate: 2,
        captureSource: 'auto',
        captureFps: 2,
        sourceMode: 'auto',
      },
    };

    const toggled = normalizeSettings({
      ...customRecSettings,
      screenIntelligence: {
        ...customRecSettings.screenIntelligence,
        enabled: true,
        saveDebugFrames: true,
        captureRate: 5,
      },
    });

    expect(toggled.personalWeight).toBe(0.09);
    expect(toggled.historyWindow).toBe(20);
    expect(toggled.riotId).toBe('Test#123');
    expect(toggled.riotPlatform).toBe('NA1');
    expect(toggled.homeRecommendation).toEqual(
      normalizeHomeRecommendationConfig(customRecSettings.homeRecommendation),
    );
    expect(toggled.screenIntelligence.enabled).toBe(true);
    expect(toggled.screenIntelligence.saveDebugFrames).toBe(true);
    expect(toggled.screenIntelligence.captureRate).toBe(5);
  });

  // 13. Home recommendation parity exact
  it('13. Home recommendation parity exact', () => {
    const disabledSettings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        enabled: false,
        saveDebugFrames: false,
        captureRate: 2,
        captureSource: 'auto',
        captureFps: 2,
        sourceMode: 'auto',
      },
    });

    const enabledSettings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: true,
        captureRate: 5,
        captureSource: 'mock',
        captureFps: 5,
        sourceMode: 'mock',
      },
    });

    const now = '2026-09-10T23:30:00.000Z';
    const recsDisabled = createRecommendations(data, disabledSettings, now);
    const recsEnabled = createRecommendations(data, enabledSettings, now);

    expect(recsEnabled.portfolio.plans.length).toBe(recsDisabled.portfolio.plans.length);
    for (let i = 0; i < recsDisabled.portfolio.plans.length; i++) {
      expect(recsEnabled.portfolio.plans[i].candidate.playbook.id).toBe(
        recsDisabled.portfolio.plans[i].candidate.playbook.id,
      );
      expect(recsEnabled.portfolio.plans[i].candidate.score).toBe(
        recsDisabled.portfolio.plans[i].candidate.score,
      );
    }

    expect(recsEnabled.homeCandidates.length).toBe(recsDisabled.homeCandidates.length);
    for (let i = 0; i < recsDisabled.homeCandidates.length; i++) {
      expect(recsEnabled.homeCandidates[i].playbook.id).toBe(
        recsDisabled.homeCandidates[i].playbook.id,
      );
      expect(recsEnabled.homeCandidates[i].score).toBe(
        recsDisabled.homeCandidates[i].score,
      );
    }
  });
});


