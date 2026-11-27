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
  'image/svg+xml',
  'application/octet-stream'
]);

const BUILTIN_BG_PRESETS = Object.freeze([
  {
    id: 'default',
    name: '默认深空山脉',
    desc: '经典静谧星空壁纸，开箱即用',
    tag: '默认',
    type: 'default',
    url: '',
    preview_url: '/background.webp',
    overlay: 40
  },
  {
    id: 'twilight-campus',
    name: '青春暮色校园',
    desc: '日落紫霞、晚风流云与校园剪影',
    tag: '矢量',
    type: 'svg',
    url: '/backgrounds/twilight-campus.svg',
    preview_url: '/backgrounds/twilight-campus.svg',
    overlay: 28
  },
  {
    id: 'deep-blue-geo',
    name: '极简深蓝几何',
    desc: '沉静深蓝几何光面，百搭毛玻璃卡片',
    tag: '矢量',
    type: 'svg',
    url: '/backgrounds/deep-blue-geo.svg',
    preview_url: '/backgrounds/deep-blue-geo.svg',
    overlay: 20
  },
  {
    id: 'aurora-peaks',
    name: '极光雪峰夜景',
    desc: '翠紫极光映照雪山轮廓与繁星',
    tag: '矢量',
    type: 'svg',
    url: '/backgrounds/aurora-peaks.svg',
    preview_url: '/backgrounds/aurora-peaks.svg',
    overlay: 24
  },
  {
    id: 'misty-forest',
    name: '青岚月影山林',
    desc: '层叠青墨远山与柔和清月微光',
    tag: '矢量',
    type: 'svg',
    url: '/backgrounds/misty-forest.svg',
    preview_url: '/backgrounds/misty-forest.svg',
    overlay: 30
  },
  {
    id: 'dawn-horizon',
    name: '微光晨曦云海',
    desc: '柔和蓝粉渐变天际线与轻盈云海',
    tag: '矢量',
    type: 'svg',
    url: '/backgrounds/dawn-horizon.svg',
    preview_url: '/backgrounds/dawn-horizon.svg',
    overlay: 36
  }
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

function findPresetById(id) {
  const clean = String(id || '').trim();
  if (!clean) return null;
  return BUILTIN_BG_PRESETS.find(preset => preset.id === clean) || null;
}

function findPresetByUrl(url) {
  const clean = String(url || '').trim();
  return BUILTIN_BG_PRESETS.find(preset => preset.url === clean) || null;
}

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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : '';
    })
    .replace(/&#(\d+);?/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : '';
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function hasDangerousUriOrCss(rawValue) {
  const decoded = decodeHtmlEntities(rawValue);
  // 移除空白与不可见控制字符后检测协议混淆（如 java\tscript:）
  const normalized = decoded.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
  if (/(?:javascript|vbscript):/.test(normalized)) return true;
  if (/data:(?:text\/html|application\/|image\/svg\+xml)/.test(normalized)) return true;
  if (/expression\s*\(|@import|behavior\s*:/i.test(decoded)) return true;
  return false;
}

function sanitizeSvgTagAttributes(tagName, attrString) {
  if (!attrString) return '';
  const lowerTag = String(tagName || '').toLowerCase();
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const kept = [];
  let match;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const attrName = match[1];
    const lowerName = attrName.toLowerCase();
    const rawVal = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : ''));
    const hasValue = match[2] !== undefined || match[3] !== undefined || match[4] !== undefined;

    // 1. 移除所有事件处理器属性（onload / onerror / onclick / onbegin 等）
    if (/^on[a-z0-9_-]*$/.test(lowerName)) continue;

    // 2. 过滤含危险协议或危险表达式的属性值
    if (hasValue && hasDangerousUriOrCss(rawVal)) continue;

    // 3. 限制 href / xlink:href / src 等引用属性
    if (lowerName === 'href' || lowerName === 'xlink:href' || lowerName === 'src' || lowerName === 'action' || lowerName === 'formaction') {
      const trimmedVal = decodeHtmlEntities(rawVal).trim();
      if (lowerTag === 'use') {
        // <use> 仅允许同文档锚点引用（#id），阻止外部引用
        if (!trimmedVal.startsWith('#')) continue;
      } else if (/^(?:javascript|vbscript|file):/i.test(trimmedVal.replace(/[\u0000-\u0020]+/g, ''))) {
        continue;
      }
    }

    // 4. 阻止 <animate>/<set> 修改事件处理器或链接属性
    if (lowerName === 'attributename') {
      const targetAttr = rawVal.trim().toLowerCase();
      if (/^on/.test(targetAttr) || targetAttr === 'href' || targetAttr === 'xlink:href') continue;
    }

    if (hasValue) {
      const safeQuote = rawVal.includes('"') && !rawVal.includes("'") ? "'" : '"';
      const escapedVal = safeQuote === '"' ? rawVal.replace(/"/g, '&quot;') : rawVal.replace(/'/g, '&#39;');
      kept.push(`${attrName}=${safeQuote}${escapedVal}${safeQuote}`);
    } else {
      kept.push(attrName);
    }
  }

  return kept.length ? ' ' + kept.join(' ') : '';
}

function sanitizeSvg(rawSvg) {
  if (typeof rawSvg !== 'string') return null;
  if (rawSvg.includes('\0')) return null;

  let svg = rawSvg.replace(/^\uFEFF/, '').trim();
  if (!svg) return null;

  // 拒绝伪装成 SVG 的 HTML 文档（如 <html>...</html> 或 <!DOCTYPE html>...）
  if (/^(?:<!DOCTYPE\s+html\b|<html[\s>])/i.test(svg)) return null;

  // 必须包含合法的 <svg ...> 根元素与闭合标签
  if (!/<svg(?:\s|>)/i.test(svg) || !/<\/svg\s*>/i.test(svg)) return null;

  // 移除 DOCTYPE / ENTITY 声明（防 XXE / 实体扩展）与注释
  svg = svg
    .replace(/<!DOCTYPE[\s\S]*?(?:\]\s*>|>)/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 循环移除所有危险标签，防止嵌套拼接绕过（如 <scr<script>ipt>）
  const dangerousTags = 'script|foreignObject|iframe|object|embed|applet|base|meta|link|audio|video';
  const pairedRe = new RegExp(`<(${dangerousTags})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
  const singleRe = new RegExp(`<\\/?(${dangerousTags})\\b[^>]*\\/?>`, 'gi');
  let prev;
  do {
    prev = svg;
    svg = svg.replace(pairedRe, '').replace(singleRe, '');
  } while (svg !== prev);

  // 移除危险嵌入后若仍存在 HTML 文档根标签则拒绝
  if (/<html[\s>]|<body[\s>]/i.test(svg)) return null;

  // 清洗 <style> 内危险 CSS（@import / expression / javascript:）
  svg = svg.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (full, cssContent) => {
    const cleanedCss = String(cssContent || '')
      .replace(/@import[\s\S]*?(?:;|$)/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/behavior\s*:[^;]+;?/gi, '')
      .replace(/url\s*\(\s*['"]?\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^)]*\)/gi, 'none');
    return `<style>${cleanedCss}</style>`;
  });

  // 逐标签清洗属性
  svg = svg.replace(/<([a-zA-Z][a-zA-Z0-9:_-]*)(\s[^<>]*?)?(\s*\/?)>/g, (full, tagName, attrs = '', selfClose = '') => {
    const cleanedAttrs = sanitizeSvgTagAttributes(tagName, attrs);
    const closing = selfClose.trim() ? ' /' : '';
    return `<${tagName}${cleanedAttrs}${closing}>`;
  });

  svg = svg.trim();

  // 再次确认合法 <svg> 根元素完整存在
  if (!/<svg(?:\s|>)/i.test(svg) || !/<\/svg\s*>/i.test(svg)) return null;

  // 确保根 <svg> 携带标准 xmlns，保证浏览器作为背景图或 <img> 正常渲染
  svg = svg.replace(/<svg\b([^>]*)>/i, (full, attrs) => {
    if (/\bxmlns\s*=/i.test(attrs)) return full;
    return `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>`;
  });

  return svg;
}

function isSvgBuffer(file, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const mimetype = String(file?.mimetype || '').toLowerCase();
  const ext = path.extname(String(file?.originalname || '')).toLowerCase();
  const hasSvgHint = mimetype === 'image/svg+xml' || ext === '.svg';
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trimStart();
  const looksLikeSvg = /^(?:<\?xml[\s\S]*?)?<svg(?:\s|>)/i.test(head) || (hasSvgHint && /<svg(?:\s|>)/i.test(head));
  return hasSvgHint || looksLikeSvg;
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
  if (url.startsWith('/backgrounds/')) {
    if (url.includes('..') || !/^\/backgrounds\/[a-zA-Z0-9._-]+$/.test(url)) {
      throw new Error('内置背景预设路径格式无效');
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

function resolvePresetId(siteBgUrl, requestedPresetId = '') {
  const cleanUrl = String(siteBgUrl || '').trim();
  const matchedByUrl = findPresetByUrl(cleanUrl);
  if (matchedByUrl) return matchedByUrl.id;
  if (requestedPresetId) {
    const matchedById = findPresetById(requestedPresetId);
    if (matchedById && matchedById.url === cleanUrl) return matchedById.id;
  }
  return cleanUrl ? '' : 'default';
}

async function getAppearanceSettings() {
  let rows = [];
  try {
    rows = await all(
      "SELECT key, value FROM site_settings WHERE key IN ('site_bg_url', 'site_bg_overlay', 'site_bg_preset')"
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
  const storedPreset = map.has('site_bg_preset') ? String(map.get('site_bg_preset') || '') : '';
  const siteBgPreset = resolvePresetId(siteBgUrl, storedPreset);

  return {
    site_bg_url: siteBgUrl,
    site_bg_overlay: siteBgOverlay,
    site_bg_preset: siteBgPreset
  };
}

async function saveAppearanceSettings({ site_bg_url, site_bg_overlay, site_bg_preset }) {
  const current = await getAppearanceSettings();
  let nextUrlInput = site_bg_url;
  let nextOverlayInput = site_bg_overlay;
  let requestedPreset = '';

  if (site_bg_preset !== undefined && site_bg_preset !== null && String(site_bg_preset).trim() !== '') {
    const preset = findPresetById(site_bg_preset);
    if (!preset) {
      throw new Error('未找到对应的内置背景预设');
    }
    requestedPreset = preset.id;
    if (nextUrlInput === undefined) nextUrlInput = preset.url;
    if (nextOverlayInput === undefined) nextOverlayInput = preset.overlay;
  }

  const nextUrl = nextUrlInput !== undefined ? validateBgUrl(nextUrlInput) : current.site_bg_url;
  const nextOverlay = nextOverlayInput !== undefined
    ? validateBgOverlay(nextOverlayInput, current.site_bg_overlay)
    : current.site_bg_overlay;
  const nextPreset = resolvePresetId(nextUrl, requestedPreset);

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
  await run(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('site_bg_preset', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [nextPreset]
  );

  return {
    site_bg_url: nextUrl,
    site_bg_overlay: nextOverlay,
    site_bg_preset: nextPreset
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

  // 公开读取内置精选背景预设库
  router.get('/presets', (req, res) => {
    res.json({ data: BUILTIN_BG_PRESETS });
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

  // 更新站点外观配置（支持内置预设、网络图片 URL、遮罩暗度调节、恢复默认）
  router.put('/appearance', authMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const updated = await saveAppearanceSettings({
        site_bg_url: body.site_bg_url,
        site_bg_overlay: body.site_bg_overlay,
        site_bg_preset: body.site_bg_preset
      });
      res.json({
        message: updated.site_bg_url ? '背景设置已保存' : '已恢复默认星空背景',
        ...updated
      });
    } catch (error) {
      res.status(400).json({ message: error.message || '保存背景设置失败' });
    }
  });

  // 上传本地背景图片（JPG / PNG / WebP / GIF / SVG，默认限制 10MB 以内），SVG 自动执行安全过滤
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
      const origExt = path.extname(String(req.file.originalname || '')).toLowerCase();
      const allowedXmlForSvg = origExt === '.svg' && (mimetype === 'text/xml' || mimetype === 'application/xml' || mimetype === 'text/plain');
      if (mimetype && !ALLOWED_MIME_TYPES.has(mimetype) && !allowedXmlForSvg) {
        return res.status(400).json({ message: '仅支持 JPG、PNG、WebP、GIF、SVG 格式图片' });
      }

      let detected = detectImageFormat(req.file.buffer);
      let fileBufferToWrite = req.file.buffer;

      if (!detected && isSvgBuffer(req.file, req.file.buffer)) {
        const sanitizedSvg = sanitizeSvg(req.file.buffer.toString('utf8'));
        if (!sanitizedSvg) {
          return res.status(400).json({ message: 'SVG 文件内容无效或包含不安全结构' });
        }
        detected = { ext: '.svg', mime: 'image/svg+xml' };
        fileBufferToWrite = Buffer.from(sanitizedSvg, 'utf8');
      }

      if (!detected) {
        return res.status(400).json({ message: '文件内容不是有效的 JPG / PNG / WebP / GIF / SVG 图片' });
      }

      try {
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const filename = `bg-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${detected.ext}`;
        const filePath = path.join(uploadsDir, filename);
        await fs.promises.writeFile(filePath, fileBufferToWrite);

        const publicUrl = `/uploads/${filename}`;
        const overlayInput = req.body?.site_bg_overlay;
        const saved = await saveAppearanceSettings({
          site_bg_url: publicUrl,
          site_bg_overlay: overlayInput !== undefined && overlayInput !== '' ? overlayInput : undefined,
          site_bg_preset: ''
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
defaultRouter.BUILTIN_BG_PRESETS = BUILTIN_BG_PRESETS;
defaultRouter.findPresetById = findPresetById;
defaultRouter.findPresetByUrl = findPresetByUrl;
defaultRouter.resolvePresetId = resolvePresetId;
defaultRouter.detectImageFormat = detectImageFormat;
defaultRouter.sanitizeSvg = sanitizeSvg;
defaultRouter.validateBgUrl = validateBgUrl;
defaultRouter.validateBgOverlay = validateBgOverlay;
defaultRouter.getAppearanceSettings = getAppearanceSettings;
defaultRouter.saveAppearanceSettings = saveAppearanceSettings;
defaultRouter.DEFAULT_BG_OVERLAY = DEFAULT_BG_OVERLAY;
defaultRouter.MAX_BG_FILE_SIZE = MAX_BG_FILE_SIZE;

module.exports = defaultRouter;
