-- Migration 6: Personal Match Observations and Account-First Ledger
CREATE TABLE IF NOT EXISTS personal_match_observations (
  match_id TEXT PRIMARY KEY,
  account_puuid TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  patch TEXT,
  riot_game_version TEXT,
  game_timestamp TEXT NOT NULL,
  placement INTEGER NOT NULL,
  level INTEGER NOT NULL,
  queue_id INTEGER,
  game_type TEXT,
  classified_comp_id TEXT,
  classification_state TEXT NOT NULL CHECK (classification_state IN ('classified', 'ambiguous', 'unclassified', 'incompatible-set')),
  classification_confidence REAL NOT NULL,
  classification_model_version TEXT NOT NULL,
  final_board_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_obs_account_time
  ON personal_match_observations(account_puuid, game_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_personal_obs_set
  ON personal_match_observations(set_number, game_timestamp DESC);
