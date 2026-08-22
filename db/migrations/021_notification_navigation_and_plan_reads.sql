ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'direct_message', 'friend_request', 'friend_accepted', 'entry_comment', 'entry_like',
  'plan_created', 'plan_rsvp', 'plan_updated', 'plan_cancelled', 'plan_reminder',
  'group_invitation', 'group_join_request', 'group_joined', 'group_message',
  'group_event_created', 'group_event_updated', 'group_event_cancelled',
  'group_poll_created', 'group_poll_closed'
));

ALTER TABLE planned_visits
  ADD COLUMN IF NOT EXISTS past_seen_at TIMESTAMPTZ;
