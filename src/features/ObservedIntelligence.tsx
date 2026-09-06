import { useState } from 'react';
import type { Playbook, StaticData } from '../domain/models';
import type { CurrentGameState, IntelligenceModel } from '../domain/intelligence';
import { targetGap, contextualContributions } from '../strategy/currentGame';
import { classifyObservedStyle } from '../strategy/observedStyle';
import { Art, Portrait } from '../components/Art';
import { EntityIntelligence } from './EntityIntelligence';

export function ObservedIntelligence({
  plan,
  data,
  intelligence,
  game,
  assets = {},
  plans = [],
  onBuild,
}: {
  plan: Playbook;
  data: StaticData;
  intelligence?: IntelligenceModel;
  game?: CurrentGameState;
  assets?: Record<string, string>;
  plans?: Playbook[];
  onBuild: () => void;
}) {
  const [entityId, setEntityId] = useState<string | null>(null);
  const [selection, setSelection] = useState(plan.hero);
  const p = plan.observed,
    style = classifyObservedStyle(plan, data),
    gap = targetGap(plan, game);
  const name = (id: string) =>
    [...data.champions, ...data.items, ...data.augments, ...data.traits].find((e) => e.id === id)
      ?.name ?? id;
  const entityButton = (id: string, portrait = false) => {
    const c = data.champions.find((c) => c.id === id),
      e = [...data.items, ...data.augments].find((e) => e.id === id);
    return (
      <button
        className="entity-chip"
        onClick={() => setEntityId(id)}
        aria-label={`Inspect ${name(id)}`}
      >
        {portrait && c ? (
          <Portrait champion={c} assets={assets} compact />
        ) : e ? (
          <Art url={e.icon} alt={e.name} assets={assets} />
        ) : null}
        <span>{name(id)}</span>
      </button>
    );
  };
  const holders =
    p?.units
      .filter((u) => p.items.some((i) => i.holder === u.id))
      .sort((a, b) => {
        const equipped = (id: string) =>
          p.items
            .filter((i) => i.holder === id && i.ids.length === 1)
            .reduce((sum, i) => sum + i.estimate.sample, 0);
        return equipped(b.id) - equipped(a.id) || b.estimate.sample - a.estimate.sample;
      })
      .slice(0, 3) ?? [];
  return (
    <section
      className="panel smart-companion"
      id="strategy-intelligence"
      aria-label="Smart strategy intelligence"
    >
      <div className="panel-heading">
        <div>
          <span className="section-kicker">OBSERVED STRATEGY</span>
          <h2>Strategy intelligence</h2>
        </div>
        <button className="secondary" onClick={onBuild}>
          Build variants
        </button>
      </div>
      {p?.estimate.sample ? (
        <>
          <p className="observed-sample">
            {p.estimate.sample} boards · {p.estimate.uniqueMatches} matches ·{' '}
            {Math.round(p.estimate.confidence * 100)}% confidence · {p.scope.region} ·{' '}
            {p.scope.cohort}
          </p>
          <p className="fine-print">
            {p.scope.patch ?? 'Patch mapping unavailable; compatible reported-client scope'} ·
            Common does not mean required or optimal.
          </p>
          <div className="observed-style">
            <strong>{style.label}</strong>
            <span>
              {style.kind} · {Math.round(style.confidence * 100)}% confidence
            </span>
            <p>{style.reasons.join(' · ')}</p>
            <small>Final-board style does not establish exact roll rounds.</small>
          </div>
          <div className="smart-columns">
            {(['core', 'flex'] as const).map((role) => (
              <div key={role}>
                <h3>{role === 'core' ? 'Observed core' : 'Common flex'}</h3>
                <div className="observed-units">
                  {p.units
                    .filter((u) => u.role === role)
                    .slice(0, 8)
                    .map((u) => (
                      <div key={u.id}>
                        {entityButton(u.id, true)}
                        <small>
                          {Math.round(u.estimate.frequency * 100)}% · {u.estimate.sample} boards
                        </small>
                      </div>
                    ))}
                  {!p.units.some((u) => u.role === role) && <p>Not established in this sample</p>}
                </div>
              </div>
            ))}
          </div>
          <h3>Observed holders, items and packages</h3>
          <div className="holder-grid">
            {holders.map((holder) => (
              <article className="holder-card" key={holder.id}>
                {entityButton(holder.id, true)}
                <p>
                  {holder.estimate.sample} holder boards ·{' '}
                  {Math.round(holder.estimate.confidence * 100)}% confidence
                </p>
                {[1, 2, 3].map((size) => (
                  <div key={size}>
                    <h4>{size === 1 ? 'Common completed items' : `${size}-item packages`}</h4>
                    {p.items
                      .filter((i) => i.holder === holder.id && i.ids.length === size)
                      .slice(0, size === 1 ? 3 : 2)
                      .map((i) => (
                        <div className="item-package" key={i.ids.join()}>
                          <div className="smart-chips">
                            {i.ids.map((id, index) => (
                              <span key={`${id}-${index}`}>{entityButton(id)}</span>
                            ))}
                          </div>
                          <small>
                            {i.estimate.sample} boards · {Math.round(i.estimate.frequency * 100)}%
                            of holder boards ·{' '}
                            {i.estimate.eligible
                              ? `observed shrunk avg ${i.estimate.average?.toFixed(2)}`
                              : 'Insufficient outcome sample'}
                          </small>
                        </div>
                      ))}
                    {!p.items.some((i) => i.holder === holder.id && i.ids.length === size) && (
                      <p className="fine-print">Not established</p>
                    )}
                  </div>
                ))}
              </article>
            ))}
          </div>
          {!holders.length && <p>No item-holder evidence is available in these final boards.</p>}
          <h3>Observed augments</h3>
          <div className="augment-evidence">
            {p.augments.slice(0, 6).map((a) => (
              <div key={a.id}>
                {entityButton(a.id)}
                <p>
                  {a.estimate.sample} boards · {Math.round(a.estimate.frequency * 100)}% frequency ·{' '}
                  {Math.round(a.estimate.confidence * 100)}% confidence
                </p>
                <small>
                  {a.estimate.eligible
                    ? `observed shrunk avg ${a.estimate.average?.toFixed(2)}`
                    : 'Insufficient outcome sample'}
                </small>
              </div>
            ))}
          </div>
          {!p.augments.length && (
            <p>No augment selections present in the compatible source matches.</p>
          )}
          <div className="smart-columns">
            <div>
              <h3>Final-level distribution</h3>
              <div className="smart-chips">
                {Object.entries(p.levels).map(([level, count]) => (
                  <span className="distribution-chip" key={level}>
                    Level {level} · {count} boards ({Math.round((count / p.estimate.sample) * 100)}
                    %)
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3>Star profile</h3>
              {p.units
                .filter((u) => u.role === 'core')
                .slice(0, 8)
                .map((u) => (
                  <p key={u.id}>
                    {name(u.id)} ·{' '}
                    {[1, 2, 3]
                      .map(
                        (star) =>
                          `${star}★ ${Math.round(((u.stars[String(star)] ?? 0) / Math.max(1, u.estimate.sample)) * 100)}%`,
                      )
                      .join(' · ')}
                  </p>
                ))}
            </div>
          </div>
          <details>
            <summary>Common structural variants</summary>
            {p.variants.map((v) => (
              <p key={v.ids.join()}>
                {v.ids.map(name).join(', ')} · {v.estimate.sample} boards
              </p>
            ))}
          </details>
        </>
      ) : (
        <p>
          No compatible final-board evidence for this comp in the selected dataset.{' '}
          {intelligence
            ? `${intelligence.excludedBoards} boards were excluded by scope or validation.`
            : 'Intelligence is awaiting cached derivation or meta collection.'}
        </p>
      )}
      {game && (
        <div className="context-reasons">
          <h3>Current-game fit</h3>
          {contextualContributions(plan, game, data).map((c) => (
            <p key={c.key}>
              {c.contribution > 0 ? '+' : ''}
              {c.contribution.toFixed(1)} · {c.label}
            </p>
          ))}
          <p>
            Missing core: {gap.missingCore.map(name).join(', ') || 'Core retained'} ·{' '}
            {gap.retained.length} target units owned · Level gap: {gap.levelGap}
          </p>
        </div>
      )}
      <details>
        <summary>Entity mechanics</summary>
        <div className="smart-controls">
          <select
            aria-label="Inspect entity mechanics"
            value={selection}
            onChange={(e) => {
              setSelection(e.target.value);
              setEntityId(e.target.value);
            }}
          >
            {[...data.champions, ...data.items, ...data.augments, ...data.traits].map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button onClick={() => setEntityId(selection)}>Inspect selected entity</button>
        </div>
      </details>
      <p className="fine-print">
        Early boards, exact roll timing and positioning remain unsourced unless separately covered
        by curated guidance.
      </p>
      {entityId && (
        <EntityIntelligence
          id={entityId}
          data={data}
          intelligence={intelligence}
          plans={plans}
          onClose={() => setEntityId(null)}
        />
      )}
    </section>
  );
}
