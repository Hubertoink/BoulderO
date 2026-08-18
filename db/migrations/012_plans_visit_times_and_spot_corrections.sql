ALTER TABLE visits ADD COLUMN IF NOT EXISTS started_at TIME;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS ended_at TIME;

CREATE TABLE IF NOT EXISTS planned_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spot_id UUID NOT NULL REFERENCES spots(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  visibility TEXT NOT NULL DEFAULT 'friends' CHECK (visibility IN ('private', 'friends', 'followers', 'public')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS planned_visits_feed_idx
  ON planned_visits (status, starts_at ASC);
CREATE INDEX IF NOT EXISTS planned_visits_owner_idx
  ON planned_visits (user_id, starts_at ASC);

CREATE TABLE IF NOT EXISTS planned_visit_rsvps (
  planned_visit_id UUID NOT NULL REFERENCES planned_visits(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK (response IN ('going', 'interested')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (planned_visit_id, user_id)
);

CREATE TABLE IF NOT EXISTS spot_correction_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id UUID NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('coordinates', 'address', 'opening_hours', 'website', 'other')),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 3 AND 2000),
  suggested_latitude DOUBLE PRECISION,
  suggested_longitude DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((suggested_latitude IS NULL AND suggested_longitude IS NULL) OR (suggested_latitude IS NOT NULL AND suggested_longitude IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS spot_correction_reports_pending_idx
  ON spot_correction_reports (spot_id, created_at ASC)
  WHERE status = 'pending';
