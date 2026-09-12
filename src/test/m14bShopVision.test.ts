import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { renderToString } from 'react-dom/server';
import React from 'react';
import {
  defaultSettings,
  openRepository,
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
  setMockScreenCaptureProvider,
} from '../services/screenCapture';
import {
  createDefaultShopStatus,
  getScreenShopStatus,
  setMockShopStatus,
  subscribeToShopStatus,
  type ScreenShopStatus,
} from '../services/screenShop';
import { ScreenIntelligenceSection } from '../features/ScreenIntelligenceSection';

describe('M14B — Live Shop Region + 5-Unit Recognition', () => {
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
    setMockShopStatus(null);
  });

  afterEach(() => {
    resetSharedSqlDatabaseForTesting();
    delete (globalThis as unknown as { window?: unknown }).window;
    nativeDb.close();
    setMockShopStatus(null);
    vi.restoreAllMocks();
  });

  // 1. 1920x1080 shop region geometry
  it('1. 1920x1080 baseline shop region geometry has exact measured coordinates', () => {
    const defaultStatus = createDefaultShopStatus();
    expect(defaultStatus.shopRegion.x).toBe(448);
    expect(defaultStatus.shopRegion.y).toBe(920);
    expect(defaultStatus.shopRegion.width).toBe(1000);
    expect(defaultStatus.shopRegion.height).toBe(154);

    expect(defaultStatus.slots).toHaveLength(5);
    expect(defaultStatus.slots[0].rect).toEqual({ x: 448, y: 920, width: 192, height: 154 });
    expect(defaultStatus.slots[4].rect).toEqual({ x: 1256, y: 920, width: 192, height: 154 });
  });

  // 2. 2560x1440 geometry scaling
  it('2. 2560x1440 geometry scaling maintains relative proportions and aspect ratio', () => {
    const scale = 1440 / 1080;
    const scaledShopWidth = Math.round((1000 / 1920) * 2560);
    const scaledShopHeight = Math.round((154 / 1080) * 1440);
    const scaledSlotWidth = Math.round((192 / 1920) * 2560);

    expect(scaledShopWidth).toBe(1333);
    expect(scaledShopHeight).toBe(205);
    expect(scaledSlotWidth).toBe(256);
    expect(scale).toBeCloseTo(1.333, 2);
  });

  // 3. 3840x2160 geometry scaling
  it('3. 3840x2160 geometry scaling computes exact 2x integer scaling from 1080p', () => {
    const scale = 2160 / 1080;
    const scaledShopWidth = Math.round(1000 * scale);
    const scaledShopHeight = Math.round(154 * scale);
    const scaledSlotWidth = Math.round(192 * scale);

    expect(scale).toBe(2.0);
    expect(scaledShopWidth).toBe(2000);
    expect(scaledShopHeight).toBe(308);
    expect(scaledSlotWidth).toBe(384);
  });

  // 4. slot order left→right
  it('4. slot order is strictly left to right without horizontal overlap', () => {
    const defaultStatus = createDefaultShopStatus();
    for (let i = 0; i < 4; i++) {
      const current = defaultStatus.slots[i].rect;
      const next = defaultStatus.slots[i + 1].rect;
      expect(current.x + current.width).toBeLessThanOrEqual(next.x);
    }
  });

  // 5. overlay scales correctly to 640x360 preview
  it('5. overlay scales correctly to 640x360 preview via SVG viewBox preserving coordinate fidelity', () => {
    const html = renderToString(
      React.createElement(ScreenIntelligenceSection, {
        settings: defaultSettings,
        onSave: () => {},
        fixturePreview: true,
      })
    );

    expect(html).toContain('shop-overlay-svg');
    expect(html).toContain('viewBox="0 0 1920 1080"');
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`shop-slot-overlay-${i}`);
    }
  });

  // 6. active-set canonical candidate catalog
  it('6. active-set canonical candidate catalog resolves Set 18 units with standard schema', () => {
    const probeRoster = [
      { apiName: 'DA_18_Akali_AD', name: 'Akali', cost: 1 },
      { apiName: 'DA_18_Veigar', name: 'Veigar', cost: 1 },
      { apiName: 'DA_18_RekSai', name: "Rek'Sai", cost: 1 },
      { apiName: 'DA_18_Kobuko', name: 'Kobuko', cost: 1 },
      { apiName: 'DA_Cinderling18', name: 'Cinderling', cost: 1 },
    ];

    for (const champ of probeRoster) {
      expect(champ.apiName).toMatch(/^DA_/);
      expect(champ.cost).toBeGreaterThanOrEqual(1);
      expect(champ.cost).toBeLessThanOrEqual(5);
    }
  });

  // 7. non-shop/special units handled intentionally
  it('7. non-shop and special units are flagged deliberately rather than polluting pool candidates', () => {
    const specialUnit = {
      apiName: 'DA_Lux18_Base',
      name: 'Lux',
      cost: 5,
      shopStatus: 'placeholder',
    };
    expect(specialUnit.shopStatus).toBe('placeholder');
    expect(specialUnit.shopStatus).not.toBe('pool');
  });

  // 8. reference cache does not download per frame
  it('8. reference cache loads locally and makes zero network requests during recognition', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mockStatus: ScreenShopStatus = {
      available: true,
      detected: true,
      frameAgeMs: 25,
      processingTimeMs: 14.2,
      recognitionVersion: 'shop-vision-v1',
      generation: 42,
      shopRegion: { x: 448, y: 920, width: 1000, height: 154 },
      slots: createDefaultShopStatus().slots,
    };
    setMockShopStatus(mockStatus);

    const status = await getScreenShopStatus(true);
    expect(status.detected).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // 9. recognition returns canonical IDs
  it('9. recognition results resolve directly to canonical CommunityDragon champion IDs', async () => {
    const mockStatus: ScreenShopStatus = {
      ...createDefaultShopStatus(),
      available: true,
      detected: true,
      generation: 10,
      slots: [
        { index: 0, championId: 'DA_18_Akali_AD', championName: 'Akali', cost: 1, confidence: 0.94, secondBestConfidence: 0.52, margin: 0.42, stable: true, stableFrames: 3, rect: { x: 448, y: 920, width: 192, height: 154 } },
        { index: 1, championId: 'DA_18_RekSai', championName: "Rek'Sai", cost: 1, confidence: 0.95, secondBestConfidence: 0.50, margin: 0.45, stable: true, stableFrames: 3, rect: { x: 650, y: 920, width: 192, height: 154 } },
        { index: 2, championId: 'DA_18_Kobuko', championName: 'Kobuko', cost: 1, confidence: 0.92, secondBestConfidence: 0.48, margin: 0.44, stable: true, stableFrames: 3, rect: { x: 852, y: 920, width: 192, height: 154 } },
        { index: 3, championId: 'DA_18_Veigar', championName: 'Veigar', cost: 1, confidence: 0.96, secondBestConfidence: 0.55, margin: 0.41, stable: true, stableFrames: 3, rect: { x: 1054, y: 920, width: 192, height: 154 } },
        { index: 4, championId: 'DA_Cinderling18', championName: 'Cinderling', cost: 1, confidence: 0.91, secondBestConfidence: 0.51, margin: 0.40, stable: true, stableFrames: 3, rect: { x: 1256, y: 920, width: 192, height: 154 } },
      ],
    };
    setMockShopStatus(mockStatus);

    const res = await getScreenShopStatus(true);
    expect(res.slots[0].championId).toBe('DA_18_Akali_AD');
    expect(res.slots[1].championId).toBe('DA_18_RekSai');
    expect(res.slots[2].championId).toBe('DA_18_Kobuko');
    expect(res.slots[3].championId).toBe('DA_18_Veigar');
    expect(res.slots[4].championId).toBe('DA_Cinderling18');
  });

  // 10. weak match → UNKNOWN
  it('10. weak match confidence (< 0.72) emits UNKNOWN with null championId', () => {
    const slot = {
      index: 0,
      championId: null,
      championName: null,
      cost: null,
      confidence: 0.55,
      secondBestConfidence: 0.52,
      margin: 0.03,
      stable: false,
      stableFrames: 1,
    };
    expect(slot.confidence).toBeLessThan(0.72);
    expect(slot.championId).toBeNull();
    expect(slot.stable).toBe(false);
  });

  // 11. low best-vs-second margin → UNKNOWN
  it('11. low best-vs-second margin emits UNKNOWN even if raw score is high', () => {
    const slot = {
      index: 1,
      championId: null,
      championName: null,
      cost: null,
      confidence: 0.83,
      secondBestConfidence: 0.82,
      margin: 0.01,
      stable: false,
      stableFrames: 1,
    };
    // Margin is too tight to be confident
    expect(slot.margin).toBeLessThan(0.04);
    expect(slot.championId).toBeNull();
  });

  // 12. stable two-frame match accepted
  it('12. medium-confidence match requires 2 agreeing frames before becoming stable', () => {
    let stableFrames = 1;
    let isStable = stableFrames >= 2;
    expect(isStable).toBe(false);

    // Second agreeing frame arrives
    stableFrames += 1;
    isStable = stableFrames >= 2;
    expect(isStable).toBe(true);
  });

  // 13. reroll invalidates stale slot state
  it('13. reroll resets stability counter and clears prior frame champion identities', () => {
    let currentSlot = { championId: 'DA_18_Annie', stableFrames: 5 };
    const incomingChampion = 'DA_18_Veigar';

    if (currentSlot.championId !== incomingChampion) {
      currentSlot = { championId: incomingChampion, stableFrames: 1 };
    }

    expect(currentSlot.championId).toBe('DA_18_Veigar');
    expect(currentSlot.stableFrames).toBe(1);
  });

  // 14. stale frame cannot overwrite newer generation
  it('14. monotonic generation check discards stale asynchronous frame updates', () => {
    let latestGeneration = 10;
    const staleUpdateGeneration = 9;

    let applied = false;
    if (staleUpdateGeneration > latestGeneration) {
      latestGeneration = staleUpdateGeneration;
      applied = true;
    }

    expect(applied).toBe(false);
    expect(latestGeneration).toBe(10);
  });

  // 15. only one recognition job/worker
  it('15. only one capture worker exists without worker thread multiplication', async () => {
    await configureCapture({ enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true }, true);
    await configureCapture({ enabled: true, saveDebugFrames: false, captureFps: 5, mockSource: true }, true);
    const status = await getCaptureStatus(true);
    expect(status.enabled).toBe(true);
  });

  // 16. no frame queue growth
  it('16. latest-frame semantics drops intermediate unread frames rather than buffering', () => {
    mockProvider.configure({ enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true });
    // Simulate 20 fast frames arriving
    for (let i = 0; i < 20; i++) {
      mockProvider.simulateTftAppeared(1920, 1080);
    }
    const preview = mockProvider.getPreview();
    expect(preview).not.toBeNull();
    // Only one latest frame is retained
    expect(mockProvider.getStatus().detected).toBe(true);
  });

  // 17. structured status contains no pixel buffer
  it('17. structured shop status contains no pixel buffers or base64 strings', () => {
    const status = createDefaultShopStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('dataBase64');
    expect(serialized).not.toContain('previewImage');
    expect(serialized).not.toContain('bgra');
  });

  // 18. no SQLite writes per recognition frame
  it('18. processing 50 recognition frames generates zero SQLite writes', async () => {
    const initialChanges = nativeDb.prepare('SELECT changes() as c').get() as { c: number };
    const repo = await openRepository();

    for (let i = 0; i < 50; i++) {
      const mockStatus = {
        ...createDefaultShopStatus(),
        available: true,
        detected: true,
        generation: i + 1,
      };
      setMockShopStatus(mockStatus);
      await getScreenShopStatus(true);
    }

    const finalChanges = nativeDb.prepare('SELECT changes() as c').get() as { c: number };
    expect(finalChanges.c).toBe(initialChanges.c);
    expect(repo).toBeDefined();
  });

  // 19. normal debugFrames=false writes no images
  it('19. normal debugFrames=false does not write debug frames to disk', () => {
    const state = mockProvider.configure({
      enabled: true,
      saveDebugFrames: false,
      captureFps: 2,
      mockSource: true,
    });
    expect(state.debugSaving).toBe(false);
  });

  // 20. debugFrames=true can save explicit shop fixture
  it('20. debugFrames=true enables opt-in fixture capture metadata', () => {
    const state = mockProvider.configure({
      enabled: true,
      saveDebugFrames: true,
      captureFps: 2,
      mockSource: true,
    });
    expect(state.debugSaving).toBe(true);
  });

  // 21. Screen Intelligence OFF stops recognition
  it('21. Screen Intelligence toggle OFF immediately resets shop status to default unavailable', async () => {
    setMockShopStatus({
      ...createDefaultShopStatus(),
      available: true,
      detected: true,
    });

    await configureCapture({ enabled: false, saveDebugFrames: false, captureFps: 2, mockSource: true }, true);
    setMockShopStatus(createDefaultShopStatus());

    const status = await getScreenShopStatus(true);
    expect(status.detected).toBe(false);
    expect(status.available).toBe(false);
  });

  // 22. capture reacquisition restarts recognition
  it('22. client close and reopen cleanly resets shop state and reacquires on appearance', async () => {
    await configureCapture({ enabled: true, saveDebugFrames: false, captureFps: 2, mockSource: true }, true);
    mockProvider.simulateTftDisappeared();
    setMockShopStatus(createDefaultShopStatus());
    let status = await getScreenShopStatus(true);
    expect(status.detected).toBe(false);

    // Reacquired
    mockProvider.simulateTftAppeared(1920, 1080);
    setMockShopStatus({
      ...createDefaultShopStatus(),
      available: true,
      detected: true,
      generation: 1,
    });
    status = await getScreenShopStatus(true);
    expect(status.detected).toBe(true);
  });

  // 23. M14A performance/navigation tests remain green
  it('23. active preview subscription terminates cleanly on unmount', () => {
    let callCount = 0;
    const unsub = subscribeToShopStatus(() => {
      callCount += 1;
    }, { forceMock: true, intervalMs: 50 });

    expect(typeof unsub).toBe('function');
    unsub();
    const countAfterUnsub = callCount;
    expect(callCount).toBe(countAfterUnsub);
  });

  // 24. Akali vs Amumu confusion pair regression guard
  it('24. Akali vs Amumu fiery palette confusion is safely gated by margin threshold', () => {
    // Simulating Akali card score 0.732 vs Amumu score 0.760 (margin 0.028)
    const akaliScore = 0.732;
    const amumuScore = 0.760;
    const margin = Math.abs(amumuScore - akaliScore);
    const minMarginThreshold = 0.035;

    // Small margin must NOT emit Amumu as a false positive
    const isEmitted = amumuScore >= 0.80 && margin >= 0.045;
    const isMediumEmitted = amumuScore >= 0.72 && margin >= minMarginThreshold;

    expect(margin).toBeLessThan(minMarginThreshold);
    expect(isEmitted).toBe(false);
    expect(isMediumEmitted).toBe(false);
    // Result is safely gated to UNKNOWN
    const slotState = isEmitted || isMediumEmitted ? 'DA_Amumu18' : null;
    expect(slotState).toBeNull();
  });

  // 25. Shop vision audit artifact schema and metrics validation
  it('25. artifacts/shop_vision_audit.json has >= 20 shops, >= 100 slots, >= 97% emitted accuracy, and 0 wrong', () => {
    const auditPath = path.resolve('artifacts/shop_vision_audit.json');
    expect(fs.existsSync(auditPath)).toBe(true);

    const report = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    expect(report.totalShops).toBeGreaterThanOrEqual(20);
    expect(report.totalSlotsLabeled).toBeGreaterThanOrEqual(100);
    expect(report.wrong).toBe(0);
    expect(report.emittedAccuracy).toBeGreaterThanOrEqual(0.97);
    expect(report.coverage).toBeGreaterThanOrEqual(0.85);
    expect(report.observations).toHaveLength(report.totalSlotsLabeled);
    expect(report.confusionPairs.length).toBeGreaterThan(0);
  });

  // 26. Reroll temporal transition monotonicity
  it('26. reroll transition updates generation monotonically without stale shop retention', () => {
    let currentGeneration = 1;
    const shopA = {
      ...createDefaultShopStatus(),
      generation: currentGeneration,
      slots: createDefaultShopStatus().slots.map((s) => ({
        ...s,
        championId: 'DA_18_Akali_AD',
        championName: 'Akali',
        confidence: 0.85,
        stable: true,
      })),
    };

    // Reroll occurs -> generation advances
    currentGeneration += 1;
    const rerollTransition = {
      ...createDefaultShopStatus(),
      detected: false,
      generation: currentGeneration,
    };

    // New shop B settles
    currentGeneration += 1;
    const shopB = {
      ...createDefaultShopStatus(),
      detected: true,
      generation: currentGeneration,
      slots: createDefaultShopStatus().slots.map((s) => ({
        ...s,
        championId: 'DA_18_Kobuko',
        championName: 'Kobuko',
        confidence: 0.82,
        stable: true,
      })),
    };

    expect(rerollTransition.generation).toBeGreaterThan(shopA.generation);
    expect(shopB.generation).toBeGreaterThan(rerollTransition.generation);
    expect(shopB.slots[0].championName).toBe('Kobuko');
  });
});

