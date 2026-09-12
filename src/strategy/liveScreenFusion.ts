import type { Playbook, ScoreComponent, StaticData } from '../domain/models';
import type { ScreenShopStatus } from '../services/screenShop';
import type { ScreenOwnedUnitsStatus } from '../services/screenOwnedUnits';
import { clamp } from './scoring';

export interface LiveScreenState {
  available: boolean;
  detected: boolean;
  frameAgeMs: number;
  shopStatus: ScreenShopStatus | null;
  ownedStatus: ScreenOwnedUnitsStatus | null;
  lastUpdated?: string;
}

export interface LiveScreenModifiers {
  ownedAffinity: number;
  shopOpportunity: number;
  total: number;
  identityCoverage: number;
  freshnessFactor: number;
  summary: string;
}

const MAX_OWNED_AFFINITY = 8.0;
const MAX_SHOP_OPPORTUNITY = 3.0;
const FRESH_THRESHOLD_MS = 2500;
const STALE_EXPIRATION_MS = 5000;

export function calculateFreshnessFactor(live?: LiveScreenState | null): number {
  if (!live || !live.available || !live.detected) return 0;
  const age = Math.max(0, live.frameAgeMs ?? 0);
  if (age <= FRESH_THRESHOLD_MS) return 1.0;
  if (age >= STALE_EXPIRATION_MS) return 0.0;
  return clamp((STALE_EXPIRATION_MS - age) / (STALE_EXPIRATION_MS - FRESH_THRESHOLD_MS));
}

/**
 * Calculates owned-unit affinity for a given comp.
 * Matches core and target units held on bench or board.
 * Star level 2 or equivalent adds extra commitment weight.
 * Damped by identityCoverage to prevent noisy/partial vision from injecting false certainty.
 * Attenuated by freshnessFactor (decays to 0 when TFT closes or frames stall).
 */
export function calculateOwnedAffinity(
  plan: Playbook,
  ownedStatus: ScreenOwnedUnitsStatus | null | undefined,
  freshnessFactor: number,
  data?: StaticData,
): { score: number; label: string } {
  if (!ownedStatus || freshnessFactor <= 0) {
    return { score: 0, label: '' };
  }

  const coverage = clamp(ownedStatus.identityCoverage ?? 1, 0, 1);
  if (coverage <= 0) {
    return { score: 0, label: 'Identity coverage 0% · owned affinity muted' };
  }

  const coreSet = new Set(plan.family.core);
  const targetSet = new Set(plan.target.units.map((u) => u.championId));

  // Map owned champions and counts from knownOwned or bench/board
  const counts = new Map<string, { count: number; stars: number }>();

  if (ownedStatus.knownOwned && ownedStatus.knownOwned.length > 0) {
    for (const entry of ownedStatus.knownOwned) {
      if (entry.confidence >= 0.6) {
        const copies = Math.max(1, entry.knownCopyEquivalent ?? entry.knownTrackCount);
        const stars = copies >= 9 ? 3 : copies >= 3 ? 2 : 1;
        counts.set(entry.championId, { count: copies, stars });
      }
    }
  } else {
    // Fallback: aggregate directly from board and bench
    const allSlots = [
      ...ownedStatus.board.filter((c) => c.occupied && c.championId && c.identityConfidence >= 0.6),
      ...ownedStatus.bench.filter((s) => s.occupied && s.championId && s.identityConfidence >= 0.6),
    ];
    for (const slot of allSlots) {
      const id = slot.championId!;
      const prev = counts.get(id) ?? { count: 0, stars: 1 };
      const stars = Math.max(prev.stars, slot.starLevel ?? 1);
      counts.set(id, { count: prev.count + 1, stars });
    }
  }

  let rawScore = 0;
  const matchedCore: string[] = [];
  const matchedTarget: string[] = [];

  for (const [id, entry] of counts.entries()) {
    const isCore = coreSet.has(id);
    const isTarget = targetSet.has(id);
    const champName = data?.champions.find((c) => c.id === id)?.name ?? id;

    if (isCore) {
      // Core pieces: base 1.5 per unique unit, +1.0 for 2-star (or >=3 copies)
      const starBonus = entry.stars >= 2 ? 1.0 : 0;
      rawScore += 1.5 + starBonus;
      matchedCore.push(`${champName}${entry.stars >= 2 ? ' 2★' : ''}`);
    } else if (isTarget) {
      // Flex/target pieces: 0.75 per unique unit
      rawScore += 0.75;
      matchedTarget.push(champName);
    }
  }

  // Apply coverage damping and staleness attenuation
  const dampedScore = Math.min(MAX_OWNED_AFFINITY, rawScore * coverage * freshnessFactor);
  const rounded = Math.round(dampedScore * 10) / 10;

  if (rounded <= 0) {
    return { score: 0, label: '' };
  }

  const piecesDesc = matchedCore.length
    ? matchedCore.join(', ')
    : matchedTarget.join(', ');
  const covPct = Math.round(coverage * 100);
  const label = `+${rounded.toFixed(1)} Owned-unit affinity (${piecesDesc}, cov ${covPct}%)`;

  return { score: rounded, label };
}

/**
 * Calculates immediate shop opportunity for a given comp.
 * Matches current stable shop slots against core and target champions.
 * Updates immediately on shop reroll. Attenuates to 0 when TFT closes.
 */
export function calculateShopOpportunity(
  plan: Playbook,
  shopStatus: ScreenShopStatus | null | undefined,
  freshnessFactor: number,
  data?: StaticData,
): { score: number; label: string } {
  if (!shopStatus || freshnessFactor <= 0) {
    return { score: 0, label: '' };
  }

  const coreSet = new Set(plan.family.core);
  const targetSet = new Set(plan.target.units.map((u) => u.championId));

  let rawScore = 0;
  const matchedShop: string[] = [];

  for (const slot of shopStatus.slots) {
    if (!slot.championId) continue;
    // Require reasonable confidence or stability
    if (slot.confidence < 0.70 && !slot.stable) continue;

    const id = slot.championId;
    const champName = slot.championName ?? data?.champions.find((c) => c.id === id)?.name ?? id;

    if (coreSet.has(id)) {
      rawScore += 1.5;
      matchedShop.push(`${champName} (core)`);
    } else if (targetSet.has(id)) {
      rawScore += 0.5;
      matchedShop.push(champName);
    }
  }

  const attenuatedScore = Math.min(MAX_SHOP_OPPORTUNITY, rawScore * freshnessFactor);
  const rounded = Math.round(attenuatedScore * 10) / 10;

  if (rounded <= 0) {
    return { score: 0, label: '' };
  }

  const label = `+${rounded.toFixed(1)} Shop opportunity (${matchedShop.join(', ')})`;
  return { score: rounded, label };
}

/**
 * Derives inspectable ScoreComponent entries for candidate scoring.
 */
export function deriveLiveScreenContributions(
  plan: Playbook,
  live?: LiveScreenState | null,
  data?: StaticData,
): ScoreComponent[] {
  const freshness = calculateFreshnessFactor(live);
  if (freshness <= 0) return [];

  const components: ScoreComponent[] = [];

  const owned = calculateOwnedAffinity(plan, live?.ownedStatus, freshness, data);
  if (owned.score > 0) {
    components.push({
      key: 'live-owned-affinity',
      label: owned.label,
      input: owned.score,
      weight: 1.0,
      contribution: owned.score,
      status: 'measured',
    });
  }

  const shop = calculateShopOpportunity(plan, live?.shopStatus, freshness, data);
  if (shop.score > 0) {
    components.push({
      key: 'live-shop-opportunity',
      label: shop.label,
      input: shop.score,
      weight: 1.0,
      contribution: shop.score,
      status: 'measured',
    });
  }

  return components;
}

/**
 * Derives summary modifiers for home recommendation and portfolio ranking.
 */
export function deriveLiveScreenModifiers(
  plan: Playbook,
  live?: LiveScreenState | null,
  data?: StaticData,
): LiveScreenModifiers {
  const freshness = calculateFreshnessFactor(live);
  const coverage = live?.ownedStatus ? clamp(live.ownedStatus.identityCoverage ?? 1, 0, 1) : 0;

  if (freshness <= 0) {
    return {
      ownedAffinity: 0,
      shopOpportunity: 0,
      total: 0,
      identityCoverage: coverage,
      freshnessFactor: 0,
      summary: '',
    };
  }

  const owned = calculateOwnedAffinity(plan, live?.ownedStatus, freshness, data);
  const shop = calculateShopOpportunity(plan, live?.shopStatus, freshness, data);
  const total = Math.round((owned.score + shop.score) * 10) / 10;

  const parts: string[] = [];
  if (owned.score > 0) parts.push(`owned +${owned.score.toFixed(1)}`);
  if (shop.score > 0) parts.push(`shop +${shop.score.toFixed(1)}`);

  return {
    ownedAffinity: owned.score,
    shopOpportunity: shop.score,
    total,
    identityCoverage: coverage,
    freshnessFactor: freshness,
    summary: parts.join(' · '),
  };
}
