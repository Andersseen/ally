CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  score INTEGER,
  unique_findings INTEGER,
  engines_succeeded INTEGER,
  engines_configured INTEGER,
  artifact_key TEXT
);

CREATE INDEX IF NOT EXISTS audits_status_created_at_idx
  ON audits (status, created_at);
