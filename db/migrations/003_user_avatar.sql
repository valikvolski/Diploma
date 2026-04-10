-- User profile photos (stored path relative to /public, e.g. uploads/avatars/...)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path VARCHAR(512);
