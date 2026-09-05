CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS static_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL, source_version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (puuid TEXT PRIMARY KEY, identity TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS completed_matches (match_id TEXT PRIMARY KEY, payload TEXT NOT NULL, set_number INTEGER NOT NULL, patch TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recent_match_indexes (puuid TEXT PRIMARY KEY, match_ids TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS opponent_profiles (puuid TEXT NOT NULL, derivation_version TEXT NOT NULL, payload TEXT NOT NULL, generated_at TEXT NOT NULL, PRIMARY KEY (puuid, derivation_version));
CREATE TABLE IF NOT EXISTS personal_profiles (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS selected_plans (id TEXT PRIMARY KEY, payload TEXT NOT NULL, match_id TEXT);
CREATE TABLE IF NOT EXISTS recommendation_snapshots (id TEXT PRIMARY KEY, payload TEXT NOT NULL, generated_at TEXT NOT NULL);
