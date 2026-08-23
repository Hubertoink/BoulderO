ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility TEXT NOT NULL DEFAULT 'friends';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_image TEXT;

ALTER TABLE users ALTER COLUMN profile_visibility SET DEFAULT 'friends';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_profile_visibility_check;
ALTER TABLE users ADD CONSTRAINT users_profile_visibility_check
  CHECK (profile_visibility IN ('public', 'friends', 'private'));
