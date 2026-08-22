CREATE TABLE IF NOT EXISTS planned_visit_dismissals (
  planned_visit_id UUID NOT NULL REFERENCES planned_visits(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (planned_visit_id, user_id)
);

CREATE INDEX IF NOT EXISTS planned_visit_dismissals_user_idx
  ON planned_visit_dismissals (user_id, dismissed_at DESC);
