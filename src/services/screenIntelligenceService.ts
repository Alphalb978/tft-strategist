import { getScreenShopStatus } from './screenShop';
import { getScreenOwnedUnitsStatus } from './screenOwnedUnits';
import { subscribeToCapturePreview } from './screenCapture';
import type { ScreenCaptureState } from './screenCapture';
import type { LiveScreenState } from '../strategy/liveScreenFusion';

export function createDefaultLiveScreenState(): LiveScreenState {
  return {
    available: false,
    detected: false,
    frameAgeMs: 99999,
    shopStatus: null,
    ownedStatus: null,
  };
}

let currentLiveScreenState: LiveScreenState = createDefaultLiveScreenState();
let mockLiveScreenState: LiveScreenState | null = null;

export function setMockLiveScreenState(state: LiveScreenState | null): void {
  mockLiveScreenState = state;
}

export function getLiveScreenState(): LiveScreenState {
  if (mockLiveScreenState) {
    return mockLiveScreenState;
  }
  return currentLiveScreenState;
}

export interface LiveScreenServiceOptions {
  intervalMs?: number;
  forceMock?: boolean;
  enabled?: boolean;
}

/**
 * Manages live screen intelligence polling and emits updated LiveScreenState.
 * Automatically handles window close, stale states, and neutral defaults.
 */
export function subscribeToLiveScreen(
  onUpdate: (state: LiveScreenState) => void,
  options: LiveScreenServiceOptions = {},
): () => void {
  const { enabled = true, forceMock = false, intervalMs = 1000 } = options;

  if (!enabled) {
    currentLiveScreenState = createDefaultLiveScreenState();
    onUpdate(currentLiveScreenState);
    return () => {};
  }

  if (forceMock || mockLiveScreenState !== null) {
    const mock = getLiveScreenState();
    onUpdate(mock);
    return () => {};
  }

  let active = true;
  let inFlight = false;
  let lastCaptureState: ScreenCaptureState | null = null;

  // Subscribe to preview to track window detection and capture state
  const unsubscribeCapture = subscribeToCapturePreview(
    (_preview, captureState) => {
      lastCaptureState = captureState;
      if (captureState.state !== 'capturing') {
        // TFT window is not open or not capturing -> return modifiers to neutral 0
        currentLiveScreenState = {
          available: false,
          detected: false,
          frameAgeMs: 99999,
          shopStatus: null,
          ownedStatus: null,
          lastUpdated: new Date().toISOString(),
        };
        onUpdate(currentLiveScreenState);
      }
    },
    { intervalMs: 1000, forceMock },
  );

  const poll = async () => {
    if (!active || inFlight) return;
    if (lastCaptureState && lastCaptureState.state !== 'capturing') return;

    inFlight = true;
    try {
      const [shop, owned] = await Promise.all([
        getScreenShopStatus(forceMock),
        getScreenOwnedUnitsStatus(forceMock),
      ]);

      if (!active) return;

      const isAvailable = Boolean(shop.available || owned.available);
      const isDetected = Boolean(shop.detected || owned.detected);
      const frameAge = Math.max(shop.frameAgeMs ?? 0, owned.frameAgeMs ?? 0);

      currentLiveScreenState = {
        available: isAvailable,
        detected: isDetected,
        frameAgeMs: frameAge,
        shopStatus: isAvailable && shop.available ? shop : null,
        ownedStatus: isAvailable && owned.available ? owned : null,
        lastUpdated: new Date().toISOString(),
      };

      onUpdate(currentLiveScreenState);
    } catch {
      // Keep previous or fallback safely
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
    unsubscribeCapture();
  };
}
