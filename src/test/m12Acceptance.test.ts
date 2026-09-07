import { describe, it, expect } from 'vitest';
import { data, playbooks, NOW } from './fixtures';
import captured from '../../data/fixtures/metatft-public.json';
import { normalizePublicComps } from '../../scripts/metatft-normalize';
import { buildCompRegistry } from '../services/compRegistry';
import { cleanMechanics, compactRank } from '../components/intelligenceDisplay';
import { emptyCurrentGame, targetGap } from '../strategy/currentGame';
import { fusedForPlan } from '../strategy/evidenceFusion';
import { validatePlaybook } from '../rules/validation';
describe('M12 human acceptance integration', () => {
  it('adds legal external-only references, fuses exact matches and restores internal fallback', () => {
    const snapshot = normalizePublicComps(captured, data, NOW);
    const matched = {
      ...snapshot.comps[0],
      id: 'exact-curated',
      units: playbooks[0].target.units.map((u) => u.championId),
      core: playbooks[0].family.core,
    };
    snapshot.comps.push(matched);
    const registry = buildCompRegistry(playbooks, data, null, undefined, snapshot);
    expect(registry.find((e) => e.id === playbooks[0].id)?.externalId).toBe('exact-curated');
    expect(
      registry.some((e) => e.id.endsWith('exact-curated') && e.sourceKind === 'external'),
    ).toBe(false);
    const references = registry.filter((e) => e.sourceKind === 'external');
    expect(references.length).toBeGreaterThan(20);
    expect(references.some((e) => e.recommendationEligible)).toBe(true);
    for (const entry of references)
      expect(validatePlaybook(entry.playbook, data).filter((i) => i.severity === 'error')).toEqual(
        [],
      );
    expect(buildCompRegistry(playbooks, data).length).toBe(playbooks.length);
    expect(fusedForPlan(playbooks[0], snapshot, data, NOW).externalWeight).toBeGreaterThan(100);
  });
  it('never shows templates or invents an unset level', () => {
    expect(
      cleanMechanics(
        'On death summons a Spirit Walker with @HealthCalc2@ max Health which immediately taunts.',
      ),
    ).toContain('taunts');
    expect(cleanMechanics('Deal @Damage@ damage. Stuns nearby enemies.')).toContain(
      'Stuns nearby enemies.',
    );
    expect(cleanMechanics('<magic>Stuns</magic>\\nNearby enemies.')).not.toMatch(/@|<|\\n/);
    expect(compactRank('CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM')).toBe('Plat+');
    expect(targetGap(playbooks[0], emptyCurrentGame(18, NOW)).levelGap).toBeNull();
  });
});
