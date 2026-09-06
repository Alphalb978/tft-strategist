import type {
  CompletedMatch,
  MatchReconciliation,
  PersonalProfile,
  PlanSession,
  PostGameReview,
  RiotIdentity,
} from '../domain/models';
import { parseRiotId } from '../providers/riotId';
import { staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import type { RiotProvider } from '../providers/riot';
import type { HistoryStore } from '../storage/history';
import type { Repository } from '../storage/repository';
import { endSessionRecord } from './planSession';
import {
  decideReconciliation,
  derivePostGameReview,
  POST_GAME_RECONCILIATION,
  reconcileCandidateCheck,
  reconstructSessionChains,
  postGameReviewIsCurrent,
  type SessionChain,
} from '../strategy/postGame';
import { buildPersonalProfile } from '../strategy/personalLearning';

const RECENT_INDEX_TTL_MS = 5 * 60 * 1_000;

export interface PostGameHistoryState {
  chains: SessionChain[];
  reconciliations: MatchReconciliation[];
  reviews: PostGameReview[];
  personal: PersonalProfile;
}

export async function loadPostGameHistory(
  repository: Repository,
  set: number,
  patch: string,
  now = new Date().toISOString(),
): Promise<PostGameHistoryState> {
  const [sessions, reconciliations, reviews, storedPersonal] = await Promise.all([
    repository.listPlanSessions(),
    repository.listReconciliations(),
    repository.listPostGameReviews(),
    repository.getPersonalProfile(set),
  ]);
  const chains = reconstructSessionChains(sessions);
  const staticFingerprints = new Map(
    chains.map((chain) => [
      chain.id,
      staticSetCompatibilityFingerprint(chain.terminal.snapshot.staticData),
    ]),
  );
  const currentReviews = reviews.filter((review) => {
    const chain = chains.find((entry) => entry.id === review.chainId);
    return chain ? postGameReviewIsCurrent(review, chain, staticFingerprints.get(chain.id)) : false;
  });
  const expectedReviewIds = currentReviews
    .filter(
      (review) =>
        review.set === set &&
        review.attribution.eligible &&
        review.baseline.placementResidual !== null,
    )
    .map((review) => review.id);
  const storedIds = storedPersonal?.sourceReviewIds ?? [];
  const personal =
    storedPersonal?.modelVersion === 'personal-residual-v1' &&
    storedPersonal.set === set &&
    storedPersonal.patch === patch &&
    JSON.stringify(storedIds) === JSON.stringify(expectedReviewIds)
      ? storedPersonal
      : buildPersonalProfile(currentReviews, set, patch, now);
  if (personal !== storedPersonal) await repository.putPersonalProfile(personal);
  return { chains, reconciliations, reviews, personal };
}

async function resolveChainIdentity(
  chain: SessionChain,
  provider: RiotProvider,
  history: HistoryStore,
  now: string,
): Promise<RiotIdentity> {
  const context = chain.terminal.accountContext ?? chain.sessions[0].accountContext;
  if (!context) throw new Error('No Riot account is attached to this session chain.');
  const parsed = parseRiotId(context.riotId);
  const cached = await history.getIdentity(parsed.gameName, parsed.tagLine, context.platform);
  if (cached) return cached;
  const identity = await provider.resolveAccount(parsed.gameName, parsed.tagLine, {
    deadlineAt: Date.now() + 8_000,
  });
  await history.putIdentity(identity, now);
  return identity;
}

async function recentCompletedMatches(
  identity: RiotIdentity,
  provider: RiotProvider,
  history: HistoryStore,
  now: string,
): Promise<CompletedMatch[]> {
  const cachedIndex = await history.getRecentIndex(identity.puuid, identity.routing);
  const freshIndex =
    cachedIndex &&
    Date.parse(now) - Date.parse(cachedIndex.fetchedAt) >= 0 &&
    Date.parse(now) - Date.parse(cachedIndex.fetchedAt) < RECENT_INDEX_TTL_MS;
  const ids = freshIndex
    ? cachedIndex.ids.slice(0, POST_GAME_RECONCILIATION.recentMatchHorizon)
    : await provider.recentMatchIds(
        identity.puuid,
        0,
        POST_GAME_RECONCILIATION.recentMatchHorizon,
        { deadlineAt: Date.now() + 8_000 },
      );
  if (!freshIndex)
    await history.putRecentIndex({
      puuid: identity.puuid,
      routing: identity.routing,
      targetCount: POST_GAME_RECONCILIATION.recentMatchHorizon,
      requestedCount: POST_GAME_RECONCILIATION.recentMatchHorizon,
      ids,
      exhausted: ids.length < POST_GAME_RECONCILIATION.recentMatchHorizon,
      fetchedAt: now,
    });
  return Promise.all(
    ids.map(async (id) => {
      const cached = await history.getCompletedMatch(id);
      if (cached) return cached;
      const match = await provider.completedMatch(id, { deadlineAt: Date.now() + 8_000 });
      await history.putCompletedMatch(match, now);
      return match;
    }),
  );
}

function reviewFamilies(chain: SessionChain, currentFamilies: PostGameReviewFamily[]) {
  const frozen = chain.sessions.flatMap((session) =>
    session.snapshot.portfolio.plans.map((plan) => plan.candidate.playbook),
  );
  return [
    ...new Map([...currentFamilies, ...frozen].map((family) => [family.id, family])).values(),
  ];
}
type PostGameReviewFamily = PlanSession['snapshot']['playbook'];

async function persistMatchedOutcome(
  repository: Repository,
  chain: SessionChain,
  reconciliation: MatchReconciliation,
  match: CompletedMatch,
  currentFamilies: PostGameReviewFamily[],
  activeSet: number,
  activePatch: string,
  now: string,
) {
  let terminal = chain.terminal;
  if (terminal.reconciliation.matchId !== match.id || terminal.state === 'active') {
    terminal = {
      ...(terminal.state === 'active'
        ? endSessionRecord(terminal, 'completed', now)
        : structuredClone(terminal)),
      reconciliation: { matchId: match.id },
    };
    await repository.updatePlanSession(terminal);
    chain.terminal = terminal;
    chain.sessions = chain.sessions.map((session) =>
      session.id === terminal.id ? terminal : session,
    );
  }
  const review = derivePostGameReview(
    chain,
    reconciliation,
    match,
    reviewFamilies(chain, currentFamilies),
    now,
  );
  await repository.putPostGameReview(review);
  const reviews = await repository.listPostGameReviews();
  const personal = buildPersonalProfile(reviews, activeSet, activePatch, now);
  await repository.putPersonalProfile(personal);
  return { review, personal };
}

export async function checkCompletedMatch(
  chainId: string,
  repository: Repository,
  provider: RiotProvider,
  history: HistoryStore,
  currentFamilies: PostGameReviewFamily[],
  activeSet: number,
  activePatch: string,
  now = new Date().toISOString(),
) {
  const sessions = await repository.listPlanSessions();
  const chain = reconstructSessionChains(sessions).find((entry) => entry.id === chainId);
  if (!chain) throw new Error('Session chain is no longer available.');
  const existing = (await repository.listReconciliations()).find(
    (entry) => entry.chainId === chainId,
  );
  if (existing?.state === 'matched' && existing.matchId) {
    const cached = await history.getCompletedMatch(existing.matchId);
    if (!cached)
      throw new Error('The linked immutable match is not available locally for review rebuild.');
    const derived = await persistMatchedOutcome(
      repository,
      chain,
      existing,
      cached,
      currentFamilies,
      activeSet,
      activePatch,
      now,
    );
    return { reconciliation: existing, ...derived };
  }
  const identity = await resolveChainIdentity(chain, provider, history, now);
  const usedMatchIds = new Set(
    (await repository.listReconciliations())
      .filter((entry) => entry.chainId !== chainId && entry.state === 'matched' && entry.matchId)
      .map((entry) => entry.matchId!),
  );
  const matches = (await recentCompletedMatches(identity, provider, history, now)).filter(
    (match) => !usedMatchIds.has(match.id),
  );
  const reconciliation = reconcileCandidateCheck(
    chain,
    matches,
    identity.puuid,
    identity.platform,
    now,
    existing,
  );
  await repository.putReconciliation(reconciliation);
  if (reconciliation.state !== 'matched') return { reconciliation, review: null, personal: null };
  const match = matches.find((entry) => entry.id === reconciliation.matchId)!;
  const derived = await persistMatchedOutcome(
    repository,
    chain,
    reconciliation,
    match,
    currentFamilies,
    activeSet,
    activePatch,
    now,
  );
  return { reconciliation, ...derived };
}

export async function confirmCompletedMatch(
  chainId: string,
  matchId: string,
  repository: Repository,
  history: HistoryStore,
  currentFamilies: PostGameReviewFamily[],
  activeSet: number,
  activePatch: string,
  now = new Date().toISOString(),
) {
  const chain = reconstructSessionChains(await repository.listPlanSessions()).find(
    (entry) => entry.id === chainId,
  );
  const current = (await repository.listReconciliations()).find(
    (entry) => entry.chainId === chainId,
  );
  if (!chain || !current) throw new Error('Reconciliation candidate state is unavailable.');
  const reconciliation = decideReconciliation(current, 'confirm', matchId, now);
  await repository.putReconciliation(reconciliation);
  const match = await history.getCompletedMatch(matchId);
  if (!match) throw new Error('The immutable completed-match cache entry is unavailable.');
  const derived = await persistMatchedOutcome(
    repository,
    chain,
    reconciliation,
    match,
    currentFamilies,
    activeSet,
    activePatch,
    now,
  );
  return { reconciliation, ...derived };
}

export async function rejectOrUnlinkCompletedMatch(
  chainId: string,
  action: 'reject' | 'unlink',
  repository: Repository,
  activeSet: number,
  activePatch: string,
  now = new Date().toISOString(),
) {
  const current = (await repository.listReconciliations()).find(
    (entry) => entry.chainId === chainId,
  );
  if (!current) throw new Error('Reconciliation state is unavailable.');
  const reconciliation = decideReconciliation(current, action, current.matchId, now);
  await repository.putReconciliation(reconciliation);
  if (action === 'unlink') {
    await repository.deletePostGameReview(chainId);
    const terminal = (await repository.listPlanSessions()).find(
      (session) => session.id === reconciliation.terminalSessionId,
    );
    if (terminal?.reconciliation.matchId) {
      await repository.updatePlanSession({ ...terminal, reconciliation: { matchId: null } });
    }
  }
  const personal = buildPersonalProfile(
    await repository.listPostGameReviews(),
    activeSet,
    activePatch,
    now,
  );
  await repository.putPersonalProfile(personal);
  return { reconciliation, personal };
}
