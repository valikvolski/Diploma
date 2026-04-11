-- Одно напоминание по email за сутки до приёма (см. scripts/send-appointment-reminders.js)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_email_sent_at TIMESTAMPTZ;
