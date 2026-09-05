CREATE TABLE IF NOT EXISTS riot_accounts (
  puuid TEXT PRIMARY KEY,
  game_name TEXT NOT NULL,
  tag_line TEXT NOT NULL,
  platform TEXT NOT NULL,
  regional_route TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS riot_accounts_identity
  ON riot_accounts(game_name COLLATE NOCASE, tag_line COLLATE NOCASE, platform);

CREATE TABLE IF NOT EXISTS riot_match_indexes (
  puuid TEXT NOT NULL,
  regional_route TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  requested_count INTEGER NOT NULL,
  match_ids TEXT NOT NULL,
  exhausted INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (puuid, regional_route)
);

CREATE TABLE IF NOT EXISTS riot_completed_matches (
  match_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  patch TEXT NOT NULL,
  game_timestamp TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS riot_opponent_profiles (
  puuid TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  patch TEXT NOT NULL,
  derivation_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (puuid, set_number, patch, derivation_version)
);

CREATE TABLE IF NOT EXISTS riot_scan_snapshots (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  requested_opponents INTEGER NOT NULL,
  target_games INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

