import { invoke, isTauri } from '@tauri-apps/api/core';

export type ShopSlotState = 'champion' | 'empty' | 'unknown';

export interface ShopSlotRecognition {
  index: number;
  state?: ShopSlotState;
  championId: string | null;
  championName: string | null;
  cost: number | null;
  confidence: number;
  secondBestChampionId?: string | null;
  secondBestConfidence?: number;
  margin?: number;
  stable: boolean;
  stableFrames?: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ScreenShopStatus {
  available: boolean;
  detected: boolean;
  frameAgeMs: number;
  processingTimeMs: number;
  recognitionVersion: string;
  generation: number;
  slots: ShopSlotRecognition[];
  shopRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const DEFAULT_SHOP_REGION = {
  x: 448,
  y: 920,
  width: 1000,
  height: 154,
};

export function createDefaultShopStatus(): ScreenShopStatus {
  const slots: ShopSlotRecognition[] = [];
  for (let i = 0; i < 5; i++) {
    slots.push({
      index: i,
      state: 'unknown',
      championId: null,
      championName: null,
      cost: null,
      confidence: 0,
      secondBestChampionId: null,
      secondBestConfidence: 0,
      margin: 0,
      stable: false,
      stableFrames: 0,
      rect: {
        x: 448 + i * 202,
        y: 920,
        width: 192,
        height: 154,
      },
    });
  }

  return {
    available: false,
    detected: false,
    frameAgeMs: 0,
    processingTimeMs: 0,
    recognitionVersion: 'shop-vision-v1',
    generation: 0,
    slots,
    shopRegion: DEFAULT_SHOP_REGION,
  };
}

let mockShopStatus: ScreenShopStatus | null = null;

export function setMockShopStatus(status: ScreenShopStatus | null): void {
  mockShopStatus = status;
}

export function getMockShopStatus(): ScreenShopStatus {
  if (!mockShopStatus) {
    mockShopStatus = createDefaultShopStatus();
  }
  return mockShopStatus;
}

export async function getScreenShopStatus(forceMock = false): Promise<ScreenShopStatus> {
  if (!forceMock && isTauri()) {
    try {
      return await invoke<ScreenShopStatus>('screen_shop_status');
    } catch {
      return createDefaultShopStatus();
    }
  }

  return getMockShopStatus();
}

export function subscribeToShopStatus(
  onUpdate: (status: ScreenShopStatus) => void,
  options: { intervalMs?: number; forceMock?: boolean } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 500;
  let active = true;
  let inFlight = false;

  const poll = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const status = await getScreenShopStatus(options.forceMock);
      if (!active) return;
      onUpdate(status);
    } catch {
      // Ignore polling errors
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
  };
}
