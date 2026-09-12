import { invoke } from '@tauri-apps/api/core';

export type TrackerAuditEventType =
  | 'PURCHASE_CANDIDATE'
  | 'PURCHASE_RESOLVED'
  | 'MOVE'
  | 'AMBIGUOUS_MOVE'
  | 'COMBINE'
  | 'POSSIBLE_SALE'
  | 'TRACK_CREATED'
  | 'TRACK_REMOVED'
  | 'IDENTITY_ASSIGNED'
  | 'IDENTITY_LOST'
  | 'AMBIGUITY_CREATED'
  | 'AMBIGUITY_RESOLVED';

export type ManualLabelStatus =
  | 'CORRECT'
  | 'WRONG'
  | 'MISSED_EVENT'
  | 'UNRESOLVED';

export type MissedEventType =
  | 'MISSED_PURCHASE'
  | 'MISSED_MOVE'
  | 'MISSED_COMBINE'
  | 'MISSED_SALE';

export interface TrackerAuditEvent {
  auditSessionId: string;
  eventId: string;
  eventType: TrackerAuditEventType | string;
  timestamp: number;
  frameGeneration: number;
  championId?: string | null;
  championName?: string | null;
  trackId?: string | null;
  sourceLocation?: string | null;
  destinationLocation?: string | null;
  confidence?: number | null;
  identitySource?: string | null;
  relatedShopSlot?: number | null;
  relatedPurchaseEventId?: string | null;
  ambiguityGroupId?: string | null;
  cropPaths?: string[];
}

export interface ManualLabel {
  eventId: string;
  status: ManualLabelStatus;
  actualChampionId?: string | null;
  actualChampionName?: string | null;
  actualSourceLocation?: string | null;
  actualDestinationLocation?: string | null;
  notes?: string | null;
  labeledAt: number;
}

export interface MissedEvent {
  missedType: MissedEventType;
  timestamp: number;
  frameGeneration?: number | null;
  championId?: string | null;
  championName?: string | null;
  sourceLocation?: string | null;
  destinationLocation?: string | null;
  notes?: string | null;
}

export interface PurchaseMetrics {
  observedPurchases: number;
  detectedPurchases: number;
  truePositives: number;
  falsePositives: number;
  missed: number;
  precision: number;
  recall: number;
}

export interface IdentityMetrics {
  assignments: number;
  correct: number;
  wrong: number;
  unresolved: number;
  emittedAccuracy: number;
  coverage: number;
}

export interface MovementMetrics {
  observed: number;
  correct: number;
  wrong: number;
  ambiguous: number;
  accuracy: number;
  coverage: number;
}

export interface CombineMetrics {
  observed: number;
  correct: number;
  wrong: number;
  unresolved: number;
}

export interface SaleMetrics {
  observed: number;
  correct: number;
  wrong: number;
  unresolved: number;
}

export interface CoverageMetrics {
  minCoverage: number;
  meanCoverage: number;
  maxCoverage: number;
  finalCoverage: number;
}

export interface LatencyMetrics {
  timeToIdentityAfterPurchaseMs: number;
  timeToResolveMoveMs: number;
  pendingEventAgeMs: number;
}

export interface AuditMetricsSummary {
  purchase: PurchaseMetrics;
  identity: IdentityMetrics;
  movement: MovementMetrics;
  combine: CombineMetrics;
  sale: SaleMetrics;
  coverage: CoverageMetrics;
  latency: LatencyMetrics;
}

export interface AuditSessionStatus {
  active: boolean;
  auditSessionId: string | null;
  startTime: number | null;
  durationSeconds: number;
  framesObserved: number;
  saveCrops: boolean;
  eventCount: number;
  events: TrackerAuditEvent[];
  labelsCount: number;
  missedCount: number;
  metrics: AuditMetricsSummary;
}

export interface AuditExportPayload {
  sessionMetadata: Record<string, unknown>;
  resolution: string;
  captureFps: number;
  trackerVersion: string;
  shopVisionVersion: string;
  benchLayoutVersion: string;
  boardLayoutVersion: string;
  events: TrackerAuditEvent[];
  manualLabels: ManualLabel[];
  missedEvents: MissedEvent[];
  metrics: AuditMetricsSummary;
}

// In-memory mock store for testing and browser preview
let mockAuditSessionStatus: AuditSessionStatus = createDefaultAuditSessionStatus();
const mockLabels: Map<string, ManualLabel> = new Map();
const mockMissed: MissedEvent[] = [];

export function createDefaultAuditMetrics(): AuditMetricsSummary {
  return {
    purchase: {
      observedPurchases: 0,
      detectedPurchases: 0,
      truePositives: 0,
      falsePositives: 0,
      missed: 0,
      precision: 1.0,
      recall: 1.0,
    },
    identity: {
      assignments: 0,
      correct: 0,
      wrong: 0,
      unresolved: 0,
      emittedAccuracy: 1.0,
      coverage: 0.0,
    },
    movement: {
      observed: 0,
      correct: 0,
      wrong: 0,
      ambiguous: 0,
      accuracy: 1.0,
      coverage: 0.0,
    },
    combine: {
      observed: 0,
      correct: 0,
      wrong: 0,
      unresolved: 0,
    },
    sale: {
      observed: 0,
      correct: 0,
      wrong: 0,
      unresolved: 0,
    },
    coverage: {
      minCoverage: 0.0,
      meanCoverage: 0.0,
      maxCoverage: 0.0,
      finalCoverage: 0.0,
    },
    latency: {
      timeToIdentityAfterPurchaseMs: 0.0,
      timeToResolveMoveMs: 0.0,
      pendingEventAgeMs: 0.0,
    },
  };
}

export function createDefaultAuditSessionStatus(): AuditSessionStatus {
  return {
    active: false,
    auditSessionId: null,
    startTime: null,
    durationSeconds: 0,
    framesObserved: 0,
    saveCrops: false,
    eventCount: 0,
    events: [],
    labelsCount: 0,
    missedCount: 0,
    metrics: createDefaultAuditMetrics(),
  };
}

export function setMockAuditSessionStatus(status: AuditSessionStatus): void {
  mockAuditSessionStatus = status;
}

export async function startOwnedUnitAudit(saveCrops = false, forceMock = false): Promise<AuditSessionStatus> {
  if (forceMock || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    mockAuditSessionStatus = {
      ...createDefaultAuditSessionStatus(),
      active: true,
      auditSessionId: `audit-mock-${Date.now()}`,
      startTime: Date.now(),
      saveCrops,
    };
    mockLabels.clear();
    mockMissed.length = 0;
    return mockAuditSessionStatus;
  }
  try {
    return await invoke<AuditSessionStatus>('start_owned_unit_audit', { saveCrops });
  } catch {
    return mockAuditSessionStatus;
  }
}

export async function stopOwnedUnitAudit(forceMock = false): Promise<AuditSessionStatus> {
  if (forceMock || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    mockAuditSessionStatus = {
      ...mockAuditSessionStatus,
      active: false,
    };
    return mockAuditSessionStatus;
  }
  try {
    return await invoke<AuditSessionStatus>('stop_owned_unit_audit');
  } catch {
    return mockAuditSessionStatus;
  }
}

export async function getOwnedUnitAuditStatus(forceMock = false): Promise<AuditSessionStatus> {
  if (forceMock || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return mockAuditSessionStatus;
  }
  try {
    return await invoke<AuditSessionStatus>('get_owned_unit_audit_status');
  } catch {
    return mockAuditSessionStatus;
  }
}

export async function clearOwnedUnitAudit(forceMock = false): Promise<AuditSessionStatus> {
  if (forceMock || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    mockAuditSessionStatus = createDefaultAuditSessionStatus();
    mockLabels.clear();
    mockMissed.length = 0;
    return mockAuditSessionStatus;
  }
  try {
    return await invoke<AuditSessionStatus>('clear_owned_unit_audit');
  } catch {
    return mockAuditSessionStatus;
  }
}

export async function exportOwnedUnitAudit(forceMock = false): Promise<AuditExportPayload> {
  if (forceMock || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return {
      sessionMetadata: {
        auditSessionId: mockAuditSessionStatus.auditSessionId ?? 'mock',
        startTime: mockAuditSessionStatus.startTime,
        durationSeconds: mockAuditSessionStatus.durationSeconds,
      },
      resolution: '1920x1080',
      captureFps: 2.0,
      trackerVersion: 'tracker-v1',
      shopVisionVersion: 'shop-vision-v1',
      benchLayoutVersion: 'tft-bench-1080p-v1',
      boardLayoutVersion: 'tft-board-1080p-v1',
      events: mockAuditSessionStatus.events,
      manualLabels: Array.from(mockLabels.values()),
      missedEvents: [...mockMissed],
      metrics: mockAuditSessionStatus.metrics,
    };
  }
  try {
    return await invoke<AuditExportPayload>('export_owned_unit_audit');
  } catch {
    return {
      sessionMetadata: {},
      resolution: '1920x1080',
      captureFps: 2.0,
      trackerVersion: 'tracker-v1',
      shopVisionVersion: 'shop-vision-v1',
      benchLayoutVersion: 'tft-bench-1080p-v1',
      boardLayoutVersion: 'tft-board-1080p-v1',
      events: [],
      manualLabels: [],
      missedEvents: [],
      metrics: createDefaultAuditMetrics(),
    };
  }
}

export async function addManualAuditLabel(label: ManualLabel, forceMock = false): Promise<AuditSessionStatus> {
  if (forceMock || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    mockLabels.set(label.eventId, label);
    mockAuditSessionStatus.labelsCount = mockLabels.size;
    return mockAuditSessionStatus;
  }
  try {
    return await invoke<AuditSessionStatus>('add_manual_audit_label', { label });
  } catch {
    return mockAuditSessionStatus;
  }
}

export async function addMissedAuditEvent(missed: MissedEvent, forceMock = false): Promise<AuditSessionStatus> {
  if (forceMock || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    mockMissed.push(missed);
    mockAuditSessionStatus.missedCount = mockMissed.length;
    return mockAuditSessionStatus;
  }
  try {
    return await invoke<AuditSessionStatus>('add_missed_audit_event', { missed });
  } catch {
    return mockAuditSessionStatus;
  }
}
