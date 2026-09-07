import type { FusedEstimate } from './evidenceFusion';
export function opportunitySignals(
  fused: FusedEstimate,
  contest: number | null,
  adoption: number | null = null,
) {
  if (fused.externalWeight < 100 || fused.confidence < 0.5) return [];
  const signals: string[] = [];
  if (fused.disagreement && fused.internalWeight >= 100)
    signals.push('External / local disagreement');
  if (
    contest !== null &&
    contest < 0.2 &&
    fused.average !== null &&
    fused.average < 4.2 &&
    fused.confidence >= 0.7
  )
    signals.push('Low-contest value');
  if (adoption !== null && adoption > 0.015) signals.push('Rising adoption');
  return signals;
}
