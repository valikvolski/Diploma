-- Расширяем schedule_exceptions для хранения периодов и изменённого времени.

ALTER TABLE schedule_exceptions
  ADD COLUMN IF NOT EXISTS date_from DATE,
  ADD COLUMN IF NOT EXISTS date_to DATE,
  ADD COLUMN IF NOT EXISTS is_day_off BOOLEAN,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time TIME;

-- Бэкоф для старых записей (однодневные).
UPDATE schedule_exceptions
SET
  date_from = COALESCE(date_from, exception_date),
  date_to = COALESCE(date_to, exception_date),
  is_day_off = COALESCE(is_day_off, TRUE);

ALTER TABLE schedule_exceptions
  ALTER COLUMN date_from SET NOT NULL,
  ALTER COLUMN date_to SET NOT NULL,
  ALTER COLUMN is_day_off SET NOT NULL;

ALTER TABLE schedule_exceptions
  ALTER COLUMN is_day_off SET DEFAULT TRUE;

ALTER TABLE schedule_exceptions
  DROP CONSTRAINT IF EXISTS schedule_exceptions_doctor_id_exception_date_key;

ALTER TABLE schedule_exceptions
  DROP CONSTRAINT IF EXISTS schedule_exceptions_date_range_check;

ALTER TABLE schedule_exceptions
  ADD CONSTRAINT schedule_exceptions_date_range_check
  CHECK (date_to >= date_from);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_doctor_period
  ON schedule_exceptions (doctor_id, date_from, date_to);

