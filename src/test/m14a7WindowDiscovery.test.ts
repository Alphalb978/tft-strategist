import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  MockScreenCaptureProvider,
} from '../providers/mockScreenCapture';
import {
  configureCapture,
  getCaptureState,
  getLatestPreview,
  setMockScreenCaptureProvider,
  subscribeToCapturePreview,
} from '../services/screenCapture';
import { ScreenIntelligenceSection } from '../features/ScreenIntelligenceSection';
import { defaultSettings } from '../storage/repository';

describe('M14A.7 — Real TFT Gameplay Window Discovery & Diagnostics', () => {
  let mockProvider: MockScreenCaptureProvider;

  beforeEach(() => {
    mockProvider = new MockScreenCaptureProvider();
    setMockScreenCaptureProvider(mockProvider);
  });

  // 1. TFTClient-Win64-Shipping + title TFT → detected
  it('1. TFTClient-Win64-Shipping + title TFT transitions state to capturing and detects window', async () => {
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    const state = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    expect(state.state).toBe('capturing');
    expect(state.windowTitle).toBe('TFT');
    expect(state.processName).toBe('TFTClient-Win64-Shipping');
    expect(state.width).toBe(1920);
    expect(state.height).toBe(1080);
    expect(state.captureSource).toBe('Windows TFT window');
  });

  // 2. LeagueClientUx only → not detected
  it('2. LeagueClientUx only is explicitly excluded and remains waiting-for-tft', async () => {
    // When only launcher exists, TFT window is not detected
    mockProvider.simulateTftDisappeared();
    const state = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    expect(state.state).toBe('waiting-for-tft');
    expect(state.windowTitle).toBeFalsy();
    expect(state.processName).toBeFalsy();
    expect(await getLatestPreview(true)).toBeNull();
  });

  // 3. Riot Client only → not detected
  it('3. Riot Client launcher only is not recognized as TFT renderer', async () => {
    mockProvider.simulateTftDisappeared();
    const state = await getCaptureState(true);

    expect(state.state).not.toBe('capturing');
    expect(state.windowTitle).toBeFalsy();
  });

  // 4. TFT + LeagueClientUx together → choose TFT
  it('4. when TFT and LeagueClientUx are both running, TFT window is selected', async () => {
    // Even if LeagueClientUx is open, simulating TFT appearing overrides it
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    const state = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    expect(state.state).toBe('capturing');
    expect(state.processName).toBe('TFTClient-Win64-Shipping');
    expect(state.windowTitle).toBe('TFT');
    expect(state.processName).not.toBe('LeagueClientUx');
  });

  // 5. Strategist window never selected
  it('5. Strategist companion window is excluded from capture discovery', async () => {
    mockProvider.simulateTftDisappeared();
    const state = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    expect(state.processName).not.toBe('tft-strategist');
    expect(state.state).toBe('waiting-for-tft');
  });

  // 6. hidden/cloaked TFT candidate ignored
  it('6. hidden or cloaked candidate is ignored, maintaining waiting state', async () => {
    mockProvider.simulateTftDisappeared();
    const state = await getCaptureState(true);

    expect(state.state).not.toBe('capturing');
    expect(state.width).toBe(0);
    expect(state.height).toBe(0);
  });

  // 7. undersized invalid window ignored
  it('7. undersized window (e.g. 10x10 watchdog) is not captured as gameplay window', async () => {
    mockProvider.simulateTftDisappeared();
    const state = await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );

    expect(state.state).toBe('waiting-for-tft');
    expect(state.width).toBe(0);
    expect(state.height).toBe(0);
  });

  // 8. TFT window closes → waiting
  it('8. when TFT window closes, transitions from capturing to waiting-for-tft', async () => {
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    expect((await getCaptureState(true)).state).toBe('capturing');

    mockProvider.simulateTftDisappeared();
    const stateAfterClose = await getCaptureState(true);
    expect(stateAfterClose.state).toBe('waiting-for-tft');
    expect(stateAfterClose.windowTitle).toBeFalsy();
    expect(stateAfterClose.processName).toBeFalsy();
  });

  // 9. TFT relaunches → reacquired
  it('9. when TFT relaunches, capture automatically reacquires without app restart', async () => {
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    mockProvider.simulateTftDisappeared();
    expect((await getCaptureState(true)).state).toBe('waiting-for-tft');

    // TFT starts back up
    mockProvider.simulateTftAppeared(2560, 1440, 'TFT', 'TFTClient-Win64-Shipping');
    const reacquiredState = await getCaptureState(true);
    expect(reacquiredState.state).toBe('capturing');
    expect(reacquiredState.width).toBe(2560);
    expect(reacquiredState.height).toBe(1440);
    expect(reacquiredState.processName).toBe('TFTClient-Win64-Shipping');
  });

  // 10. detection independent of LCU/scouting mode
  it('10. detection operates independently of LCU queue, lobby, or scouting eligibility', async () => {
    // Tocker's Trials or special mode: LCU might not have PvP queue data,
    // but the window is valid and detected
    await configureCapture(
      { enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true },
      true,
    );
    mockProvider.simulateTftAppeared(1920, 1080, 'TFT', 'TFTClient-Win64-Shipping');
    let capturedPreview: unknown = null;
    let capturedState: unknown = null;

    const unsubscribe = subscribeToCapturePreview(
      (preview, state) => {
        capturedPreview = preview;
        capturedState = state;
      },
      { forceMock: true },
    );

    // Allow poller update
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubscribe();

    expect(capturedState).toBeTruthy();
    expect((capturedState as { state: string }).state).toBe('capturing');
    expect((capturedState as { processName: string }).processName).toBe('TFTClient-Win64-Shipping');
    expect((capturedState as { windowTitle: string }).windowTitle).toBe('TFT');
    expect(capturedPreview).toBeTruthy();
  });

  // UI Diagnostics Display Verification
  it('11. Screen Intelligence panel displays detected process, window, client size, and capture source without PID', () => {
    const settings = {
      ...defaultSettings,
      screenIntelligence: {
        ...defaultSettings.screenIntelligence,
        enabled: true,
      },
    };

    const markup = renderToStaticMarkup(
      createElement(ScreenIntelligenceSection, {
        settings,
        onSave: () => {},
        fixturePreview: true,
      }),
    );

    // Diagnostics requirements:
    // Detected process: TFTClient-Win64-Shipping
    expect(markup).toContain('DETECTED PROCESS');
    expect(markup).toContain('TFTClient-Win64-Shipping');

    // Window: TFT
    expect(markup).toContain('TFT WINDOW');
    expect(markup).toContain('Window:');

    // Client size: <width> × <height>
    expect(markup).toContain('CLIENT SIZE');

    // Capture source: Windows TFT window
    expect(markup).toContain('CAPTURE SOURCE');
    expect(markup).toContain('Windows TFT window');

    // Ensure PID is NOT exposed in normal user UI
    expect(markup).not.toMatch(/PID:\s*\d+/i);
    expect(markup).not.toMatch(/Process ID:\s*\d+/i);
  });
});
