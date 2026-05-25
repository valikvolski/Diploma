-- История работы врача; experience_years в doctor_profiles считается автоматически
CREATE TABLE IF NOT EXISTS doctor_work_history (
  id                SERIAL PRIMARY KEY,
  doctor_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_name VARCHAR(200) NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT doctor_work_history_dates_check CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_doctor_work_history_doctor
  ON doctor_work_history (doctor_user_id, start_date DESC);
