ALTER TABLE users ALTER COLUMN profile_visibility SET DEFAULT 'friends';
-- The setting was introduced with a private fallback. Treat those pre-existing
-- values as the new default; users can still choose "Niemand" afterwards.
UPDATE users SET profile_visibility = 'friends' WHERE profile_visibility = 'private';
