import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Camera, Monitor, ShieldCheck, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  defaultSettings,
  defaultScreenIntelligenceSettings,
  type Settings,
} from '../storage/repository';
import {
  configureCapture,
  subscribeToCapturePreview,
  type CapturedFramePreview,
  type ScreenCaptureState,
} from '../services/screenCapture';

export function formatMetric(
  value: number | null | undefined,
  digits = 1,
): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : '—';
}

export class ScreenIntelligenceErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('ScreenIntelligence error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="panel screen-intelligence-panel" aria-label="Screen Intelligence settings">
          <div className="panel-heading">
            <Monitor size={18} />
            <h2>Screen intelligence</h2>
            <span className="badge error">UNAVAILABLE</span>
          </div>
          <p className="description">Capture unavailable</p>
          <div className="screen-intel-error-banner" role="alert">
            <AlertCircle size={16} />
            <div>
              <strong>Component error</strong>
              <div>{this.state.errorMessage || 'An error occurred while loading screen intelligence.'}</div>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

export function ScreenIntelligenceSection({
  settings,
  onSave,
  fixturePreview,
}: {
  settings?: Settings | null;
  onSave: (settings: Settings) => void;
  fixturePreview?: boolean;
}) {
  const currentSettings = settings ?? defaultSettings;
  const screenSettings = currentSettings.screenIntelligence ?? defaultScreenIntelligenceSettings;

  // Optimistic local state for instant UI response (<100ms)
  const [localSettings, setLocalSettings] = useState(screenSettings);

  // Sync with incoming persisted settings (handles initial load or revert on persistence failure)
  useEffect(() => {
    setLocalSettings(screenSettings);
  }, [screenSettings]);

  const isMock =
    localSettings.captureSource === 'mock' ||
    localSettings.sourceMode === 'mock' ||
    Boolean(fixturePreview);

  const [captureState, setCaptureState] = useState<ScreenCaptureState>({
    state: localSettings.enabled ? (fixturePreview ? 'capturing' : 'waiting-for-tft') : 'disabled',
    windowTitle: fixturePreview ? 'TFT' : null,
    processName: fixturePreview ? 'TFTClient-Win64-Shipping' : null,
    width: fixturePreview ? 1920 : null,
    height: fixturePreview ? 1080 : null,
    captureSource: isMock ? (fixturePreview ? 'Windows TFT window' : 'mock-fixture') : 'none',
    captureFps: fixturePreview ? 2 : null,
    debugSaving: localSettings.saveDebugFrames,
  });

  const [preview, setPreview] = useState<CapturedFramePreview | null>(
    fixturePreview
      ? {
          width: 640,
          height: 360,
          timestamp: new Date().toISOString(),
          dataBase64: 'data:image/svg+xml;utf8,<svg></svg>',
        }
      : null,
  );

  // Monotonic generation for rapid toggle safety (OFF -> ON -> OFF -> ON)
  const toggleGenerationRef = useRef(0);
  const pollerUnsubscribeRef = useRef<(() => void) | null>(null);
  const lastTimestampRef = useRef<string | undefined>(undefined);

  const stopPoller = () => {
    if (pollerUnsubscribeRef.current) {
      pollerUnsubscribeRef.current();
      pollerUnsubscribeRef.current = null;
    }
  };

  const startPoller = (gen: number, mock: boolean) => {
    stopPoller();
    pollerUnsubscribeRef.current = subscribeToCapturePreview(
      (nextPreview, nextState) => {
        // Discard frame if a newer toggle happened or if disabled
        if (toggleGenerationRef.current !== gen) return;

        if (nextPreview?.timestamp !== lastTimestampRef.current) {
          lastTimestampRef.current = nextPreview?.timestamp;
          setPreview(nextPreview);
        }

        setCaptureState((prev) => {
          if (
            prev.state === nextState.state &&
            prev.lastFrameTimestamp === nextState.lastFrameTimestamp &&
            prev.captureFps === nextState.captureFps &&
            prev.processingTimeMs === nextState.processingTimeMs &&
            prev.width === nextState.width &&
            prev.height === nextState.height &&
            prev.debugSaving === nextState.debugSaving &&
            prev.errorMessage === nextState.errorMessage
          ) {
            return prev;
          }
          return nextState;
        });
      },
      { intervalMs: 1000, forceMock: mock },
    );
  };

  // Mount lifecycle: if initially enabled, start poller
  useEffect(() => {
    if (screenSettings.enabled) {
      const gen = ++toggleGenerationRef.current;
      void configureCapture(
        {
          enabled: true,
          saveDebugFrames: screenSettings.saveDebugFrames,
          captureFps: screenSettings.captureFps,
          mockSource: isMock,
        },
        isMock,
      )
        .then((st) => {
          if (toggleGenerationRef.current === gen) {
            setCaptureState(st);
          }
        })
        .catch(() => {});
      startPoller(gen, isMock);
    }
    return () => {
      toggleGenerationRef.current += 1;
      stopPoller();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleEnabled = (enabled: boolean) => {
    const gen = ++toggleGenerationRef.current;
    const nextSettings = {
      ...localSettings,
      enabled,
    };

    // Instant optimistic visual update
    setLocalSettings(nextSettings);

    if (!enabled) {
      // Instant OFF: clear JS timer, mark disabled, clear preview immediately (<100ms)
      stopPoller();
      setPreview(null);
      setCaptureState({
        state: 'disabled',
        width: null,
        height: null,
        captureSource: 'none',
        captureFps: null,
        debugSaving: nextSettings.saveDebugFrames,
      });

      // Notify native capture asynchronously
      void configureCapture(
        {
          enabled: false,
          saveDebugFrames: false,
          captureFps: nextSettings.captureFps,
          mockSource: isMock,
        },
        isMock,
      ).catch(() => {});
    } else {
      // Instant ON: mark waiting-for-tft, configure native, start single poller
      setCaptureState((prev) => ({
        ...prev,
        state: 'waiting-for-tft',
        captureSource: isMock ? 'mock-fixture' : 'none',
      }));

      void configureCapture(
        {
          enabled: true,
          saveDebugFrames: nextSettings.saveDebugFrames,
          captureFps: nextSettings.captureFps,
          mockSource: isMock,
        },
        isMock,
      )
        .then((st) => {
          if (toggleGenerationRef.current === gen) {
            setCaptureState(st);
          }
        })
        .catch((err) => {
          if (toggleGenerationRef.current === gen) {
            setCaptureState({
              state: 'error',
              width: null,
              height: null,
              captureSource: 'none',
              captureFps: null,
              debugSaving: nextSettings.saveDebugFrames,
              errorMessage: String(err),
            });
          }
        });

      startPoller(gen, isMock);
    }

    // Persist asynchronously via fast settings path
    onSave({
      ...currentSettings,
      screenIntelligence: nextSettings,
    });
  };

  const handleToggleSaveDebug = (saveDebugFrames: boolean) => {
    const nextSettings = {
      ...localSettings,
      saveDebugFrames,
    };
    setLocalSettings(nextSettings);

    if (localSettings.enabled) {
      void configureCapture(
        {
          enabled: true,
          saveDebugFrames,
          captureFps: nextSettings.captureFps,
          mockSource: isMock,
        },
        isMock,
      ).catch(() => {});
    }

    onSave({
      ...currentSettings,
      screenIntelligence: nextSettings,
    });
  };

  const handleFpsChange = (rateVal: number) => {
    const rate = [1, 2, 5].includes(rateVal) ? (rateVal as 1 | 2 | 5) : 2;
    const nextSettings = {
      ...localSettings,
      captureRate: rate,
      captureFps: rate,
    };
    setLocalSettings(nextSettings);

    // Rate change takes effect in native loop on next cycle; DOES NOT recreate or duplicate the preview poller!
    if (localSettings.enabled) {
      void configureCapture(
        {
          enabled: true,
          saveDebugFrames: nextSettings.saveDebugFrames,
          captureFps: rate,
          mockSource: isMock,
        },
        isMock,
      ).catch(() => {});
    }

    onSave({
      ...currentSettings,
      screenIntelligence: nextSettings,
    });
  };

  const handleSourceModeChange = (captureSource: 'auto' | 'mock') => {
    const nextSettings = {
      ...localSettings,
      captureSource,
      sourceMode: captureSource,
    };
    setLocalSettings(nextSettings);
    const newMock = captureSource === 'mock' || Boolean(fixturePreview);

    if (localSettings.enabled) {
      const gen = ++toggleGenerationRef.current;
      void configureCapture(
        {
          enabled: true,
          saveDebugFrames: nextSettings.saveDebugFrames,
          captureFps: nextSettings.captureFps,
          mockSource: newMock,
        },
        newMock,
      )
        .then((st) => {
          if (toggleGenerationRef.current === gen) {
            setCaptureState(st);
          }
        })
        .catch(() => {});
      startPoller(gen, newMock);
    }

    onSave({
      ...currentSettings,
      screenIntelligence: nextSettings,
    });
  };

  const isUnavailable =
    captureState.state === 'error' || captureState.state === 'capture-unavailable';

  return (
    <section className="panel screen-intelligence-panel" aria-label="Screen Intelligence settings">
      <div className="panel-heading">
        <Monitor size={18} />
        <h2>Screen intelligence</h2>
        <span className="badge">LOCAL ONLY</span>
      </div>

      <p className="description">
        Reads visible TFT pixels locally to support future board/shop recognition.
      </p>

      <div className="privacy-badge-banner">
        <ShieldCheck size={16} />
        <span>
          Frames remain local in memory and are discarded immediately. Never uploaded.
        </span>
      </div>

      {isUnavailable && (
        <div className="screen-intel-error-banner" role="alert">
          <AlertCircle size={16} />
          <div>
            <strong>Capture unavailable</strong>
            <div>{captureState.errorMessage || 'Screen capture encountered an unexpected issue.'}</div>
          </div>
        </div>
      )}

      <div className="setting-checkbox-row">
        <label className="checkbox-label" htmlFor="screen-intel-enabled">
          <input
            id="screen-intel-enabled"
            type="checkbox"
            checked={localSettings.enabled}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
          />
          <strong>Enable live screen analysis</strong>
        </label>
        <span className="fine-print">Default OFF · Safe local screen capture only</span>
      </div>

      <div className="setting-checkbox-row">
        <label className="checkbox-label" htmlFor="screen-intel-save-debug">
          <input
            id="screen-intel-save-debug"
            type="checkbox"
            disabled={!localSettings.enabled}
            checked={localSettings.saveDebugFrames}
            onChange={(e) => handleToggleSaveDebug(e.target.checked)}
          />
          <strong>Save debug frames</strong>
        </label>
        <span className="fine-print">
          Default OFF · Normal operation does not permanently save screenshots
        </span>
      </div>

      <div className="screen-intel-controls-grid">
        <div className="control-item">
          <label htmlFor="screen-intel-fps">Capture rate</label>
          <select
            id="screen-intel-fps"
            value={localSettings.captureRate ?? localSettings.captureFps ?? 2}
            disabled={!localSettings.enabled}
            onChange={(e) => handleFpsChange(Number(e.target.value))}
          >
            <option value="1">1 FPS (Conservative)</option>
            <option value="2">2 FPS (Standard · Recommended)</option>
            <option value="5">5 FPS (High)</option>
          </select>
        </div>

        <div className="control-item">
          <label htmlFor="screen-intel-source">Capture source</label>
          <select
            id="screen-intel-source"
            value={localSettings.captureSource ?? localSettings.sourceMode ?? 'auto'}
            disabled={!localSettings.enabled}
            onChange={(e) => handleSourceModeChange(e.target.value as 'auto' | 'mock')}
          >
            <option value="auto">Auto (Windows TFT window)</option>
            <option value="mock">Mock fixture (Development)</option>
          </select>
        </div>
      </div>

      {/* Developer Debug Preview Panel */}
      <div className="debug-preview-container" aria-label="Developer capture preview">
        <div className="debug-preview-header">
          <div className="debug-preview-title">
            <Camera size={16} />
            <h3>Developer capture preview</h3>
          </div>
          <span className="fine-print">Visual validation only · Recommendation logic untouched</span>
        </div>

        <div className="debug-metrics-grid">
          <div className="metric-box">
            <span className="metric-label">TFT WINDOW</span>
            <div className="metric-value">
              {captureState.state === 'capturing' ? (
                <span className="status-pill active" title={captureState.windowTitle ?? undefined}>
                  <CheckCircle2 size={13} />
                  Detected
                </span>
              ) : captureState.state === 'waiting-for-tft' ? (
                <span className="status-pill waiting">
                  <RefreshCw size={13} className="spin" />
                  Waiting for TFT
                </span>
              ) : isUnavailable ? (
                <span className="status-pill error">
                  <AlertCircle size={13} />
                  Unavailable
                </span>
              ) : (
                <span className="status-pill disabled">Disabled</span>
              )}
            </div>
            <small className="metric-subtext">
              Window: {captureState.windowTitle || (captureState.state === 'capturing' ? 'TFT' : '—')}
            </small>
          </div>

          <div className="metric-box">
            <span className="metric-label">DETECTED PROCESS</span>
            <div className="metric-value">
              <span className={`status-pill ${captureState.state === 'capturing' ? 'active' : 'neutral'}`}>
                {captureState.processName || (captureState.state === 'capturing' ? 'TFTClient-Win64-Shipping' : '—')}
              </span>
            </div>
            <small className="metric-subtext">
              Detected process: {captureState.processName || (captureState.state === 'capturing' ? 'TFTClient-Win64-Shipping' : 'None')}
            </small>
          </div>

          <div className="metric-box">
            <span className="metric-label">CLIENT SIZE</span>
            <div className="metric-value">
              <strong>
                {typeof captureState.width === 'number' &&
                typeof captureState.height === 'number' &&
                Number.isFinite(captureState.width) &&
                Number.isFinite(captureState.height) &&
                captureState.width > 0 &&
                captureState.height > 0
                  ? `${captureState.width} × ${captureState.height}`
                  : '—'}
              </strong>
            </div>
            <small className="metric-subtext">
              Client size: {typeof captureState.width === 'number' && typeof captureState.height === 'number' && captureState.width > 0
                ? `${captureState.width} × ${captureState.height}`
                : '—'}
            </small>
          </div>

          <div className="metric-box">
            <span className="metric-label">CAPTURE SOURCE</span>
            <div className="metric-value">
              <span className={`status-pill ${captureState.state === 'capturing' ? 'active' : 'neutral'}`}>
                {captureState.state === 'capturing'
                  ? 'Active'
                  : captureState.state === 'disabled'
                    ? 'Disabled'
                    : isUnavailable
                      ? 'Unavailable'
                      : 'Idle'}
              </span>
            </div>
            <small className="metric-subtext">
              Capture source: {captureState.captureSource === 'none' ? 'None' : (captureState.captureSource || 'Windows TFT window')}
            </small>
          </div>

          <div className="metric-box">
            <span className="metric-label">CAPTURE FPS</span>
            <div className="metric-value">
              <strong>
                {captureState.state === 'capturing' &&
                typeof captureState.captureFps === 'number' &&
                Number.isFinite(captureState.captureFps) &&
                captureState.captureFps > 0
                  ? `${formatMetric(captureState.captureFps, 1)} FPS`
                  : '—'}
              </strong>
            </div>
            <small className="metric-subtext">
              Target: {formatMetric(screenSettings.captureFps, 0)} FPS
            </small>
          </div>

          <div className="metric-box">
            <span className="metric-label">LAST FRAME</span>
            <div className="metric-value">
              <small>
                {typeof captureState.lastFrameTimestamp === 'string' &&
                captureState.lastFrameTimestamp.trim().length > 0 &&
                !isNaN(Date.parse(captureState.lastFrameTimestamp))
                  ? new Date(captureState.lastFrameTimestamp).toLocaleTimeString()
                  : '—'}
              </small>
            </div>
            {captureState.debugSaving ? (
              <small className="metric-subtext saved">Debug frame saved</small>
            ) : typeof captureState.processingTimeMs === 'number' &&
              Number.isFinite(captureState.processingTimeMs) &&
              captureState.processingTimeMs > 0 ? (
              <small className="metric-subtext">
                Processed in {formatMetric(captureState.processingTimeMs, 1)} ms
              </small>
            ) : null}
          </div>
        </div>

        {/* Scaled Preview Frame */}
        <div className="preview-viewport">
          {preview?.dataBase64 ? (
            <div className="preview-frame-wrapper">
              <img
                src={preview.dataBase64}
                alt="Captured TFT frame preview"
                className="screen-preview-image"
              />
              <div className="preview-watermark">
                <span>
                  PREVIEW · {formatMetric(preview?.width, 0)}×{formatMetric(preview?.height, 0)}
                </span>
              </div>
            </div>
          ) : (
            <div className="preview-placeholder">
              <Camera size={36} />
              <p>
                {!screenSettings.enabled
                  ? 'Screen analysis is disabled. Enable above to begin capture.'
                  : isUnavailable
                    ? 'Capture unavailable: ' + (captureState.errorMessage || 'Please check display permissions.')
                    : 'Waiting for TFT client window to be detected…'}
              </p>
              <span className="fine-print">
                Supports borderless and windowed modes across standard resolutions.
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
