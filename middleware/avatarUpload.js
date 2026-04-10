const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const PUBLIC_PREFIX = 'uploads/avatars';
const AVATAR_DIR = path.join(__dirname, '..', 'public', PUBLIC_PREFIX);
const MAX_BYTES = 2 * 1024 * 1024;

function ensureDir() {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    ensureDir();
    cb(null, AVATAR_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `tmp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter(_req, file, cb) {
    const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    const ext = path.extname(file.originalname || '').toLowerCase();
    const okExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    if (!okMime || !okExt) {
      cb(new Error('BAD_AVATAR_TYPE'));
      return;
    }
    cb(null, true);
  },
});

function getSafeAbsFromDb(relative) {
  if (!relative || typeof relative !== 'string') return null;
  const norm = relative.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!norm.startsWith(`${PUBLIC_PREFIX}/`)) return null;
  const abs = path.resolve(path.join(__dirname, '..', 'public', norm));
  const root = path.resolve(AVATAR_DIR);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return abs;
}

async function unlinkDbPath(dbPath) {
  const abs = getSafeAbsFromDb(dbPath);
  if (!abs) return;
  try {
    await fs.promises.unlink(abs);
  } catch (_) {}
}

async function finalizeTempToWebp(tempPath, userId) {
  ensureDir();
  const name = `u${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.webp`;
  const outPath = path.join(AVATAR_DIR, name);
  try {
    await sharp(tempPath)
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toFile(outPath);
    return `${PUBLIC_PREFIX}/${name}`;
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (_) {}
  }
}

module.exports = {
  uploadAvatar: upload.single('avatar'),
  PUBLIC_PREFIX,
  AVATAR_DIR,
  getSafeAbsFromDb,
  unlinkDbPath,
  finalizeTempToWebp,
  MAX_BYTES,
};
