import type { LobbyPressure, StaticData } from '../domain/models';
import { Art } from './Art';

export function LobbyPressureSummary({
  lobby,
  data,
  assets,
  compact = false,
}: {
  lobby: LobbyPressure;
  data: StaticData;
  assets: Record<string, string>;
  compact?: boolean;
}) {
  const championById = new Map(data.champions.map((champion) => [champion.id, champion]));
  const pressured = lobby.unitPressure.filter((unit) => unit.normalizedPressure > 0);
  const visible = pressured.slice(0, compact ? 4 : 6);
  return (
    <div className={`lobby-pressure-summary ${compact ? 'compact' : ''}`}>
      <div className="pressure-heading">
        <strong>Historical unit pressure</strong>
        <span>
          {Math.round((lobby.unitPressure[0]?.evidenceCoverage ?? 0) * 100)}% lobby evidence
        </span>
      </div>
      {visible.length ? (
        <div className="pressure-strip">
          {visible.map((pressure) => {
            const champion = championById.get(pressure.championId);
            return (
              <div key={pressure.championId} title={`${pressure.championId} · historical evidence`}>
                {champion && <Art url={champion.icon} alt={champion.name} assets={assets} />}
                <span>
                  <strong>{champion?.name ?? pressure.championId}</strong>
                  <small>
                    {pressure.totalEquivalentUsers.toFixed(1)} equivalent users ·{' '}
                    {pressure.opponentsWithEvidence} opponent
                    {pressure.opponentsWithEvidence === 1 ? '' : 's'}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="fine-print">Resolved histories contain no current-set unit signals.</p>
      )}
      {!compact && pressured.length > visible.length && (
        <details className="pressure-details">
          <summary>Inspect {Math.min(12, pressured.length)} lobby unit signals</summary>
          <div className="pressure-table">
            {pressured.slice(0, 12).map((pressure) => (
              <div key={pressure.championId}>
                <strong>
                  {championById.get(pressure.championId)?.name ?? pressure.championId}
                </strong>
                <span>{pressure.equivalentHistoricalUsers.toFixed(2)} base users</span>
                <span>+{pressure.recentSpikeEquivalentUsers.toFixed(2)} recent spike</span>
                <span>+{pressure.historicalCopyEquivalentUsers.toFixed(2)} copy signal</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
