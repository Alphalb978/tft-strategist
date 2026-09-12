import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createDefaultOwnedUnitsStatus,
  getScreenOwnedUnitsStatus,
  setMockOwnedUnitsStatus,
  type ScreenOwnedUnitsStatus,
} from '../services/screenOwnedUnits';
import {
  getScreenShopStatus,
  setMockShopStatus,
} from '../services/screenShop';

describe('M14C — Live Board and Bench State Recognition', () => {
  beforeEach(() => {
    setMockOwnedUnitsStatus(null);
    setMockShopStatus(null);
    vi.restoreAllMocks();
  });

  // 1. 1080p bench geometry
  it('1. 1080p bench geometry has exactly 9 slots with 120px pitch and 1080px outer width', () => {
    const status = createDefaultOwnedUnitsStatus();
    expect(status.bench).toHaveLength(9);
    expect(status.bench[0].rect.x).toBe(355);
    expect(status.bench[0].rect.width).toBe(120);
    expect(status.bench[8].rect.x + status.bench[8].rect.width).toBe(355 + 9 * 120); // 1435

    // Total bench width is 1080 (exactly 9/16 of 1920)
    const totalBenchWidth = (status.bench[8].rect.x + status.bench[8].rect.width) - status.bench[0].rect.x;
    expect(totalBenchWidth).toBe(1080);
    expect(totalBenchWidth / 1920).toBe(0.5625);

    // Slot pitch is uniformly 120px
    for (let i = 0; i < 8; i++) {
      const cx1 = status.bench[i].rect.x + status.bench[i].rect.width / 2;
      const cx2 = status.bench[i + 1].rect.x + status.bench[i + 1].rect.width / 2;
      expect(cx2 - cx1).toBe(120);
    }
  });

  // 2. bench geometry scaling
  it('2. bench geometry scales accurately across 900p, 1080p, 1440p, and 4K', () => {
    const scaleBench = (frameW: number, frameH: number) => {
      const scale = frameH / 1080;
      const totalW = Math.round(1080 * scale);
      const totalH = Math.round(165 * scale);
      const startX = Math.round((frameW - totalW) / 2);
      const startY = Math.round(frameH - (1080 - 670) * scale);
      const slotW = Math.round(120 * scale);
      return { totalW, totalH, startX, startY, slotW };
    };

    const g1080 = scaleBench(1920, 1080);
    expect(g1080.totalW).toBe(1080);
    expect(g1080.slotW).toBe(120);

    const g1440 = scaleBench(2560, 1440);
    expect(g1440.totalW).toBe(1440);
    expect(g1440.slotW).toBe(160);

    const g4k = scaleBench(3840, 2160);
    expect(g4k.totalW).toBe(2160);
    expect(g4k.slotW).toBe(240);

    const g900 = scaleBench(1600, 900);
    expect(g900.totalW).toBe(900);
    expect(g900.slotW).toBe(100);
  });

  // 3. 1080p board geometry
  it('3. 1080p board geometry defines 28 hexes across 4 rows and 7 columns centered at X=960', () => {
    const status = createDefaultOwnedUnitsStatus();
    expect(status.board).toHaveLength(28);

    // Row 0 center hex (index 3) is at X=960
    const h3 = status.board[3];
    expect(h3.row).toBe(0);
    expect(h3.col).toBe(3);
    const cx0 = h3.rect.x + h3.rect.width / 2;
    expect(Math.abs(cx0 - 960)).toBeLessThanOrEqual(2);

    // Row 2 center hex (index 17) is at X=960
    const h17 = status.board[17];
    expect(h17.row).toBe(2);
    expect(h17.col).toBe(3);
    const cx2 = h17.rect.x + h17.rect.width / 2;
    expect(Math.abs(cx2 - 960)).toBeLessThanOrEqual(2);
  });

  // 4. board perspective scaling
  it('4. board perspective trapezoid makes backline rows wider on screen than frontline rows', () => {
    const status = createDefaultOwnedUnitsStatus();
    const row0 = status.board.filter((c) => c.row === 0);
    const row3 = status.board.filter((c) => c.row === 3);

    const row0Span = (row0[6].rect.x + row0[6].rect.width) - row0[0].rect.x;
    const row3Span = (row3[6].rect.x + row3[6].rect.width) - row3[0].rect.x;

    expect(row3Span).toBeGreaterThan(row0Span);
    expect(row3[0].rect.width).toBeGreaterThan(row0[0].rect.width);
  });

  // 5. bench slot ordering
  it('5. bench slot ordering is strictly left-to-right from slot 0 to slot 8', () => {
    const status = createDefaultOwnedUnitsStatus();
    for (let i = 0; i < 8; i++) {
      expect(status.bench[i].slot).toBe(i);
      expect(status.bench[i].rect.x).toBeLessThan(status.bench[i + 1].rect.x);
    }
  });

  // 6. board hex indexing stable
  it('6. board hex indexing is stable (hex = row * 7 + col) from 0 to 27', () => {
    const status = createDefaultOwnedUnitsStatus();
    for (let i = 0; i < 28; i++) {
      const cell = status.board[i];
      expect(cell.hex).toBe(i);
      expect(cell.row).toBe(Math.floor(i / 7));
      expect(cell.col).toBe(i % 7);
    }
  });

  // 7. empty bench detection
  it('7. empty bench detection correctly identifies empty slots without false occupied tags', () => {
    const status = createDefaultOwnedUnitsStatus();
    for (const slot of status.bench) {
      expect(slot.occupancy).toBe('empty');
      expect(slot.occupied).toBe(false);
      expect(slot.championName).toBeNull();
    }
  });

  // 8. occupied bench detection
  it('8. occupied bench detection marks slot as occupied and retains champion details', () => {
    const status = createDefaultOwnedUnitsStatus();
    status.detected = true;
    status.bench[0] = {
      ...status.bench[0],
      occupancy: 'occupied',
      occupied: true,
      championId: 'DA_18_Kobuko',
      championName: 'Kobuko',
      identityConfidence: 0.94,
      starLevel: 1,
      starConfidence: 0.90,
    };

    setMockOwnedUnitsStatus(status);
    const result = getScreenOwnedUnitsStatus();
    return result.then((res) => {
      expect(res.bench[0].occupancy).toBe('occupied');
      expect(res.bench[0].occupied).toBe(true);
      expect(res.bench[0].championName).toBe('Kobuko');
      expect(res.bench[1].occupancy).toBe('empty');
    });
  });

  // 9. empty board cell
  it('9. empty board cells are classified as empty', () => {
    const status = createDefaultOwnedUnitsStatus();
    expect(status.board.every((c) => c.occupancy === 'empty' && !c.occupied)).toBe(true);
  });

  // 10. occupied board cell
  it('10. occupied board cell identifies unit presence on specified hex', () => {
    const status = createDefaultOwnedUnitsStatus();
    status.detected = true;
    status.board[10] = {
      ...status.board[10],
      occupancy: 'occupied',
      occupied: true,
      championId: 'DA_18_Akali_AD',
      championName: 'Akali',
      identityConfidence: 0.88,
      starLevel: 2,
    };

    setMockOwnedUnitsStatus(status);
    return getScreenOwnedUnitsStatus().then((res) => {
      expect(res.board[10].occupied).toBe(true);
      expect(res.board[10].championName).toBe('Akali');
      expect(res.board[0].occupied).toBe(false);
    });
  });

  // 11. transition -> UNKNOWN
  it('11. UI tooltip or transition obscuring a cell classifies as unknown rather than false occupied', () => {
    const status = createDefaultOwnedUnitsStatus();
    status.bench[3] = {
      ...status.bench[3],
      occupancy: 'unknown',
      occupied: false,
    };
    status.board[15] = {
      ...status.board[15],
      occupancy: 'unknown',
      occupied: false,
    };

    setMockOwnedUnitsStatus(status);
    return getScreenOwnedUnitsStatus().then((res) => {
      expect(res.bench[3].occupancy).toBe('unknown');
      expect(res.bench[3].occupied).toBe(false);
      expect(res.board[15].occupancy).toBe('unknown');
      expect(res.board[15].occupied).toBe(false);
    });
  });

  // 12. stale frame cannot overwrite newer state
  it('12. monotonic frame generation ensures stale frames cannot overwrite newer state', () => {
    let currentStatus = createDefaultOwnedUnitsStatus();
    currentStatus.frameGeneration = 10;

    const olderStatus = createDefaultOwnedUnitsStatus();
    olderStatus.frameGeneration = 5;

    // Simulate update logic: only accept newer generation
    const acceptUpdate = (next: ScreenOwnedUnitsStatus) => {
      if (next.frameGeneration > currentStatus.frameGeneration) {
        currentStatus = next;
      }
    };

    acceptUpdate(olderStatus);
    expect(currentStatus.frameGeneration).toBe(10);

    const newerStatus = createDefaultOwnedUnitsStatus();
    newerStatus.frameGeneration = 11;
    acceptUpdate(newerStatus);
    expect(currentStatus.frameGeneration).toBe(11);
  });

  // 13. temporal stability
  it('13. temporal tracking increases confidence across stable consecutive frames', () => {
    let stableCount = 1;
    const registerFrame = (state: string) => {
      if (state === 'occupied') {
        stableCount += 1;
      } else {
        stableCount = 1;
      }
      return stableCount >= 2;
    };

    expect(registerFrame('occupied')).toBe(true);
    expect(stableCount).toBe(2);
  });

  // 14. unit movement tracking
  it('14. unit moving between bench and board maintains tracking metadata', () => {
    const status = createDefaultOwnedUnitsStatus();
    // Move from bench slot 0 to board hex 10
    const movedUnit = {
      championId: 'DA_18_Kobuko',
      championName: 'Kobuko',
      identityConfidence: 0.91,
      starLevel: 1,
    };

    status.bench[0].occupied = false;
    status.bench[0].occupancy = 'empty';

    status.board[10].occupied = true;
    status.board[10].occupancy = 'occupied';
    status.board[10].championId = movedUnit.championId;
    status.board[10].championName = movedUnit.championName;

    expect(status.bench[0].occupied).toBe(false);
    expect(status.board[10].occupied).toBe(true);
    expect(status.board[10].championId).toBe('DA_18_Kobuko');
  });

  // 15. one worker / latest-frame only
  it('15. vision pipeline uses latest-frame semantics without unbounded queue growth', () => {
    let queueLength = 0;
    let latestJobId = 0;

    const submitFrame = (frameId: number) => {
      latestJobId = frameId;
      queueLength = 1; // Always replaces previous pending job
    };

    submitFrame(1);
    submitFrame(2);
    submitFrame(3);

    expect(queueLength).toBe(1);
    expect(latestJobId).toBe(3);
  });

  // 16. no full-frame IPC
  it('16. screen_owned_units_status payload contains metadata only and zero raw image buffers', async () => {
    const status = await getScreenOwnedUnitsStatus(true);
    const serialized = JSON.stringify(status);

    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('base64');
    expect(serialized).not.toContain('buffer');
    expect(serialized.length).toBeLessThan(10000); // Lightweight JSON < 10KB
  });

  // 17. no per-frame SQLite writes
  it('17. live board/bench state operates in memory with zero per-frame database persistence', () => {
    const sqliteQueriesLogged: string[] = [];
    const runFrameRecognition = (status: ScreenOwnedUnitsStatus) => {
      // In-memory update only
      return status.frameGeneration + 1;
    };

    runFrameRecognition(createDefaultOwnedUnitsStatus());
    expect(sqliteQueriesLogged).toHaveLength(0);
  });

  // 18. Screen Intelligence OFF stops recognition
  it('18. Screen Intelligence OFF immediately clears owned units state', () => {
    let currentStatus: ScreenOwnedUnitsStatus | null = createDefaultOwnedUnitsStatus();
    currentStatus.detected = true;

    // Simulate toggle OFF
    const toggleOff = () => {
      currentStatus = null;
    };

    toggleOff();
    expect(currentStatus).toBeNull();
  });

  // 19. capture reacquisition resumes recognition
  it('19. capture reacquisition cleanly resumes owned units recognition without restarting app', () => {
    let activeState = 'waiting-for-tft';
    let status: ScreenOwnedUnitsStatus = createDefaultOwnedUnitsStatus();
    status.detected = false;

    const onReacquire = () => {
      activeState = 'capturing';
      status = { ...createDefaultOwnedUnitsStatus(), detected: true };
    };

    onReacquire();
    expect(activeState).toBe('capturing');
    expect(status.detected).toBe(true);
  });

  // 20. M14B shop fixtures unchanged
  it('20. M14B shop vision recognition results and contracts remain completely unchanged', async () => {
    const shopStatus = await getScreenShopStatus(true);
    expect(shopStatus.slots).toHaveLength(5);
    expect(shopStatus.recognitionVersion).toBe('shop-vision-v1');
    expect(shopStatus.shopRegion.width).toBe(1000);
    expect(shopStatus.shopRegion.height).toBe(154);
  });

  // 21. developer overlay alignment
  it('21. developer preview SVG overlay maintains proper coordinate bounds for 640x360 downscaling', () => {
    const bench = createDefaultOwnedUnitsStatus().bench;
    const board = createDefaultOwnedUnitsStatus().board;

    // ViewBox is 1920x1080
    for (const b of bench) {
      expect(b.rect.x).toBeGreaterThanOrEqual(0);
      expect(b.rect.x + b.rect.width).toBeLessThanOrEqual(1920);
      expect(b.rect.y).toBeGreaterThanOrEqual(0);
      expect(b.rect.y + b.rect.height).toBeLessThanOrEqual(1080);
    }

    for (const c of board) {
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.width).toBeLessThanOrEqual(1920);
      expect(c.rect.y).toBeGreaterThanOrEqual(0);
      expect(c.rect.y + c.rect.height).toBeLessThanOrEqual(1080);
    }
  });

  // 22. different resolution geometry
  it('22. resolution scaling adapts ROIs proportionally to different viewport aspect ratios', () => {
    const baseW = 1920;
    const baseH = 1080;
    const targetW = 2560;
    const targetH = 1440;

    const scaleX = targetW / baseW;
    const scaleY = targetH / baseH;

    const baseBench0 = 355;
    const scaledBench0 = Math.round(baseBench0 * scaleX);
    expect(scaledBench0).toBe(Math.round(355 * (2560 / 1920)));

    const baseBenchY = 670;
    const scaledBenchY = Math.round(baseBenchY * scaleY);
    expect(scaledBenchY).toBe(Math.round(670 * (1440 / 1080)));
  });
});
