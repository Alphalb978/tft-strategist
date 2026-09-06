import { useEffect, useRef } from 'react';
import type { StaticData, Playbook } from '../domain/models';
import type { IntelligenceModel } from '../domain/intelligence';
export function EntityIntelligence({
  id,
  data,
  intelligence,
  plans,
  onClose,
}: {
  id: string;
  data: StaticData;
  intelligence?: IntelligenceModel;
  plans: Playbook[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const name = (id: string) =>
    [...data.champions, ...data.items, ...data.augments, ...data.traits].find((e) => e.id === id)
      ?.name ?? id;
  const title = (id: string) => plans.find((p) => p.id === id)?.title ?? 'Observed structure';
  const c = data.champions.find((c) => c.id === id),
    item = data.items.find((i) => i.id === id),
    augment = data.augments.find((a) => a.id === id);
  const entity = data.knowledge?.entities[id];
  const champion = intelligence?.verifiedChampions?.[id]?.estimate.sample
    ? intelligence.verifiedChampions[id]
    : intelligence?.champions[id];
  const uses = Object.values(intelligence?.profiles ?? {}).filter((p) => p.estimate.sample > 0);
  return (
    <dialog
      className="entity-dialog smart-companion"
      ref={dialog}
      onClose={onClose}
      aria-label={`${name(id)} intelligence`}
    >
      <div className="panel-heading">
        <h2>{name(id)}</h2>
        <button autoFocus onClick={() => dialog.current?.close()}>
          Close entity details
        </button>
      </div>
      {c && (
        <p>
          {c.cost} cost · {c.traitIds.map(name).join(' / ')}
        </p>
      )}
      <h3>{entity?.abilityName ?? 'Effect'}</h3>
      <p>
        {entity?.description ?? 'Effect description unavailable in the selected structured source.'}
      </p>
      <p>{entity?.tags.map((t) => t.tag).join(' · ') || 'Advanced semantic tags unavailable'}</p>
      {entity?.unresolvedTokens.length ? (
        <p className="fine-print">
          Source values remain unresolved; exact combat effects are not fully verified.
        </p>
      ) : null}
      {item && (
        <p>
          Components: {item.components.map(name).join(' + ') || 'No verified component recipe'} ·
          Category: {item.category}
        </p>
      )}
      {augment && (
        <p>
          Tier/class: {entity?.sourceClass ?? 'unavailable'} · Categories:{' '}
          {entity?.tags.map((t) => t.tag).join(', ') || 'unavailable'}
        </p>
      )}
      {entity && Object.keys(entity.stats).length > 0 && (
        <details>
          <summary>Sourced stats</summary>
          <p>
            {Object.entries(entity.stats)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ')}
          </p>
        </details>
      )}
      {entity && Object.keys(entity.effects).length > 0 && (
        <details>
          <summary>Structured source effects</summary>
          <pre>{JSON.stringify(entity.effects, null, 2)}</pre>
        </details>
      )}
      {c && champion && (
        <>
          <h3>Observed champion context</h3>
          <p>
            {champion.scope.cohort} · {champion.scope.region} · {champion.estimate.sample} boards ·{' '}
            {Math.round(champion.estimate.frequency * 100)}% presence ·{' '}
            {Math.round(champion.estimate.confidence * 100)}% confidence
          </p>
          <p>
            {champion.estimate.eligible
              ? `Shrunk avg ${champion.estimate.average?.toFixed(2)} · Top4 ${Math.round((champion.estimate.top4 ?? 0) * 100)}% · Win ${Math.round((champion.estimate.win ?? 0) * 100)}%`
              : 'Insufficient outcome sample'}
          </p>
          <h3>Common items</h3>
          {champion.items.slice(0, 5).map((i) => (
            <p key={i.ids.join()}>
              {i.ids.map(name).join(' + ')} · {i.estimate.sample} boards
            </p>
          ))}
          <h3>Common co-units</h3>
          <p>
            {champion.units
              .filter((u) => u.id !== id)
              .slice(0, 6)
              .map((u) => `${name(u.id)} ${Math.round(u.estimate.frequency * 100)}%`)
              .join(' · ') || 'Not established'}
          </p>
          <h3>Common comps</h3>
          {(champion.familyMembership ?? intelligence?.champions[id]?.familyMembership)
            ?.slice(0, 5)
            .map((p) => (
              <p key={p.id}>
                {title(p.id)} · {p.sample} boards
              </p>
            ))}
        </>
      )}
      {(item || augment) && (
        <>
          <h3>Observed contextual usage</h3>
          {uses
            .filter((p) =>
              item ? p.items.some((i) => i.ids.includes(id)) : p.augments.some((a) => a.id === id),
            )
            .slice(0, 6)
            .map((p) => (
              <div key={p.id}>
                <strong>{title(p.id)}</strong>
                {item
                  ? p.items
                      .filter((i) => i.ids.length === 1 && i.ids.includes(id))
                      .slice(0, 3)
                      .map((i) => (
                        <p key={i.holder}>
                          {name(i.holder)} · {i.estimate.sample} boards ·{' '}
                          {Math.round(i.estimate.confidence * 100)}% confidence ·{' '}
                          {Math.round(i.estimate.frequency * 100)}% of this holder's boards
                        </p>
                      ))
                  : p.augments
                      .filter((a) => a.id === id)
                      .map((a) => (
                        <p key={a.id}>
                          {a.estimate.sample} boards · {Math.round(a.estimate.frequency * 100)}%
                          frequency · {Math.round(a.estimate.confidence * 100)}% confidence ·{' '}
                          {a.estimate.eligible
                            ? `shrunk avg ${a.estimate.average?.toFixed(2)}`
                            : 'Insufficient sample'}
                        </p>
                      ))}
              </div>
            ))}
          {!uses.some((p) =>
            item ? p.items.some((i) => i.ids.includes(id)) : p.augments.some((a) => a.id === id),
          ) && <p>No compatible observed usage available.</p>}
        </>
      )}
      <p className="fine-print">
        Observational association, not independent power or a causal benefit. Comp-specific usage is
        shown separately; overlapping comp samples are not added together.
      </p>
      <p className="fine-print">{entity?.provenance.source ?? 'Knowledge source unavailable'}</p>
    </dialog>
  );
}
