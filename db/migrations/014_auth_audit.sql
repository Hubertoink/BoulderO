CREATE TABLE IF NOT EXISTS auth_audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('registration', 'login')),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_audit_events_created_at_idx
  ON auth_audit_events (created_at DESC);
