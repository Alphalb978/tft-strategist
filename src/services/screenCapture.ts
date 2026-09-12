import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  MockScreenCaptureProvider,
  type CapturedFramePreview,
  type ScreenCaptureConfig,
  type ScreenCaptureState,
  type ScreenCaptureStatus,
  type ScreenCaptureTelemetry,
} from '../providers/mockScreenCapture';

export type {
  CapturedFramePreview,
  ScreenCaptureConfig,
  ScreenCaptureState,
  ScreenCaptureStatus,
  ScreenCaptureTelemetry,
};

let mockProviderInstance: MockScreenCaptureProvider | null = null;
let activePreviewPollersCount = 0;

export function getActivePreviewPollersCount(): number {
  return activePreviewPollersCount;
}

export function getMockScreenCaptureProvider(): MockScreenCaptureProvider {
  if (!mockProviderInstance) {
    mockProviderInstance = new MockScreenCaptureProvider();
  }
  return mockProviderInstance;
}

export function setMockScreenCaptureProvider(provider: MockScreenCaptureProvider | null): void {
  mockProviderInstance = provider;
}

export async function getCaptureState(forceMock = false): Promise<ScreenCaptureState> {
  if (!forceMock && isTauri()) {
    try {
      return await invoke<ScreenCaptureState>('screen_capture_get_state');
    } catch (err) {
      return {
        state: 'error',
        width: 0,
        height: 0,
        captureSource: 'tauri-bridge-error',
        captureFps: 0,
        debugSaving: false,
        errorMessage: String(err),
      };
    }
  }

  return getMockScreenCaptureProvider().getState();
}

export async function getCaptureStatus(forceMock = false): Promise<ScreenCaptureStatus> {
  if (!forceMock && isTauri()) {
    try {
      return await invoke<ScreenCaptureStatus>('screen_capture_status');
    } catch {
      return {
        enabled: false,
        detected: false,
        processName: null,
        windowTitle: null,
        sourceWidth: 0,
        sourceHeight: 0,
        captureFps: 0,
        processingTimeMs: 0,
        lastFrameAgeMs: null,
      };
    }
  }

  return getMockScreenCaptureProvider().getStatus();
}

export async function configureCapture(
  config: ScreenCaptureConfig,
  forceMock = false,
): Promise<ScreenCaptureState> {
  if (!forceMock && isTauri()) {
    try {
      return await invoke<ScreenCaptureState>('screen_capture_configure', { config });
    } catch (err) {
      return {
        state: 'error',
        width: 0,
        height: 0,
        captureSource: 'tauri-bridge-error',
        captureFps: 0,
        debugSaving: config.saveDebugFrames,
        errorMessage: String(err),
      };
    }
  }

  return getMockScreenCaptureProvider().configure(config);
}

export async function getLatestPreview(forceMock = false): Promise<CapturedFramePreview | null> {
  if (!forceMock && isTauri()) {
    try {
      return await invoke<CapturedFramePreview | null>('screen_capture_preview');
    } catch {
      return null;
    }
  }

  return getMockScreenCaptureProvider().getPreview();
}

export async function getCapturePreview(forceMock = false): Promise<CapturedFramePreview | null> {
  return getLatestPreview(forceMock);
}

export async function pollCapture(
  includePreview = true,
  forceMock = false,
): Promise<ScreenCaptureTelemetry> {
  if (!forceMock && isTauri()) {
    try {
      return await invoke<ScreenCaptureTelemetry>('screen_capture_poll', { includePreview });
    } catch (err) {
      return {
        state: 'error',
        windowTitle: undefined,
        source: 'tauri-bridge-error',
        sourceWidth: 0,
        sourceHeight: 0,
        fps: 0,
        processingMs: 0,
        previewWidth: 0,
        previewHeight: 0,
        lastFrameTimestamp: undefined,
        previewImage: undefined,
        debugSaving: false,
        errorMessage: String(err),
      };
    }
  }

  return getMockScreenCaptureProvider().poll(includePreview);
}

export function subscribeToCapturePreview(
  onUpdate: (preview: CapturedFramePreview | null, state: ScreenCaptureState) => void,
  options: { intervalMs?: number; forceMock?: boolean } = {},
): () => void {
  activePreviewPollersCount += 1;
  const intervalMs = options.intervalMs ?? 1000;
  let active = true;
  let inFlight = false;

  const poll = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const telemetry = await pollCapture(true, options.forceMock);
      if (!active) return;

      const state: ScreenCaptureState = {
        state: telemetry.state,
        windowTitle: telemetry.windowTitle,
        processName: telemetry.processName,
        width: telemetry.sourceWidth,
        height: telemetry.sourceHeight,
        captureSource: telemetry.source,
        captureFps: telemetry.fps,
        lastFrameTimestamp: telemetry.lastFrameTimestamp,
        processingTimeMs: telemetry.processingMs,
        debugSaving: telemetry.debugSaving,
        errorMessage: telemetry.errorMessage,
      };

      const preview: CapturedFramePreview | null = telemetry.previewImage
        ? {
            width: telemetry.previewWidth ?? null,
            height: telemetry.previewHeight ?? null,
            timestamp: telemetry.lastFrameTimestamp ?? new Date().toISOString(),
            processingTimeMs: telemetry.processingMs ?? null,
            dataBase64: telemetry.previewImage,
          }
        : null;

      onUpdate(preview, state);
    } catch {
      // Ignored during shutdown or component unmount
    } finally {
      inFlight = false;
    }
  };

  void poll();
  const timer = setInterval(() => {
    void poll();
  }, intervalMs);

  return () => {
    active = false;
    clearInterval(timer);
    activePreviewPollersCount = Math.max(0, activePreviewPollersCount - 1);
  };
}
