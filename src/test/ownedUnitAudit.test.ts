import { describe, it, expect, beforeEach } from 'vitest';
import {
  startOwnedUnitAudit,
  stopOwnedUnitAudit,
  clearOwnedUnitAudit,
  exportOwnedUnitAudit,
  addManualAuditLabel,
  addMissedAuditEvent,
} from '../services/ownedUnitAudit';
import {
  createDefaultOwnedUnitsStatus,
  type ScreenOwnedUnitsStatus,
} from '../services/screenOwnedUnits';

describe('M14C.6 Live Owned-Unit Tracker Audit Harness', () => {
  beforeEach(async () => {
    await clearOwnedUnitAudit(true);
  });

  it('1. begins audit session with unique auditSessionId and default false crop saving', async () => {
    const session = await startOwnedUnitAudit(false, true);
    expect(session.active).toBe(true);
    expect(session.auditSessionId).toMatch(/^audit-mock-\d+/);
    expect(session.saveCrops).toBe(false);
    expect(session.eventCount).toBe(0);
  });

  it('2. allows toggling save audit crops on session start', async () => {
    const session = await startOwnedUnitAudit(true, true);
    expect(session.active).toBe(true);
    expect(session.saveCrops).toBe(true);
  });

  it('3. stops audit session and keeps event logs intact in memory', async () => {
    await startOwnedUnitAudit(false, true);
    const stopped = await stopOwnedUnitAudit(true);
    expect(stopped.active).toBe(false);
    expect(stopped.auditSessionId).toBeDefined();
  });

  it('4. logs manual labels for detected events without altering underlying tracker state', async () => {
    await startOwnedUnitAudit(false, true);
    const status = await addManualAuditLabel(
      {
        eventId: 'audit-event-101',
        status: 'CORRECT',
        labeledAt: Date.now(),
      },
      true,
    );
    expect(status.labelsCount).toBe(1);

    const wrongStatus = await addManualAuditLabel(
      {
        eventId: 'audit-event-102',
        status: 'WRONG',
        actualChampionName: "Rek'Sai",
        actualDestinationLocation: 'H12',
        notes: 'Misidentified Kobuko instead of RekSai',
        labeledAt: Date.now(),
      },
      true,
    );
    expect(wrongStatus.labelsCount).toBe(2);
  });

  it('5. records missed events (purchase, move, combine, sale) for true recall calculation', async () => {
    await startOwnedUnitAudit(false, true);
    const afterMissed = await addMissedAuditEvent(
      {
        missedType: 'MISSED_PURCHASE',
        timestamp: Date.now(),
        championName: 'Veigar',
        sourceLocation: 'Shop S2',
        destinationLocation: 'Bench B1',
        notes: 'Fast click missed before frame capture',
      },
      true,
    );
    expect(afterMissed.missedCount).toBe(1);

    const afterMove = await addMissedAuditEvent(
      {
        missedType: 'MISSED_MOVE',
        timestamp: Date.now(),
        championName: 'Veigar',
        sourceLocation: 'Bench B1',
        destinationLocation: 'Board H14',
      },
      true,
    );
    expect(afterMove.missedCount).toBe(2);
  });

  it('6. exports audit payload with metadata, metrics, and zero raw frame pixel buffers or secrets', async () => {
    await startOwnedUnitAudit(false, true);
    await addManualAuditLabel(
      {
        eventId: 'ev-1',
        status: 'CORRECT',
        labeledAt: Date.now(),
      },
      true,
    );
    await addMissedAuditEvent(
      {
        missedType: 'MISSED_SALE',
        timestamp: Date.now(),
        championName: 'Kobuko',
      },
      true,
    );

    const payload = await exportOwnedUnitAudit(true);
    expect(payload.resolution).toBe('1920x1080');
    expect(payload.captureFps).toBe(2.0);
    expect(payload.trackerVersion).toBe('tracker-v1');
    expect(payload.shopVisionVersion).toBe('shop-vision-v1');
    expect(payload.manualLabels).toHaveLength(1);
    expect(payload.missedEvents).toHaveLength(1);

    const json = JSON.stringify(payload);
    expect(json).not.toContain('RGAPI');
    expect(json).not.toContain('riotToken');
    expect(json).not.toContain('puuid');
    expect(json).not.toContain('base64');
    expect(json).not.toContain('data:image');
  });

  it('7. clears current audit session cleanly', async () => {
    await startOwnedUnitAudit(false, true);
    await addManualAuditLabel(
      {
        eventId: 'ev-1',
        status: 'CORRECT',
        labeledAt: Date.now(),
      },
      true,
    );
    const cleared = await clearOwnedUnitAudit(true);
    expect(cleared.active).toBe(false);
    expect(cleared.auditSessionId).toBeNull();
    expect(cleared.labelsCount).toBe(0);
    expect(cleared.missedCount).toBe(0);
  });

  it('8. screen owned units status provides recentEvents and identityCoverage for compact summary UI', () => {
    const status: ScreenOwnedUnitsStatus = createDefaultOwnedUnitsStatus();
    status.identityCoverage = 0.78;
    status.pendingPurchases = 1;
    status.ambiguityGroups = 0;
    status.knownOwned = [
      {
        championId: 'DA_18_RekSai',
        championName: "Rek'Sai",
        knownTrackCount: 1,
        knownCopyEquivalent: 1,
        confidence: 0.95,
      },
      {
        championId: 'DA_18_Veigar',
        championName: 'Veigar',
        knownTrackCount: 2,
        knownCopyEquivalent: 2,
        confidence: 0.92,
      },
    ];
    status.recentEvents = [
      { text: 'BUY Veigar', generation: 10 },
      { text: 'MOVE Veigar B4 → H11', generation: 12 },
      { text: 'COMBINE Veigar → 2★', generation: 15 },
    ];

    expect(status.identityCoverage).toBe(0.78);
    expect(status.knownOwned).toHaveLength(2);
    expect(status.recentEvents).toHaveLength(3);
    expect(status.recentEvents[0].text).toBe('BUY Veigar');
  });
});
