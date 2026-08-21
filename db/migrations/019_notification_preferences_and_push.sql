ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'plans',
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'BoulderO',
  ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_url TEXT NOT NULL DEFAULT '/social',
  ADD COLUMN IF NOT EXISTS in_app_visible BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'direct_message',
    'friend_request',
    'friend_accepted',
    'entry_comment',
    'entry_like',
    'plan_rsvp',
    'plan_updated',
    'plan_cancelled',
    'plan_reminder'
  ));

ALTER TABLE notifications
  ADD CONSTRAINT notifications_category_check CHECK (category IN (
    'messages',
    'friendships',
    'comments',
    'reactions',
    'plans',
    'reminders'
  ));

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'messages',
    'friendships',
    'comments',
    'reactions',
    'plans',
    'reminders'
  )),
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category)
);

INSERT INTO notification_preferences (user_id, category, in_app_enabled, push_enabled)
SELECT u.id, defaults.category, defaults.in_app_enabled, defaults.push_enabled
  FROM users u
 CROSS JOIN (
   VALUES
     ('messages', TRUE, TRUE),
     ('friendships', TRUE, TRUE),
     ('comments', TRUE, TRUE),
     ('reactions', TRUE, FALSE),
     ('plans', TRUE, TRUE),
     ('reminders', TRUE, TRUE)
 ) AS defaults(category, in_app_enabled, push_enabled)
ON CONFLICT (user_id, category) DO NOTHING;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time TIMESTAMPTZ,
  user_agent TEXT NOT NULL DEFAULT '',
  content_preview_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  badge_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (notification_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_pending_idx
  ON notification_deliveries (status, available_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS notifications_plan_reminder_unique_idx
  ON notifications (user_id, planned_visit_id, type)
  WHERE type = 'plan_reminder';
