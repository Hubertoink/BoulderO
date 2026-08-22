ALTER TABLE media DROP CONSTRAINT IF EXISTS media_byte_size_check;
ALTER TABLE media
  ADD CONSTRAINT media_byte_size_check
  CHECK (byte_size > 0 AND byte_size <= 52428800);
