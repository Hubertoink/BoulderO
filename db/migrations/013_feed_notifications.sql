CREATE TABLE IF NOT EXISTS social_feed_reads (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO social_feed_reads (user_id, last_seen_at)
SELECT id, NOW() FROM users
ON CONFLICT (user_id) DO NOTHING;
