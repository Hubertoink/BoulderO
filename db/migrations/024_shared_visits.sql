CREATE TABLE IF NOT EXISTS visit_participants (
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (visit_id, user_id)
);

CREATE INDEX IF NOT EXISTS visit_participants_user_status_idx
  ON visit_participants (user_id, status, visit_id);
CREATE INDEX IF NOT EXISTS visit_participants_visit_status_idx
  ON visit_participants (visit_id, status, requested_at);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'direct_message', 'friend_request', 'friend_accepted', 'entry_comment', 'entry_like',
  'plan_created', 'plan_rsvp', 'plan_updated', 'plan_cancelled', 'plan_reminder',
  'group_invitation', 'group_join_request', 'group_joined', 'group_message',
  'group_event_created', 'group_event_updated', 'group_event_cancelled',
  'group_poll_created', 'group_poll_closed',
  'visit_participant_request', 'visit_participant_approved', 'visit_participant_declined'
));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK (category IN (
  'messages', 'friendships', 'comments', 'reactions', 'plans', 'reminders', 'groups', 'visits'
));

ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check CHECK (category IN (
  'messages', 'friendships', 'comments', 'reactions', 'plans', 'reminders', 'groups', 'visits'
));

INSERT INTO notification_preferences (user_id, category, in_app_enabled, push_enabled)
SELECT id, 'visits', TRUE, TRUE FROM users
ON CONFLICT (user_id, category) DO NOTHING;
