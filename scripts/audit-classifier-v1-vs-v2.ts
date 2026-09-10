import { data, playbooks } from '../src/test/fixtures';
import { createRiotPreviewProvider } from '../src/providers/riotPreview';
import { classifyPersonalBoard } from '../src/strategy/personalClassifier';
import type { MatchParticipant } from '../src/domain/models';
import type { RuntimeKnowledgeCatalog } from '../src/services/knowledgeCatalog';

function createCatalog(): RuntimeKnowledgeCatalog {
  return {
    version: { set: data.version.set, patch: data.version.patch, hotfix: null, sourceVersion: data.version.sourceVersion },
    snapshots: { static: null, curated: null, external: null },
    sourceSnapshots: { static: null, curated: null, external: null },
    provenance: { static: data.version.provenance, curated: data.version.provenance, external: null },
    champions: [], traits: [], items: [], augments: [], comps: [],
    playbooks: structuredClone(playbooks),
    metaObservations: [], externalSnapshot: null,
  };
}

// V1 implementation for comparison
function classifyV1(participant: MatchParticipant, set: number, catalog: RuntimeKnowledgeCatalog, staticData: typeof data) {
  if (set !== staticData.version.set) return { state: 'incompatible-set', compId: null, confidence: 0 };
  const boardUnitIds = new Set(participant.units.map(u => u.championId));
  const candidatePool = catalog.playbooks.filter(p => p.set === set);
  if (!candidatePool.length) return { state: 'unclassified', compId: null, confidence: 0 };

  const scored = candidatePool.map(playbook => {
    const coreUnits = new Set(playbook.family.core);
    const targetUnits = new Set(playbook.target.units.map(u => u.championId));
    const carryAnchors = playbook.roles.filter(r => r.role === 'carry').map(r => r.championId);
    const tankAnchors = playbook.roles.filter(r => r.role === 'tank').map(r => r.championId);

    const coreOverlap = [...coreUnits].filter(id => boardUnitIds.has(id)).length;
    const coreRecall = coreUnits.size > 0 ? coreOverlap / coreUnits.size : 0;
    const targetOverlap = [...targetUnits].filter(id => boardUnitIds.has(id)).length;
    const unionSize = new Set([...boardUnitIds, ...targetUnits]).size;
    const targetJaccard = unionSize > 0 ? targetOverlap / unionSize : 0;
    const carryOverlap = carryAnchors.filter(id => boardUnitIds.has(id)).length;
    const carryRecall = carryAnchors.length > 0 ? carryOverlap / carryAnchors.length : 1;
    const tankOverlap = tankAnchors.filter(id => boardUnitIds.has(id)).length;
    const tankRecall = tankAnchors.length > 0 ? tankOverlap / tankAnchors.length : 1;
    const anchorRecall = (carryRecall + tankRecall) / 2;
    const sizeFit = 1 - Math.abs(boardUnitIds.size - targetUnits.size) / Math.max(boardUnitIds.size, targetUnits.size, 1);

    let score = 0.45 * coreRecall + 0.30 * targetJaccard + 0.20 * anchorRecall + 0.05 * sizeFit;
    if (carryAnchors.length > 0 && carryOverlap === 0) score *= 0.60;
    if (coreRecall < 0.40) score *= Math.pow(coreRecall / 0.40, 2);

    const clearsGates = score >= 0.58 && coreRecall >= 0.45 && (carryAnchors.length === 0 || carryOverlap > 0);
    return { compId: playbook.id, score, clearsGates };
  }).sort((a, b) => b.score - a.score || a.compId.localeCompare(b.compId));

  const top = scored[0];
  const runnerUp = scored[1];
  if (!top || !top.clearsGates) return { state: 'unclassified', compId: null, confidence: top ? top.score : 0 };
  const margin = runnerUp && runnerUp.clearsGates ? top.score - runnerUp.score : 1.0;
  if (runnerUp && runnerUp.clearsGates && margin < 0.08) return { state: 'ambiguous', compId: null, confidence: top.score };
  return { state: 'classified', compId: top.compId, confidence: top.score };
}

async function runAudit() {
  const catalog = createCatalog();
  const provider = createRiotPreviewProvider(data);

  // Collect all matches from preview provider
  const ownMatches = await Promise.all([
    provider.completedMatch('EUW1_FIXTURE_SELF_1'),
    provider.completedMatch('EUW1_FIXTURE_SELF_2'),
    provider.completedMatch('EUW1_FIXTURE_SELF_3'),
    provider.completedMatch('EUW1_FIXTURE_SELF_4'),
    provider.completedMatch('EUW1_FIXTURE_SELF_5'),
    provider.completedMatch('EUW1_FIXTURE_SELF_6'),
    provider.completedMatch('EUW1_FIXTURE_SELF_7'),
    provider.completedMatch('EUW1_FIXTURE_SELF_8'),
    provider.completedMatch('EUW1_FIXTURE_SELF_9'),
    provider.completedMatch('EUW1_FIXTURE_SELF_10'),
    provider.completedMatch('EUW1_FIXTURE_SELF_11'),
    provider.completedMatch('EUW1_FIXTURE_SELF_12'),
  ]);

  const allParticipants: { desc: string; p: MatchParticipant; set: number }[] = [];
  for (let i = 0; i < ownMatches.length; i++) {
    const m = ownMatches[i];
    allParticipants.push({ desc: 'Own Match ' + (i + 1), p: m.participants[0], set: m.set });
  }

  // Collect opponent matches
  for (let mIdx = 1; mIdx <= 20; mIdx++) {
    const oppMatch = await provider.completedMatch(`EUW1_FIXTURE_${mIdx}`);
    for (const p of oppMatch.participants) {
      allParticipants.push({ desc: `Opponent Match ${mIdx} - ${p.puuid}`, p, set: oppMatch.set });
    }
  }

  // Add 10 synthetic real-world edge boards:
  const p0 = playbooks[0];
  // 1. Exact comp
  allParticipants.push({
    desc: 'Synthetic 1: Exact comp (8/8)',
    set: 18,
    p: { puuid: 's1', placement: 1, level: p0.target.targetLevel, traits: [], augmentIds: [], unresolvedAugmentIds: [], units: p0.target.units.map(u => ({ championId: u.championId, stars: 2, items: [], rarity: null, rawName: null, unresolvedUnit: false, unresolvedItems: [] })) },
  });

  // 2. Comp missing 1 flex unit (7/8)
  allParticipants.push({
    desc: 'Synthetic 2: Missing 1 flex unit (7/8)',
    set: 18,
    p: { puuid: 's2', placement: 2, level: 7, traits: [], augmentIds: [], unresolvedAugmentIds: [], units: p0.target.units.slice(0, 7).map(u => ({ championId: u.championId, stars: 2, items: [], rarity: null, rawName: null, unresolvedUnit: false, unresolvedItems: [] })) },
  });

  // 3. Comp missing 2 units (6/8) but core & carry/tank intact
  const coreAndAnchors = [...new Set([...p0.family.core, ...p0.roles.map(r => r.championId)])];
  const fillers = p0.target.units.map(u => u.championId).filter(id => !coreAndAnchors.includes(id));
  allParticipants.push({
    desc: 'Synthetic 3: Missing 2 units but core/carry/tank intact (5/7)',
    set: 18,
    p: { puuid: 's3', placement: 4, level: 5, traits: [], augmentIds: [], unresolvedAugmentIds: [], units: [...coreAndAnchors, fillers[0]].map(id => ({ championId: id, stars: 2, items: [], rarity: null, rawName: null, unresolvedUnit: false, unresolvedItems: [] })) },
  });

  // 4. Comp with splash legendary
  const splashId = data.champions.find(c => c.cost >= 4 && !p0.target.units.some(u => u.championId === c.id))!.id;
  allParticipants.push({
    desc: 'Synthetic 4: Core + 1 splash legendary',
    set: 18,
    p: { puuid: 's4', placement: 2, level: 8, traits: [], augmentIds: [], unresolvedAugmentIds: [], units: [...p0.target.units.slice(0, 6).map(u => u.championId), splashId].map(id => ({ championId: id, stars: 2, items: [], rarity: null, rawName: null, unresolvedUnit: false, unresolvedItems: [] })) },
  });

  // 5. Generic frontline overlap only (tanks only, no carry)
  const tankOnly = p0.roles.filter(r => r.role === 'tank').map(r => r.championId);
  const randomUnits = data.champions.filter(c => !p0.target.units.some(u => u.championId === c.id)).slice(0, 6).map(c => c.id);
  allParticipants.push({
    desc: 'Synthetic 5: Generic frontline overlap (tanks only, 0 carry)',
    set: 18,
    p: { puuid: 's5', placement: 6, level: 7, traits: [], augmentIds: [], unresolvedAugmentIds: [], units: [...tankOnly, ...randomUnits].map(id => ({ championId: id, stars: 2, items: [], rarity: null, rawName: null, unresolvedUnit: false, unresolvedItems: [] })) },
  });

  // Run audit and timing
  let v1Classified = 0, v1Ambiguous = 0, v1Unclassified = 0, v1Incompat = 0;
  let v2Classified = 0, v2Ambiguous = 0, v2Unclassified = 0, v2Incompat = 0;

  const v1Start = performance.now();
  for (const item of allParticipants) {
    const r1 = classifyV1(item.p, item.set, catalog, data);
    if (r1.state === 'classified') v1Classified++;
    else if (r1.state === 'ambiguous') v1Ambiguous++;
    else if (r1.state === 'incompatible-set') v1Incompat++;
    else v1Unclassified++;
  }
  const v1Elapsed = performance.now() - v1Start;

  const v2Start = performance.now();
  for (const item of allParticipants) {
    const r2 = classifyPersonalBoard(item.p, item.set, catalog, data);
    if (r2.state === 'classified') v2Classified++;
    else if (r2.state === 'ambiguous') v2Ambiguous++;
    else if (r2.state === 'incompatible-set') v2Incompat++;
    else v2Unclassified++;
  }
  const v2End = performance.now();
  const v2TimePerBoard = (v2End - v2Start) / allParticipants.length;

  console.log('=== AUDIT RESULTS (V1 vs V2) ===');
  console.log('Total boards tested: ' + allParticipants.length);
  console.log('V1: Classified=' + v1Classified + ', Ambiguous=' + v1Ambiguous + ', Unclassified=' + v1Unclassified + ', Incompatible=' + v1Incompat);
  console.log('V2: Classified=' + v2Classified + ', Ambiguous=' + v2Ambiguous + ', Unclassified=' + v2Unclassified + ', Incompatible=' + v2Incompat);
  console.log('V1 Average time per board: ' + (v1Elapsed / allParticipants.length).toFixed(4) + ' ms');
  console.log('V2 Average time per board: ' + v2TimePerBoard.toFixed(4) + ' ms (Goal: << 5ms)');

  // Check false positives
  const genericFrontlineV2 = classifyPersonalBoard(allParticipants.find(p => p.desc.includes('Generic frontline'))!.p, 18, catalog, data);
  console.log('Generic frontline test result: ' + genericFrontlineV2.state + ' (Expected: unclassified)');

  // Check missing 2 units result
  const missing2UnitsV2 = classifyPersonalBoard(allParticipants.find(p => p.desc.includes('Missing 2 units'))!.p, 18, catalog, data);
  console.log('Missing 2 units test result: ' + missing2UnitsV2.state + ', Comp: ' + missing2UnitsV2.compId + ', Affinity: ' + missing2UnitsV2.confidence);
}

runAudit();
