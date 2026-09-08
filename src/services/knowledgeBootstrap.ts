import type { SqlDatabase } from '../storage/knowledgeDatabase';
import { MemoryKnowledgeRepository, type SourceSnapshot } from '../storage/knowledgeRepository';
import type { Playbook, StaticData } from '../domain/models';
import type { ExternalSnapshot } from '../domain/externalMeta';
import {
  importCommunityDragonKnowledge,
  importCuratedPlaybooks,
  importMetaTFTExternal,
} from '../storage/knowledgeImporter';
import { externalStatus } from '../providers/externalMeta';
import { stableFingerprint, familyDefinitionsFingerprint } from '../domain/fingerprint';

export interface BootstrapResult {
  bootstrapped: boolean;
  staticSnapshotId: string;
  curatedSnapshotId: string;
  externalSnapshotId?: string;
  notice?: string;
}

/**
 * Automatically and idempotently bootstraps an SQLite database containing migration v5
 * when active knowledge snapshots are missing.
 * Reuses M13A importers.
 */
export async function bootstrapKnowledgeDatabase(
  db: SqlDatabase,
  data: StaticData,
  playbooks: Playbook[],
  external?: ExternalSnapshot | null,
): Promise<BootstrapResult> {
  const activeRows = await db.select<{ kind: string; snapshot_id: string }>(
    "SELECT kind, snapshot_id FROM active_knowledge_snapshots WHERE kind IN ('static', 'curated')",
  );

  const staticActive = activeRows.find((r) => r.kind === 'static');
  const curatedActive = activeRows.find((r) => r.kind === 'curated');

  if (staticActive && curatedActive) {
    const extActive = (
      await db.select<{ snapshot_id: string }>(
        "SELECT snapshot_id FROM active_knowledge_snapshots WHERE kind = 'external-meta'",
      )
    )[0];

    return {
      bootstrapped: false,
      staticSnapshotId: staticActive.snapshot_id,
      curatedSnapshotId: curatedActive.snapshot_id,
      externalSnapshotId: extActive?.snapshot_id,
    };
  }

  // Import static knowledge first
  const staticResult = await importCommunityDragonKnowledge(db, data, { activate: true });

  // Import curated playbooks
  const curatedResult = await importCuratedPlaybooks(db, playbooks, staticResult.snapshotId, {
    activate: true,
  });

  let externalSnapshotId: string | undefined;
  if (external && externalStatus(external, data).startsWith('Compatible')) {
    try {
      const extResult = await importMetaTFTExternal(db, external, data, { activate: true });
      externalSnapshotId = extResult.snapshotId;
    } catch {
      /* fail-closed on external import failure; static & curated remain active */
    }
  }

  return {
    bootstrapped: true,
    staticSnapshotId: staticResult.snapshotId,
    curatedSnapshotId: curatedResult.snapshotId,
    externalSnapshotId,
    notice: 'Versioned knowledge database initialized from bundled source snapshot.',
  };
}

/**
 * Populates a MemoryKnowledgeRepository for browser / test environments.
 */
export function populateMemoryKnowledgeRepository(
  repo: MemoryKnowledgeRepository,
  data: StaticData,
  playbooks: Playbook[],
  external?: ExternalSnapshot | null,
): { staticSnapshotId: string; curatedSnapshotId: string; externalSnapshotId?: string } {
  const now = new Date().toISOString();
  const staticContentHash =
    data.knowledge?.fingerprint ??
    stableFingerprint({
      set: data.version.set,
      patch: data.version.provenance.patch,
      sourceVersion: data.version.sourceVersion,
      champions: data.champions.map((c) => c.id),
      traits: data.traits.map((t) => t.id),
      items: data.items.map((i) => i.id),
      augments: data.augments.map((a) => a.id),
    });

  const staticSnapshotId = `cd:${staticContentHash}`;

  const staticSnapshot: SourceSnapshot = {
    snapshotId: staticSnapshotId,
    sourceId: 'community-dragon',
    sourceType: 'static-cdn',
    setNumber: data.version.set,
    balancePatch: data.version.provenance.patch ?? null,
    hotfix: data.knowledge?.balanceHotfix ?? null,
    retrievedAt: data.version.provenance.fetchedAt,
    publishedAt: data.version.provenance.publishedAt ?? null,
    sourceVersion: data.version.sourceVersion,
    schemaVersion: data.version.schemaVersion,
    contentHash: staticContentHash,
    provenanceStatus: data.version.provenance.status,
    parityStatus: data.version.parityStatus,
    sourceUri: data.version.provenance.source,
    notes: data.version.provenance.note,
    rawReference: null,
    createdAt: now,
  };

  repo.setSourceSnapshot(staticSnapshot);

  for (const c of data.champions) {
    repo.setChampion({
      id: c.id,
      name: c.name,
      snapshotId: staticSnapshotId,
      cost: c.cost,
      role: c.role ?? null,
      shopStatus: c.shopStatus,
      boardEligible: c.boardEligible,
      icon: c.icon,
      splash: c.splash,
      traitIds: c.traitIds,
      contentFingerprint: data.knowledge?.entityFingerprints[c.id] ?? stableFingerprint(c),
      mechanics: data.knowledge?.entities[c.id] ?? null,
    });
  }

  for (const t of data.traits) {
    repo.setTrait({
      id: t.id,
      name: t.name,
      snapshotId: staticSnapshotId,
      icon: t.icon,
      counting: t.counting,
      availability: t.availability,
      breakpoints: t.breakpoints.map((minUnits) => ({
        minUnits,
        maxUnits: null,
        effects: null,
      })),
      contentFingerprint: data.knowledge?.entityFingerprints[t.id] ?? stableFingerprint(t),
      mechanics: data.knowledge?.entities[t.id] ?? null,
    });
  }

  for (const i of data.items) {
    repo.setItem({
      id: i.id,
      name: i.name,
      snapshotId: staticSnapshotId,
      category: i.category,
      icon: i.icon,
      components: i.components,
      availability: i.availability,
      contentFingerprint: data.knowledge?.entityFingerprints[i.id] ?? stableFingerprint(i),
      mechanics: data.knowledge?.entities[i.id] ?? null,
    });
  }

  for (const a of data.augments) {
    repo.setAugment({
      id: a.id,
      name: a.name,
      snapshotId: staticSnapshotId,
      tier: a.tier ?? null,
      category: a.category ?? null,
      availability: a.availability,
      presentInExport: a.presentInExport,
      liveStatus: a.liveStatus,
      requiredTraits: a.requiredTraits,
      contentFingerprint: data.knowledge?.entityFingerprints[a.id] ?? stableFingerprint(a),
      mechanics: data.knowledge?.entities[a.id] ?? null,
    });
  }

  repo.setActiveKnowledgeVersion({
    kind: 'static',
    snapshotId: staticSnapshotId,
    setNumber: data.version.set,
    balancePatch: data.version.provenance.patch ?? null,
    hotfix: data.knowledge?.balanceHotfix ?? null,
    sourceVersion: data.version.sourceVersion,
    contentHash: staticContentHash,
    activatedAt: now,
  });

  // Curated playbooks
  const curatedContentHash = familyDefinitionsFingerprint(playbooks);
  const curatedSnapshotId = `playbooks:${curatedContentHash}`;

  const curatedSnapshot: SourceSnapshot = {
    snapshotId: curatedSnapshotId,
    sourceId: 'curated-playbooks',
    sourceType: 'curated-file',
    setNumber: playbooks[0]?.set ?? data.version.set,
    balancePatch: playbooks[0]?.patch ?? data.version.patch,
    hotfix: null,
    retrievedAt: playbooks[0]?.provenance.fetchedAt ?? now,
    publishedAt: null,
    sourceVersion: `${playbooks[0]?.set ?? data.version.set}.${playbooks[0]?.patch ?? data.version.patch}`,
    schemaVersion: 1,
    contentHash: curatedContentHash,
    provenanceStatus: 'curated',
    parityStatus: 'unverified',
    sourceUri: 'data/playbooks/set18.json',
    notes: 'Human-curated strategy playbooks',
    rawReference: 'data/playbooks/set18.json',
    createdAt: now,
  };

  repo.setSourceSnapshot(curatedSnapshot);

  for (const p of playbooks) {
    const finalUnits = p.target.units.map((u) => {
      const r = p.roles.find((item) => item.championId === u.championId)?.role;
      return {
        compId: p.id,
        snapshotId: curatedSnapshotId,
        championId: u.championId,
        slot: (u.slot ?? (p.family.core.includes(u.championId) ? 'core' : 'flex')) as
          | 'core'
          | 'flex'
          | 'temporary',
        role: r === 'carry' || r === 'tank' ? r : null,
        stage: 'final' as const,
      };
    });

    const itemPackages = p.items.flatMap((pkg) =>
      pkg.priorities.map((itemId, idx) => ({
        compId: p.id,
        snapshotId: curatedSnapshotId,
        holderId: pkg.holder,
        itemId,
        priorityOrder: idx,
      })),
    );

    repo.setComp({
      id: p.id,
      name: p.title,
      sourceKind: 'curated',
      snapshotId: curatedSnapshotId,
      title: p.title,
      subtitle: p.subtitle,
      heroId: p.hero,
      style: p.features.style ?? null,
      evidenceLabel: p.evidence,
      targetLevel: p.target.targetLevel,
      levelPlan: p.levelPlan.value ?? null,
      playSignals: p.playSignals.value ?? null,
      avoidSignals: p.avoidSignals.value ?? null,
      contentFingerprint: stableFingerprint(p),
      units: finalUnits,
      itemPackages,
      payload: {
        stages: p.stages,
        decisionMap: p.decisionMap,
        augments: p.augments,
        components: p.components,
        features: p.features,
        strategy: p.strategy,
        replacements: p.replacements,
        variants: p.variants,
        family: p.family,
        provenance: p.provenance,
        roles: p.roles,
        planner: p.planner,
        sampleSize: p.sampleSize,
      },
    });
  }

  repo.setActiveKnowledgeVersion({
    kind: 'curated',
    snapshotId: curatedSnapshotId,
    setNumber: playbooks[0]?.set ?? data.version.set,
    balancePatch: playbooks[0]?.patch ?? data.version.patch,
    hotfix: null,
    sourceVersion: `${playbooks[0]?.set ?? data.version.set}.${playbooks[0]?.patch ?? data.version.patch}`,
    contentHash: curatedContentHash,
    activatedAt: now,
  });

  // External meta if compatible
  let externalSnapshotId: string | undefined;
  if (external && externalStatus(external, data).startsWith('Compatible')) {
    const extContentHash = external.manifest.contentHash;
    externalSnapshotId = `metatft:${extContentHash}`;

    const extSnapshot: SourceSnapshot = {
      snapshotId: externalSnapshotId,
      sourceId: 'metatft',
      sourceType: 'external-scrape',
      setNumber: external.manifest.scope.set,
      balancePatch: external.manifest.scope.patch,
      hotfix: external.manifest.scope.hotfix,
      retrievedAt: external.manifest.retrievedAt,
      publishedAt: external.manifest.providerUpdated ?? null,
      sourceVersion: external.manifest.collectorVersion,
      schemaVersion: external.manifest.schemaVersion,
      contentHash: extContentHash,
      provenanceStatus: 'measured',
      parityStatus: 'unverified',
      sourceUri: external.manifest.sourceUrls[0] ?? 'https://www.metatft.com/comps',
      notes: external.manifest.warnings.join('; '),
      rawReference: null,
      createdAt: now,
    };

    repo.setSourceSnapshot(extSnapshot);

    for (const comp of external.comps) {
      const compId = `external-meta:${comp.id}`;
      repo.setComp({
        id: compId,
        name: comp.name,
        sourceKind: 'external-meta',
        snapshotId: externalSnapshotId,
        title: comp.name,
        subtitle: comp.tier ? `Tier ${comp.tier}` : null,
        heroId: null,
        style: comp.style,
        evidenceLabel: 'Emerging',
        targetLevel: comp.units.length,
        levelPlan: null,
        playSignals: null,
        avoidSignals: null,
        contentFingerprint: stableFingerprint(comp),
        units: comp.units.map((u) => ({
          compId,
          snapshotId: externalSnapshotId!,
          championId: u,
          slot: comp.core.includes(u) ? ('core' as const) : ('flex' as const),
          role: null,
          stage: 'final' as const,
        })),
        itemPackages: comp.packages.flatMap((pkg) =>
          pkg.items.map((itemId, idx) => ({
            compId,
            snapshotId: externalSnapshotId!,
            holderId: pkg.holder,
            itemId,
            priorityOrder: idx,
          })),
        ),
        payload: {
          tier: comp.tier,
          conditions: comp.conditions,
          packages: comp.packages,
          positions: comp.positions,
        },
      });

      repo.addMetaObservation({
        observationId: `obs:${externalSnapshotId}:${comp.id}`,
        snapshotId: externalSnapshotId,
        compId,
        providerCompId: comp.id,
        sampleSize: comp.stats.sample,
        averagePlacement: comp.stats.average,
        top4Rate: comp.stats.top4,
        winRate: comp.stats.win,
        pickRate: comp.pickRate ? comp.pickRate.value / 100 : comp.stats.playRate,
        rawStats: comp.stats as Record<string, unknown>,
        positions: comp.positions,
        itemPackages: comp.packages,
        observedAt: external.manifest.retrievedAt,
      });
    }

    repo.setMetaSnapshot({
      snapshotId: externalSnapshotId,
      provider: external.manifest.provider ?? 'MetaTFT',
      setNumber: external.manifest.scope.set,
      patch: external.manifest.scope.patch,
      hotfix: external.manifest.scope.hotfix,
      rankBracket: external.manifest.scope.rank,
      region: external.manifest.scope.region,
      window: external.manifest.scope.window,
      queue: external.manifest.scope.queue,
      sampleSize: external.manifest.population,
      retrievedAt: external.manifest.retrievedAt,
      contentHash: extContentHash,
    });

    repo.setActiveKnowledgeVersion({
      kind: 'external-meta',
      snapshotId: externalSnapshotId,
      setNumber: external.manifest.scope.set,
      balancePatch: external.manifest.scope.patch,
      hotfix: external.manifest.scope.hotfix,
      sourceVersion: external.manifest.collectorVersion,
      contentHash: extContentHash,
      activatedAt: now,
    });
  }

  return { staticSnapshotId, curatedSnapshotId, externalSnapshotId };
}
