CREATE TABLE IF NOT EXISTS knowledge_sources (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('static-cdn', 'curated-file', 'external-scrape', 'derived-archive')),
  base_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(source_id),
  source_type TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  balance_patch TEXT,
  hotfix TEXT,
  retrieved_at TEXT NOT NULL,
  published_at TEXT,
  source_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  provenance_status TEXT NOT NULL,
  parity_status TEXT NOT NULL,
  source_uri TEXT,
  notes TEXT,
  raw_reference TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS active_knowledge_snapshots (
  kind TEXT PRIMARY KEY CHECK (kind IN ('static', 'curated', 'external-meta')),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  activated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS champions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS champion_versions (
  champion_id TEXT NOT NULL REFERENCES champions(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  cost INTEGER NOT NULL,
  role TEXT,
  shop_status TEXT NOT NULL CHECK (shop_status IN ('pool', 'runtime-variant', 'placeholder')),
  board_eligible INTEGER NOT NULL CHECK (board_eligible IN (0, 1)),
  icon TEXT,
  splash TEXT,
  content_fingerprint TEXT NOT NULL,
  mechanics TEXT,
  PRIMARY KEY (champion_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS traits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS champion_traits (
  champion_id TEXT NOT NULL REFERENCES champions(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  trait_id TEXT NOT NULL REFERENCES traits(id),
  PRIMARY KEY (champion_id, snapshot_id, trait_id)
);

CREATE TABLE IF NOT EXISTS trait_versions (
  trait_id TEXT NOT NULL REFERENCES traits(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  icon TEXT,
  counting TEXT NOT NULL,
  availability TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  mechanics TEXT,
  PRIMARY KEY (trait_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS trait_breakpoints (
  trait_id TEXT NOT NULL REFERENCES traits(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  min_units INTEGER NOT NULL,
  max_units INTEGER,
  effects TEXT,
  PRIMARY KEY (trait_id, snapshot_id, min_units)
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_versions (
  item_id TEXT NOT NULL REFERENCES items(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  category TEXT NOT NULL CHECK (category IN ('component', 'combined', 'other')),
  icon TEXT,
  availability TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  mechanics TEXT,
  PRIMARY KEY (item_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS item_components (
  item_id TEXT NOT NULL REFERENCES items(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  component_id TEXT NOT NULL REFERENCES items(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (item_id, snapshot_id, position)
);

CREATE TABLE IF NOT EXISTS augments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS augment_versions (
  augment_id TEXT NOT NULL REFERENCES augments(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  tier TEXT,
  category TEXT,
  availability TEXT NOT NULL,
  present_in_export INTEGER NOT NULL CHECK (present_in_export IN (0, 1)),
  live_status TEXT NOT NULL CHECK (live_status IN ('enabled', 'disabled', 'unverified')),
  content_fingerprint TEXT NOT NULL,
  mechanics TEXT,
  PRIMARY KEY (augment_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS augment_required_traits (
  augment_id TEXT NOT NULL REFERENCES augments(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  trait_id TEXT NOT NULL REFERENCES traits(id),
  PRIMARY KEY (augment_id, snapshot_id, trait_id)
);

CREATE TABLE IF NOT EXISTS comps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('curated', 'external-meta', 'discovered')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comp_versions (
  comp_id TEXT NOT NULL REFERENCES comps(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  title TEXT NOT NULL,
  subtitle TEXT,
  hero_id TEXT REFERENCES champions(id),
  style TEXT,
  evidence_label TEXT NOT NULL CHECK (evidence_label IN ('Proven', 'Variant', 'Emerging', 'Experimental')),
  target_level INTEGER,
  level_plan TEXT,
  play_signals TEXT,
  avoid_signals TEXT,
  content_fingerprint TEXT NOT NULL,
  payload TEXT,
  PRIMARY KEY (comp_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS comp_units (
  comp_id TEXT NOT NULL REFERENCES comps(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  champion_id TEXT NOT NULL REFERENCES champions(id),
  slot TEXT NOT NULL CHECK (slot IN ('core', 'flex', 'temporary')),
  role TEXT CHECK (role IN ('carry', 'tank') OR role IS NULL),
  stage TEXT NOT NULL DEFAULT 'final' CHECK (stage IN ('early', 'mid', 'stabilization', 'final')),
  PRIMARY KEY (comp_id, snapshot_id, stage, champion_id)
);

CREATE TABLE IF NOT EXISTS comp_item_packages (
  comp_id TEXT NOT NULL REFERENCES comps(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
  holder_id TEXT NOT NULL REFERENCES champions(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  priority_order INTEGER NOT NULL,
  PRIMARY KEY (comp_id, snapshot_id, holder_id, priority_order)
);

CREATE TABLE IF NOT EXISTS meta_snapshots (
  snapshot_id TEXT PRIMARY KEY REFERENCES source_snapshots(snapshot_id),
  provider TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  patch TEXT,
  hotfix TEXT,
  rank_bracket TEXT,
  region TEXT,
  window TEXT,
  queue INTEGER,
  sample_size INTEGER,
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comp_meta_observations (
  observation_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES meta_snapshots(snapshot_id),
  comp_id TEXT NOT NULL REFERENCES comps(id),
  provider_comp_id TEXT NOT NULL,
  sample_size INTEGER,
  average_placement REAL,
  top4_rate REAL,
  win_rate REAL,
  pick_rate REAL,
  raw_stats TEXT,
  positions TEXT,
  item_packages TEXT,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_snapshots_source
  ON source_snapshots(source_id, set_number);

CREATE INDEX IF NOT EXISTS idx_champion_versions_snapshot
  ON champion_versions(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_trait_versions_snapshot
  ON trait_versions(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_item_versions_snapshot
  ON item_versions(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_augment_versions_snapshot
  ON augment_versions(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_comp_versions_snapshot
  ON comp_versions(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_comp_meta_obs_comp
  ON comp_meta_observations(comp_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_comp_meta_obs_snapshot
  ON comp_meta_observations(snapshot_id);
