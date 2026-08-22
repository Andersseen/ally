-- Extends the job lifecycle beyond queued/running/completed/failed and adds
-- the fields needed to debug a failed hosted audit. SQLite requires a table
-- rebuild to widen a CHECK constraint, so this migration recreates `audits`
-- rather than a series of ALTER TABLE statements.
CREATE TABLE audits_new (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'claimed', 'running', 'persisting', 'completed', 'failed', 'timed_out', 'cancelled')
  ),
  current_stage TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  runner_id TEXT,
  score INTEGER,
  score_version INTEGER,
  unique_findings INTEGER,
  raw_findings INTEGER,
  keyboard_warnings INTEGER,
  engines_succeeded INTEGER,
  engines_configured INTEGER,
  engines_failed INTEGER,
  artifact_key TEXT,
  owner_user_id TEXT,
  owner_email TEXT
);

INSERT INTO audits_new (
  id, url, status, current_stage, attempt, created_at, updated_at,
  started_at, completed_at, last_error, runner_id,
  score, score_version, unique_findings, raw_findings, keyboard_warnings,
  engines_succeeded, engines_configured, engines_failed,
  artifact_key, owner_user_id, owner_email
)
SELECT
  id, url, status, NULL, 0, created_at, updated_at,
  started_at, completed_at, error, NULL,
  score, NULL, unique_findings, NULL, NULL,
  engines_succeeded, engines_configured, NULL,
  artifact_key, owner_user_id, owner_email
FROM audits;

DROP TABLE audits;
ALTER TABLE audits_new RENAME TO audits;

CREATE INDEX IF NOT EXISTS audits_status_created_at_idx
  ON audits (status, created_at);

CREATE INDEX IF NOT EXISTS audits_owner_status_created_at_idx
  ON audits (owner_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS audits_owner_created_at_idx
  ON audits (owner_user_id, created_at);
