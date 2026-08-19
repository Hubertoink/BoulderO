ALTER TABLE planned_visits
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '' CHECK (char_length(cancel_reason) <= 1000),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('plan_rsvp', 'plan_updated', 'plan_cancelled', 'plan_reminder')),
  planned_visit_id UUID REFERENCES planned_visits(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS planned_visit_rsvps_user_idx
  ON planned_visit_rsvps (user_id, response, planned_visit_id);
