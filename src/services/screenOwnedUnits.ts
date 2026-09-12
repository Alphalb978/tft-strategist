import { invoke } from '@tauri-apps/api/core';

export type OccupancyState = 'empty' | 'occupied' | 'unknown';
export type OwnedUnitState = 'known' | 'ambiguous' | 'unknown' | 'empty';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BenchSlotStatus {
  slot: number;
  occupancy: OccupancyState;
  occupied: boolean;
  state?: OwnedUnitState;
  trackId?: string | null;
  championId: string | null;
  championName: string | null;
  identitySource?: string | null;
  identityConfidence: number;
  starLevel: number | null;
  starConfidence: number | null;
  rect: PixelRect;
}

export interface BoardCellStatus {
  hex: number;
  row: number;
  col: number;
  occupancy: OccupancyState;
  occupied: boolean;
  state?: OwnedUnitState;
  trackId?: string | null;
  championId: string | null;
  championName: string | null;
  identitySource?: string | null;
  identityConfidence: number;
  starLevel: number | null;
  rect: PixelRect;
}

export interface KnownOwnedChampion {
  championId: string;
  championName: string;
  knownTrackCount: number;
  knownCopyEquivalent: number | null;
  confidence: number;
}

export interface ScreenOwnedUnitsStatus {
  available: boolean;
  detected: boolean;
  frameGeneration: number;
  frameAgeMs: number;
  processingTimeMs: number;
  recognitionVersion: string;
  benchLayoutVersion: string;
  boardLayoutVersion: string;
  identityCoverage?: number;
  pendingPurchases?: number;
  ambiguityGroups?: number;
  knownOwned?: KnownOwnedChampion[];
  recentEvents?: { text: string; generation: number }[];
  bench: BenchSlotStatus[];
  board: BoardCellStatus[];
}

export function createDefaultOwnedUnitsStatus(): ScreenOwnedUnitsStatus {
  const bench: BenchSlotStatus[] = Array.from({ length: 9 }, (_, i) => ({
    slot: i,
    occupancy: 'empty',
    occupied: false,
    state: 'empty',
    trackId: null,
    championId: null,
    championName: null,
    identitySource: null,
    identityConfidence: 0.0,
    starLevel: null,
    starConfidence: null,
    rect: {
      x: Math.round(355 + i * 120),
      y: 670,
      width: 120,
      height: 165,
    },
  }));

  const board: BoardCellStatus[] = Array.from({ length: 28 }, (_, h) => {
    const row = Math.floor(h / 7);
    const col = h % 7;
    const isStaggered = row % 2 === 1;
    const pitch = 120 + row * 10;
    const offsetCols = isStaggered ? col - 3 + 0.5 : col - 3;
    const cx = 960 + offsetCols * pitch;
    const cy = [440, 520, 605, 690][row] ?? 440;
    const roiW = pitch * 1.05;
    const roiH = 95 + row * 10;

    return {
      hex: h,
      row,
      col,
      occupancy: 'empty',
      occupied: false,
      state: 'empty',
      trackId: null,
      championId: null,
      championName: null,
      identitySource: null,
      identityConfidence: 0.0,
      starLevel: null,
      rect: {
        x: Math.round(cx - roiW / 2),
        y: Math.round(cy - roiH * 0.65),
        width: Math.round(roiW),
        height: Math.round(roiH),
      },
    };
  });

  return {
    available: false,
    detected: false,
    frameGeneration: 0,
    frameAgeMs: 0,
    processingTimeMs: 0.0,
    recognitionVersion: 'board-vision-v1',
    benchLayoutVersion: 'tft-bench-1080p-v1',
    boardLayoutVersion: 'tft-board-1080p-v1',
    identityCoverage: 0.0,
    pendingPurchases: 0,
    ambiguityGroups: 0,
    knownOwned: [],
    recentEvents: [],
    bench,
    board,
  };
}

let mockOwnedUnitsStatus: ScreenOwnedUnitsStatus | null = null;

export function setMockOwnedUnitsStatus(status: ScreenOwnedUnitsStatus | null): void {
  mockOwnedUnitsStatus = status;
}

export function getMockOwnedUnitsStatus(): ScreenOwnedUnitsStatus {
  return mockOwnedUnitsStatus ? JSON.parse(JSON.stringify(mockOwnedUnitsStatus)) : createDefaultOwnedUnitsStatus();
}

export async function getScreenOwnedUnitsStatus(forceMock = false): Promise<ScreenOwnedUnitsStatus> {
  if (forceMock || mockOwnedUnitsStatus !== null) {
    return getMockOwnedUnitsStatus();
  }

  try {
    return await invoke<ScreenOwnedUnitsStatus>('screen_owned_units_status');
  } catch {
    return getMockOwnedUnitsStatus();
  }
}
