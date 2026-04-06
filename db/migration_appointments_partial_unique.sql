-- Повторная запись на тот же слот после отмены: уникальность только для booked/completed
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_doctor_id_appointment_date_appointment_time_key;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_doctor_datetime_active_unique
  ON appointments (doctor_id, appointment_date, appointment_time)
  WHERE status IN ('booked', 'completed');
