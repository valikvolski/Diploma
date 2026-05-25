-- Время последнего изменения записи (для ленты активности: отмена/завершение ≠ слот приёма)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE appointments
SET updated_at = COALESCE(updated_at, created_at::timestamptz, NOW());

ALTER TABLE appointments ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE appointments ALTER COLUMN updated_at SET NOT NULL;
