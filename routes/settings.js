const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const authMiddleware = require('./authMiddleware');

const DEFAULT_BG_OVERLAY = 40;
const MIN_BG_OVERLAY = 0;
const MAX_BG_OVERLAY = 80;
const MAX_BG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_UPLOADS_DIR = path.join(__dirname, '../uploads');

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/octet-stream'
]);

db.run(`CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
)`);

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(error) {
    if (error) reject(error);
    else resolve(this);
  });
});

function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: '.png', mime: 'image/png' };
  }
  // GIF: GIF87a / GIF89a
  const gifSig = buffer.subarray(0, 6).toString('ascii');
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return { ext: '.gif', mime: 'image/gif' };
  }
  // WebP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', mime: 'image/webp' };
  }
  return null;
}

function validateBgUrl(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new Error('背景图片地址格式无效');
  }
  const url = raw.trim();
  if (!url) return '';
  if (url.length > 2048) {
    throw new Error('背景图片地址过长');
  }
  if (url.startsWith('/uploads/')) {
    if (url.includes('..') || !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(url)) {
      throw new Error('本地背景图片路径格式无效');
    }
    return url;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('请输入有效的网络图片地址（http:// 或 https://）');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('网络背景图片地址必须使用 http:// 或 https://');
  }
  return url;
}

function validateBgOverlay(raw, fallback = DEFAULT_BG_OVERLAY) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new Error('遮罩暗度必须为 0 ~ 80 之间的数字');
  }
  return Math.round(Math.min(MAX_BG_OVERLAY, Math.max(MIN_BG_OVERLAY, num)));
}

async function getAppearanceSettings() {
  let rows = [];
  try {
    rows = await all(
      "SELECT key, value FROM site_settings WHERE key IN ('site_bg_url', 'site_bg_overlay')"
    );
  } catch {
    rows = [];
  }
  const map = new Map(rows.map(row => [row.key, row.value]));
  const rawUrl = map.has('site_bg_url') ? String(map.get('site_bg_url') || '') : '';
  let siteBgUrl = '';
  try {
    siteBgUrl = validateBgUrl(rawUrl);
  } catch {
    siteBgUrl = '';
  }
  let siteBgOverlay = DEFAULT_BG_OVERLAY;
  if (map.has('site_bg_overlay')) {
    try {
      siteBgOverlay = validateBgOverlay(map.get('site_bg_overlay'), DEFAULT_BG_OVERLAY);
    } catch {
      siteBgOverlay = DEFAULT_BG_OVERLAY;
    }
  }
  return {
    site_bg_url: siteBgUrl,
    site_bg_overlay: siteBgOverlay
  };
}

async function saveAppearanceSettings({ site_bg_url, site_bg_overlay }) {
  const current = await getAppearanceSettings();
  const nextUrl = site_bg_url !== undefined ? validateBgUrl(site_bg_url) : current.site_bg_url;
  const nextOverlay = site_bg_overlay !== undefined
    ? validateBgOverlay(site_bg_overlay, current.site_bg_overlay)
    : current.site_bg_overlay;

  await run(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('site_bg_url', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [nextUrl]
  );
  await run(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('site_bg_overlay', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [String(nextOverlay)]
  );

  return {
    site_bg_url: nextUrl,
    site_bg_overlay: nextOverlay
  };
}

function createSettingsRouter(options = {}) {
  const router = express.Router();
  const uploadsDir = options.uploadsDir || DEFAULT_UPLOADS_DIR;
  const maxFileSize = Number(options.maxFileSize) > 0 ? Number(options.maxFileSize) : MAX_BG_FILE_SIZE;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize }
  });

  // 公开读取站点外观配置（供前台首页加载背景与遮罩透明度）
  router.get('/appearance', async (req, res) => {
    try {
      const settings = await getAppearanceSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: `读取站点背景配置失败：${error.message}` });
    }
  });

  // 更新站点外观配置（支持网络图片 URL、遮罩暗度调节、恢复默认）
  router.put('/appearance', authMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const updated = await saveAppearanceSettings({
        site_bg_url: body.site_bg_url,
        site_bg_overlay: body.site_bg_overlay
      });
      res.json({
        message: updated.site_bg_url ? '背景设置已保存' : '已恢复默认星空背景',
        ...updated
      });
    } catch (error) {
      res.status(400).json({ message: error.message || '保存背景设置失败' });
    }
  });

  // 上传本地背景图片（JPG / PNG / WebP / GIF，默认限制 10MB 以内），保存至 uploads/ 并立即生效
  router.post('/background/upload', authMiddleware, (req, res) => {
    upload.single('background')(req, res, async (uploadErr) => {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          const maxMb = Math.max(1, Math.round(maxFileSize / (1024 * 1024)));
          return res.status(400).json({ message: `图片大小不能超过 ${maxMb}MB` });
        }
        return res.status(400).json({ message: uploadErr.message || '图片上传失败' });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ message: '请选择要上传的背景图片' });
      }

      const mimetype = String(req.file.mimetype || '').toLowerCase();
      if (mimetype && !ALLOWED_MIME_TYPES.has(mimetype)) {
        return res.status(400).json({ message: '仅支持 JPG、PNG、WebP、GIF 格式图片' });
      }

      const detected = detectImageFormat(req.file.buffer);
      if (!detected) {
        return res.status(400).json({ message: '文件内容不是有效的 JPG / PNG / WebP / GIF 图片' });
      }

      try {
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const filename = `bg-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${detected.ext}`;
        const filePath = path.join(uploadsDir, filename);
        await fs.promises.writeFile(filePath, req.file.buffer);

        const publicUrl = `/uploads/${filename}`;
        const overlayInput = req.body?.site_bg_overlay;
        const saved = await saveAppearanceSettings({
          site_bg_url: publicUrl,
          site_bg_overlay: overlayInput !== undefined && overlayInput !== '' ? overlayInput : undefined
        });

        res.json({
          message: '背景图片上传成功并已生效',
          filename,
          url: publicUrl,
          ...saved
        });
      } catch (error) {
        res.status(500).json({ message: `保存背景图片失败：${error.message}` });
      }
    });
  });

  return router;
}

const defaultRouter = createSettingsRouter();
defaultRouter.createSettingsRouter = createSettingsRouter;
defaultRouter.detectImageFormat = detectImageFormat;
defaultRouter.validateBgUrl = validateBgUrl;
defaultRouter.validateBgOverlay = validateBgOverlay;
defaultRouter.getAppearanceSettings = getAppearanceSettings;
defaultRouter.saveAppearanceSettings = saveAppearanceSettings;
defaultRouter.DEFAULT_BG_OVERLAY = DEFAULT_BG_OVERLAY;
defaultRouter.MAX_BG_FILE_SIZE = MAX_BG_FILE_SIZE;

module.exports = defaultRouter;
