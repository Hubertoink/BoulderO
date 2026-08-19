CREATE INDEX IF NOT EXISTS auth_audit_events_user_login_idx
  ON auth_audit_events (user_id, created_at DESC)
  WHERE event_type = 'login';
