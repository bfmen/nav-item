const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const authMiddleware = require('./authMiddleware');

const DEFAULT_DAY_BG_URL = '/backgrounds/campus-day.svg';
const DEFAULT_DAY_BG_OVERLAY = 0;
const DEFAULT_DAY_BG_PRESET = 'campus-day';
const DEFAULT_NIGHT_BG_URL = '/backgrounds/campus-night.svg';
const DEFAULT_NIGHT_BG_OVERLAY = 24;
const DEFAULT_NIGHT_BG_PRESET = 'campus-night';
const DEFAULT_BG_OVERLAY = DEFAULT_NIGHT_BG_OVERLAY;
const DEFAULT_THEME = 'auto';
const MIN_BG_OVERLAY = 0;
const MAX_BG_OVERLAY = 80;
const MAX_BG_HISTORY = 2;
const MAX_BG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_UPLOADS_DIR = path.join(__dirname, '../uploads');

const ALLOWED_THEMES = new Set(['light', 'dark', 'auto']);
const ALLOWED_BG_THEMES = new Set(['light', 'dark']);

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
    id: 'campus-day',
    name: '青春晴空校园',
    desc: '晴空白云、绿茵操场与红跑道，清爽明亮',
    tag: '白天推荐',
    recommended_theme: 'light',
    type: 'svg',
    url: '/backgrounds/campus-day.svg',
    preview_url: '/backgrounds/campus-day.svg',
    overlay: 0
  },
  {
    id: 'campus-night',
    name: '青春暮色校园',
    desc: '日落紫霞、暮色星光与暖灯校园剪影',
    tag: '夜晚推荐',
    recommended_theme: 'dark',
    type: 'svg',
    url: '/backgrounds/campus-night.svg',
    preview_url: '/backgrounds/campus-night.svg',
    overlay: 24
  },
  {
    id: 'dawn-horizon',
    name: '微光晨曦云海',
    desc: '柔和蓝粉渐变天际线与轻盈云海',
    tag: '白天推荐',
    recommended_theme: 'light',
    type: 'svg',
    url: '/backgrounds/dawn-horizon.svg',
    preview_url: '/backgrounds/dawn-horizon.svg',
    overlay: 8
  },
  {
    id: 'deep-blue-geo',
    name: '极简深蓝几何',
    desc: '沉静深蓝几何光面，百搭暗色毛玻璃',
    tag: '夜晚推荐',
    recommended_theme: 'dark',
    type: 'svg',
    url: '/backgrounds/deep-blue-geo.svg',
    preview_url: '/backgrounds/deep-blue-geo.svg',
    overlay: 20
  },
  {
    id: 'aurora-peaks',
    name: '极光雪峰夜景',
    desc: '翠紫极光映照雪山轮廓与繁星',
    tag: '夜晚推荐',
    recommended_theme: 'dark',
    type: 'svg',
    url: '/backgrounds/aurora-peaks.svg',
    preview_url: '/backgrounds/aurora-peaks.svg',
    overlay: 24
  },
  {
    id: 'misty-forest',
    name: '青岚月影山林',
    desc: '层叠青墨远山与柔和清月微光',
    tag: '夜晚推荐',
    recommended_theme: 'dark',
    type: 'svg',
    url: '/backgrounds/misty-forest.svg',
    preview_url: '/backgrounds/misty-forest.svg',
    overlay: 28
  }
]);

const APPEARANCE_KEYS = [
  'day_bg_url',
  'day_bg_overlay',
  'day_bg_preset',
  'night_bg_url',
  'night_bg_overlay',
  'night_bg_preset',
  'default_theme',
  'bg_history',
  'site_bg_url',
  'site_bg_overlay',
  'site_bg_preset'
];

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

function normalizeLegacyUrl(url) {
  const clean = String(url || '').trim();
  if (clean === '/backgrounds/twilight-campus.svg') {
    return DEFAULT_NIGHT_BG_URL;
  }
  return clean;
}

function findPresetById(id, targetTheme = 'dark') {
  const clean = String(id || '').trim();
  if (!clean) return null;
  if (clean === 'twilight-campus') {
    return BUILTIN_BG_PRESETS.find(preset => preset.id === 'campus-night') || null;
  }
  if (clean === 'default') {
    const fallbackId = targetTheme === 'light' ? DEFAULT_DAY_BG_PRESET : DEFAULT_NIGHT_BG_PRESET;
    return BUILTIN_BG_PRESETS.find(preset => preset.id === fallbackId) || null;
  }
  return BUILTIN_BG_PRESETS.find(preset => preset.id === clean) || null;
}

function findPresetByUrl(url) {
  const clean = normalizeLegacyUrl(url);
  if (!clean) return null;
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
  const url = normalizeLegacyUrl(raw);
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

function validateDefaultTheme(raw, fallback = DEFAULT_THEME) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const clean = String(raw).trim().toLowerCase();
  if (!ALLOWED_THEMES.has(clean)) {
    throw new Error('默认主题模式必须为 light、dark 或 auto');
  }
  return clean;
}

function normalizeBgHistory(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }

  const seen = new Set();
  const normalized = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    let safeUrl = '';
    try {
      safeUrl = validateBgUrl(item.url);
    } catch {
      continue;
    }
    if (!safeUrl || seen.has(safeUrl)) continue;
    seen.add(safeUrl);
    const safeTheme = ALLOWED_BG_THEMES.has(String(item.theme || '').toLowerCase())
      ? String(item.theme).toLowerCase()
      : 'dark';
    const fallbackOverlay = safeTheme === 'light' ? DEFAULT_DAY_BG_OVERLAY : DEFAULT_NIGHT_BG_OVERLAY;
    let safeOverlay = fallbackOverlay;
    try {
      safeOverlay = validateBgOverlay(item.overlay, fallbackOverlay);
    } catch {
      safeOverlay = fallbackOverlay;
    }
    const savedAt = typeof item.savedAt === 'string' && item.savedAt.trim()
      ? item.savedAt.trim()
      : new Date().toISOString();
    normalized.push({
      url: safeUrl,
      overlay: safeOverlay,
      theme: safeTheme,
      savedAt
    });
    if (normalized.length >= MAX_BG_HISTORY) break;
  }
  return normalized;
}

function pushBgHistory(currentHistory, entry) {
  const existing = normalizeBgHistory(currentHistory);
  if (!entry || !entry.url) return existing;
  let safeUrl = '';
  try {
    safeUrl = validateBgUrl(entry.url);
  } catch {
    return existing;
  }
  if (!safeUrl) return existing;
  const safeTheme = ALLOWED_BG_THEMES.has(String(entry.theme || '').toLowerCase())
    ? String(entry.theme).toLowerCase()
    : 'dark';
  const fallbackOverlay = safeTheme === 'light' ? DEFAULT_DAY_BG_OVERLAY : DEFAULT_NIGHT_BG_OVERLAY;
  const safeOverlay = validateBgOverlay(entry.overlay, fallbackOverlay);
  const nextItem = {
    url: safeUrl,
    overlay: safeOverlay,
    theme: safeTheme,
    savedAt: typeof entry.savedAt === 'string' && entry.savedAt.trim()
      ? entry.savedAt.trim()
      : new Date().toISOString()
  };
  return [nextItem, ...existing.filter(item => item.url !== safeUrl)].slice(0, MAX_BG_HISTORY);
}

function resolvePresetId(bgUrl, requestedPresetId = '', targetTheme = 'dark') {
  const cleanUrl = normalizeLegacyUrl(bgUrl);
  const matchedByUrl = findPresetByUrl(cleanUrl);
  if (matchedByUrl) return matchedByUrl.id;
  if (requestedPresetId) {
    const matchedById = findPresetById(requestedPresetId, targetTheme);
    if (matchedById && matchedById.url === cleanUrl) return matchedById.id;
  }
  return '';
}

function buildAppearanceFromMap(map) {
  // 读取白天配置
  let dayUrl = DEFAULT_DAY_BG_URL;
  if (map.has('day_bg_url')) {
    try {
      const validated = validateBgUrl(map.get('day_bg_url'));
      dayUrl = validated || DEFAULT_DAY_BG_URL;
    } catch {
      dayUrl = DEFAULT_DAY_BG_URL;
    }
  }
  let dayOverlay = DEFAULT_DAY_BG_OVERLAY;
  if (map.has('day_bg_overlay')) {
    try {
      dayOverlay = validateBgOverlay(map.get('day_bg_overlay'), DEFAULT_DAY_BG_OVERLAY);
    } catch {
      dayOverlay = DEFAULT_DAY_BG_OVERLAY;
    }
  }
  const dayPreset = resolvePresetId(dayUrl, map.get('day_bg_preset') || '', 'light');

  // 读取夜晚配置（兼容旧版单背景 site_bg_url / site_bg_overlay）
  const hasNightKey = map.has('night_bg_url');
  const rawNightUrl = hasNightKey ? map.get('night_bg_url') : (map.get('site_bg_url') || '');
  let nightUrl = DEFAULT_NIGHT_BG_URL;
  try {
    const validated = validateBgUrl(rawNightUrl);
    nightUrl = validated || DEFAULT_NIGHT_BG_URL;
  } catch {
    nightUrl = DEFAULT_NIGHT_BG_URL;
  }
  let nightOverlay = DEFAULT_NIGHT_BG_OVERLAY;
  if (map.has('night_bg_overlay')) {
    try {
      nightOverlay = validateBgOverlay(map.get('night_bg_overlay'), DEFAULT_NIGHT_BG_OVERLAY);
    } catch {
      nightOverlay = DEFAULT_NIGHT_BG_OVERLAY;
    }
  } else if (map.has('site_bg_overlay')) {
    try {
      nightOverlay = validateBgOverlay(map.get('site_bg_overlay'), DEFAULT_NIGHT_BG_OVERLAY);
    } catch {
      nightOverlay = DEFAULT_NIGHT_BG_OVERLAY;
    }
  }
  const nightPreset = resolvePresetId(
    nightUrl,
    map.get('night_bg_preset') || map.get('site_bg_preset') || '',
    'dark'
  );

  let defaultTheme = DEFAULT_THEME;
  if (map.has('default_theme')) {
    try {
      defaultTheme = validateDefaultTheme(map.get('default_theme'), DEFAULT_THEME);
    } catch {
      defaultTheme = DEFAULT_THEME;
    }
  }

  const bgHistory = normalizeBgHistory(map.get('bg_history'));

  return {
    day_bg_url: dayUrl,
    day_bg_overlay: dayOverlay,
    day_bg_preset: dayPreset,
    night_bg_url: nightUrl,
    night_bg_overlay: nightOverlay,
    night_bg_preset: nightPreset,
    default_theme: defaultTheme,
    bg_history: bgHistory,
    // 向后兼容旧版单背景字段（同步夜晚模式）
    site_bg_url: nightUrl,
    site_bg_overlay: nightOverlay,
    site_bg_preset: nightPreset
  };
}

async function getAppearanceSettings() {
  let rows = [];
  try {
    const placeholders = APPEARANCE_KEYS.map(() => '?').join(', ');
    rows = await all(
      `SELECT key, value FROM site_settings WHERE key IN (${placeholders})`,
      APPEARANCE_KEYS
    );
  } catch {
    rows = [];
  }
  const map = new Map(rows.map(row => [String(row.key), String(row.value ?? '')]));
  return buildAppearanceFromMap(map);
}

async function upsertSetting(key, value) {
  await run(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, String(value ?? '')]
  );
}

function resolveThemeModeUpdate(currentUrl, currentOverlay, { urlInput, overlayInput, presetInput }, targetTheme) {
  const defaultUrl = targetTheme === 'light' ? DEFAULT_DAY_BG_URL : DEFAULT_NIGHT_BG_URL;
  const defaultOverlay = targetTheme === 'light' ? DEFAULT_DAY_BG_OVERLAY : DEFAULT_NIGHT_BG_OVERLAY;

  let nextUrlInput = urlInput;
  let nextOverlayInput = overlayInput;
  let requestedPreset = '';

  if (presetInput !== undefined && presetInput !== null && String(presetInput).trim() !== '') {
    const preset = findPresetById(presetInput, targetTheme);
    if (!preset) {
      throw new Error('未找到对应的内置背景预设');
    }
    requestedPreset = preset.id;
    if (nextUrlInput === undefined) nextUrlInput = preset.url;
    if (nextOverlayInput === undefined) nextOverlayInput = preset.overlay;
  }

  let nextUrl = currentUrl;
  if (nextUrlInput !== undefined) {
    const validated = validateBgUrl(nextUrlInput);
    nextUrl = validated || defaultUrl;
  }

  let nextOverlay = currentOverlay;
  if (nextOverlayInput !== undefined) {
    nextOverlay = validateBgOverlay(nextOverlayInput, defaultOverlay);
  }

  const nextPreset = resolvePresetId(nextUrl, requestedPreset, targetTheme);
  return { url: nextUrl, overlay: nextOverlay, preset: nextPreset };
}

async function saveAppearanceSettings(payload = {}) {
  const current = await getAppearanceSettings();
  const body = payload || {};

  const targetLegacyTheme = String(body.theme || '').trim().toLowerCase() === 'light' ? 'light' : 'dark';

  // 若调用方仍传递旧版单背景字段 site_bg_*，自动映射到目标模式（默认夜晚模式）
  const dayUrlInput = body.day_bg_url !== undefined
    ? body.day_bg_url
    : (targetLegacyTheme === 'light' ? body.site_bg_url : undefined);
  const dayOverlayInput = body.day_bg_overlay !== undefined
    ? body.day_bg_overlay
    : (targetLegacyTheme === 'light' ? body.site_bg_overlay : undefined);
  const dayPresetInput = body.day_bg_preset !== undefined
    ? body.day_bg_preset
    : (targetLegacyTheme === 'light' ? body.site_bg_preset : undefined);

  const nightUrlInput = body.night_bg_url !== undefined
    ? body.night_bg_url
    : (targetLegacyTheme === 'dark' ? body.site_bg_url : undefined);
  const nightOverlayInput = body.night_bg_overlay !== undefined
    ? body.night_bg_overlay
    : (targetLegacyTheme === 'dark' ? body.site_bg_overlay : undefined);
  const nightPresetInput = body.night_bg_preset !== undefined
    ? body.night_bg_preset
    : (targetLegacyTheme === 'dark' ? body.site_bg_preset : undefined);

  const nextDay = resolveThemeModeUpdate(
    current.day_bg_url,
    current.day_bg_overlay,
    { urlInput: dayUrlInput, overlayInput: dayOverlayInput, presetInput: dayPresetInput },
    'light'
  );
  const nextNight = resolveThemeModeUpdate(
    current.night_bg_url,
    current.night_bg_overlay,
    { urlInput: nightUrlInput, overlayInput: nightOverlayInput, presetInput: nightPresetInput },
    'dark'
  );

  const nextDefaultTheme = body.default_theme !== undefined
    ? validateDefaultTheme(body.default_theme, current.default_theme)
    : current.default_theme;

  // 壁纸发生变更时，自动将变更前的旧壁纸压入历史记录（去重，最多保留最近 2 条）
  let nextHistory = [...current.bg_history];
  const nowIso = new Date().toISOString();
  if (nextDay.url !== current.day_bg_url && current.day_bg_url) {
    nextHistory = pushBgHistory(nextHistory, {
      url: current.day_bg_url,
      overlay: current.day_bg_overlay,
      theme: 'light',
      savedAt: nowIso
    });
  }
  if (nextNight.url !== current.night_bg_url && current.night_bg_url) {
    nextHistory = pushBgHistory(nextHistory, {
      url: current.night_bg_url,
      overlay: current.night_bg_overlay,
      theme: 'dark',
      savedAt: nowIso
    });
  }

  await upsertSetting('day_bg_url', nextDay.url);
  await upsertSetting('day_bg_overlay', String(nextDay.overlay));
  await upsertSetting('day_bg_preset', nextDay.preset);
  await upsertSetting('night_bg_url', nextNight.url);
  await upsertSetting('night_bg_overlay', String(nextNight.overlay));
  await upsertSetting('night_bg_preset', nextNight.preset);
  await upsertSetting('default_theme', nextDefaultTheme);
  await upsertSetting('bg_history', JSON.stringify(nextHistory));
  // 同步写入旧版兼容字段
  await upsertSetting('site_bg_url', nextNight.url);
  await upsertSetting('site_bg_overlay', String(nextNight.overlay));
  await upsertSetting('site_bg_preset', nextNight.preset);

  return {
    day_bg_url: nextDay.url,
    day_bg_overlay: nextDay.overlay,
    day_bg_preset: nextDay.preset,
    night_bg_url: nextNight.url,
    night_bg_overlay: nextNight.overlay,
    night_bg_preset: nextNight.preset,
    default_theme: nextDefaultTheme,
    bg_history: nextHistory,
    site_bg_url: nextNight.url,
    site_bg_overlay: nextNight.overlay,
    site_bg_preset: nextNight.preset
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

  // 公开读取内置精选纯 SVG 背景预设库
  router.get('/presets', (req, res) => {
    res.json({ data: BUILTIN_BG_PRESETS });
  });

  // 公开读取站点外观配置（白天/夜晚双模式壁纸、遮罩透明度、默认主题与历史壁纸）
  router.get('/appearance', async (req, res) => {
    try {
      const settings = await getAppearanceSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: `读取站点背景配置失败：${error.message}` });
    }
  });

  // 更新站点外观配置（支持白天/夜晚独立保存、内置预设、网络图片 URL、遮罩调节与旧版单字段兼容）
  router.put('/appearance', authMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const updated = await saveAppearanceSettings(body);
      res.json({
        message: '背景设置已保存',
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
        const targetTheme = String(req.body?.theme || '').trim().toLowerCase() === 'light' ? 'light' : 'dark';
        const overlayRaw = targetTheme === 'light'
          ? (req.body?.day_bg_overlay ?? req.body?.overlay ?? req.body?.site_bg_overlay)
          : (req.body?.night_bg_overlay ?? req.body?.overlay ?? req.body?.site_bg_overlay);
        const overlayValue = overlayRaw !== undefined && overlayRaw !== '' ? overlayRaw : undefined;

        const savePayload = targetTheme === 'light'
          ? { day_bg_url: publicUrl, day_bg_overlay: overlayValue, day_bg_preset: '' }
          : { night_bg_url: publicUrl, night_bg_overlay: overlayValue, night_bg_preset: '' };

        const saved = await saveAppearanceSettings(savePayload);

        res.json({
          message: targetTheme === 'light' ? '白天模式背景上传成功并已生效' : '夜晚模式背景上传成功并已生效',
          filename,
          url: publicUrl,
          theme: targetTheme,
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
defaultRouter.validateDefaultTheme = validateDefaultTheme;
defaultRouter.normalizeBgHistory = normalizeBgHistory;
defaultRouter.pushBgHistory = pushBgHistory;
defaultRouter.buildAppearanceFromMap = buildAppearanceFromMap;
defaultRouter.getAppearanceSettings = getAppearanceSettings;
defaultRouter.saveAppearanceSettings = saveAppearanceSettings;
defaultRouter.DEFAULT_DAY_BG_URL = DEFAULT_DAY_BG_URL;
defaultRouter.DEFAULT_DAY_BG_OVERLAY = DEFAULT_DAY_BG_OVERLAY;
defaultRouter.DEFAULT_DAY_BG_PRESET = DEFAULT_DAY_BG_PRESET;
defaultRouter.DEFAULT_NIGHT_BG_URL = DEFAULT_NIGHT_BG_URL;
defaultRouter.DEFAULT_NIGHT_BG_OVERLAY = DEFAULT_NIGHT_BG_OVERLAY;
defaultRouter.DEFAULT_NIGHT_BG_PRESET = DEFAULT_NIGHT_BG_PRESET;
defaultRouter.DEFAULT_BG_OVERLAY = DEFAULT_BG_OVERLAY;
defaultRouter.DEFAULT_THEME = DEFAULT_THEME;
defaultRouter.MAX_BG_HISTORY = MAX_BG_HISTORY;
defaultRouter.MAX_BG_FILE_SIZE = MAX_BG_FILE_SIZE;

module.exports = defaultRouter;
