function redirectMulterAvatarError(err, res, pathNoQuery) {
  if (!err) return false;
  const sep = pathNoQuery.includes('?') ? '&' : '?';
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.redirect(`${pathNoQuery}${sep}error=${encodeURIComponent('Файл не должен превышать 2 МБ')}`);
    return true;
  }
  if (err.message === 'BAD_AVATAR_TYPE') {
    res.redirect(
      `${pathNoQuery}${sep}error=${encodeURIComponent('Разрешены только JPG, JPEG, PNG и WebP')}`
    );
    return true;
  }
  return false;
}

module.exports = { redirectMulterAvatarError };
