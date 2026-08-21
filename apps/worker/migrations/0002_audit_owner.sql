ALTER TABLE audits ADD COLUMN owner_user_id TEXT;
ALTER TABLE audits ADD COLUMN owner_email TEXT;

CREATE INDEX IF NOT EXISTS audits_owner_status_created_at_idx
  ON audits (owner_user_id, status, created_at);
