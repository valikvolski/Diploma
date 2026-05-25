/**
 * Русские подписи событий ленты активности (админ-панель).
 * Ключи — kind, action_type или код события из БД.
 */

const EVENT_LABELS = {
  registration: 'Регистрация аккаунта',
  login: 'Вход в систему',
  logout: 'Выход из системы',
  appointment_created: 'Запись на приём создана',
  appointment_cancelled: 'Запись на приём отменена',
  appointment_completed: 'Приём завершён',
  profile_updated: 'Профиль обновлён',
  password_changed: 'Пароль изменён',
  password_change: 'Пароль изменён',
  avatar_update: 'Изменение фото профиля',
  email_change: 'Смена email',
  account_blocked: 'Аккаунт заблокирован',
  account_unblocked: 'Аккаунт разблокирован',
};

/** Заголовки событий записей из SQL (уже на русском) → единый текст для ленты */
const APPOINTMENT_TITLE_LABELS = {
  'Создана запись': 'Запись на приём создана',
  'Запись отменена': 'Запись на приём отменена',
  'Приём завершён': 'Приём завершён',
  'Запись': 'Запись на приём',
};

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * @param {{ kind?: string, title?: string }} event
 * @returns {string}
 */
function getActivityEventLabel(event) {
  if (!event) return 'Событие';

  const kind = normalizeKey(event.kind);

  if (kind === 'registration') {
    return EVENT_LABELS.registration;
  }

  if (kind === 'audit') {
    const actionKey = normalizeKey(event.title);
    if (EVENT_LABELS[actionKey]) return EVENT_LABELS[actionKey];
    return 'Изменение';
  }

  if (kind === 'appointment') {
    const title = String(event.title || '').trim();
    if (APPOINTMENT_TITLE_LABELS[title]) return APPOINTMENT_TITLE_LABELS[title];
    const byKey = normalizeKey(title);
    if (EVENT_LABELS[byKey]) return EVENT_LABELS[byKey];
    return title || 'Запись';
  }

  const titleKey = normalizeKey(event.title);
  if (EVENT_LABELS[titleKey]) return EVENT_LABELS[titleKey];
  if (EVENT_LABELS[kind]) return EVENT_LABELS[kind];

  const rawTitle = String(event.title || '').trim();
  return rawTitle || 'Событие';
}

module.exports = {
  EVENT_LABELS,
  APPOINTMENT_TITLE_LABELS,
  getActivityEventLabel,
};
