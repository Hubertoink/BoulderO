CREATE TABLE IF NOT EXISTS friend_suggestion_dismissals (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggested_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, suggested_user_id),
  CHECK (user_id <> suggested_user_id)
);

CREATE INDEX IF NOT EXISTS friend_suggestion_dismissals_user_idx
  ON friend_suggestion_dismissals (user_id, dismissed_at DESC);
