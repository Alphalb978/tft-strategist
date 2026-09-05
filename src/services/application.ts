import type { Playbook, RecommendationPortfolio, SelectedPlan, StaticData } from '../domain/models';
import { CommunityDragonProvider } from '../providers/communityDragon';
import { loadPlaybooks } from '../providers/playbooks';
import { validatePlaybook } from '../rules/validation';
import type { Repository, Settings } from '../storage/repository';
import { defaultSettings } from '../storage/repository';
import { scoreCandidate } from '../strategy/scoring';
import { optimizePortfolio } from '../strategy/portfolio';
import { isStaticData } from '../domain/staticSchema';
export interface ApplicationState {
  data: StaticData;
  playbooks: Playbook[];
  portfolio: RecommendationPortfolio;
  source: 'Bundled snapshot' | 'Local cache' | 'Network';
  settings: Settings;
  selection: SelectedPlan | null;
  notices: string[];
  assets: Record<string, string>;
}
export function createRecommendations(
  data: StaticData,
  settings: Settings,
  now = new Date().toISOString(),
) {
  const all = loadPlaybooks(data),
    notices: string[] = [];
  const playbooks = all.filter((p) => {
    const errors = validatePlaybook(p, data).filter((i) => i.severity === 'error');
    if (errors.length)
      notices.push(`${p.title} excluded: ${errors.map((e) => e.message).join(' ')}`);
    return !errors.length;
  });
  const portfolio = optimizePortfolio(
    playbooks.map((p) =>
      scoreCandidate(p, { version: data.version, now, personalWeight: settings.personalWeight }),
    ),
    now,
  );
  return { playbooks, portfolio, notices };
}
export async function loadApplication(repository: Repository): Promise<ApplicationState> {
  const [cached, savedSettings, selection, assetResponse] = await Promise.all([
    repository.get<StaticData>('static'),
    repository.get<Settings>('settings'),
    repository.get<SelectedPlan>('selection'),
    fetch('/data/asset-manifest.json').catch(() => null),
  ]);
  const settings = {
    personalWeight: Math.min(
      0.1,
      Math.max(0.05, Number(savedSettings?.personalWeight) || defaultSettings.personalWeight),
    ),
    historyWindow: Math.min(20, Math.max(10, Number(savedSettings?.historyWindow) || 15)),
  };
  let cacheUsable = isStaticData(cached);
  if (cacheUsable) {
    try {
      cacheUsable = createRecommendations(cached!, settings).playbooks.length > 0;
    } catch {
      cacheUsable = false;
    }
  }
  const response = !cacheUsable ? await fetch('/data/static-set18.json') : null;
  if (response && !response.ok) throw new Error('The bundled static snapshot could not be loaded.');
  const data: unknown = cacheUsable ? cached : await response!.json();
  if (!isStaticData(data))
    throw new Error('Static snapshot schema is unsupported. Refresh the application data.');
  const assets: Record<string, string> = assetResponse?.ok
    ? await assetResponse.json().catch(() => ({}))
    : {};
  const result = createRecommendations(data, settings);
  let usableSelection: SelectedPlan | null = null;
  try {
    if (
      selection?.set === data.version.set &&
      selection.patch === data.version.patch &&
      selection.sourceVersion === data.version.sourceVersion &&
      Array.isArray(selection.snapshot?.plans) &&
      selection.snapshot.plans.length === 3 &&
      selection.snapshot.plans.some((p) => p.candidate.playbook.id === selection.playbookId) &&
      selection.snapshot.plans.every(
        (p) =>
          Number.isFinite(p.candidate.score) &&
          p.candidate.confidence &&
          validatePlaybook(p.candidate.playbook, data).every((i) => i.severity !== 'error'),
      )
    )
      usableSelection = selection;
  } catch {
    /* Invalid snapshots are discarded; the fresh validated portfolio remains usable. */
  }
  if (cached && !cacheUsable)
    result.notices.push('Incompatible cache ignored; using the bundled snapshot.');
  return {
    data,
    ...result,
    source: cacheUsable ? 'Local cache' : 'Bundled snapshot',
    settings,
    selection: usableSelection,
    assets,
  };
}
export async function refreshApplication(
  current: ApplicationState,
  repository: Repository,
): Promise<ApplicationState> {
  const data = await new CommunityDragonProvider().fetch();
  const result = createRecommendations(data, current.settings);
  if (!result.playbooks.length)
    throw new Error('Refreshed roster failed playbook validation; previous cache retained.');
  await repository.set('static', data);
  return { ...current, data, ...result, source: 'Network' };
}
export async function selectPlan(
  playbookId: string,
  state: ApplicationState,
  repository: Repository,
): Promise<SelectedPlan> {
  if (!state.portfolio.plans.some((p) => p.candidate.playbook.id === playbookId))
    throw new Error('Plan is not in this portfolio.');
  const selection: SelectedPlan = {
    id: crypto.randomUUID(),
    playbookId,
    set: state.data.version.set,
    patch: state.data.version.patch,
    sourceVersion: state.data.version.sourceVersion,
    selectedAt: new Date().toISOString(),
    snapshot: state.portfolio,
  };
  await repository.set('selection', selection);
  return selection;
}
