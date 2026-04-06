-- Создаём администратора (email: admin@clinic.by, пароль: Admin123)
-- bcrypt hash для 'Admin123' (10 раундов)
INSERT INTO users (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked)
VALUES (
  'admin@clinic.by',
  '$2b$10$Wd9FQ689hqhkNZrJoFURXO9ppI8XL8YO1JGzWHFC0L7EQjcmI9l6K',
  'Администратор',
  'Системный',
  '',
  '',
  'admin',
  false
)
ON CONFLICT (email) DO NOTHING;
