export type ScreenCaptureStateValue =
  | 'disabled'
  | 'waiting-for-tft'
  | 'capturing'
  | 'capture-unavailable'
  | 'error';

export interface ScreenCaptureState {
  state: ScreenCaptureStateValue;
  windowTitle?: string | null;
  processName?: string | null;
  width?: number | null;
  height?: number | null;
  captureSource: string;
  captureFps?: number | null;
  lastFrameTimestamp?: string | null;
  processingTimeMs?: number | null;
  debugSaving: boolean;
  errorMessage?: string | null;
}

export interface ScreenCaptureTelemetry {
  state: ScreenCaptureStateValue;
  windowTitle?: string | null;
  processName?: string | null;
  source: string;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  fps?: number | null;
  processingMs?: number | null;
  previewWidth?: number | null;
  previewHeight?: number | null;
  lastFrameTimestamp?: string | null;
  previewImage?: string | null;
  debugSaving: boolean;
  errorMessage?: string | null;
}

export interface CapturedFramePreview {
  width?: number | null;
  height?: number | null;
  timestamp: string;
  processingTimeMs?: number | null;
  dataBase64: string;
}

export interface ScreenCaptureStatus {
  enabled: boolean;
  detected: boolean;
  processName?: string | null;
  windowTitle?: string | null;
  sourceWidth: number;
  sourceHeight: number;
  captureFps: number;
  processingTimeMs: number;
  lastFrameAgeMs?: number | null;
}

export interface ScreenCaptureConfig {
  enabled: boolean;
  saveDebugFrames: boolean;
  captureFps?: number;
  mockSource?: boolean;
}

export function createDeterministicMockSvg(
  frameSequence: number,
  width = 640,
  height = 360,
  timestamp = new Date().toISOString(),
): string {
  const dotX = (frameSequence * 15) % (width - 40) + 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0c121e" />
        <stop offset="50%" stop-color="#141e30" />
        <stop offset="100%" stop-color="#0a0e17" />
      </linearGradient>
      <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#24334a" />
        <stop offset="100%" stop-color="#152033" />
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)" />
    <!-- Top HUD Bar -->
    <rect x="0" y="0" width="${width}" height="28" fill="#080c14" opacity="0.95" />
    <text x="12" y="18" fill="#f0e6d2" font-family="sans-serif" font-size="11" font-weight="bold">STAGE 3-2 · TFT SCREEN INTELLIGENCE FIXTURE</text>
    <text x="${width - 160}" y="18" fill="#c8aa6e" font-family="sans-serif" font-size="10">FRAME #${frameSequence} · ${width}×${height}</text>
    <circle cx="${dotX}" cy="14" r="5" fill="#c8aa6e" />
    <!-- Board Hex Area -->
    <rect x="80" y="45" width="${width - 160}" height="${height - 120}" rx="6" fill="#131c2a" stroke="#2c3e55" stroke-width="1.5" />
    <text x="${width / 2}" y="${height / 2 - 15}" fill="#785a28" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">TFT BOARD EMULATION</text>
    <text x="${width / 2}" y="${height / 2 + 8}" fill="#a09b8c" font-family="sans-serif" font-size="11" text-anchor="middle">Timestamp: ${timestamp}</text>
    <text x="${width / 2}" y="${height / 2 + 25}" fill="#5c5b57" font-family="sans-serif" font-size="9" text-anchor="middle">Pixels remain strictly local in-memory</text>
    <!-- Shop Bar -->
    <rect x="60" y="${height - 65}" width="${width - 120}" height="55" rx="4" fill="#0d1420" stroke="#1e2d42" stroke-width="1" />
    ${[0, 1, 2, 3, 4]
      .map((i) => {
        const slotW = (width - 140) / 5;
        const slotX = 70 + i * (slotW + 2);
        return `<rect x="${slotX}" y="${height - 60}" width="${slotW}" height="45" rx="3" fill="url(#card)" stroke="#c8aa6e" stroke-width="1" />
        <text x="${slotX + slotW / 2}" y="${height - 35}" fill="#f0e6d2" font-family="sans-serif" font-size="8" text-anchor="middle">CARD ${i + 1}</text>`;
      })
      .join('')}
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export class MockScreenCaptureProvider {
  private config: ScreenCaptureConfig = {
    enabled: false,
    saveDebugFrames: false,
    captureFps: 2,
    mockSource: true,
  };

  private state: ScreenCaptureState = {
    state: 'disabled',
    windowTitle: null,
    processName: null,
    width: 0,
    height: 0,
    captureSource: 'none',
    captureFps: 0,
    debugSaving: false,
  };

  private latestPreview: CapturedFramePreview | null = null;
  private sequenceCounter = 0;
  private tftPresent = true;
  private failureError: string | null = null;
  private mockWidth = 1920;
  private mockHeight = 1080;

  constructor(initialConfig?: Partial<ScreenCaptureConfig>) {
    if (initialConfig) {
      this.configure({ ...this.config, ...initialConfig });
    }
  }

  public getState(): ScreenCaptureState {
    return { ...this.state };
  }

  public getPreview(): CapturedFramePreview | null {
    return this.latestPreview ? { ...this.latestPreview } : null;
  }

  public getStatus(): ScreenCaptureStatus {
    const isDetected = this.state.state === 'capturing';
    return {
      enabled: this.config.enabled,
      detected: isDetected,
      processName: this.state.processName,
      windowTitle: this.state.windowTitle,
      sourceWidth: this.state.width ?? 0,
      sourceHeight: this.state.height ?? 0,
      captureFps: this.state.captureFps ?? 0,
      processingTimeMs: this.state.processingTimeMs ?? 0,
      lastFrameAgeMs: isDetected ? 50 : null,
    };
  }

  public poll(includePreview = false): ScreenCaptureTelemetry {
    const st = this.state;
    const prev = this.latestPreview;
    return {
      state: st.state,
      windowTitle: st.windowTitle,
      processName: st.processName,
      source: st.captureSource,
      sourceWidth: st.width,
      sourceHeight: st.height,
      fps: st.captureFps,
      processingMs: st.processingTimeMs ?? 0,
      previewWidth: prev?.width ?? 0,
      previewHeight: prev?.height ?? 0,
      lastFrameTimestamp: st.lastFrameTimestamp,
      previewImage: includePreview ? prev?.dataBase64 : undefined,
      debugSaving: st.debugSaving,
      errorMessage: st.errorMessage,
    };
  }

  public configure(config: ScreenCaptureConfig): ScreenCaptureState {
    this.config = { ...config };
    this.state.debugSaving = config.saveDebugFrames;

    if (!config.enabled) {
      this.state = {
        state: 'disabled',
        windowTitle: undefined,
        processName: undefined,
        width: 0,
        height: 0,
        captureSource: 'none',
        captureFps: 0,
        lastFrameTimestamp: undefined,
        processingTimeMs: undefined,
        debugSaving: config.saveDebugFrames,
        errorMessage: undefined,
      };
      this.latestPreview = null;
      return this.getState();
    }

    // When enabled
    if (this.failureError) {
      this.state = {
        state: 'error',
        windowTitle: undefined,
        processName: undefined,
        width: 0,
        height: 0,
        captureSource: 'Windows TFT window',
        captureFps: 0,
        debugSaving: config.saveDebugFrames,
        errorMessage: this.failureError,
      };
      this.latestPreview = null;
      return this.getState();
    }

    if (!this.tftPresent) {
      this.state = {
        state: 'waiting-for-tft',
        windowTitle: undefined,
        processName: undefined,
        width: 0,
        height: 0,
        captureSource: 'none',
        captureFps: 0,
        debugSaving: config.saveDebugFrames,
        errorMessage: undefined,
      };
      this.latestPreview = null;
      return this.getState();
    }

    // TFT present & capturing
    this.sequenceCounter += 1;
    const timestamp = new Date().toISOString();
    const previewWidth = Math.min(640, this.mockWidth);
    const previewHeight = Math.round((previewWidth / this.mockWidth) * this.mockHeight);
    const dataUri = createDeterministicMockSvg(
      this.sequenceCounter,
      previewWidth,
      previewHeight,
      timestamp,
    );

    this.latestPreview = {
      width: previewWidth,
      height: previewHeight,
      timestamp,
      processingTimeMs: 1.4,
      dataBase64: dataUri,
    };

    this.state = {
      state: 'capturing',
      windowTitle: 'TFT',
      processName: 'TFTClient-Win64-Shipping',
      width: this.mockWidth,
      height: this.mockHeight,
      captureSource: 'Windows TFT window',
      captureFps: config.captureFps ?? 2,
      lastFrameTimestamp: timestamp,
      processingTimeMs: 1.4,
      debugSaving: config.saveDebugFrames,
      errorMessage: undefined,
    };

    return this.getState();
  }

  public simulateTftAppeared(width = 1920, height = 1080, title?: string, processName = 'TFTClient-Win64-Shipping'): void {
    this.tftPresent = true;
    this.failureError = null;
    this.mockWidth = width;
    this.mockHeight = height;

    if (this.config.enabled) {
      this.sequenceCounter += 1;
      const timestamp = new Date().toISOString();
      const previewWidth = Math.min(640, width);
      const previewHeight = Math.round((previewWidth / width) * height);
      const dataUri = createDeterministicMockSvg(this.sequenceCounter, previewWidth, previewHeight, timestamp);

      this.latestPreview = {
        width: previewWidth,
        height: previewHeight,
        timestamp,
        processingTimeMs: 1.5,
        dataBase64: dataUri,
      };

      this.state = {
        state: 'capturing',
        windowTitle: title ?? 'TFT',
        processName,
        width,
        height,
        captureSource: 'Windows TFT window',
        captureFps: this.config.captureFps ?? 2,
        lastFrameTimestamp: timestamp,
        processingTimeMs: 1.5,
        debugSaving: this.config.saveDebugFrames,
        errorMessage: undefined,
      };
    }
  }

  public simulateTftDisappeared(): void {
    this.tftPresent = false;
    if (this.config.enabled) {
      this.state = {
        state: 'waiting-for-tft',
        windowTitle: undefined,
        processName: undefined,
        width: 0,
        height: 0,
        captureSource: 'none',
        captureFps: 0,
        lastFrameTimestamp: undefined,
        processingTimeMs: undefined,
        debugSaving: this.config.saveDebugFrames,
        errorMessage: undefined,
      };
      this.latestPreview = null;
    }
  }

  public simulateCaptureFailure(error: string): void {
    this.failureError = error;
    if (this.config.enabled) {
      this.state = {
        state: 'error',
        windowTitle: undefined,
        width: 0,
        height: 0,
        captureSource: 'none',
        captureFps: 0,
        lastFrameTimestamp: undefined,
        processingTimeMs: undefined,
        debugSaving: this.config.saveDebugFrames,
        errorMessage: error,
      };
      this.latestPreview = null;
    }
  }

  public reset(): void {
    this.sequenceCounter = 0;
    this.tftPresent = true;
    this.failureError = null;
    this.mockWidth = 1920;
    this.mockHeight = 1080;
    this.configure({ enabled: false, saveDebugFrames: false });
  }
}
