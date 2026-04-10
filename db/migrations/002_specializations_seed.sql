-- ═══════════════════════════════════════════════════════════════════════════
-- 002: полный справочник specializations (источник правды — только БД)
-- Требует: таблица specializations, колонка compat_group (см. 001).
-- Идемпотентно: INSERT ... ON CONFLICT (name) DO NOTHING
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE specializations
  ADD COLUMN IF NOT EXISTS compat_group VARCHAR(32) NOT NULL DEFAULT 'therapy';

CREATE UNIQUE INDEX IF NOT EXISTS specializations_name_unique ON specializations (name);

INSERT INTO specializations (name, compat_group) VALUES
  ('Аллерголог-иммунолог', 'therapy'),
  ('Анестезиолог-реаниматолог', 'surgery'),
  ('Врач УЗИ', 'imaging'),
  ('Гастроэнтеролог', 'therapy'),
  ('Гинеколог', 'gynecology'),
  ('Дерматолог', 'therapy'),
  ('Инфекционист', 'therapy'),
  ('Кардиолог', 'therapy'),
  ('ЛОР (оториноларинголог)', 'ent'),
  ('Невролог', 'therapy'),
  ('Нефролог', 'therapy'),
  ('Онколог', 'therapy'),
  ('Офтальмолог', 'ophthalmology'),
  ('Педиатр', 'therapy'),
  ('Проктолог', 'surgery'),
  ('Психиатр', 'therapy'),
  ('Пульмонолог', 'therapy'),
  ('Ревматолог', 'therapy'),
  ('Рентгенолог', 'imaging'),
  ('Стоматолог', 'dental'),
  ('Терапевт', 'therapy'),
  ('Травматолог-ортопед', 'surgery'),
  ('Уролог', 'surgery'),
  ('Хирург', 'surgery'),
  ('Эндокринолог', 'therapy')
ON CONFLICT (name) DO NOTHING;

-- Удалить «висячие» связи и несуществующие ссылки в профилях
DELETE FROM doctor_specializations ds
WHERE NOT EXISTS (SELECT 1 FROM specializations s WHERE s.id = ds.specialization_id);

UPDATE doctor_profiles dp
SET specialization_id = NULL
WHERE specialization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM specializations s WHERE s.id = dp.specialization_id);

-- Ровно один primary на врача: сброс и MIN(specialization_id)
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

UPDATE doctor_profiles dp
SET specialization_id = sub.sid
FROM (
  SELECT doctor_user_id, specialization_id AS sid
  FROM doctor_specializations
  WHERE is_primary
) sub
WHERE dp.user_id = sub.doctor_user_id;
