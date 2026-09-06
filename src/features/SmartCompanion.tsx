import { useState } from 'react';
import type { StaticData } from '../domain/models';
import type { CurrentGameState } from '../domain/intelligence';
import { emptyCurrentGame } from '../strategy/currentGame';

export function CurrentGameEditor({
  data,
  value,
  onChange,
  compact = false,
}: {
  data: StaticData;
  value?: CurrentGameState;
  onChange: (game: CurrentGameState) => void;
  compact?: boolean;
}) {
  const game = value ?? emptyCurrentGame(data.version.set, new Date().toISOString());
  const [query, setQuery] = useState('');
  const change = (patch: Partial<CurrentGameState>) =>
    onChange({ ...game, ...patch, updatedAt: new Date().toISOString() });
  const chosen = data.champions.filter((c) => game.copies[c.id] || game.board.includes(c.id));
  const matches = query.trim()
    ? data.champions
        .filter((c) => c.boardEligible && c.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6)
    : [];
  return (
    <section className="panel smart-companion" aria-label="Current game state">
      <h2>Current game</h2>
      <p className="fine-print">
        Update your situation to adapt all three plans. Saved locally; active games stay with their
        session.
      </p>
      <div className="smart-controls">
        <label>
          Stage
          <select
            aria-label="Current stage"
            value={game.stage}
            onChange={(e) => change({ stage: e.target.value })}
          >
            <option value="">Unknown</option>
            {Array.from({ length: 8 }, (_, stage) =>
              Array.from({ length: 7 }, (_, round) => `${stage + 1}-${round + 1}`),
            )
              .flat()
              .map((s) => (
                <option key={s}>{s}</option>
              ))}
          </select>
        </label>
        <label>
          Level
          <select
            aria-label="Current level"
            value={game.level}
            onChange={(e) => change({ level: Number(e.target.value) })}
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1}>{i + 1}</option>
            ))}
          </select>
        </label>
        <label>
          Health
          <select
            aria-label="Health band"
            value={game.health}
            onChange={(e) => change({ health: e.target.value as CurrentGameState['health'] })}
          >
            {['healthy', 'pressured', 'critical'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Economy
          <select
            aria-label="Economy band"
            value={game.economy}
            onChange={(e) => change({ economy: e.target.value as CurrentGameState['economy'] })}
          >
            {['strong', 'normal', 'weak'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <details open={!compact} className="game-inventory">
        <summary>
          Items, copies &amp; augments {value ? '· Context-aware' : '· Add your current board'}
        </summary>
        <div className="smart-chips">
          {data.items
            .filter((i) => i.category === 'component')
            .map((i) => (
              <button
                key={i.id}
                title={i.name}
                onClick={() => change({ components: [...game.components, i.id].slice(0, 30) })}
              >
                {i.name} +{game.components.filter((id) => id === i.id).length}
              </button>
            ))}
          <button onClick={() => change({ components: [] })}>Clear components</button>
        </div>
        <div className="smart-controls">
          <label>
            Completed item
            <select
              aria-label="Add completed item"
              value=""
              onChange={(e) => {
                if (e.target.value) change({ items: [...game.items, e.target.value].slice(0, 30) });
              }}
            >
              <option value="">Add item…</option>
              {data.items
                .filter((i) => i.category === 'combined')
                .map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Augment category
            <select
              aria-label="Augment category"
              value={game.augmentCategory ?? ''}
              onChange={(e) => change({ augmentCategory: e.target.value || null })}
            >
              <option value="">Unknown</option>
              {['combat', 'economy', 'leveling', 'reroll', 'item', 'trait', 'flexible'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Augment
            <select
              aria-label="Add augment"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  change({
                    augments: [...new Set([...game.augments, e.target.value])].slice(0, 3),
                  });
              }}
            >
              <option value="">Add augment…</option>
              {data.augments
                .filter((a) => a.liveStatus !== 'disabled')
                .map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="smart-chips">
          {game.items.map((id, index) => (
            <button
              key={`${id}-${index}`}
              onClick={() => change({ items: game.items.filter((_, i) => i !== index) })}
            >
              {data.items.find((i) => i.id === id)?.name} ×
            </button>
          ))}
          {game.augments.map((id) => (
            <button
              key={id}
              onClick={() => change({ augments: game.augments.filter((i) => i !== id) })}
            >
              {data.augments.find((i) => i.id === id)?.name} ×
            </button>
          ))}
        </div>
        <input
          aria-label="Find owned champion"
          placeholder="Find important owned units…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="smart-chips">
          {matches.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                change({
                  copies: { ...game.copies, [c.id]: Math.min(9, (game.copies[c.id] ?? 0) + 1) },
                });
                setQuery('');
              }}
            >
              {c.name} +
            </button>
          ))}
        </div>
        <div className="smart-chips">
          {chosen.map((c) => (
            <div className="smart-unit" key={c.id}>
              <span>{c.name}</span>
              <button
                aria-label={`Remove ${c.name} copy`}
                onClick={() =>
                  change({
                    copies: { ...game.copies, [c.id]: Math.max(0, (game.copies[c.id] ?? 0) - 1) },
                  })
                }
              >
                −
              </button>
              <b>{game.copies[c.id] ?? 0}</b>
              <button
                aria-label={`Add ${c.name} copy`}
                onClick={() =>
                  change({
                    copies: { ...game.copies, [c.id]: Math.min(9, (game.copies[c.id] ?? 0) + 1) },
                  })
                }
              >
                +
              </button>
              <button
                aria-pressed={game.board.includes(c.id)}
                onClick={() =>
                  change({
                    board: game.board.includes(c.id)
                      ? game.board.filter((id) => id !== c.id)
                      : [...game.board, c.id].slice(0, 10),
                  })
                }
              >
                On board
              </button>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
