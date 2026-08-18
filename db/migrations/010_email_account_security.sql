ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Bereits bestehende Passwort-Konten stammen aus der Phase vor der
-- E-Mail-Bestätigung. Sie bleiben nutzbar; neue Konten werden erst nach
-- Klick auf den Bestätigungslink freigeschaltet.
UPDATE users
   SET email_verified_at = COALESCE("emailVerified", NOW())
 WHERE password_hash IS NOT NULL
   AND email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS account_action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS account_action_tokens_lookup_idx
  ON account_action_tokens (token_hash, purpose)
  WHERE used_at IS NULL;
