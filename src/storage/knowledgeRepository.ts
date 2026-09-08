import type { SqlDatabase } from './knowledgeDatabase';
import type { EntityMechanics } from '../domain/intelligence';
import type { EvidenceLabel, Verification } from '../domain/models';

export interface ActiveKnowledgeVersion {
  kind: 'static' | 'curated' | 'external-meta';
  snapshotId: string;
  setNumber: number;
  balancePatch: string | null;
  hotfix: string | null;
  sourceVersion: string;
  contentHash: string;
  activatedAt: string;
}

export interface ChampionKnowledge {
  id: string;
  name: string;
  snapshotId: string;
  cost: number;
  role: string | null;
  shopStatus: 'pool' | 'runtime-variant' | 'placeholder';
  boardEligible: boolean;
  icon: string | null;
  splash: string | null;
  traitIds: string[];
  contentFingerprint: string;
  mechanics: EntityMechanics | null;
}

export interface TraitBreakpointKnowledge {
  minUnits: number;
  maxUnits: number | null;
  effects: Record<string, unknown> | null;
}

export interface TraitKnowledge {
  id: string;
  name: string;
  snapshotId: string;
  icon: string | null;
  counting: 'unverified' | 'unique-unit';
  availability: 'verified' | 'unavailable';
  breakpoints: TraitBreakpointKnowledge[];
  contentFingerprint: string;
  mechanics: EntityMechanics | null;
}

export interface ItemKnowledge {
  id: string;
  name: string;
  snapshotId: string;
  category: 'component' | 'combined' | 'other';
  icon: string | null;
  components: string[];
  availability: Verification;
  contentFingerprint: string;
  mechanics: EntityMechanics | null;
}

export interface AugmentKnowledge {
  id: string;
  name: string;
  snapshotId: string;
  tier: string | null;
  category: string | null;
  availability: Verification;
  presentInExport: boolean;
  liveStatus: 'enabled' | 'disabled' | 'unverified';
  requiredTraits: string[];
  contentFingerprint: string;
  mechanics: EntityMechanics | null;
}

export interface CompUnitKnowledge {
  compId: string;
  snapshotId: string;
  championId: string;
  slot: 'core' | 'flex' | 'temporary';
  role: 'carry' | 'tank' | null;
  stage: 'early' | 'mid' | 'stabilization' | 'final';
}

export interface CompItemPackageKnowledge {
  compId: string;
  snapshotId: string;
  holderId: string;
  itemId: string;
  priorityOrder: number;
}

export interface CompKnowledge {
  id: string;
  name: string;
  sourceKind: 'curated' | 'external-meta' | 'discovered';
  snapshotId: string;
  title: string;
  subtitle: string | null;
  heroId: string | null;
  style: string | null;
  evidenceLabel: EvidenceLabel;
  targetLevel: number | null;
  levelPlan: string | null;
  playSignals: string[] | null;
  avoidSignals: string[] | null;
  contentFingerprint: string;
  units: CompUnitKnowledge[];
  itemPackages: CompItemPackageKnowledge[];
  payload: Record<string, unknown> | null;
}

export interface CompMetaObservation {
  observationId: string;
  snapshotId: string;
  compId: string;
  providerCompId: string;
  sampleSize: number | null;
  averagePlacement: number | null;
  top4Rate: number | null;
  winRate: number | null;
  pickRate: number | null;
  rawStats: Record<string, unknown>;
  positions: Array<{ championId: string; row: number; column: number }>;
  itemPackages: Array<{ holder: string; items: string[]; source: string }>;
  observedAt: string;
}

export interface SourceSnapshot {
  snapshotId: string;
  sourceId: string;
  sourceType: string;
  setNumber: number;
  balancePatch: string | null;
  hotfix: string | null;
  retrievedAt: string;
  publishedAt: string | null;
  sourceVersion: string;
  schemaVersion: number;
  contentHash: string;
  provenanceStatus: string;
  parityStatus: string;
  sourceUri: string | null;
  notes: string | null;
  rawReference: string | null;
  createdAt: string;
}

export interface KnowledgeDiff {
  previousSnapshotId: string;
  nextSnapshotId: string;
  setChanged: boolean;
  championsAdded: string[];
  championsRemoved: string[];
  championsChanged: string[];
  traitsAdded: string[];
  traitsRemoved: string[];
  traitsChanged: string[];
  itemsAdded: string[];
  itemsRemoved: string[];
  itemsChanged: string[];
  augmentsAdded: string[];
  augmentsRemoved: string[];
  augmentsChanged: string[];
  compsAdded: string[];
  compsRemoved: string[];
  compsChanged: string[];
}

export interface KnowledgeRepository {
  getActiveKnowledgeVersion(
    kind?: 'static' | 'curated' | 'external-meta',
  ): Promise<ActiveKnowledgeVersion | null>;
  getChampion(id: string, snapshotId?: string): Promise<ChampionKnowledge | null>;
  listChampions(filter?: {
    snapshotId?: string;
    role?: string;
    cost?: number;
    traitId?: string;
  }): Promise<ChampionKnowledge[]>;
  getTrait(id: string, snapshotId?: string): Promise<TraitKnowledge | null>;
  listTraits(filter?: { snapshotId?: string }): Promise<TraitKnowledge[]>;
  getItem(id: string, snapshotId?: string): Promise<ItemKnowledge | null>;
  listItems(filter?: { snapshotId?: string; category?: string }): Promise<ItemKnowledge[]>;
  getAugment(id: string, snapshotId?: string): Promise<AugmentKnowledge | null>;
  listAugments(filter?: { snapshotId?: string; tier?: string }): Promise<AugmentKnowledge[]>;
  getComp(id: string, snapshotId?: string): Promise<CompKnowledge | null>;
  listComps(filter?: { snapshotId?: string; sourceKind?: string }): Promise<CompKnowledge[]>;
  getCompUnits(compId: string, snapshotId?: string): Promise<CompUnitKnowledge[]>;
  getLatestMetaForComp(compId: string): Promise<CompMetaObservation | null>;
  getSourceSnapshot(snapshotId: string): Promise<SourceSnapshot | null>;
  listSourceSnapshots(filter?: {
    sourceId?: string;
    setNumber?: number;
  }): Promise<SourceSnapshot[]>;
  getKnowledgeDiff(
    previousSnapshotId: string,
    nextSnapshotId: string,
  ): Promise<KnowledgeDiff | null>;
}

export class SqlKnowledgeRepository implements KnowledgeRepository {
  constructor(private db: SqlDatabase) {}

  private async resolveSnapshot(
    kind: 'static' | 'curated' | 'external-meta',
    explicit?: string,
  ): Promise<string | null> {
    if (explicit) return explicit;
    const active = await this.getActiveKnowledgeVersion(kind);
    return active?.snapshotId ?? null;
  }

  async getActiveKnowledgeVersion(
    kind: 'static' | 'curated' | 'external-meta' = 'static',
  ): Promise<ActiveKnowledgeVersion | null> {
    const rows = await this.db.select<{
      kind: 'static' | 'curated' | 'external-meta';
      snapshot_id: string;
      activated_at: string;
      set_number: number;
      balance_patch: string | null;
      hotfix: string | null;
      source_version: string;
      content_hash: string;
    }>(
      `SELECT a.kind, a.snapshot_id, a.activated_at, s.set_number, s.balance_patch, s.hotfix, s.source_version, s.content_hash
       FROM active_knowledge_snapshots a
       JOIN source_snapshots s ON a.snapshot_id = s.snapshot_id
       WHERE a.kind = $1`,
      [kind],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      kind: r.kind,
      snapshotId: r.snapshot_id,
      setNumber: r.set_number,
      balancePatch: r.balance_patch,
      hotfix: r.hotfix,
      sourceVersion: r.source_version,
      contentHash: r.content_hash,
      activatedAt: r.activated_at,
    };
  }

  async getChampion(id: string, snapshotId?: string): Promise<ChampionKnowledge | null> {
    const snap = await this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      cost: number;
      role: string | null;
      shop_status: 'pool' | 'runtime-variant' | 'placeholder';
      board_eligible: number;
      icon: string | null;
      splash: string | null;
      content_fingerprint: string;
      mechanics: string | null;
    }>(
      `SELECT c.id, c.name, cv.snapshot_id, cv.cost, cv.role, cv.shop_status, cv.board_eligible, cv.icon, cv.splash, cv.content_fingerprint, cv.mechanics
       FROM champions c
       JOIN champion_versions cv ON c.id = cv.champion_id
       WHERE c.id = $1 AND cv.snapshot_id = $2`,
      [id, snap],
    );
    if (!rows.length) return null;
    const r = rows[0];

    const traitRows = await this.db.select<{ trait_id: string }>(
      'SELECT trait_id FROM champion_traits WHERE champion_id = $1 AND snapshot_id = $2 ORDER BY trait_id ASC',
      [id, snap],
    );

    return {
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      cost: r.cost,
      role: r.role,
      shopStatus: r.shop_status,
      boardEligible: Boolean(r.board_eligible),
      icon: r.icon,
      splash: r.splash,
      traitIds: traitRows.map((t) => t.trait_id),
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    };
  }

  async listChampions(filter?: {
    snapshotId?: string;
    role?: string;
    cost?: number;
    traitId?: string;
  }): Promise<ChampionKnowledge[]> {
    const snap = await this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];

    let query = `
      SELECT DISTINCT c.id, c.name, cv.snapshot_id, cv.cost, cv.role, cv.shop_status, cv.board_eligible, cv.icon, cv.splash, cv.content_fingerprint, cv.mechanics
      FROM champions c
      JOIN champion_versions cv ON c.id = cv.champion_id
    `;
    const conditions = ['cv.snapshot_id = $1'];
    const params: unknown[] = [snap];

    if (filter?.traitId) {
      query +=
        ' JOIN champion_traits ct ON c.id = ct.champion_id AND cv.snapshot_id = ct.snapshot_id';
      params.push(filter.traitId);
      conditions.push(`ct.trait_id = $${params.length}`);
    }

    if (filter?.role) {
      params.push(filter.role);
      conditions.push(`cv.role = $${params.length}`);
    }

    if (filter?.cost !== undefined) {
      params.push(filter.cost);
      conditions.push(`cv.cost = $${params.length}`);
    }

    query += ` WHERE ${conditions.join(' AND ')} ORDER BY cv.cost ASC, c.name ASC, c.id ASC`;

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      cost: number;
      role: string | null;
      shop_status: 'pool' | 'runtime-variant' | 'placeholder';
      board_eligible: number;
      icon: string | null;
      splash: string | null;
      content_fingerprint: string;
      mechanics: string | null;
    }>(query, params);

    const traitRows = await this.db.select<{ champion_id: string; trait_id: string }>(
      'SELECT champion_id, trait_id FROM champion_traits WHERE snapshot_id = $1 ORDER BY trait_id ASC',
      [snap],
    );
    const traitMap = new Map<string, string[]>();
    for (const tr of traitRows) {
      const list = traitMap.get(tr.champion_id) ?? [];
      list.push(tr.trait_id);
      traitMap.set(tr.champion_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      cost: r.cost,
      role: r.role,
      shopStatus: r.shop_status,
      boardEligible: Boolean(r.board_eligible),
      icon: r.icon,
      splash: r.splash,
      traitIds: traitMap.get(r.id) ?? [],
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    }));
  }

  async getTrait(id: string, snapshotId?: string): Promise<TraitKnowledge | null> {
    const snap = await this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      icon: string | null;
      counting: 'unverified' | 'unique-unit';
      availability: 'verified' | 'unavailable';
      content_fingerprint: string;
      mechanics: string | null;
    }>(
      `SELECT t.id, t.name, tv.snapshot_id, tv.icon, tv.counting, tv.availability, tv.content_fingerprint, tv.mechanics
       FROM traits t
       JOIN trait_versions tv ON t.id = tv.trait_id
       WHERE t.id = $1 AND tv.snapshot_id = $2`,
      [id, snap],
    );
    if (!rows.length) return null;
    const r = rows[0];

    const bpRows = await this.db.select<{
      min_units: number;
      max_units: number | null;
      effects: string | null;
    }>(
      'SELECT min_units, max_units, effects FROM trait_breakpoints WHERE trait_id = $1 AND snapshot_id = $2 ORDER BY min_units ASC',
      [id, snap],
    );

    return {
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      icon: r.icon,
      counting: r.counting,
      availability: r.availability,
      breakpoints: bpRows.map((b) => ({
        minUnits: b.min_units,
        maxUnits: b.max_units,
        effects: b.effects ? (JSON.parse(b.effects) as Record<string, unknown>) : null,
      })),
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    };
  }

  async listTraits(filter?: { snapshotId?: string }): Promise<TraitKnowledge[]> {
    const snap = await this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      icon: string | null;
      counting: 'unverified' | 'unique-unit';
      availability: 'verified' | 'unavailable';
      content_fingerprint: string;
      mechanics: string | null;
    }>(
      `SELECT t.id, t.name, tv.snapshot_id, tv.icon, tv.counting, tv.availability, tv.content_fingerprint, tv.mechanics
       FROM traits t
       JOIN trait_versions tv ON t.id = tv.trait_id
       WHERE tv.snapshot_id = $1
       ORDER BY t.name ASC, t.id ASC`,
      [snap],
    );

    const bpRows = await this.db.select<{
      trait_id: string;
      min_units: number;
      max_units: number | null;
      effects: string | null;
    }>(
      'SELECT trait_id, min_units, max_units, effects FROM trait_breakpoints WHERE snapshot_id = $1 ORDER BY min_units ASC',
      [snap],
    );

    const bpMap = new Map<string, TraitBreakpointKnowledge[]>();
    for (const b of bpRows) {
      const list = bpMap.get(b.trait_id) ?? [];
      list.push({
        minUnits: b.min_units,
        maxUnits: b.max_units,
        effects: b.effects ? (JSON.parse(b.effects) as Record<string, unknown>) : null,
      });
      bpMap.set(b.trait_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      icon: r.icon,
      counting: r.counting,
      availability: r.availability,
      breakpoints: bpMap.get(r.id) ?? [],
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    }));
  }

  async getItem(id: string, snapshotId?: string): Promise<ItemKnowledge | null> {
    const snap = await this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      category: 'component' | 'combined' | 'other';
      icon: string | null;
      availability: Verification;
      content_fingerprint: string;
      mechanics: string | null;
    }>(
      `SELECT i.id, i.name, iv.snapshot_id, iv.category, iv.icon, iv.availability, iv.content_fingerprint, iv.mechanics
       FROM items i
       JOIN item_versions iv ON i.id = iv.item_id
       WHERE i.id = $1 AND iv.snapshot_id = $2`,
      [id, snap],
    );
    if (!rows.length) return null;
    const r = rows[0];

    const compRows = await this.db.select<{ component_id: string }>(
      'SELECT component_id FROM item_components WHERE item_id = $1 AND snapshot_id = $2 ORDER BY position ASC',
      [id, snap],
    );

    return {
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      category: r.category,
      icon: r.icon,
      components: compRows.map((c) => c.component_id),
      availability: r.availability,
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    };
  }

  async listItems(filter?: { snapshotId?: string; category?: string }): Promise<ItemKnowledge[]> {
    const snap = await this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];

    let query = `
      SELECT i.id, i.name, iv.snapshot_id, iv.category, iv.icon, iv.availability, iv.content_fingerprint, iv.mechanics
      FROM items i
      JOIN item_versions iv ON i.id = iv.item_id
      WHERE iv.snapshot_id = $1
    `;
    const params: unknown[] = [snap];

    if (filter?.category) {
      params.push(filter.category);
      query += ` AND iv.category = $${params.length}`;
    }

    query += ' ORDER BY iv.category ASC, i.name ASC, i.id ASC';

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      category: 'component' | 'combined' | 'other';
      icon: string | null;
      availability: Verification;
      content_fingerprint: string;
      mechanics: string | null;
    }>(query, params);

    const compRows = await this.db.select<{ item_id: string; component_id: string }>(
      'SELECT item_id, component_id FROM item_components WHERE snapshot_id = $1 ORDER BY position ASC',
      [snap],
    );
    const compMap = new Map<string, string[]>();
    for (const c of compRows) {
      const list = compMap.get(c.item_id) ?? [];
      list.push(c.component_id);
      compMap.set(c.item_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      category: r.category,
      icon: r.icon,
      components: compMap.get(r.id) ?? [],
      availability: r.availability,
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    }));
  }

  async getAugment(id: string, snapshotId?: string): Promise<AugmentKnowledge | null> {
    const snap = await this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      tier: string | null;
      category: string | null;
      availability: Verification;
      present_in_export: number;
      live_status: 'enabled' | 'disabled' | 'unverified';
      content_fingerprint: string;
      mechanics: string | null;
    }>(
      `SELECT a.id, a.name, av.snapshot_id, av.tier, av.category, av.availability, av.present_in_export, av.live_status, av.content_fingerprint, av.mechanics
       FROM augments a
       JOIN augment_versions av ON a.id = av.augment_id
       WHERE a.id = $1 AND av.snapshot_id = $2`,
      [id, snap],
    );
    if (!rows.length) return null;
    const r = rows[0];

    const traitRows = await this.db.select<{ trait_id: string }>(
      'SELECT trait_id FROM augment_required_traits WHERE augment_id = $1 AND snapshot_id = $2 ORDER BY trait_id ASC',
      [id, snap],
    );

    return {
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      tier: r.tier,
      category: r.category,
      availability: r.availability,
      presentInExport: Boolean(r.present_in_export),
      liveStatus: r.live_status,
      requiredTraits: traitRows.map((t) => t.trait_id),
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    };
  }

  async listAugments(filter?: { snapshotId?: string; tier?: string }): Promise<AugmentKnowledge[]> {
    const snap = await this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];

    let query = `
      SELECT a.id, a.name, av.snapshot_id, av.tier, av.category, av.availability, av.present_in_export, av.live_status, av.content_fingerprint, av.mechanics
      FROM augments a
      JOIN augment_versions av ON a.id = av.augment_id
      WHERE av.snapshot_id = $1
    `;
    const params: unknown[] = [snap];

    if (filter?.tier) {
      params.push(filter.tier);
      query += ` AND av.tier = $${params.length}`;
    }

    query += ' ORDER BY av.tier ASC, a.name ASC, a.id ASC';

    const rows = await this.db.select<{
      id: string;
      name: string;
      snapshot_id: string;
      tier: string | null;
      category: string | null;
      availability: Verification;
      present_in_export: number;
      live_status: 'enabled' | 'disabled' | 'unverified';
      content_fingerprint: string;
      mechanics: string | null;
    }>(query, params);

    const traitRows = await this.db.select<{ augment_id: string; trait_id: string }>(
      'SELECT augment_id, trait_id FROM augment_required_traits WHERE snapshot_id = $1 ORDER BY trait_id ASC',
      [snap],
    );
    const traitMap = new Map<string, string[]>();
    for (const t of traitRows) {
      const list = traitMap.get(t.augment_id) ?? [];
      list.push(t.trait_id);
      traitMap.set(t.augment_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      snapshotId: r.snapshot_id,
      tier: r.tier,
      category: r.category,
      availability: r.availability,
      presentInExport: Boolean(r.present_in_export),
      liveStatus: r.live_status,
      requiredTraits: traitMap.get(r.id) ?? [],
      contentFingerprint: r.content_fingerprint,
      mechanics: r.mechanics ? (JSON.parse(r.mechanics) as EntityMechanics) : null,
    }));
  }

  async getComp(id: string, snapshotId?: string): Promise<CompKnowledge | null> {
    let snap = snapshotId;
    if (!snap) {
      snap =
        (await this.resolveSnapshot('curated')) ??
        (await this.resolveSnapshot('external-meta')) ??
        undefined;
    }
    if (!snap) return null;

    const rows = await this.db.select<{
      id: string;
      name: string;
      source_kind: 'curated' | 'external-meta' | 'discovered';
      snapshot_id: string;
      title: string;
      subtitle: string | null;
      hero_id: string | null;
      style: string | null;
      evidence_label: EvidenceLabel;
      target_level: number | null;
      level_plan: string | null;
      play_signals: string | null;
      avoid_signals: string | null;
      content_fingerprint: string;
      payload: string | null;
    }>(
      `SELECT c.id, c.name, c.source_kind, cv.snapshot_id, cv.title, cv.subtitle, cv.hero_id, cv.style, cv.evidence_label, cv.target_level, cv.level_plan, cv.play_signals, cv.avoid_signals, cv.content_fingerprint, cv.payload
       FROM comps c
       JOIN comp_versions cv ON c.id = cv.comp_id
       WHERE c.id = $1 AND cv.snapshot_id = $2`,
      [id, snap],
    );
    if (!rows.length) return null;
    const r = rows[0];

    const units = await this.getCompUnits(id, snap);

    const pkgRows = await this.db.select<{
      comp_id: string;
      snapshot_id: string;
      holder_id: string;
      item_id: string;
      priority_order: number;
    }>(
      'SELECT comp_id, snapshot_id, holder_id, item_id, priority_order FROM comp_item_packages WHERE comp_id = $1 AND snapshot_id = $2 ORDER BY holder_id ASC, priority_order ASC',
      [id, snap],
    );

    return {
      id: r.id,
      name: r.name,
      sourceKind: r.source_kind,
      snapshotId: r.snapshot_id,
      title: r.title,
      subtitle: r.subtitle,
      heroId: r.hero_id,
      style: r.style,
      evidenceLabel: r.evidence_label,
      targetLevel: r.target_level,
      levelPlan: r.level_plan,
      playSignals: r.play_signals ? (JSON.parse(r.play_signals) as string[]) : null,
      avoidSignals: r.avoid_signals ? (JSON.parse(r.avoid_signals) as string[]) : null,
      contentFingerprint: r.content_fingerprint,
      units,
      itemPackages: pkgRows.map((p) => ({
        compId: p.comp_id,
        snapshotId: p.snapshot_id,
        holderId: p.holder_id,
        itemId: p.item_id,
        priorityOrder: p.priority_order,
      })),
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
    };
  }

  async listComps(filter?: { snapshotId?: string; sourceKind?: string }): Promise<CompKnowledge[]> {
    let snap = filter?.snapshotId;
    if (!snap) {
      snap =
        (await this.resolveSnapshot('curated')) ??
        (await this.resolveSnapshot('external-meta')) ??
        undefined;
    }
    if (!snap) return [];

    let query = `
      SELECT c.id, c.name, c.source_kind, cv.snapshot_id, cv.title, cv.subtitle, cv.hero_id, cv.style, cv.evidence_label, cv.target_level, cv.level_plan, cv.play_signals, cv.avoid_signals, cv.content_fingerprint, cv.payload
      FROM comps c
      JOIN comp_versions cv ON c.id = cv.comp_id
      WHERE cv.snapshot_id = $1
    `;
    const params: unknown[] = [snap];

    if (filter?.sourceKind) {
      params.push(filter.sourceKind);
      query += ` AND c.source_kind = $${params.length}`;
    }

    query += ' ORDER BY cv.title ASC, c.id ASC';

    const rows = await this.db.select<{
      id: string;
      name: string;
      source_kind: 'curated' | 'external-meta' | 'discovered';
      snapshot_id: string;
      title: string;
      subtitle: string | null;
      hero_id: string | null;
      style: string | null;
      evidence_label: EvidenceLabel;
      target_level: number | null;
      level_plan: string | null;
      play_signals: string | null;
      avoid_signals: string | null;
      content_fingerprint: string;
      payload: string | null;
    }>(query, params);

    const allUnits = await this.db.select<{
      comp_id: string;
      snapshot_id: string;
      champion_id: string;
      slot: 'core' | 'flex' | 'temporary';
      role: 'carry' | 'tank' | null;
      stage: 'early' | 'mid' | 'stabilization' | 'final';
    }>(
      'SELECT comp_id, snapshot_id, champion_id, slot, role, stage FROM comp_units WHERE snapshot_id = $1 ORDER BY stage ASC, slot ASC, champion_id ASC',
      [snap],
    );
    const unitMap = new Map<string, CompUnitKnowledge[]>();
    for (const u of allUnits) {
      const list = unitMap.get(u.comp_id) ?? [];
      list.push({
        compId: u.comp_id,
        snapshotId: u.snapshot_id,
        championId: u.champion_id,
        slot: u.slot,
        role: u.role,
        stage: u.stage,
      });
      unitMap.set(u.comp_id, list);
    }

    const allPkgs = await this.db.select<{
      comp_id: string;
      snapshot_id: string;
      holder_id: string;
      item_id: string;
      priority_order: number;
    }>(
      'SELECT comp_id, snapshot_id, holder_id, item_id, priority_order FROM comp_item_packages WHERE snapshot_id = $1 ORDER BY holder_id ASC, priority_order ASC',
      [snap],
    );
    const pkgMap = new Map<string, CompItemPackageKnowledge[]>();
    for (const p of allPkgs) {
      const list = pkgMap.get(p.comp_id) ?? [];
      list.push({
        compId: p.comp_id,
        snapshotId: p.snapshot_id,
        holderId: p.holder_id,
        itemId: p.item_id,
        priorityOrder: p.priority_order,
      });
      pkgMap.set(p.comp_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sourceKind: r.source_kind,
      snapshotId: r.snapshot_id,
      title: r.title,
      subtitle: r.subtitle,
      heroId: r.hero_id,
      style: r.style,
      evidenceLabel: r.evidence_label,
      targetLevel: r.target_level,
      levelPlan: r.level_plan,
      playSignals: r.play_signals ? (JSON.parse(r.play_signals) as string[]) : null,
      avoidSignals: r.avoid_signals ? (JSON.parse(r.avoid_signals) as string[]) : null,
      contentFingerprint: r.content_fingerprint,
      units: unitMap.get(r.id) ?? [],
      itemPackages: pkgMap.get(r.id) ?? [],
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
    }));
  }

  async getCompUnits(compId: string, snapshotId?: string): Promise<CompUnitKnowledge[]> {
    let snap = snapshotId;
    if (!snap) {
      snap =
        (await this.resolveSnapshot('curated')) ??
        (await this.resolveSnapshot('external-meta')) ??
        undefined;
    }
    if (!snap) return [];

    const rows = await this.db.select<{
      comp_id: string;
      snapshot_id: string;
      champion_id: string;
      slot: 'core' | 'flex' | 'temporary';
      role: 'carry' | 'tank' | null;
      stage: 'early' | 'mid' | 'stabilization' | 'final';
    }>(
      'SELECT comp_id, snapshot_id, champion_id, slot, role, stage FROM comp_units WHERE comp_id = $1 AND snapshot_id = $2 ORDER BY stage ASC, slot ASC, champion_id ASC',
      [compId, snap],
    );

    return rows.map((r) => ({
      compId: r.comp_id,
      snapshotId: r.snapshot_id,
      championId: r.champion_id,
      slot: r.slot,
      role: r.role,
      stage: r.stage,
    }));
  }

  async getLatestMetaForComp(compId: string): Promise<CompMetaObservation | null> {
    const rows = await this.db.select<{
      observation_id: string;
      snapshot_id: string;
      comp_id: string;
      provider_comp_id: string;
      sample_size: number | null;
      average_placement: number | null;
      top4_rate: number | null;
      win_rate: number | null;
      pick_rate: number | null;
      raw_stats: string;
      positions: string;
      item_packages: string;
      observed_at: string;
    }>(
      'SELECT observation_id, snapshot_id, comp_id, provider_comp_id, sample_size, average_placement, top4_rate, win_rate, pick_rate, raw_stats, positions, item_packages, observed_at FROM comp_meta_observations WHERE comp_id = $1 ORDER BY observed_at DESC LIMIT 1',
      [compId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      observationId: r.observation_id,
      snapshotId: r.snapshot_id,
      compId: r.comp_id,
      providerCompId: r.provider_comp_id,
      sampleSize: r.sample_size,
      averagePlacement: r.average_placement,
      top4Rate: r.top4_rate,
      winRate: r.win_rate,
      pickRate: r.pick_rate,
      rawStats: JSON.parse(r.raw_stats) as Record<string, unknown>,
      positions: JSON.parse(r.positions) as Array<{
        championId: string;
        row: number;
        column: number;
      }>,
      itemPackages: JSON.parse(r.item_packages) as Array<{
        holder: string;
        items: string[];
        source: string;
      }>,
      observedAt: r.observed_at,
    };
  }

  async getSourceSnapshot(snapshotId: string): Promise<SourceSnapshot | null> {
    const rows = await this.db.select<{
      snapshot_id: string;
      source_id: string;
      source_type: string;
      set_number: number;
      balance_patch: string | null;
      hotfix: string | null;
      retrieved_at: string;
      published_at: string | null;
      source_version: string;
      schema_version: number;
      content_hash: string;
      provenance_status: string;
      parity_status: string;
      source_uri: string | null;
      notes: string | null;
      raw_reference: string | null;
      created_at: string;
    }>('SELECT * FROM source_snapshots WHERE snapshot_id = $1', [snapshotId]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      snapshotId: r.snapshot_id,
      sourceId: r.source_id,
      sourceType: r.source_type,
      setNumber: r.set_number,
      balancePatch: r.balance_patch,
      hotfix: r.hotfix,
      retrievedAt: r.retrieved_at,
      publishedAt: r.published_at,
      sourceVersion: r.source_version,
      schemaVersion: r.schema_version,
      contentHash: r.content_hash,
      provenanceStatus: r.provenance_status,
      parityStatus: r.parity_status,
      sourceUri: r.source_uri,
      notes: r.notes,
      rawReference: r.raw_reference,
      createdAt: r.created_at,
    };
  }

  async listSourceSnapshots(filter?: {
    sourceId?: string;
    setNumber?: number;
  }): Promise<SourceSnapshot[]> {
    let query = 'SELECT * FROM source_snapshots';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.sourceId) {
      params.push(filter.sourceId);
      conditions.push(`source_id = $${params.length}`);
    }
    if (filter?.setNumber !== undefined) {
      params.push(filter.setNumber);
      conditions.push(`set_number = $${params.length}`);
    }

    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY retrieved_at DESC';

    const rows = await this.db.select<{
      snapshot_id: string;
      source_id: string;
      source_type: string;
      set_number: number;
      balance_patch: string | null;
      hotfix: string | null;
      retrieved_at: string;
      published_at: string | null;
      source_version: string;
      schema_version: number;
      content_hash: string;
      provenance_status: string;
      parity_status: string;
      source_uri: string | null;
      notes: string | null;
      raw_reference: string | null;
      created_at: string;
    }>(query, params);

    return rows.map((r) => ({
      snapshotId: r.snapshot_id,
      sourceId: r.source_id,
      sourceType: r.source_type,
      setNumber: r.set_number,
      balancePatch: r.balance_patch,
      hotfix: r.hotfix,
      retrievedAt: r.retrieved_at,
      publishedAt: r.published_at,
      sourceVersion: r.source_version,
      schemaVersion: r.schema_version,
      contentHash: r.content_hash,
      provenanceStatus: r.provenance_status,
      parityStatus: r.parity_status,
      sourceUri: r.source_uri,
      notes: r.notes,
      rawReference: r.raw_reference,
      createdAt: r.created_at,
    }));
  }

  async getKnowledgeDiff(
    previousSnapshotId: string,
    nextSnapshotId: string,
  ): Promise<KnowledgeDiff | null> {
    const prevSnap = await this.getSourceSnapshot(previousSnapshotId);
    const nextSnap = await this.getSourceSnapshot(nextSnapshotId);
    if (!prevSnap || !nextSnap) return null;

    const diffEntity = async (
      table: string,
      idCol: string,
    ): Promise<{ added: string[]; removed: string[]; changed: string[] }> => {
      const prevRows = await this.db.select<{ id: string; fp: string }>(
        `SELECT ${idCol} AS id, content_fingerprint AS fp FROM ${table} WHERE snapshot_id = $1`,
        [previousSnapshotId],
      );
      const nextRows = await this.db.select<{ id: string; fp: string }>(
        `SELECT ${idCol} AS id, content_fingerprint AS fp FROM ${table} WHERE snapshot_id = $1`,
        [nextSnapshotId],
      );

      const prevMap = new Map(prevRows.map((r) => [r.id, r.fp]));
      const nextMap = new Map(nextRows.map((r) => [r.id, r.fp]));

      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];

      for (const [id, fp] of nextMap) {
        if (!prevMap.has(id)) added.push(id);
        else if (prevMap.get(id) !== fp) changed.push(id);
      }
      for (const id of prevMap.keys()) {
        if (!nextMap.has(id)) removed.push(id);
      }

      return {
        added: added.sort(),
        removed: removed.sort(),
        changed: changed.sort(),
      };
    };

    const champions = await diffEntity('champion_versions', 'champion_id');
    const traits = await diffEntity('trait_versions', 'trait_id');
    const items = await diffEntity('item_versions', 'item_id');
    const augments = await diffEntity('augment_versions', 'augment_id');
    const comps = await diffEntity('comp_versions', 'comp_id');

    return {
      previousSnapshotId,
      nextSnapshotId,
      setChanged: prevSnap.setNumber !== nextSnap.setNumber,
      championsAdded: champions.added,
      championsRemoved: champions.removed,
      championsChanged: champions.changed,
      traitsAdded: traits.added,
      traitsRemoved: traits.removed,
      traitsChanged: traits.changed,
      itemsAdded: items.added,
      itemsRemoved: items.removed,
      itemsChanged: items.changed,
      augmentsAdded: augments.added,
      augmentsRemoved: augments.removed,
      augmentsChanged: augments.changed,
      compsAdded: comps.added,
      compsRemoved: comps.removed,
      compsChanged: comps.changed,
    };
  }
}

export class MemoryKnowledgeRepository implements KnowledgeRepository {
  private active = new Map<'static' | 'curated' | 'external-meta', ActiveKnowledgeVersion>();
  private champions = new Map<string, Map<string, ChampionKnowledge>>();
  private traits = new Map<string, Map<string, TraitKnowledge>>();
  private items = new Map<string, Map<string, ItemKnowledge>>();
  private augments = new Map<string, Map<string, AugmentKnowledge>>();
  private comps = new Map<string, Map<string, CompKnowledge>>();
  private compUnits = new Map<string, Map<string, CompUnitKnowledge[]>>();
  private metaObs = new Map<string, CompMetaObservation[]>();
  private snapshots = new Map<string, SourceSnapshot>();

  setActiveKnowledgeVersion(version: ActiveKnowledgeVersion) {
    this.active.set(version.kind, structuredClone(version));
  }

  setSourceSnapshot(snap: SourceSnapshot) {
    this.snapshots.set(snap.snapshotId, structuredClone(snap));
  }

  setChampion(champ: ChampionKnowledge) {
    let map = this.champions.get(champ.snapshotId);
    if (!map) {
      map = new Map();
      this.champions.set(champ.snapshotId, map);
    }
    map.set(champ.id, structuredClone(champ));
  }

  setTrait(trait: TraitKnowledge) {
    let map = this.traits.get(trait.snapshotId);
    if (!map) {
      map = new Map();
      this.traits.set(trait.snapshotId, map);
    }
    map.set(trait.id, structuredClone(trait));
  }

  setItem(item: ItemKnowledge) {
    let map = this.items.get(item.snapshotId);
    if (!map) {
      map = new Map();
      this.items.set(item.snapshotId, map);
    }
    map.set(item.id, structuredClone(item));
  }

  setAugment(aug: AugmentKnowledge) {
    let map = this.augments.get(aug.snapshotId);
    if (!map) {
      map = new Map();
      this.augments.set(aug.snapshotId, map);
    }
    map.set(aug.id, structuredClone(aug));
  }

  setComp(comp: CompKnowledge) {
    let map = this.comps.get(comp.snapshotId);
    if (!map) {
      map = new Map();
      this.comps.set(comp.snapshotId, map);
    }
    map.set(comp.id, structuredClone(comp));

    let uMap = this.compUnits.get(comp.snapshotId);
    if (!uMap) {
      uMap = new Map();
      this.compUnits.set(comp.snapshotId, uMap);
    }
    uMap.set(comp.id, structuredClone(comp.units));
  }

  addMetaObservation(obs: CompMetaObservation) {
    const list = this.metaObs.get(obs.compId) ?? [];
    list.push(structuredClone(obs));
    list.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    this.metaObs.set(obs.compId, list);
  }

  async getActiveKnowledgeVersion(
    kind: 'static' | 'curated' | 'external-meta' = 'static',
  ): Promise<ActiveKnowledgeVersion | null> {
    const v = this.active.get(kind);
    return v ? structuredClone(v) : null;
  }

  private resolveSnapshot(
    kind: 'static' | 'curated' | 'external-meta',
    explicit?: string,
  ): string | null {
    if (explicit) return explicit;
    return this.active.get(kind)?.snapshotId ?? null;
  }

  async getChampion(id: string, snapshotId?: string): Promise<ChampionKnowledge | null> {
    const snap = this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;
    const c = this.champions.get(snap)?.get(id);
    return c ? structuredClone(c) : null;
  }

  async listChampions(filter?: {
    snapshotId?: string;
    role?: string;
    cost?: number;
    traitId?: string;
  }): Promise<ChampionKnowledge[]> {
    const snap = this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];
    let list = Array.from(this.champions.get(snap)?.values() ?? []);
    if (filter?.role) list = list.filter((c) => c.role === filter.role);
    if (filter?.cost !== undefined) list = list.filter((c) => c.cost === filter.cost);
    if (filter?.traitId) list = list.filter((c) => c.traitIds.includes(filter.traitId!));
    return structuredClone(
      list.sort(
        (a, b) => a.cost - b.cost || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      ),
    );
  }

  async getTrait(id: string, snapshotId?: string): Promise<TraitKnowledge | null> {
    const snap = this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;
    const t = this.traits.get(snap)?.get(id);
    return t ? structuredClone(t) : null;
  }

  async listTraits(filter?: { snapshotId?: string }): Promise<TraitKnowledge[]> {
    const snap = this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];
    const list = Array.from(this.traits.get(snap)?.values() ?? []);
    return structuredClone(
      list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    );
  }

  async getItem(id: string, snapshotId?: string): Promise<ItemKnowledge | null> {
    const snap = this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;
    const i = this.items.get(snap)?.get(id);
    return i ? structuredClone(i) : null;
  }

  async listItems(filter?: { snapshotId?: string; category?: string }): Promise<ItemKnowledge[]> {
    const snap = this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];
    let list = Array.from(this.items.get(snap)?.values() ?? []);
    if (filter?.category) list = list.filter((i) => i.category === filter.category);
    return structuredClone(
      list.sort(
        (a, b) =>
          a.category.localeCompare(b.category) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      ),
    );
  }

  async getAugment(id: string, snapshotId?: string): Promise<AugmentKnowledge | null> {
    const snap = this.resolveSnapshot('static', snapshotId);
    if (!snap) return null;
    const a = this.augments.get(snap)?.get(id);
    return a ? structuredClone(a) : null;
  }

  async listAugments(filter?: { snapshotId?: string; tier?: string }): Promise<AugmentKnowledge[]> {
    const snap = this.resolveSnapshot('static', filter?.snapshotId);
    if (!snap) return [];
    let list = Array.from(this.augments.get(snap)?.values() ?? []);
    if (filter?.tier) list = list.filter((a) => a.tier === filter.tier);
    return structuredClone(
      list.sort(
        (a, b) =>
          (a.tier ?? '').localeCompare(b.tier ?? '') ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      ),
    );
  }

  async getComp(id: string, snapshotId?: string): Promise<CompKnowledge | null> {
    let snap = snapshotId;
    if (!snap) {
      snap = this.resolveSnapshot('curated') ?? this.resolveSnapshot('external-meta') ?? undefined;
    }
    if (!snap) return null;
    const c = this.comps.get(snap)?.get(id);
    return c ? structuredClone(c) : null;
  }

  async listComps(filter?: { snapshotId?: string; sourceKind?: string }): Promise<CompKnowledge[]> {
    let snap = filter?.snapshotId;
    if (!snap) {
      snap = this.resolveSnapshot('curated') ?? this.resolveSnapshot('external-meta') ?? undefined;
    }
    if (!snap) return [];
    let list = Array.from(this.comps.get(snap)?.values() ?? []);
    if (filter?.sourceKind) list = list.filter((c) => c.sourceKind === filter.sourceKind);
    return structuredClone(
      list.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
    );
  }

  async getCompUnits(compId: string, snapshotId?: string): Promise<CompUnitKnowledge[]> {
    let snap = snapshotId;
    if (!snap) {
      snap = this.resolveSnapshot('curated') ?? this.resolveSnapshot('external-meta') ?? undefined;
    }
    if (!snap) return [];
    const list = this.compUnits.get(snap)?.get(compId) ?? [];
    return structuredClone(list);
  }

  async getLatestMetaForComp(compId: string): Promise<CompMetaObservation | null> {
    const list = this.metaObs.get(compId);
    return list && list.length ? structuredClone(list[0]) : null;
  }

  async getSourceSnapshot(snapshotId: string): Promise<SourceSnapshot | null> {
    const s = this.snapshots.get(snapshotId);
    return s ? structuredClone(s) : null;
  }

  async listSourceSnapshots(filter?: {
    sourceId?: string;
    setNumber?: number;
  }): Promise<SourceSnapshot[]> {
    let list = Array.from(this.snapshots.values());
    if (filter?.sourceId) list = list.filter((s) => s.sourceId === filter.sourceId);
    if (filter?.setNumber !== undefined)
      list = list.filter((s) => s.setNumber === filter.setNumber);
    return structuredClone(list.sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt)));
  }

  async getKnowledgeDiff(
    previousSnapshotId: string,
    nextSnapshotId: string,
  ): Promise<KnowledgeDiff | null> {
    const prevSnap = this.snapshots.get(previousSnapshotId);
    const nextSnap = this.snapshots.get(nextSnapshotId);
    if (!prevSnap || !nextSnap) return null;

    const diff = (
      prevMap?: Map<string, { contentFingerprint: string }>,
      nextMap?: Map<string, { contentFingerprint: string }>,
    ) => {
      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];

      for (const [id, item] of nextMap ?? []) {
        const p = prevMap?.get(id);
        if (!p) added.push(id);
        else if (p.contentFingerprint !== item.contentFingerprint) changed.push(id);
      }
      for (const id of prevMap?.keys() ?? []) {
        if (!nextMap?.has(id)) removed.push(id);
      }

      return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
    };

    const champions = diff(
      this.champions.get(previousSnapshotId),
      this.champions.get(nextSnapshotId),
    );
    const traits = diff(this.traits.get(previousSnapshotId), this.traits.get(nextSnapshotId));
    const items = diff(this.items.get(previousSnapshotId), this.items.get(nextSnapshotId));
    const augments = diff(this.augments.get(previousSnapshotId), this.augments.get(nextSnapshotId));
    const comps = diff(this.comps.get(previousSnapshotId), this.comps.get(nextSnapshotId));

    return {
      previousSnapshotId,
      nextSnapshotId,
      setChanged: prevSnap.setNumber !== nextSnap.setNumber,
      championsAdded: champions.added,
      championsRemoved: champions.removed,
      championsChanged: champions.changed,
      traitsAdded: traits.added,
      traitsRemoved: traits.removed,
      traitsChanged: traits.changed,
      itemsAdded: items.added,
      itemsRemoved: items.removed,
      itemsChanged: items.changed,
      augmentsAdded: augments.added,
      augmentsRemoved: augments.removed,
      augmentsChanged: augments.changed,
      compsAdded: comps.added,
      compsRemoved: comps.removed,
      compsChanged: comps.changed,
    };
  }
}
