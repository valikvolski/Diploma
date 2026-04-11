-- Google OIDC profile cache + external avatar URL (used when no uploaded avatar_path)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_picture_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_locale TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email_verified BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
