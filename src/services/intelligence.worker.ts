import { deriveIntelligence } from '../strategy/observedIntelligence';
self.onmessage = (event) => {
  try {
    self.postMessage({
      model: deriveIntelligence(...(event.data as Parameters<typeof deriveIntelligence>)),
    });
  } catch {
    self.postMessage({ error: true });
  }
};
