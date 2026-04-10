/**
 * @typedef {{ id: number, name: string, compat_group: string }} SpecRow
 */

const GROUP_LABELS = {
  therapy: 'терапия и смежные консервативные специальности',
  surgery: 'хирургия и операционные профили',
  ophthalmology: 'офтальмология',
  dental: 'стоматология',
  ent: 'ЛОР',
  imaging: 'инструментальная диагностика (УЗИ, рентген)',
  gynecology: 'акушерство и гинекология',
};

function groupLabel(group) {
  return GROUP_LABELS[group] || group;
}

/**
 * @param {number[]} specIds
 * @param {SpecRow[]} allSpecs rows with id, compat_group
 * @returns {{ ok: boolean, message?: string, groups?: Set<string> }}
 */
function validateSpecializationSet(specIds, allSpecs) {
  const ids = [...new Set(specIds.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)))];
  if (ids.length === 0) {
    return { ok: false, message: 'Выберите хотя бы одну специализацию.' };
  }
  const byId = new Map(allSpecs.map((s) => [s.id, s]));
  const groups = new Set();
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      return { ok: false, message: 'Указана неизвестная специализация.' };
    }
    groups.add(row.compat_group || 'therapy');
  }
  if (groups.size > 1) {
    const gList = [...groups].map(groupLabel).join('; ');
    return {
      ok: false,
      message:
        'Нельзя сочетать выбранные специализации: они относятся к разным группам совместимости (' +
        gList +
        '). Оставьте специализации из одной группы.',
    };
  }
  return { ok: true, groups };
}

/**
 * Specs in the same compat_group as any selected id (for UI hints).
 * @param {number[]} selectedIds
 * @param {SpecRow[]} allSpecs
 * @returns {SpecRow[]}
 */
function suggestedCompatibleSpecs(selectedIds, allSpecs) {
  const ids = selectedIds.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
  if (ids.length === 0) return allSpecs;
  const byId = new Map(allSpecs.map((s) => [s.id, s]));
  const groups = new Set();
  for (const id of ids) {
    const row = byId.get(id);
    if (row) groups.add(row.compat_group || 'therapy');
  }
  if (groups.size !== 1) return allSpecs;
  const g = [...groups][0];
  return allSpecs.filter((s) => (s.compat_group || 'therapy') === g);
}

/**
 * @param {number[]} specIds
 * @param {number|string|null|undefined} primaryId
 * @returns {{ primary: number|null, error?: string }}
 */
function resolvePrimarySpecializationId(specIds, primaryId) {
  const ids = [...new Set(specIds.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)))];
  if (ids.length === 0) return { primary: null };
  const p = primaryId != null && String(primaryId).trim() !== '' ? parseInt(primaryId, 10) : NaN;
  if (!isNaN(p) && ids.includes(p)) return { primary: p };
  return { primary: ids[0] };
}

module.exports = {
  validateSpecializationSet,
  suggestedCompatibleSpecs,
  resolvePrimarySpecializationId,
  groupLabel,
  GROUP_LABELS,
};
