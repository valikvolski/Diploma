-- ══════════════════════════════════════════════════════════════
-- Профили пациентов (дополнительные данные)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS patient_profiles (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  birth_date    DATE,
  gender        VARCHAR(10) CHECK (gender IN ('male','female') OR gender IS NULL),
  address       TEXT,
  policy_number VARCHAR(50),
  UNIQUE(user_id)
);

-- Создаём профили для существующих пациентов
INSERT INTO patient_profiles (user_id)
SELECT id FROM users WHERE role = 'patient'
ON CONFLICT (user_id) DO NOTHING;
