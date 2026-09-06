CREATE TABLE IF NOT EXISTS postgame_reconciliations (
  chain_id TEXT PRIMARY KEY,
  terminal_session_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('unmatched','candidate','matched','ambiguous','rejected')),
  match_id TEXT UNIQUE,
  payload TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS postgame_reviews (
  chain_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  derivation_fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS postgame_reviews_created_at
  ON postgame_reviews(created_at DESC);
