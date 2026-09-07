import type { ApplicationState } from '../services/application';
import type { Playbook } from '../domain/models';
import { relatedExternal } from '../strategy/evidenceFusion';
import { externalStatus } from '../providers/externalMeta';
import { familyRepresentation, metaCohortLabel } from '../strategy/metaCatalog';
export const PICK_HELP =
  'Broad MetaTFT adoption for the active external scope. Shown in the provider’s displayed units.';
export const DIRECT_HELP =
  'Share of our classified Riot boards matching this comp in the selected direct dataset.';
export function adoptionMetrics(
  plan: Playbook,
  state: Pick<ApplicationState, 'external' | 'data' | 'meta'>,
  now = new Date().toISOString(),
) {
  const snapshot = state.external;
  const relation = relatedExternal(plan, snapshot);
  const compatible =
    externalStatus(snapshot, state.data, now).startsWith('Compatible') &&
    snapshot?.manifest.scope.queue === 1100 &&
    Boolean(snapshot.manifest.scope.rank && snapshot.manifest.scope.window);
  const reported = compatible ? relation?.comp.pickRate : undefined;
  const pick =
    reported &&
    Number.isFinite(reported.value) &&
    reported.value >= 0 &&
    reported.value <= 100 &&
    ['percent', 'provider-display'].includes(reported.unit)
      ? reported
      : null;
  const stat = state.meta?.familyStats.find((s) => s.familyId === plan.family.id);
  const representation = stat && state.meta ? familyRepresentation(stat, state.meta) : null;
  const direct =
    representation &&
    representation.denominator > 0 &&
    representation.rate >= 0 &&
    representation.rate <= 1
      ? representation.rate
      : null;
  const scope = state.meta
    ? `${state.meta.platform} ${metaCohortLabel(state.meta.rankCohort)} · ${state.meta.scope?.windowDays ?? '?'}d`
    : 'No direct dataset';
  return { pick, direct, scope, sample: stat?.games ?? null, relation: relation?.relation };
}
export function AdoptionMetric({
  plan,
  state,
  details = false,
}: {
  plan: Playbook;
  state: ApplicationState;
  details?: boolean;
}) {
  const value = adoptionMetrics(plan, state);
  const directText = value.direct == null ? '—' : `${(value.direct * 100).toFixed(1)}%`;
  return (
    <span className="adoption-metric">
      <span
        title={value.pick ? PICK_HELP : DIRECT_HELP}
        aria-label={value.pick ? 'MetaTFT Pick Rate' : 'Direct Share'}
      >
        <b>
          {value.pick
            ? `${value.pick.value.toFixed(2)}${value.pick.unit === 'percent' ? '%' : ''}`
            : directText}
        </b>{' '}
        {value.pick ? 'Pick Rate' : 'Direct Share'}
      </span>
      {(!value.pick || details) && <small>{value.scope}</small>}
      {details && (
        <details>
          <summary>Adoption · Evidence & Method</summary>
          <p>
            {PICK_HELP}{' '}
            {value.pick
              ? value.pick.unit === 'percent'
                ? 'Provider reports a percentage.'
                : 'Provider displays a rate without a percent sign.'
              : 'No compatible captured Pick Rate.'}
          </p>
          <p>
            {DIRECT_HELP} Direct Share: {directText} · {value.sample ?? 0} direct boards ·{' '}
            {value.scope}.
          </p>
          <p>
            External scope: {state.external?.manifest.scope.rank ?? 'Unknown'} ·{' '}
            {state.external?.manifest.scope.window ?? 'Unknown'}. Match:{' '}
            {value.relation ?? 'unmapped'}.
          </p>
          <p>
            Different populations: a difference may reflect sampling or classification. One snapshot
            does not establish a trend.
          </p>
        </details>
      )}
    </span>
  );
}
