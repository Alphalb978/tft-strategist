import type { SqlDatabase } from './knowledgeDatabase';
import type { StaticData, Playbook } from '../domain/models';
import type { ExternalSnapshot } from '../domain/externalMeta';
import { familyDefinitionsFingerprint, stableFingerprint } from '../domain/fingerprint';
import { validateExternal } from '../providers/externalMeta';

export interface ImportResult {
  snapshotId: string;
  created: boolean;
  contentHash: string;
}

export interface ImportOptions {
  rawReference?: string;
  activate?: boolean;
}

export async function importCommunityDragonKnowledge(
  db: SqlDatabase,
  data: StaticData,
  options?: ImportOptions,
): Promise<ImportResult> {
  const contentHash =
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

  const snapshotId = `cd:${contentHash}`;

  const existing = await db.select<{ snapshot_id: string }>(
    'SELECT snapshot_id FROM source_snapshots WHERE source_id = $1 AND content_hash = $2',
    ['community-dragon', contentHash],
  );
  if (existing.length > 0) {
    if (options?.activate !== false) {
      await activateKnowledgeSnapshot(db, 'static', existing[0].snapshot_id);
    }
    return { snapshotId: existing[0].snapshot_id, created: false, contentHash };
  }

  const now = new Date().toISOString();

  await db.execute('BEGIN TRANSACTION');
  try {
    await db.execute(
      'INSERT OR IGNORE INTO knowledge_sources (source_id, name, source_type, base_url, created_at) VALUES ($1, $2, $3, $4, $5)',
      ['community-dragon', 'CommunityDragon', 'static-cdn', 'https://raw.communitydragon.org', now],
    );

    await db.execute(
      `INSERT INTO source_snapshots (
        snapshot_id, source_id, source_type, set_number, balance_patch, hotfix,
        retrieved_at, published_at, source_version, schema_version, content_hash,
        provenance_status, parity_status, source_uri, notes, raw_reference, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        snapshotId,
        'community-dragon',
        'static-cdn',
        data.version.set,
        data.version.provenance.patch ?? null,
        data.knowledge?.balanceHotfix ?? null,
        data.version.provenance.fetchedAt,
        data.version.provenance.publishedAt ?? null,
        data.version.sourceVersion,
        data.version.schemaVersion,
        contentHash,
        data.version.provenance.status,
        data.version.parityStatus,
        data.version.provenance.source,
        data.version.provenance.note,
        options?.rawReference ?? null,
        JSON.stringify({ warnings: data.warnings, name: data.version.name }),
        now,
      ],
    );

    // 1. Base entity registries first to satisfy foreign keys
    for (const trait of data.traits) {
      await db.execute('INSERT OR IGNORE INTO traits (id, name, created_at) VALUES ($1, $2, $3)', [
        trait.id,
        trait.name,
        now,
      ]);
    }
    for (const champion of data.champions) {
      await db.execute(
        'INSERT OR IGNORE INTO champions (id, name, created_at) VALUES ($1, $2, $3)',
        [champion.id, champion.name, now],
      );
    }
    for (const item of data.items) {
      await db.execute('INSERT OR IGNORE INTO items (id, name, created_at) VALUES ($1, $2, $3)', [
        item.id,
        item.name,
        now,
      ]);
    }
    for (const augment of data.augments) {
      await db.execute(
        'INSERT OR IGNORE INTO augments (id, name, created_at) VALUES ($1, $2, $3)',
        [augment.id, augment.name, now],
      );
    }

    // 2. Champions versions & trait associations
    for (const champion of data.champions) {
      const mechanics = data.knowledge?.entities[champion.id] ?? null;
      const contentFingerprint =
        data.knowledge?.entityFingerprints[champion.id] ?? stableFingerprint(champion);

      await db.execute(
        `INSERT INTO champion_versions (
          champion_id, snapshot_id, cost, role, shop_status, board_eligible,
          icon, splash, content_fingerprint, mechanics
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          champion.id,
          snapshotId,
          champion.cost,
          champion.role ?? null,
          champion.shopStatus,
          champion.boardEligible ? 1 : 0,
          champion.icon,
          champion.splash,
          contentFingerprint,
          mechanics ? JSON.stringify(mechanics) : null,
        ],
      );

      for (const traitId of champion.traitIds) {
        await db.execute(
          'INSERT OR IGNORE INTO champion_traits (champion_id, snapshot_id, trait_id) VALUES ($1, $2, $3)',
          [champion.id, snapshotId, traitId],
        );
      }
    }

    // 3. Trait versions & breakpoints
    for (const trait of data.traits) {
      const mechanics = data.knowledge?.entities[trait.id] ?? null;
      const contentFingerprint =
        data.knowledge?.entityFingerprints[trait.id] ?? stableFingerprint(trait);

      await db.execute(
        `INSERT INTO trait_versions (
          trait_id, snapshot_id, icon, counting, availability, content_fingerprint, mechanics
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          trait.id,
          snapshotId,
          trait.icon,
          trait.counting,
          trait.availability,
          contentFingerprint,
          mechanics ? JSON.stringify(mechanics) : null,
        ],
      );

      for (const minUnits of trait.breakpoints) {
        const bpMechanic = mechanics?.breakpoints?.find((b) => b.minimum === minUnits);
        await db.execute(
          'INSERT OR IGNORE INTO trait_breakpoints (trait_id, snapshot_id, min_units, max_units, effects) VALUES ($1, $2, $3, $4, $5)',
          [
            trait.id,
            snapshotId,
            minUnits,
            bpMechanic?.maximum ?? null,
            bpMechanic?.effects ? JSON.stringify(bpMechanic.effects) : null,
          ],
        );
      }
    }

    // 4. Item versions & components
    for (const item of data.items) {
      const mechanics = data.knowledge?.entities[item.id] ?? null;
      const contentFingerprint =
        data.knowledge?.entityFingerprints[item.id] ?? stableFingerprint(item);

      await db.execute(
        `INSERT INTO item_versions (
          item_id, snapshot_id, category, icon, availability, content_fingerprint, mechanics
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          item.id,
          snapshotId,
          item.category,
          item.icon,
          item.availability,
          contentFingerprint,
          mechanics ? JSON.stringify(mechanics) : null,
        ],
      );

      for (let pos = 0; pos < item.components.length; pos++) {
        await db.execute(
          'INSERT OR IGNORE INTO item_components (item_id, snapshot_id, component_id, position) VALUES ($1, $2, $3, $4)',
          [item.id, snapshotId, item.components[pos], pos],
        );
      }
    }

    // 5. Augment versions & requirements
    for (const augment of data.augments) {
      const mechanics = data.knowledge?.entities[augment.id] ?? null;
      const contentFingerprint =
        data.knowledge?.entityFingerprints[augment.id] ?? stableFingerprint(augment);

      await db.execute(
        `INSERT INTO augment_versions (
          augment_id, snapshot_id, tier, category, availability, present_in_export,
          live_status, content_fingerprint, mechanics
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          augment.id,
          snapshotId,
          augment.tier ?? null,
          augment.category ?? null,
          augment.availability,
          augment.presentInExport ? 1 : 0,
          augment.liveStatus,
          contentFingerprint,
          mechanics ? JSON.stringify(mechanics) : null,
        ],
      );

      for (const traitId of augment.requiredTraits) {
        await db.execute(
          'INSERT OR IGNORE INTO augment_required_traits (augment_id, snapshot_id, trait_id) VALUES ($1, $2, $3)',
          [augment.id, snapshotId, traitId],
        );
      }
    }

    // 6. Atomically update active knowledge pointer within the exact same transaction
    if (options?.activate !== false) {
      await db.execute(
        `INSERT INTO active_knowledge_snapshots (kind, snapshot_id, activated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(kind) DO UPDATE SET snapshot_id = excluded.snapshot_id, activated_at = excluded.activated_at`,
        ['static', snapshotId, now],
      );
    }

    await db.execute('COMMIT');
    return { snapshotId, created: true, contentHash };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

export async function importCuratedPlaybooks(
  db: SqlDatabase,
  playbooks: Playbook[],
  staticSnapshotId: string,
  options?: ImportOptions & {
    reviewedAt?: string;
    patch?: string;
    set?: number;
  },
): Promise<ImportResult> {
  const contentHash = familyDefinitionsFingerprint(playbooks);
  const snapshotId = `playbooks:${contentHash}`;

  const existing = await db.select<{ snapshot_id: string }>(
    'SELECT snapshot_id FROM source_snapshots WHERE source_id = $1 AND content_hash = $2',
    ['curated-playbooks', contentHash],
  );
  if (existing.length > 0) {
    if (options?.activate !== false) {
      await activateKnowledgeSnapshot(db, 'curated', existing[0].snapshot_id);
    }
    return { snapshotId: existing[0].snapshot_id, created: false, contentHash };
  }

  const now = new Date().toISOString();
  const setNumber = options?.set ?? playbooks[0]?.set ?? 18;
  const patch = options?.patch ?? playbooks[0]?.patch ?? '18.1';
  const reviewedAt =
    options?.reviewedAt ?? playbooks[0]?.provenance.fetchedAt ?? new Date().toISOString();

  await db.execute('BEGIN TRANSACTION');
  try {
    await db.execute(
      'INSERT OR IGNORE INTO knowledge_sources (source_id, name, source_type, base_url, created_at) VALUES ($1, $2, $3, $4, $5)',
      ['curated-playbooks', 'Curated Playbooks', 'curated-file', 'data/playbooks', now],
    );

    await db.execute(
      `INSERT INTO source_snapshots (
        snapshot_id, source_id, source_type, set_number, balance_patch, hotfix,
        retrieved_at, published_at, source_version, schema_version, content_hash,
        provenance_status, parity_status, source_uri, notes, raw_reference, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        snapshotId,
        'curated-playbooks',
        'curated-file',
        setNumber,
        patch,
        null,
        reviewedAt,
        null,
        `${setNumber}.${patch}`,
        1,
        contentHash,
        'curated',
        'unverified',
        'data/playbooks/set18.json',
        'Human-curated strategy playbooks',
        options?.rawReference ?? 'data/playbooks/set18.json',
        JSON.stringify({ playbookCount: playbooks.length, staticSnapshotId }),
        now,
      ],
    );

    for (const playbook of playbooks) {
      await db.execute(
        'INSERT OR IGNORE INTO comps (id, name, source_kind, created_at) VALUES ($1, $2, $3, $4)',
        [playbook.id, playbook.title, 'curated', now],
      );

      const contentFingerprint = stableFingerprint(playbook);
      const playSignals = playbook.playSignals.value
        ? JSON.stringify(playbook.playSignals.value)
        : null;
      const avoidSignals = playbook.avoidSignals.value
        ? JSON.stringify(playbook.avoidSignals.value)
        : null;

      await db.execute(
        `INSERT INTO comp_versions (
          comp_id, snapshot_id, title, subtitle, hero_id, style,
          evidence_label, target_level, level_plan, play_signals, avoid_signals,
          content_fingerprint, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          playbook.id,
          snapshotId,
          playbook.title,
          playbook.subtitle,
          playbook.hero,
          playbook.features.style ?? null,
          playbook.evidence,
          playbook.target.targetLevel,
          playbook.levelPlan.value ?? null,
          playSignals,
          avoidSignals,
          contentFingerprint,
          JSON.stringify({
            stages: playbook.stages,
            decisionMap: playbook.decisionMap,
            augments: playbook.augments,
            components: playbook.components,
            features: playbook.features,
            strategy: playbook.strategy,
            replacements: playbook.replacements,
            variants: playbook.variants,
            family: playbook.family,
            provenance: playbook.provenance,
            roles: playbook.roles,
            planner: playbook.planner,
            sampleSize: playbook.sampleSize,
          }),
        ],
      );

      for (const unit of playbook.target.units) {
        const role = playbook.roles.find((r) => r.championId === unit.championId)?.role ?? null;
        const slot =
          unit.slot ?? (playbook.family.core.includes(unit.championId) ? 'core' : 'flex');
        await db.execute(
          `INSERT OR IGNORE INTO comp_units (
            comp_id, snapshot_id, champion_id, slot, role, stage
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [playbook.id, snapshotId, unit.championId, slot, role, 'final'],
        );
      }

      for (const stage of playbook.stages) {
        if (stage.stage !== 'final' && stage.board.value?.units) {
          for (const unit of stage.board.value.units) {
            const slot = unit.slot ?? 'flex';
            await db.execute(
              `INSERT OR IGNORE INTO comp_units (
                comp_id, snapshot_id, champion_id, slot, role, stage
              ) VALUES ($1, $2, $3, $4, NULL, $5)`,
              [playbook.id, snapshotId, unit.championId, slot, stage.stage],
            );
          }
        }
      }

      for (const pkg of playbook.items) {
        for (let pIdx = 0; pIdx < pkg.priorities.length; pIdx++) {
          await db.execute(
            `INSERT OR IGNORE INTO comp_item_packages (
              comp_id, snapshot_id, holder_id, item_id, priority_order
            ) VALUES ($1, $2, $3, $4, $5)`,
            [playbook.id, snapshotId, pkg.holder, pkg.priorities[pIdx], pIdx],
          );
        }
      }
    }

    if (options?.activate !== false) {
      await db.execute(
        `INSERT INTO active_knowledge_snapshots (kind, snapshot_id, activated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(kind) DO UPDATE SET snapshot_id = excluded.snapshot_id, activated_at = excluded.activated_at`,
        ['curated', snapshotId, now],
      );
    }

    await db.execute('COMMIT');
    return { snapshotId, created: true, contentHash };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

export async function importMetaTFTExternal(
  db: SqlDatabase,
  snapshot: ExternalSnapshot,
  staticData: StaticData,
  options?: ImportOptions,
): Promise<ImportResult> {
  const validated = validateExternal(snapshot, staticData);
  const contentHash = validated.manifest.contentHash;
  const snapshotId = `metatft:${contentHash}`;

  const existing = await db.select<{ snapshot_id: string }>(
    'SELECT snapshot_id FROM source_snapshots WHERE source_id = $1 AND content_hash = $2',
    ['metatft', contentHash],
  );
  if (existing.length > 0) {
    if (options?.activate !== false) {
      await activateKnowledgeSnapshot(db, 'external-meta', existing[0].snapshot_id);
    }
    return { snapshotId: existing[0].snapshot_id, created: false, contentHash };
  }

  const now = new Date().toISOString();

  await db.execute('BEGIN TRANSACTION');
  try {
    await db.execute(
      'INSERT OR IGNORE INTO knowledge_sources (source_id, name, source_type, base_url, created_at) VALUES ($1, $2, $3, $4, $5)',
      ['metatft', 'MetaTFT', 'external-scrape', 'https://www.metatft.com', now],
    );

    await db.execute(
      `INSERT INTO source_snapshots (
        snapshot_id, source_id, source_type, set_number, balance_patch, hotfix,
        retrieved_at, published_at, source_version, schema_version, content_hash,
        provenance_status, parity_status, source_uri, notes, raw_reference, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        snapshotId,
        'metatft',
        'external-scrape',
        validated.manifest.scope.set,
        validated.manifest.scope.patch,
        validated.manifest.scope.hotfix,
        validated.manifest.retrievedAt,
        validated.manifest.providerUpdated,
        validated.manifest.collectorVersion,
        validated.manifest.schemaVersion,
        contentHash,
        'measured',
        'unverified',
        validated.manifest.sourceUrls[0] ?? 'https://www.metatft.com/comps',
        validated.manifest.warnings.join('; '),
        options?.rawReference ?? null,
        JSON.stringify({
          compCount: validated.comps.length,
          population: validated.manifest.population,
        }),
        now,
      ],
    );

    // Ensure base champions and items exist for foreign keys
    for (const c of staticData.champions) {
      await db.execute(
        'INSERT OR IGNORE INTO champions (id, name, created_at) VALUES ($1, $2, $3)',
        [c.id, c.name, now],
      );
    }
    for (const i of staticData.items) {
      await db.execute('INSERT OR IGNORE INTO items (id, name, created_at) VALUES ($1, $2, $3)', [
        i.id,
        i.name,
        now,
      ]);
    }

    await db.execute(
      `INSERT INTO meta_snapshots (
        snapshot_id, provider, set_number, patch, hotfix, rank_bracket,
        region, window, queue, sample_size, retrieved_at, content_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        snapshotId,
        'MetaTFT',
        validated.manifest.scope.set,
        validated.manifest.scope.patch,
        validated.manifest.scope.hotfix,
        validated.manifest.scope.rank,
        validated.manifest.scope.region,
        validated.manifest.scope.window,
        validated.manifest.scope.queue,
        validated.manifest.population,
        validated.manifest.retrievedAt,
        contentHash,
      ],
    );

    for (const comp of validated.comps) {
      const compId = `external-meta:${comp.id}`;
      await db.execute(
        'INSERT OR IGNORE INTO comps (id, name, source_kind, created_at) VALUES ($1, $2, $3, $4)',
        [compId, comp.name, 'external-meta', now],
      );

      const contentFingerprint = stableFingerprint(comp);
      await db.execute(
        `INSERT INTO comp_versions (
          comp_id, snapshot_id, title, subtitle, hero_id, style,
          evidence_label, target_level, level_plan, play_signals, avoid_signals,
          content_fingerprint, payload
        ) VALUES ($1, $2, $3, $4, NULL, $5, 'Emerging', $6, NULL, NULL, NULL, $7, $8)`,
        [
          compId,
          snapshotId,
          comp.name,
          comp.tier ? `Tier ${comp.tier}` : null,
          comp.style,
          comp.units.length,
          contentFingerprint,
          JSON.stringify({
            tier: comp.tier,
            conditions: comp.conditions,
            packages: comp.packages,
            positions: comp.positions,
          }),
        ],
      );

      for (const unit of comp.units) {
        const slot = comp.core.includes(unit) ? 'core' : 'flex';
        await db.execute(
          `INSERT OR IGNORE INTO comp_units (
            comp_id, snapshot_id, champion_id, slot, role, stage
          ) VALUES ($1, $2, $3, $4, NULL, 'final')`,
          [compId, snapshotId, unit, slot],
        );
      }

      for (const pkg of comp.packages) {
        for (let pIdx = 0; pIdx < pkg.items.length; pIdx++) {
          await db.execute(
            `INSERT OR IGNORE INTO comp_item_packages (
              comp_id, snapshot_id, holder_id, item_id, priority_order
            ) VALUES ($1, $2, $3, $4, $5)`,
            [compId, snapshotId, pkg.holder, pkg.items[pIdx], pIdx],
          );
        }
      }

      const pickRate = comp.stats.playRate ?? (comp.pickRate ? comp.pickRate.value / 100 : null);
      await db.execute(
        `INSERT INTO comp_meta_observations (
          observation_id, snapshot_id, comp_id, provider_comp_id, sample_size,
          average_placement, top4_rate, win_rate, pick_rate, raw_stats, positions,
          item_packages, observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          `${contentHash}:${comp.id}`,
          snapshotId,
          compId,
          comp.id,
          comp.stats.sample,
          comp.stats.average,
          comp.stats.top4,
          comp.stats.win,
          pickRate,
          JSON.stringify(comp.stats),
          JSON.stringify(comp.positions),
          JSON.stringify(comp.packages),
          validated.manifest.retrievedAt,
        ],
      );
    }

    if (options?.activate !== false) {
      await db.execute(
        `INSERT INTO active_knowledge_snapshots (kind, snapshot_id, activated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(kind) DO UPDATE SET snapshot_id = excluded.snapshot_id, activated_at = excluded.activated_at`,
        ['external-meta', snapshotId, now],
      );
    }

    await db.execute('COMMIT');
    return { snapshotId, created: true, contentHash };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

export async function activateKnowledgeSnapshot(
  db: SqlDatabase,
  kind: 'static' | 'curated' | 'external-meta',
  snapshotId: string,
): Promise<void> {
  const snapshots = await db.select<{ snapshot_id: string }>(
    'SELECT snapshot_id FROM source_snapshots WHERE snapshot_id = $1',
    [snapshotId],
  );
  if (!snapshots.length) {
    throw new Error(`Snapshot ${snapshotId} does not exist; cannot activate.`);
  }

  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO active_knowledge_snapshots (kind, snapshot_id, activated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(kind) DO UPDATE SET snapshot_id = excluded.snapshot_id, activated_at = excluded.activated_at`,
    [kind, snapshotId, now],
  );
}
