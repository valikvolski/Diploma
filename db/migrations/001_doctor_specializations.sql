-- ═══════════════════════════════════════════════════════════════════════════
-- 001: doctor_specializations (many-to-many) + compat_group on specializations
--
-- Apply with psql (from project root):
--   psql -U postgres -d clinic_db -f db/migrations/001_doctor_specializations.sql
--
-- Or: npm run migrate:001   (uses .env DB_* — no psql required)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE specializations
  ADD COLUMN IF NOT EXISTS compat_group VARCHAR(32) NOT NULL DEFAULT 'therapy';

-- Группы совместимости задаются в db/migrations/002_specializations_seed.sql (поле compat_group при вставке)

CREATE TABLE IF NOT EXISTS doctor_specializations (
  doctor_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialization_id INTEGER NOT NULL REFERENCES specializations(id),
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doctor_user_id, specialization_id)
);

ALTER TABLE doctor_specializations
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS doctor_specializations_one_primary
  ON doctor_specializations (doctor_user_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_doctor_specializations_spec
  ON doctor_specializations (specialization_id);

-- Backfill from doctor_profiles (one row per legacy specialization, marked primary)
INSERT INTO doctor_specializations (doctor_user_id, specialization_id, is_primary)
SELECT dp.user_id, dp.specialization_id, TRUE
FROM doctor_profiles dp
WHERE dp.specialization_id IS NOT NULL
ON CONFLICT (doctor_user_id, specialization_id) DO NOTHING;

-- Exactly one primary per doctor: deterministic MIN(specialization_id)
UPDATE doctor_specializations ds
SET is_primary = FALSE;

UPDATE doctor_specializations ds
SET is_primary = TRUE
FROM (
  SELECT doctor_user_id, MIN(specialization_id) AS sid
  FROM doctor_specializations
  GROUP BY doctor_user_id
) x
WHERE ds.doctor_user_id = x.doctor_user_id
  AND ds.specialization_id = x.sid;

-- Denormalized primary on doctor_profiles matches junction
UPDATE doctor_profiles dp
SET specialization_id = sub.sid
FROM (
  SELECT doctor_user_id, specialization_id AS sid
  FROM doctor_specializations
  WHERE is_primary
) sub
WHERE dp.user_id = sub.doctor_user_id;
