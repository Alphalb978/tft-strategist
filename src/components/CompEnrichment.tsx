import type { ExternalSnapshot } from '../domain/externalMeta';
import type { Playbook, StaticData } from '../domain/models';
import { relatedExternal } from '../strategy/evidenceFusion';
import { Art, Portrait } from './Art';

export function enrichmentForPlan(plan: Playbook, external?: ExternalSnapshot | null) {
  const relation = relatedExternal(plan, external);
  const scope = external?.manifest.scope;
  const trustedPackages =
    relation?.relation === 'strong'
      ? (relation.comp.packages ?? []).filter(
          (pkg) =>
            pkg.evidence === 'structured-build+public-comp-row' &&
            pkg.providerCompId === relation.comp.id &&
            pkg.set === scope?.set &&
            pkg.patch === scope?.patch &&
            pkg.hotfix === scope?.hotfix,
        )
      : [];
  return {
    relation: relation?.relation ?? null,
    comp: relation?.comp ?? null,
    trustedPackages,
  };
}

export function CompMetaBadges({
  plan,
  external,
}: {
  plan: Playbook;
  external?: ExternalSnapshot | null;
}) {
  const { comp } = enrichmentForPlan(plan, external);
  const difficulty = comp?.difficulty ?? 'unknown';
  if (!comp?.providerTier && difficulty === 'unknown' && !comp?.levelingStyle) return null;
  return (
    <div className="comp-meta-badges" aria-label="MetaTFT comp details">
      {comp?.providerTier && <strong className="comp-tier">{comp.providerTier}</strong>}
      {comp?.levelingStyle && <span>{comp.levelingStyle}</span>}
      {difficulty !== 'unknown' && (
        <span className={`difficulty-badge difficulty-${difficulty}`}>
          {difficulty[0].toUpperCase() + difficulty.slice(1)}
        </span>
      )}
    </div>
  );
}

export function ExternalCompLineup({
  plan,
  external,
  data,
  assets,
}: {
  plan: Playbook;
  external?: ExternalSnapshot | null;
  data: StaticData;
  assets: Record<string, string>;
}) {
  const { trustedPackages } = enrichmentForPlan(plan, external);
  return <CompLineupContent plan={plan} data={data} assets={assets} packages={trustedPackages} />;
}

function CompLineupContent({
  plan,
  data,
  assets,
  packages,
}: {
  plan: Playbook;
  data: StaticData;
  assets: Record<string, string>;
  packages: Array<{ holder: string; items: string[] }>;
}) {
  const byHolder = new Map(packages.map((entry) => [entry.holder, entry.items]));
  const units = [...plan.target.units].sort(
    (left, right) => Number(byHolder.has(right.championId)) - Number(byHolder.has(left.championId)),
  );
  return (
    <div className="enriched-lineup" aria-label="Champion lineup and trusted items">
      {units.map((unit) => {
        const champion = data.champions.find((entry) => entry.id === unit.championId);
        if (!champion) return null;
        const itemIds = byHolder.get(unit.championId) ?? [];
        return (
          <div
            key={unit.championId}
            className={`enriched-unit ${itemIds.length ? 'is-item-holder' : ''} ${unit.slot === 'core' ? 'is-core' : ''}`}
          >
            <Portrait champion={champion} assets={assets} compact />
            <span>{champion.name}</span>
            {itemIds.length > 0 && (
              <div className="holder-items" aria-label={`${champion.name} recommended items`}>
                {itemIds.map((itemId, index) => {
                  const item = data.items.find((entry) => entry.id === itemId);
                  return item ? (
                    <span
                      className="compact-item-icon"
                      title={item.name}
                      key={`${itemId}-${index}`}
                    >
                      <Art url={item.icon} alt={item.name} assets={assets} />
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ExternalItemPackages({
  plan,
  external,
  data,
  assets,
}: {
  plan: Playbook;
  external?: ExternalSnapshot | null;
  data: StaticData;
  assets: Record<string, string>;
}) {
  const { trustedPackages } = enrichmentForPlan(plan, external);
  if (!trustedPackages.length) return null;
  return (
    <div className="external-item-packages" aria-label="MetaTFT recommended item holders">
      <small>MetaTFT · same comp, set, patch and visible holder package</small>
      {trustedPackages.map((pkg) => {
        const champion = data.champions.find((entry) => entry.id === pkg.holder);
        if (!champion) return null;
        return (
          <div className="strategy-holder-row" key={pkg.holder}>
            <Portrait champion={champion} assets={assets} compact />
            <div>
              <div className="holder-title">
                <strong>{champion.name}</strong>
                <span>provider recommendation</span>
              </div>
              <div className="item-list">
                {pkg.items.map((itemId, index) => {
                  const item = data.items.find((entry) => entry.id === itemId);
                  return item ? (
                    <span key={`${itemId}-${index}`} title={item.name}>
                      <Art url={item.icon} alt={item.name} assets={assets} />
                      <span>{item.name}</span>
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
