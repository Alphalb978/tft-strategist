import { deriveDiscoveryDataset } from '../strategy/compDiscovery';
self.onmessage = (event) => {
  try {
    self.postMessage({ dataset: deriveDiscoveryDataset(event.data) });
  } catch {
    self.postMessage({ error: true });
  }
};
