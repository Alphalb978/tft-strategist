import { useEffect, useState } from 'react';
import type { Playbook, StaticData, LobbyPressure } from '../domain/models';
import type { CurrentGameState, IntelligenceModel, BoardAlternative } from '../domain/intelligence';
import { optimizeBoards } from '../strategy/boardOptimizer';
import { emptyCurrentGame } from '../strategy/currentGame';
import { CurrentGameEditor } from './SmartCompanion';
import { Portrait } from '../components/Art';

export function SmartCompBuilder({
  plan,
  external,
  data,
  intelligence,
  game,
  lobby,
  assets,
  onClose,
}: {
  external?: import('../domain/externalMeta').ExternalSnapshot | null;
  plan: Playbook;
  data: StaticData;
  intelligence?: IntelligenceModel;
  game?: CurrentGameState;
  lobby?: LobbyPressure;
  assets: Record<string, string>;
  onClose: () => void;
}) {
  const [core, setCore] = useState(plan.family.core);
  const [start, setStart] = useState('comp');
  const [level, setLevel] = useState(plan.target.targetLevel);
  const [context, setContext] = useState(
    game ?? emptyCurrentGame(data.version.set, new Date().toISOString()),
  );
  const [query, setQuery] = useState('');
  const [boards, setBoards] = useState<BoardAlternative[] | null>(null);
  useEffect(() => {
    document.getElementById('smart-builder')?.scrollIntoView({ block: 'start' });
  }, []);
  const name = (id: string) => data.champions.find((c) => c.id === id)?.name ?? id;
  return (
    <section className="panel smart-companion" id="smart-builder" aria-label="Smart Comp Builder">
      <div className="panel-heading">
        <h2>Smart Comp Builder</h2>
        <button onClick={onClose}>Close builder</button>
      </div>
      <p>
        Start with a core, compare legal changes, and inspect the evidence behind each alternative.
      </p>
      <div className="smart-controls">
        <label>
          Start from
          <select
            aria-label="Builder start from"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setCore(e.target.value === 'comp' ? plan.family.core : []);
              setBoards(null);
            }}
          >
            <option value="comp">This comp · {plan.title}</option>
            <option value="core">Selected core champions</option>
          </select>
        </label>
        <label>
          Target level
          <select
            aria-label="Builder target level"
            value={level}
            onChange={(e) => {
              setLevel(Number(e.target.value));
              setBoards(null);
            }}
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1}>{i + 1}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="smart-chips">
        {core.map((id) => (
          <button
            key={id}
            onClick={() => {
              setCore(core.filter((c) => c !== id));
              setBoards(null);
            }}
          >
            {name(id)} ×
          </button>
        ))}
      </div>
      <input
        aria-label="Find builder core champion"
        placeholder="Add a core champion…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="smart-chips">
        {query &&
          data.champions
            .filter(
              (c) =>
                c.shopStatus === 'pool' &&
                c.boardEligible &&
                !core.includes(c.id) &&
                c.name.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 6)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCore([...core, c.id]);
                  setQuery('');
                  setBoards(null);
                }}
              >
                {c.name} +
              </button>
            ))}
      </div>
      <p>
        Lobby pressure:{' '}
        {lobby?.coverage ? 'using your current scan' : 'no current scan; pressure stays neutral'}.
      </p>
      <details>
        <summary>Optional items, components and owned units</summary>
        <CurrentGameEditor
          data={data}
          value={context}
          onChange={(value) => {
            setContext(value);
            setBoards(null);
          }}
        />
        <p className="fine-print">
          These inputs apply to this builder comparison. Your Plans uses the shared Current Game
          panel.
        </p>
      </details>
      <button
        className="primary"
        disabled={!core.length}
        onClick={() =>
          setBoards(
            optimizeBoards({
              external,
              plan,
              data,
              intelligence,
              game: context,
              lobby,
              desired: core,
              targetLevel: level,
            }),
          )
        }
      >
        Build legal variants
      </button>
      {!core.length && <p>Select at least one core champion.</p>}
      {boards?.length === 0 && (
        <p>No legal alternatives for this core and level under the reviewed rules.</p>
      )}
      {boards?.map((a) => {
        const ids = a.board.units.map((u) => u.championId),
          base = plan.target.units.map((u) => u.championId);
        const added = ids.filter((id) => !base.includes(id)),
          removed = base.filter((id) => !ids.includes(id));
        const confidence =
          a.evidence === 'Observed'
            ? `${Math.round((plan.observed?.estimate.confidence ?? 0) * 100)}% observed confidence`
            : 'Unproven · low confidence';
        return (
          <article
            key={a.board.id}
            className="builder-alternative"
            aria-label={`${a.label} alternative`}
          >
            <h3>
              {a.label} · {a.evidence}
            </h3>
            <p>
              search score {a.score.toFixed(1)} · {confidence}
            </p>
            <div className="smart-roster">
              {ids.map((id) => {
                const champion = data.champions.find((c) => c.id === id)!;
                return (
                  <div key={id}>
                    <Portrait champion={champion} assets={assets} compact />
                    <span>{champion.name}</span>
                  </div>
                );
              })}
            </div>
            <p>
              Changes: {added.length ? `add ${added.map(name).join(', ')}` : 'core retained'}
              {removed.length ? `; remove ${removed.map(name).join(', ')}` : ''}
              {!added.length && !removed.length ? ' · same roster' : ''}
            </p>
            <details>
              <summary>Why this alternative</summary>
              {a.components.map((c) => (
                <p key={c.label}>
                  {c.value.toFixed(1)} · {c.label}
                </p>
              ))}
            </details>
            <p className="fine-print">
              Legal under reviewed rules. Search score is a heuristic, not measured meta strength.
            </p>
          </article>
        );
      })}
    </section>
  );
}
