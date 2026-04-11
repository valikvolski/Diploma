-- Разделение кодов: сброс по «забыли пароль» и смена пароля в профиле
ALTER TABLE password_reset_codes
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'forgot_password';

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_purpose
  ON password_reset_codes (user_id, purpose, created_at DESC);
