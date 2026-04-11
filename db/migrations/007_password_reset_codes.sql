-- Коды сброса пароля (хранится только HMAC-хеш, не открытый код)
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_expires
  ON password_reset_codes (user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_created
  ON password_reset_codes (user_id, created_at DESC);
