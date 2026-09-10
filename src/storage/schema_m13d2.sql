-- Migration 7: Personal Match Manual Comp Corrections
CREATE TABLE IF NOT EXISTS personal_match_corrections (
  match_id TEXT PRIMARY KEY,
  canonical_comp_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('canonical', 'unclassified', 'cleared')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_corrections_match
  ON personal_match_corrections(match_id);
