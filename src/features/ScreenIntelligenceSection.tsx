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
import {
  getScreenShopStatus,
  type ScreenShopStatus,
} from '../services/screenShop';
import {
  getScreenOwnedUnitsStatus,
  type ScreenOwnedUnitsStatus,
} from '../services/screenOwnedUnits';
import {
  startOwnedUnitAudit,
  stopOwnedUnitAudit,
  getOwnedUnitAuditStatus,
  clearOwnedUnitAudit,
  exportOwnedUnitAudit,
  addManualAuditLabel,
  addMissedAuditEvent,
  type AuditSessionStatus,
  type ManualLabelStatus,
  type MissedEventType,
} from '../services/ownedUnitAudit';

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

  const [shopStatus, setShopStatus] = useState<ScreenShopStatus | null>(
    fixturePreview
      ? {
          available: true,
          detected: true,
          frameAgeMs: 50,
          processingTimeMs: 12.5,
          recognitionVersion: 'shop-vision-v1',
          generation: 1,
          shopRegion: { x: 448, y: 920, width: 1000, height: 154 },
          slots: [
            { index: 0, championId: 'DA_18_Annie', championName: 'Annie', cost: 2, confidence: 0.96, secondBestConfidence: 0.54, margin: 0.42, stable: true, stableFrames: 4, rect: { x: 448, y: 920, width: 192, height: 154 } },
            { index: 1, championId: 'DA_18_Jhin', championName: 'Jhin', cost: 4, confidence: 0.91, secondBestConfidence: 0.60, margin: 0.31, stable: true, stableFrames: 3, rect: { x: 650, y: 920, width: 192, height: 154 } },
            { index: 2, championId: 'DA_KogMaw18_AD', championName: "Kog'Maw", cost: 1, confidence: 0.94, secondBestConfidence: 0.55, margin: 0.39, stable: true, stableFrames: 5, rect: { x: 852, y: 920, width: 192, height: 154 } },
            { index: 3, championId: 'DA_18_Viego', championName: 'Viego', cost: 3, confidence: 0.89, secondBestConfidence: 0.52, margin: 0.37, stable: true, stableFrames: 2, rect: { x: 1054, y: 920, width: 192, height: 154 } },
            { index: 4, championId: 'DA_18_Caitlyn', championName: 'Caitlyn', cost: 5, confidence: 0.97, secondBestConfidence: 0.48, margin: 0.49, stable: true, stableFrames: 6, rect: { x: 1256, y: 920, width: 192, height: 154 } },
          ],
        }
      : null,
  );

  const [ownedStatus, setOwnedStatus] = useState<ScreenOwnedUnitsStatus | null>(null);
  const [auditStatus, setAuditStatus] = useState<AuditSessionStatus | null>(null);
  const [saveAuditCrops, setSaveAuditCrops] = useState<boolean>(false);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);
  const [activeLabelEventId, setActiveLabelEventId] = useState<string | null>(null);
  const [correctionChamp, setCorrectionChamp] = useState<string>('');
  const [correctionLocation, setCorrectionLocation] = useState<string>('');
  const [showMissedForm, setShowMissedForm] = useState<boolean>(false);
  const [missedType, setMissedType] = useState<MissedEventType>('MISSED_PURCHASE');
  const [missedChamp, setMissedChamp] = useState<string>('');
  const [missedSource, setMissedSource] = useState<string>('');
  const [missedDest, setMissedDest] = useState<string>('');
  const [missedNotes, setMissedNotes] = useState<string>('');

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
          void getScreenShopStatus(mock).then((status) => {
            if (toggleGenerationRef.current === gen) {
              setShopStatus(status);
            }
          });
          void getScreenOwnedUnitsStatus(mock).then((status) => {
            if (toggleGenerationRef.current === gen) {
              setOwnedStatus(status);
            }
          });
          void getOwnedUnitAuditStatus(mock).then((status) => {
            if (toggleGenerationRef.current === gen) {
              setAuditStatus(status);
            }
          });
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
      setShopStatus(null);
      setOwnedStatus(null);
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

  const handleStartAudit = async () => {
    try {
      const res = await startOwnedUnitAudit(saveAuditCrops, isMock);
      setAuditStatus(res);
      setAuditMessage(`Audit active: ${res.auditSessionId}`);
    } catch (e) {
      setAuditMessage(`Failed to start audit: ${String(e)}`);
    }
  };

  const handleStopAudit = async () => {
    try {
      const res = await stopOwnedUnitAudit(isMock);
      setAuditStatus(res);
      setAuditMessage(`Audit stopped: ${res.auditSessionId}`);
    } catch (e) {
      setAuditMessage(`Failed to stop audit: ${String(e)}`);
    }
  };

  const handleClearAudit = async () => {
    try {
      const res = await clearOwnedUnitAudit(isMock);
      setAuditStatus(res);
      setAuditMessage('Audit cleared');
    } catch (e) {
      setAuditMessage(`Failed to clear audit: ${String(e)}`);
    }
  };

  const handleExportAudit = async () => {
    try {
      const res = await exportOwnedUnitAudit(isMock);
      setAuditMessage(`Exported audit with ${res.events.length} events to artifacts/`);
    } catch (e) {
      setAuditMessage(`Failed to export audit: ${String(e)}`);
    }
  };

  const handleLabelEvent = async (eventId: string, status: ManualLabelStatus) => {
    try {
      const label = {
        eventId,
        status,
        actualChampionName: correctionChamp.trim() || undefined,
        actualDestinationLocation: correctionLocation.trim() || undefined,
        labeledAt: Date.now(),
      };
      const res = await addManualAuditLabel(label, isMock);
      setAuditStatus(res);
      setActiveLabelEventId(null);
      setCorrectionChamp('');
      setCorrectionLocation('');
    } catch (e) {
      setAuditMessage(`Labeling failed: ${String(e)}`);
    }
  };

  const handleAddMissed = async () => {
    try {
      const missed = {
        missedType,
        timestamp: Date.now(),
        championName: missedChamp.trim() || undefined,
        sourceLocation: missedSource.trim() || undefined,
        destinationLocation: missedDest.trim() || undefined,
        notes: missedNotes.trim() || undefined,
      };
      const res = await addMissedAuditEvent(missed, isMock);
      setAuditStatus(res);
      setShowMissedForm(false);
      setMissedChamp('');
      setMissedSource('');
      setMissedDest('');
      setMissedNotes('');
      setAuditMessage(`Recorded missed event: ${missedType}`);
    } catch (e) {
      setAuditMessage(`Adding missed event failed: ${String(e)}`);
    }
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

        {/* Compact Live Tracker Diagnostic Summary */}
        <div className="tracker-live-summary-card" data-testid="tracker-live-summary">
          <div className="tracker-summary-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="tracker-cov-badge" data-testid="tracker-cov-badge">
                COV {ownedStatus?.identityCoverage != null ? `${Math.round(ownedStatus.identityCoverage * 100)}%` : '—'}
              </span>
              <span className="fine-print">Owned-Unit Tracker Diagnostics</span>
            </div>
            <div className="tracker-stats-inline">
              <span>Pending purchases: <strong data-testid="tracker-pending-count">{ownedStatus?.pendingPurchases ?? 0}</strong></span>
              <span>Ambiguities: <strong data-testid="tracker-ambiguities-count">{ownedStatus?.ambiguityGroups ?? 0}</strong></span>
            </div>
          </div>

          <div className="tracker-owned-pills" data-testid="tracker-known-owned">
            <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>Known owned:</span>
            {ownedStatus?.knownOwned && ownedStatus.knownOwned.length > 0 ? (
              ownedStatus.knownOwned.map((k) => (
                <span key={k.championId} className="tracker-owned-pill" data-testid={`known-owned-${k.championId}`}>
                  {k.championName} ×{k.knownCopyEquivalent ?? k.knownTrackCount}
                </span>
              ))
            ) : (
              <span style={{ color: '#64748b', fontSize: '11px' }}>None tracked</span>
            )}
          </div>

          {ownedStatus?.recentEvents && ownedStatus.recentEvents.length > 0 && (
            <div className="tracker-recent-ticker" data-testid="tracker-recent-ticker">
              <span style={{ color: '#94a3b8' }}>Recent:</span>
              {ownedStatus.recentEvents.slice(0, 5).map((ev, i) => (
                <span key={i} style={{ marginRight: '10px' }}>{ev.text}</span>
              ))}
            </div>
          )}
        </div>

        {/* Scaled Preview Frame */}
        <div className="preview-viewport">
          {preview?.dataBase64 ? (
            <div className="preview-frame-wrapper" style={{ position: 'relative' }}>
              <img
                src={preview.dataBase64}
                alt="Captured TFT frame preview"
                className="screen-preview-image"
              />
              {(shopStatus?.detected || ownedStatus?.detected) && (
                <svg
                  className="shop-overlay-svg"
                  data-testid="shop-overlay-svg"
                  viewBox={`0 0 ${captureState.width || 1920} ${captureState.height || 1080}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                >
                  {/* Playable Board: 28 Perspective Hex Outlines */}
                  {ownedStatus?.detected &&
                    ownedStatus.board.map((cell) => {
                      const cx = cell.rect.x + cell.rect.width / 2;
                      const cy = cell.rect.y + cell.rect.height / 2;
                      const rx = cell.rect.width * 0.46;
                      const ry = cell.rect.height * 0.42;
                      const points = `${cx - rx},${cy} ${cx - rx * 0.5},${cy - ry} ${cx + rx * 0.5},${cy - ry} ${cx + rx},${cy} ${cx + rx * 0.5},${cy + ry} ${cx - rx * 0.5},${cy + ry}`;

                      const isOccupied = cell.occupancy === 'occupied';
                      const isUnknown = cell.occupancy === 'unknown';
                      const strokeColor = isOccupied ? '#22c55e' : isUnknown ? '#f59e0b' : 'rgba(148, 163, 184, 0.25)';
                      const fillColor = isOccupied ? 'rgba(34, 197, 94, 0.18)' : isUnknown ? 'rgba(245, 158, 11, 0.10)' : 'none';
                      const strokeWidth = isOccupied ? '2.5' : isUnknown ? '2' : '1';
                      const strokeDash = isUnknown ? '4 3' : 'none';

                      const boardLabel = isOccupied
                        ? (cell.championName ? `H${cell.hex + 1}: ${cell.championName}` : `H${cell.hex + 1}: ?`)
                        : '?';
                      const chipWidth = Math.max(38, boardLabel.length * 6.5 + 8);

                      return (
                        <g key={`board-hex-${cell.hex}`} data-testid={`board-hex-overlay-${cell.hex}`}>
                          <polygon
                            points={points}
                            fill={fillColor}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                            strokeDasharray={strokeDash}
                          />
                          {(isOccupied || isUnknown) && (
                            <g>
                              <rect
                                x={cx - chipWidth / 2}
                                y={cy - 9}
                                width={chipWidth}
                                height={18}
                                rx="3"
                                fill="rgba(8, 12, 20, 0.85)"
                                stroke={strokeColor}
                                strokeWidth="1"
                              />
                              <text
                                x={cx}
                                y={cy + 3.5}
                                fill={strokeColor}
                                fontFamily="ui-monospace, monospace, sans-serif"
                                fontSize="10"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                {boardLabel}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                  {/* Bench: 9 Slot Outlines and Badges */}
                  {ownedStatus?.detected &&
                    ownedStatus.bench.map((slot) => {
                      const isOccupied = slot.occupancy === 'occupied';
                      const isUnknown = slot.occupancy === 'unknown';
                      const strokeColor = isOccupied ? '#22c55e' : isUnknown ? '#f59e0b' : 'rgba(148, 163, 184, 0.35)';
                      const fillColor = isOccupied ? 'rgba(34, 197, 94, 0.12)' : isUnknown ? 'rgba(245, 158, 11, 0.08)' : 'none';
                      const badgeText = isOccupied
                        ? (slot.championName ? `B${slot.slot + 1}: ${slot.championName}` : `B${slot.slot + 1}: ?`)
                        : isUnknown
                        ? `B${slot.slot + 1}: ?`
                        : `B${slot.slot + 1}: EMPTY`;

                      return (
                        <g key={`bench-slot-${slot.slot}`} data-testid={`bench-slot-overlay-${slot.slot}`}>
                          <rect
                            x={slot.rect.x}
                            y={slot.rect.y}
                            width={slot.rect.width}
                            height={slot.rect.height}
                            fill={fillColor}
                            stroke={strokeColor}
                            strokeWidth={isOccupied ? '2.5' : isUnknown ? '2' : '1.5'}
                            strokeDasharray={isUnknown ? '4 3' : 'none'}
                            rx="4"
                          />
                          <rect
                            x={slot.rect.x + 2}
                            y={slot.rect.y + slot.rect.height - 24}
                            width={slot.rect.width - 4}
                            height="20"
                            rx="3"
                            fill="rgba(8, 12, 20, 0.88)"
                            stroke={strokeColor}
                            strokeWidth="1"
                          />
                          <text
                            x={slot.rect.x + slot.rect.width / 2}
                            y={slot.rect.y + slot.rect.height - 10}
                            fill={strokeColor}
                            fontFamily="ui-monospace, monospace, sans-serif"
                            fontSize="11"
                            fontWeight="bold"
                            textAnchor="middle"
                          >
                            {badgeText}
                          </text>
                        </g>
                      );
                    })}

                  {/* Shop outer rectangle */}
                  {shopStatus?.detected && (
                    <>
                      <rect
                        x={shopStatus.shopRegion.x}
                        y={shopStatus.shopRegion.y}
                        width={shopStatus.shopRegion.width}
                        height={shopStatus.shopRegion.height}
                        fill="rgba(200, 170, 110, 0.05)"
                        stroke="#c8aa6e"
                        strokeWidth="3"
                        strokeDasharray="8 4"
                      />
                      {/* 5 Slot rectangles and badges */}
                      {shopStatus.slots.map((slot) => {
                        const badgeText = slot.championName
                          ? `[${slot.index + 1} ${slot.championName} ${Math.round(slot.confidence * 100)}%]`
                          : `[${slot.index + 1} UNKNOWN]`;
                        const hasMatch = Boolean(slot.championName);
                        const strokeColor = hasMatch ? '#00e5ff' : '#6b7280';
                        const textColor = hasMatch ? '#00e5ff' : '#9ca3af';

                        return (
                          <g key={slot.index} data-testid={`shop-slot-overlay-${slot.index}`}>
                            {/* Slot card outline */}
                            <rect
                              x={slot.rect.x}
                              y={slot.rect.y}
                              width={slot.rect.width}
                              height={slot.rect.height}
                              fill={hasMatch ? 'rgba(0, 229, 255, 0.05)' : 'none'}
                              stroke={strokeColor}
                              strokeWidth="2.5"
                              rx="4"
                            />
                            {/* Overlay text pill at top of slot */}
                            <rect
                              x={slot.rect.x + 4}
                              y={slot.rect.y + 6}
                              width={slot.rect.width - 8}
                              height="28"
                              rx="4"
                              fill="rgba(8, 12, 20, 0.88)"
                              stroke={strokeColor}
                              strokeWidth="1"
                            />
                            <text
                              x={slot.rect.x + slot.rect.width / 2}
                              y={slot.rect.y + 25}
                              fill={textColor}
                              fontFamily="ui-monospace, monospace, sans-serif"
                              fontSize="13"
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              {badgeText}
                            </text>
                          </g>
                        );
                      })}
                    </>
                  )}
                </svg>
              )}
              <div className="preview-watermark">
                <span>
                  PREVIEW · {formatMetric(preview?.width, 0)}×{formatMetric(preview?.height, 0)}
                  {shopStatus?.detected && ` · SHOP (${formatMetric(shopStatus.processingTimeMs, 1)}ms)`}
                  {ownedStatus?.detected &&
                    ` · UNITS (${formatMetric(ownedStatus.processingTimeMs, 1)}ms${
                      ownedStatus.identityCoverage != null
                        ? ` · COV ${Math.round(ownedStatus.identityCoverage * 100)}%`
                        : ''
                    })`}
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

        {/* M14C.6 Live Owned-Unit Tracker Audit Harness */}
        <div className="audit-section-container" data-testid="audit-section-container" style={{ marginTop: '20px', borderTop: '1px solid rgba(148, 163, 184, 0.2)', paddingTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Live Owned-Unit Tracker Audit Harness
            </h4>
            <span className="fine-print">Development Only · Zero Strategy Impact</span>
          </div>

          {auditMessage && (
            <div style={{ fontSize: '11px', color: '#38bdf8', marginBottom: '8px', fontFamily: 'monospace' }}>
              ℹ {auditMessage}
            </div>
          )}

          {/* Audit Controls Bar */}
          <div className="audit-control-bar" data-testid="audit-controls">
            <div className="audit-btn-group">
              {!auditStatus?.active ? (
                <button
                  type="button"
                  className="audit-btn primary"
                  onClick={() => void handleStartAudit()}
                  data-testid="start-audit-btn"
                >
                  Start Owned-Unit Audit
                </button>
              ) : (
                <button
                  type="button"
                  className="audit-btn danger"
                  onClick={() => void handleStopAudit()}
                  data-testid="stop-audit-btn"
                >
                  Stop audit
                </button>
              )}

              <button
                type="button"
                className="audit-btn secondary"
                onClick={() => void handleExportAudit()}
                disabled={!auditStatus?.auditSessionId && (!auditStatus?.events || auditStatus.events.length === 0)}
                data-testid="export-audit-btn"
              >
                Export audit
              </button>

              <button
                type="button"
                className="audit-btn secondary"
                onClick={() => void handleClearAudit()}
                disabled={!auditStatus?.auditSessionId && (!auditStatus?.events || auditStatus.events.length === 0)}
                data-testid="clear-audit-btn"
              >
                Clear current audit
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#cbd5e1', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={saveAuditCrops}
                onChange={(e) => setSaveAuditCrops(e.target.checked)}
                data-testid="save-audit-crops-checkbox"
              />
              <span>Save audit crops (Event ROIs only)</span>
            </label>
          </div>

          {/* Live Metrics Dashboard */}
          <div className="audit-metrics-dashboard" data-testid="audit-metrics-dashboard">
            <div className="audit-metric-card">
              <span className="card-label">Duration</span>
              <span className="card-value">{auditStatus?.durationSeconds ?? 0}s</span>
              <span className="card-subtext">{auditStatus?.framesObserved ?? 0} frames</span>
            </div>

            <div className="audit-metric-card">
              <span className="card-label">Purchases</span>
              <span className="card-value">
                {auditStatus?.metrics.purchase.detectedPurchases ?? 0} det
              </span>
              <span className="card-subtext">
                Prec: {formatMetric((auditStatus?.metrics.purchase.precision ?? 1) * 100, 1)}% · Rec: {formatMetric((auditStatus?.metrics.purchase.recall ?? 1) * 100, 1)}%
              </span>
            </div>

            <div className="audit-metric-card">
              <span className="card-label">Identities</span>
              <span className="card-value">{auditStatus?.metrics.identity.assignments ?? 0} assigned</span>
              <span className="card-subtext">
                Acc: {formatMetric((auditStatus?.metrics.identity.emittedAccuracy ?? 1) * 100, 1)}%
              </span>
            </div>

            <div className="audit-metric-card">
              <span className="card-label">Moves</span>
              <span className="card-value">{auditStatus?.metrics.movement.observed ?? 0} moves</span>
              <span className="card-subtext">
                Acc: {formatMetric((auditStatus?.metrics.movement.accuracy ?? 1) * 100, 1)}%
              </span>
            </div>

            <div className="audit-metric-card">
              <span className="card-label">Ambiguities</span>
              <span className="card-value">{auditStatus?.metrics.movement.ambiguous ?? 0}</span>
              <span className="card-subtext">groups created</span>
            </div>

            <div className="audit-metric-card">
              <span className="card-label">Combines</span>
              <span className="card-value">{auditStatus?.metrics.combine.observed ?? 0}</span>
              <span className="card-subtext">auto 2★ merges</span>
            </div>

            <div className="audit-metric-card">
              <span className="card-label">Sales</span>
              <span className="card-value">{auditStatus?.metrics.sale.observed ?? 0}</span>
              <span className="card-subtext">resolved removals</span>
            </div>

            <div className="audit-metric-card">
              <span className="card-label">Coverage</span>
              <span className="card-value">
                {auditStatus?.metrics.coverage ? `${Math.round(auditStatus.metrics.coverage.finalCoverage * 100)}%` : '—'}
              </span>
              <span className="card-subtext">
                Mean: {auditStatus?.metrics.coverage ? `${Math.round(auditStatus.metrics.coverage.meanCoverage * 100)}%` : '—'}
              </span>
            </div>
          </div>

          {/* Missed Events Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Ground Truth & Recall Validation:</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="audit-label-btn"
                style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}
                onClick={() => { setMissedType('MISSED_PURCHASE'); setShowMissedForm(true); }}
              >
                + Missed purchase
              </button>
              <button
                type="button"
                className="audit-label-btn"
                style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' }}
                onClick={() => { setMissedType('MISSED_MOVE'); setShowMissedForm(true); }}
              >
                + Missed move
              </button>
              <button
                type="button"
                className="audit-label-btn"
                style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#facc15' }}
                onClick={() => { setMissedType('MISSED_COMBINE'); setShowMissedForm(true); }}
              >
                + Missed combine
              </button>
              <button
                type="button"
                className="audit-label-btn"
                style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}
                onClick={() => { setMissedType('MISSED_SALE'); setShowMissedForm(true); }}
              >
                + Missed sale
              </button>
            </div>
          </div>

          {showMissedForm && (
            <div className="audit-missed-form" data-testid="missed-event-form">
              <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{missedType}:</span>
              <input
                type="text"
                placeholder="Champion (e.g. Rek'Sai)"
                value={missedChamp}
                onChange={(e) => setMissedChamp(e.target.value)}
                style={{ padding: '3px 6px', fontSize: '11px', background: '#0b1120', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px' }}
              />
              <input
                type="text"
                placeholder="Source (e.g. B2, S3)"
                value={missedSource}
                onChange={(e) => setMissedSource(e.target.value)}
                style={{ padding: '3px 6px', fontSize: '11px', background: '#0b1120', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px', width: '100px' }}
              />
              <input
                type="text"
                placeholder="Dest (e.g. H14)"
                value={missedDest}
                onChange={(e) => setMissedDest(e.target.value)}
                style={{ padding: '3px 6px', fontSize: '11px', background: '#0b1120', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px', width: '100px' }}
              />
              <input
                type="text"
                placeholder="Notes..."
                value={missedNotes}
                onChange={(e) => setMissedNotes(e.target.value)}
                style={{ padding: '3px 6px', fontSize: '11px', background: '#0b1120', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px', flex: 1 }}
              />
              <button
                type="button"
                className="audit-btn primary"
                style={{ padding: '3px 8px', fontSize: '11px' }}
                onClick={() => void handleAddMissed()}
              >
                Save Missed
              </button>
              <button
                type="button"
                className="audit-btn secondary"
                style={{ padding: '3px 8px', fontSize: '11px' }}
                onClick={() => setShowMissedForm(false)}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Detected Events Labeling Table */}
          <div className="audit-events-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                Recent Detected Events ({auditStatus?.events ? auditStatus.events.length : 0})
              </span>
              <span className="fine-print">Label detected events as ground truth</span>
            </div>

            <div className="audit-events-table-wrapper" data-testid="audit-events-table-wrapper">
              <table className="audit-events-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Gen</th>
                    <th>Predicted Details</th>
                    <th>Conf</th>
                    <th>Ground Truth Label</th>
                  </tr>
                </thead>
                <tbody>
                  {auditStatus?.events && auditStatus.events.length > 0 ? (
                    auditStatus.events.slice(-25).reverse().map((ev) => {
                      const badgeClass = ev.eventType.includes('PURCHASE') ? 'purchase' :
                        ev.eventType.includes('MOVE') ? 'move' :
                        ev.eventType.includes('COMBINE') ? 'combine' :
                        ev.eventType.includes('SALE') ? 'sale' : 'other';

                      const details = ev.championName
                        ? `${ev.championName}${ev.sourceLocation ? ` (${ev.sourceLocation} → ${ev.destinationLocation ?? '?'})` : ''}`
                        : ev.sourceLocation
                        ? `${ev.sourceLocation} → ${ev.destinationLocation ?? '?'}`
                        : '—';

                      return (
                        <tr key={ev.eventId} data-testid={`event-row-${ev.eventId}`}>
                          <td><span className={`audit-badge ${badgeClass}`}>{ev.eventType}</span></td>
                          <td>{ev.frameGeneration}</td>
                          <td>{details}</td>
                          <td>{ev.confidence != null ? `${Math.round(ev.confidence * 100)}%` : '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="audit-label-btn correct"
                              onClick={() => void handleLabelEvent(ev.eventId, 'CORRECT')}
                            >
                              CORRECT
                            </button>
                            <button
                              type="button"
                              className="audit-label-btn wrong"
                              onClick={() => {
                                if (activeLabelEventId === ev.eventId) {
                                  void handleLabelEvent(ev.eventId, 'WRONG');
                                } else {
                                  setActiveLabelEventId(ev.eventId);
                                }
                              }}
                            >
                              WRONG
                            </button>
                            <button
                              type="button"
                              className="audit-label-btn unresolved"
                              onClick={() => void handleLabelEvent(ev.eventId, 'UNRESOLVED')}
                            >
                              UNRESOLVED
                            </button>

                            {activeLabelEventId === ev.eventId && (
                              <div style={{ display: 'inline-flex', gap: '4px', marginLeft: '6px' }}>
                                <input
                                  type="text"
                                  placeholder="Actual champ"
                                  value={correctionChamp}
                                  onChange={(e) => setCorrectionChamp(e.target.value)}
                                  style={{ width: '80px', fontSize: '10px', padding: '1px 4px', background: '#0b1120', border: '1px solid #334155', color: '#f8fafc', borderRadius: '3px' }}
                                />
                                <input
                                  type="text"
                                  placeholder="Actual dest"
                                  value={correctionLocation}
                                  onChange={(e) => setCorrectionLocation(e.target.value)}
                                  style={{ width: '60px', fontSize: '10px', padding: '1px 4px', background: '#0b1120', border: '1px solid #334155', color: '#f8fafc', borderRadius: '3px' }}
                                />
                                <button
                                  type="button"
                                  className="audit-label-btn"
                                  style={{ background: '#3b82f6', color: '#fff' }}
                                  onClick={() => void handleLabelEvent(ev.eventId, 'WRONG')}
                                >
                                  Save
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: '#64748b', padding: '14px' }}>
                        No audit events recorded yet. Click "Start Owned-Unit Audit" above to begin.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
