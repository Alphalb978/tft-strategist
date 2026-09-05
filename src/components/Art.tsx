import { useState } from 'react';
import type { Champion } from '../domain/models';
export function Art({
  url,
  alt,
  assets,
  className = '',
}: {
  url: string | null;
  alt: string;
  assets: Record<string, string>;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? (
    <img className={className} src={assets[url] ?? url} alt={alt} onError={() => setFailed(true)} />
  ) : (
    <span
      role="img"
      aria-label={`${alt} · art unavailable`}
      className={`art-fallback ${className}`}
    >
      {alt.slice(0, 2)}
    </span>
  );
}
export function Portrait({
  champion,
  assets,
  compact = false,
  role,
}: {
  champion: Champion;
  assets: Record<string, string>;
  compact?: boolean;
  role?: string;
}) {
  return (
    <div
      className={`portrait ${compact ? 'compact' : ''}`}
      title={`${champion.name} · ${champion.cost} cost${role ? ` · ${role}` : ''}`}
    >
      <div className={`portrait-frame cost-${Math.min(champion.cost, 5)}`}>
        <Art url={champion.icon} alt={champion.name} assets={assets} />
        {!compact && <span className="cost">{champion.cost}</span>}
      </div>
      {!compact && (
        <>
          <span className="unit-name">{champion.name}</span>
          {role && <span className="unit-role">{role}</span>}
        </>
      )}
    </div>
  );
}
