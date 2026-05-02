function redirectMulterAvatarError(err, res, pathNoQuery, options) {
  if (!err) return false;
  const useJson = options && options.useJson;
  const sep = pathNoQuery.includes('?') ? '&' : '?';
  let message;
  if (err.code === 'LIMIT_FILE_SIZE') {
    message = 'Файл не должен превышать 2 МБ';
  } else if (err.message === 'BAD_AVATAR_TYPE') {
    message = 'Разрешены только JPG, JPEG, PNG и WebP';
  } else {
    return false;
  }
  if (useJson) {
    res.status(400).json({ ok: false, error: message });
    return true;
  }
  res.redirect(`${pathNoQuery}${sep}error=${encodeURIComponent(message)}`);
  return true;
}

module.exports = { redirectMulterAvatarError };
