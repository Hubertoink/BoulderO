CREATE INDEX IF NOT EXISTS follows_followed_status_idx ON follows (followed_id, status);
CREATE INDEX IF NOT EXISTS follows_follower_status_idx ON follows (follower_id, status);
CREATE INDEX IF NOT EXISTS journal_entries_visibility_created_idx ON journal_entries (visibility, created_at DESC);
