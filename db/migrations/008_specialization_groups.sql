-- 008: compatibility groups dictionary for specializations

CREATE TABLE IF NOT EXISTS specialization_groups (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed default groups used by existing compat_group logic
INSERT INTO specialization_groups (code, name) VALUES
  ('therapy', 'Терапия и смежные'),
  ('surgery', 'Хирургия'),
  ('ophthalmology', 'Офтальмология'),
  ('dental', 'Стоматология'),
  ('ent', 'ЛОР'),
  ('imaging', 'Инструментальная диагностика'),
  ('gynecology', 'Акушерство и гинекология')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE specializations
  ADD COLUMN IF NOT EXISTS specialization_group_id INTEGER REFERENCES specialization_groups(id);

-- Backfill relation from legacy compat_group value
UPDATE specializations s
SET specialization_group_id = sg.id
FROM specialization_groups sg
WHERE s.specialization_group_id IS NULL
  AND COALESCE(NULLIF(s.compat_group, ''), 'therapy') = sg.code;

-- Fallback for unknown/legacy values
UPDATE specializations s
SET specialization_group_id = sg.id,
    compat_group = sg.code
FROM specialization_groups sg
WHERE s.specialization_group_id IS NULL
  AND sg.code = 'therapy';

CREATE INDEX IF NOT EXISTS idx_specializations_group_id
  ON specializations(specialization_group_id);
