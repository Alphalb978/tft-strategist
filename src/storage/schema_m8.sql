CREATE TABLE IF NOT EXISTS plan_sessions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('active', 'ended')),
  locked_at TEXT NOT NULL,
  ended_at TEXT,
  payload TEXT NOT NULL,
  match_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_plan_session
  ON plan_sessions(state)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS plan_sessions_reconciliation_window
  ON plan_sessions(locked_at, ended_at, match_id);

CREATE TRIGGER IF NOT EXISTS plan_session_replace_active
BEFORE INSERT ON plan_sessions
WHEN NEW.state = 'active'
  AND json_extract(NEW.payload, '$.replacesSessionId') IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM plan_sessions
    WHERE id = json_extract(NEW.payload, '$.replacesSessionId')
      AND state = 'active'
  ) THEN RAISE(ABORT, 'active plan-session predecessor is missing') END;
  UPDATE plan_sessions
  SET state = 'ended',
      ended_at = NEW.locked_at,
      payload = json_set(
        payload,
        '$.state', 'ended',
        '$.endedAt', NEW.locked_at,
        '$.endReason', 'replaced',
        '$.replacedBySessionId', NEW.id
      )
  WHERE id = json_extract(NEW.payload, '$.replacesSessionId')
    AND state = 'active';
END;

CREATE TRIGGER IF NOT EXISTS plan_session_snapshot_is_immutable
BEFORE UPDATE OF payload ON plan_sessions
WHEN json_extract(OLD.payload, '$.snapshotFingerprint') IS NOT
       json_extract(NEW.payload, '$.snapshotFingerprint')
  OR json_extract(OLD.payload, '$.snapshot') IS NOT
       json_extract(NEW.payload, '$.snapshot')
BEGIN
  SELECT RAISE(ABORT, 'locked plan-session snapshot is immutable');
END;

CREATE TRIGGER IF NOT EXISTS plan_session_cannot_reactivate
BEFORE UPDATE OF state ON plan_sessions
WHEN OLD.state = 'ended' AND NEW.state = 'active'
BEGIN
  SELECT RAISE(ABORT, 'ended plan session cannot be reactivated');
END;
