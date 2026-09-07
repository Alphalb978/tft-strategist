import { cleanMechanics, compactCount, compactRank } from './intelligenceDisplay';
import { resolveEntityIntelligence } from '../strategy/entityIntelligence';
import type { IntelligenceModel, CurrentGameState } from '../domain/intelligence';
import { useId, useState } from 'react';
import type { Playbook, StaticData } from '../domain/models';
import { Art } from './Art';
import { EntityIntelligence } from '../features/EntityIntelligence';
export function IntelligenceHover({
  id,
  data,
  plan,
  assets,
  external,
  intelligence,
  plans,
  game,
}: {
  external?: import('../domain/externalMeta').ExternalSnapshot | null;
  intelligence?: IntelligenceModel;
  plans?: Playbook[];
  game?: CurrentGameState;
  id: string;
  data: StaticData;
  plan: Playbook;
  assets: Record<string, string>;
}) {
  const tooltipId = useId(),
    [open, setOpen] = useState(false),
    [details, setDetails] = useState(false);
  const entity = [...data.champions, ...data.items, ...data.augments, ...data.traits].find(
    (e) => e.id === id,
  );
  const champ = data.champions.find((e) => e.id === id),
    item = data.items.find((e) => e.id === id),
    mechanics = data.knowledge?.entities[id];
  const name = (key: string) =>
    [...data.champions, ...data.items, ...data.traits].find((e) => e.id === key)?.name ?? key;
  const resolved = resolveEntityIntelligence({
    id,
    data,
    plan,
    plans,
    intelligence,
    external,
    game,
  });
  const { aggregate, packages } = resolved;
  const observed = plan.observed?.units.find((u) => u.id === id);
  return (
    <span
      className="intelligence-hover"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="entity-chip"
        aria-label={`Inspect ${entity?.name ?? id}`}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        onClick={() => setDetails(true)}
      >
        <Art url={entity?.icon ?? null} alt={entity?.name ?? id} assets={assets} />
        <span>{entity?.name ?? id}</span>
      </button>
      {open && (
        <span role="tooltip" id={tooltipId} className="intelligence-tooltip">
          <strong>{entity?.name ?? id}</strong>
          {champ && (
            <span>
              {champ.cost} cost · {champ.traitIds.map(name).join(' / ')}
              <br />
              {plan.family.core.includes(id)
                ? 'Core'
                : plan.family.core.length
                  ? 'Flex'
                  : 'Role not established'}{' '}
              ·{' '}
              {observed
                ? `${Math.round(observed.estimate.frequency * 100)}% observed presence`
                : 'Contest not known'}
            </span>
          )}
          {item && <span>{item.components.map(name).join(' + ') || 'Recipe unavailable'}</span>}
          <span>{cleanMechanics(mechanics?.description).slice(0, 230)}</span>
          {packages.length > 0 && (
            <strong>
              {resolved.source.startsWith('Global')
                ? `Common ${entity?.name ?? id} ${champ ? 'items' : 'holders'}`
                : 'Comp items'}{' '}
              · {resolved.source}
            </strong>
          )}
          {resolved.ownedCopies > 0 && (
            <span>
              {resolved.ownedCopies} owned copies{resolved.onBoard ? ' · On your board' : ''}
            </span>
          )}
          {packages.map((p, i) => (
            <span key={i}>
              {name(p.holder)}:{' '}
              {p.ids.map((key) => (
                <span key={key} title={name(key)}>
                  <Art
                    url={data.items.find((i) => i.id === key)?.icon ?? null}
                    alt={name(key)}
                    assets={assets}
                  />
                  {name(key)}{' '}
                </span>
              ))}
            </span>
          ))}
          {!packages.length && (
            <span>Supported {champ ? 'item packages' : 'holders'} unavailable</span>
          )}
          {aggregate && (
            <span>
              MetaTFT: avg {aggregate.stats.average?.toFixed(2)} ·{' '}
              {compactCount(aggregate.stats.sample)} observations ·{' '}
              {compactRank(external?.manifest.scope.rank)} · {external?.manifest.scope.window}.
              Common in observed games.
            </span>
          )}
          <small>Click or Enter for details and evidence.</small>
        </span>
      )}
      {details && (
        <EntityIntelligence
          id={id}
          data={data}
          plans={plans ?? [plan]}
          plan={plan}
          intelligence={intelligence}
          external={external}
          onClose={() => setDetails(false)}
        />
      )}
    </span>
  );
}
