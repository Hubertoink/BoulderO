CREATE TABLE IF NOT EXISTS community_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  city TEXT NOT NULL DEFAULT '' CHECK (char_length(city) <= 120),
  image TEXT,
  access_mode TEXT NOT NULL DEFAULT 'request' CHECK (access_mode IN ('open', 'request', 'private')),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_groups_discover_idx
  ON community_groups (access_mode, is_archived, created_at DESC);

CREATE TABLE IF NOT EXISTS community_group_spots (
  group_id UUID NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  spot_id UUID NOT NULL REFERENCES spots(id) ON DELETE RESTRICT,
  position SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
  PRIMARY KEY (group_id, spot_id)
);

CREATE TABLE IF NOT EXISTS community_group_members (
  group_id UUID NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'requested', 'invited', 'banned', 'left')),
  notification_level TEXT NOT NULL DEFAULT 'important' CHECK (notification_level IN ('all', 'important', 'muted')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  request_note TEXT NOT NULL DEFAULT '' CHECK (char_length(request_note) <= 500),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_group_members_user_idx
  ON community_group_members (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS community_group_members_group_idx
  ON community_group_members (group_id, status, role, joined_at);

CREATE TABLE IF NOT EXISTS community_group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS community_group_messages_group_idx
  ON community_group_messages (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_group_message_reads (
  group_id UUID NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_group_event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  repeat_until DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE planned_visits
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES community_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS group_event_series_id UUID REFERENCES community_group_event_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capacity INTEGER CHECK (capacity IS NULL OR capacity > 0);

CREATE INDEX IF NOT EXISTS planned_visits_group_idx
  ON planned_visits (group_id, status, starts_at ASC)
  WHERE group_id IS NOT NULL;

ALTER TABLE planned_visit_rsvps
  DROP CONSTRAINT IF EXISTS planned_visit_rsvps_response_check;
ALTER TABLE planned_visit_rsvps
  ADD CONSTRAINT planned_visit_rsvps_response_check CHECK (response IN ('going', 'interested', 'waitlisted'));

CREATE TABLE IF NOT EXISTS community_group_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (char_length(trim(question)) BETWEEN 3 AND 240),
  kind TEXT NOT NULL CHECK (kind IN ('spot', 'date', 'general')),
  closes_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_group_polls_group_idx
  ON community_group_polls (group_id, closed_at, created_at DESC);

CREATE TABLE IF NOT EXISTS community_group_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES community_group_polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 160),
  spot_id UUID REFERENCES spots(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ,
  position SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS community_group_poll_options_poll_idx
  ON community_group_poll_options (poll_id, position);

CREATE TABLE IF NOT EXISTS community_group_poll_votes (
  poll_id UUID NOT NULL REFERENCES community_group_polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES community_group_poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, user_id)
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'direct_message', 'friend_request', 'friend_accepted', 'entry_comment', 'entry_like',
  'plan_rsvp', 'plan_updated', 'plan_cancelled', 'plan_reminder',
  'group_invitation', 'group_join_request', 'group_joined', 'group_message',
  'group_event_created', 'group_event_updated', 'group_event_cancelled',
  'group_poll_created', 'group_poll_closed'
));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK (category IN (
  'messages', 'friendships', 'comments', 'reactions', 'plans', 'reminders', 'groups'
));

ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check CHECK (category IN (
  'messages', 'friendships', 'comments', 'reactions', 'plans', 'reminders', 'groups'
));

INSERT INTO notification_preferences (user_id, category, in_app_enabled, push_enabled)
SELECT id, 'groups', TRUE, TRUE FROM users
ON CONFLICT (user_id, category) DO NOTHING;
