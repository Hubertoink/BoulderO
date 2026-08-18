CREATE TABLE IF NOT EXISTS spot_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  district TEXT CHECK (district IS NULL OR char_length(district) <= 120),
  address TEXT NOT NULL CHECK (char_length(address) BETWEEN 5 AND 300),
  website TEXT CHECK (website IS NULL OR char_length(website) <= 500),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_spot_id UUID REFERENCES spots(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS spot_suggestions_pending_idx
  ON spot_suggestions (status, created_at DESC)
  WHERE status = 'pending';
