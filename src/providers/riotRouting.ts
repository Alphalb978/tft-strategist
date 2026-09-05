export const RIOT_PLATFORMS = [
  'BR1',
  'EUN1',
  'EUW1',
  'JP1',
  'KR',
  'LA1',
  'LA2',
  'ME1',
  'NA1',
  'OC1',
  'PH2',
  'RU',
  'SG2',
  'TH2',
  'TR1',
  'TW2',
  'VN2',
] as const;

export type RiotPlatform = (typeof RIOT_PLATFORMS)[number];
export type RiotRegionalRoute = 'AMERICAS' | 'ASIA' | 'EUROPE' | 'SEA';
export type RiotAccountRoute = Exclude<RiotRegionalRoute, 'SEA'>;
export const SPECTATOR_TFT_PLATFORMS = RIOT_PLATFORMS.filter(
  (platform) => platform !== 'PH2' && platform !== 'TH2',
);

/**
 * Platform-to-match routing is centralized so providers never assemble routing
 * hosts independently. PH2 and TH2 are accepted platform IDs but their match
 * cluster is explicitly unverified in the current portal text; see M3 evidence.
 */
const routes: Record<RiotPlatform, RiotRegionalRoute> = {
  BR1: 'AMERICAS',
  EUN1: 'EUROPE',
  EUW1: 'EUROPE',
  JP1: 'ASIA',
  KR: 'ASIA',
  LA1: 'AMERICAS',
  LA2: 'AMERICAS',
  ME1: 'EUROPE',
  NA1: 'AMERICAS',
  OC1: 'SEA',
  PH2: 'SEA',
  RU: 'EUROPE',
  SG2: 'SEA',
  TH2: 'SEA',
  TR1: 'EUROPE',
  TW2: 'SEA',
  VN2: 'SEA',
};

export class RiotRoutingError extends Error {
  readonly code = 'invalid-route';
  constructor(value: string) {
    super(`“${value}” is not a supported TFT platform route.`);
    this.name = 'RiotRoutingError';
  }
}

export function parsePlatform(value: string): RiotPlatform {
  const normalized = value.trim().toUpperCase();
  if (!RIOT_PLATFORMS.includes(normalized as RiotPlatform)) throw new RiotRoutingError(value);
  return normalized as RiotPlatform;
}

export function regionalRouteFor(platform: string): RiotRegionalRoute {
  return routes[parsePlatform(platform)];
}

/** account-v1 currently exposes only AMERICAS, ASIA, and EUROPE and is globally queryable. */
export function accountRouteFor(platform: string): RiotAccountRoute {
  const route = regionalRouteFor(platform);
  return route === 'SEA' ? 'ASIA' : route;
}

export function spectatorTftSupported(platform: string): boolean {
  const parsed = parsePlatform(platform);
  return SPECTATOR_TFT_PLATFORMS.includes(parsed as (typeof SPECTATOR_TFT_PLATFORMS)[number]);
}

export function regionalHost(route: RiotRegionalRoute): string {
  return `${route.toLowerCase()}.api.riotgames.com`;
}

export function platformHost(platform: RiotPlatform): string {
  return `${platform.toLowerCase()}.api.riotgames.com`;
}
