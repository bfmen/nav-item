const express = require('express');
const http = require('http');
const https = require('https');
const authMiddleware = require('./authMiddleware');
const db = require('../db');
const {
  DEFAULT_DAY_BG_OVERLAY,
  DEFAULT_NIGHT_BG_OVERLAY,
  DEFAULT_THEME,
  buildAppearanceFromMap,
  normalizeBgHistory,
  validateDefaultTheme
} = require('./settings');

const router = express.Router();
const SCHEMA_VERSION = 2;
const REQUIRED_TABLES = ['menus', 'sub_menus', 'cards'];
const MAX_WEBDAV_BACKUPS = 8;

// 配置保存在服务端 SQLite 数据库，Docker 持久化 database 目录后即可跨刷新和重启保留。
db.run(`CREATE TABLE IF NOT EXISTS webdav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL DEFAULT '',
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',
  updated_at TEXT
)`);
db.run(`CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
)`);

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(error) {
    if (error) reject(error);
    else resolve(this);
  });
});

async function createBackup() {
  const [menus, subMenus, cards, users] = await Promise.all([
    all('SELECT id, name, "order" FROM menus ORDER BY "order" ASC, id ASC'),
    all('SELECT id, parent_id, name, "order" FROM sub_menus ORDER BY parent_id ASC, "order" ASC, id ASC'),
    all('SELECT id, menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order", COALESCE(is_deleted, 0) AS is_deleted, deleted_at, recycle_reason FROM cards ORDER BY id ASC'),
    all('SELECT id, username, password, current_login_at, current_login_ip, last_login_at, last_login_ip FROM users ORDER BY id ASC')
  ]);

  let aiConfigs = [];
  try {
    aiConfigs = await all('SELECT id, name, base_url, api_key, model, is_active, created_at, updated_at FROM ai_configs ORDER BY id ASC');
  } catch {
    aiConfigs = [];
  }

  const webdavRow = await get('SELECT url, username, password FROM webdav_config WHERE id = 1').catch(() => null);
  const webdavConfig = webdavRow || { url: '', username: '', password: '' };

  let siteSettingRows = [];
  try {
    siteSettingRows = await all('SELECT key, value, updated_at FROM site_settings ORDER BY key ASC');
  } catch {
    siteSettingRows = [];
  }
  const siteSettingsMap = new Map(siteSettingRows.map(row => [String(row.key), String(row.value ?? '')]));
  const siteSettings = buildAppearanceFromMap(siteSettingsMap);
  const canonicalEntries = [
    ['day_bg_url', siteSettings.day_bg_url],
    ['day_bg_overlay', String(siteSettings.day_bg_overlay)],
    ['day_bg_preset', siteSettings.day_bg_preset],
    ['night_bg_url', siteSettings.night_bg_url],
    ['night_bg_overlay', String(siteSettings.night_bg_overlay)],
    ['night_bg_preset', siteSettings.night_bg_preset],
    ['default_theme', siteSettings.default_theme],
    ['bg_history', JSON.stringify(siteSettings.bg_history)],
    ['site_bg_url', siteSettings.site_bg_url],
    ['site_bg_overlay', String(siteSettings.site_bg_overlay)],
    ['site_bg_preset', siteSettings.site_bg_preset]
  ];
  const rowMap = new Map(siteSettingRows.map(row => [
    String(row.key),
    { key: String(row.key), value: String(row.value ?? ''), updated_at: row.updated_at || null }
  ]));
  for (const [k, v] of canonicalEntries) {
    const existingRow = rowMap.get(k);
    rowMap.set(k, { key: k, value: v, updated_at: existingRow?.updated_at || null });
  }
  const normalizedSiteSettings = [...rowMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  const normalizedMenus = menus.map(m => ({
    id: Number(m.id),
    name: String(m.name || ''),
    order: Number(m.order || 0),
    sort: Number(m.order || 0)
  }));

  const normalizedSubMenus = subMenus.map(sm => ({
    id: Number(sm.id),
    parent_id: Number(sm.parent_id),
    name: String(sm.name || ''),
    order: Number(sm.order || 0),
    sort: Number(sm.order || 0)
  }));

  const normalizedCards = cards.map(c => ({
    id: Number(c.id),
    menu_id: c.menu_id !== null && c.menu_id !== undefined ? Number(c.menu_id) : null,
    sub_menu_id: c.sub_menu_id !== null && c.sub_menu_id !== undefined ? Number(c.sub_menu_id) : null,
    title: String(c.title || ''),
    url: String(c.url || ''),
    logo_url: c.logo_url || '',
    custom_logo_path: c.custom_logo_path || null,
    desc: c.desc || '',
    order: Number(c.order || 0),
    sort: Number(c.order || 0),
    is_deleted: c.is_deleted ? 1 : 0,
    deleted_at: c.deleted_at || null,
    recycle_reason: c.recycle_reason || null
  }));

  const normalizedAiConfigs = aiConfigs.map(cfg => ({
    id: Number(cfg.id),
    name: String(cfg.name || ''),
    base_url: String(cfg.base_url || ''),
    api_key: String(cfg.api_key || ''),
    model: String(cfg.model || ''),
    is_active: cfg.is_active ? 1 : 0,
    created_at: cfg.created_at || null,
    updated_at: cfg.updated_at || null
  }));

  return {
    format: 'nav-item-backup',
    schema_version: SCHEMA_VERSION,
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    tables: {
      menus: normalizedMenus,
      sub_menus: normalizedSubMenus,
      cards: normalizedCards,
      users,
      ai_configs: normalizedAiConfigs,
      site_settings: normalizedSiteSettings
    },
    webdavConfig,
    aiConfigs: normalizedAiConfigs,
    siteSettings
  };
}

function validBackup(value) {
  return Boolean(
    value &&
    value.format === 'nav-item-backup' &&
    value.tables &&
    REQUIRED_TABLES.every(table => Array.isArray(value.tables[table]))
  );
}

// 原子化全量覆盖还原：
// 关键：SQLite 中 PRAGMA foreign_keys 必须在事务外（BEGIN TRANSACTION 之前）关闭，
// 事务内关闭会被静默忽略导致外键冲突或残留。还原完成后在事务外恢复开启。
async function restoreBackup(backup) {
  if (!validBackup(backup)) throw new Error('备份文件格式无效');

  const menus = backup.tables.menus || [];
  const subMenus = backup.tables.sub_menus || [];
  const cards = backup.tables.cards || [];
  const users = Array.isArray(backup.tables.users) ? backup.tables.users : null;
  const aiConfigs = Array.isArray(backup.tables.ai_configs)
    ? backup.tables.ai_configs
    : (Array.isArray(backup.aiConfigs) ? backup.aiConfigs : null);
  const hasSiteSettings = Boolean(
    (backup.siteSettings && typeof backup.siteSettings === 'object') ||
    Array.isArray(backup.tables.site_settings)
  );

  await run('PRAGMA foreign_keys = OFF');
  try {
    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      // 彻底清空核心导航表，确保绝无旧子菜单名或重复记录残留
      await run('DELETE FROM cards');
      await run('DELETE FROM sub_menus');
      await run('DELETE FROM menus');
      if (users && users.length > 0) {
        await run('DELETE FROM users');
      }
      if (aiConfigs !== null) {
        await run('DELETE FROM ai_configs');
      }
      if (hasSiteSettings) {
        await run('DELETE FROM site_settings');
      }
      // 重置自增序列，避免历史最大 ID 干扰
      await run("DELETE FROM sqlite_sequence WHERE name IN ('cards', 'sub_menus', 'menus')").catch(() => {});

      for (const row of menus) {
        const sortVal = Number(row.order ?? row.sort ?? 0) || 0;
        await run(
          'INSERT INTO menus (id, name, "order") VALUES (?, ?, ?)',
          [Number(row.id), String(row.name || ''), sortVal]
        );
      }

      for (const row of subMenus) {
        const sortVal = Number(row.order ?? row.sort ?? 0) || 0;
        await run(
          'INSERT INTO sub_menus (id, parent_id, name, "order") VALUES (?, ?, ?, ?)',
          [Number(row.id), Number(row.parent_id), String(row.name || ''), sortVal]
        );
      }

      for (const row of cards) {
        const sortVal = Number(row.order ?? row.sort ?? 0) || 0;
        const descVal = row.desc !== undefined ? row.desc : (row.description !== undefined ? row.description : '');
        const menuIdVal = row.menu_id !== null && row.menu_id !== undefined && row.menu_id !== '' ? Number(row.menu_id) : null;
        const subMenuIdVal = row.sub_menu_id !== null && row.sub_menu_id !== undefined && row.sub_menu_id !== '' ? Number(row.sub_menu_id) : null;
        await run(
          'INSERT INTO cards (id, menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order", is_deleted, deleted_at, recycle_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            Number(row.id),
            menuIdVal,
            subMenuIdVal,
            String(row.title || ''),
            String(row.url || ''),
            row.logo_url || '',
            row.custom_logo_path || null,
            String(descVal || ''),
            sortVal,
            row.is_deleted ? 1 : 0,
            row.deleted_at || null,
            row.recycle_reason || null
          ]
        );
      }

      if (users && users.length > 0) {
        for (const row of users) {
          await run(
            'INSERT INTO users (id, username, password, current_login_at, current_login_ip, last_login_at, last_login_ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [row.id, row.username, row.password, row.current_login_at || null, row.current_login_ip || null, row.last_login_at || null, row.last_login_ip || null]
          );
        }
      }

      if (backup.webdavConfig && typeof backup.webdavConfig === 'object') {
        const { url = '', username = '', password = '' } = backup.webdavConfig;
        await run(
          `INSERT INTO webdav_config (id, url, username, password, updated_at) VALUES (1, ?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET url=excluded.url, username=excluded.username, password=excluded.password, updated_at=excluded.updated_at`,
          [String(url), String(username), String(password)]
        );
      }

      if (aiConfigs !== null) {
        for (const cfg of aiConfigs) {
          if (!cfg || !cfg.name || !cfg.base_url) continue;
          await run(
            `INSERT INTO ai_configs (name, base_url, api_key, model, is_active, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [String(cfg.name), String(cfg.base_url), String(cfg.api_key || ''), String(cfg.model || ''), cfg.is_active ? 1 : 0]
          );
        }
      }

      if (hasSiteSettings) {
        const mergedSettings = new Map();
        if (Array.isArray(backup.tables.site_settings)) {
          for (const entry of backup.tables.site_settings) {
            if (!entry || !entry.key) continue;
            mergedSettings.set(String(entry.key), String(entry.value ?? ''));
          }
        }
        if (backup.siteSettings && typeof backup.siteSettings === 'object') {
          const s = backup.siteSettings;
          if (s.day_bg_url !== undefined) mergedSettings.set('day_bg_url', String(s.day_bg_url ?? ''));
          if (s.day_bg_overlay !== undefined) mergedSettings.set('day_bg_overlay', String(s.day_bg_overlay ?? DEFAULT_DAY_BG_OVERLAY));
          if (s.day_bg_preset !== undefined) mergedSettings.set('day_bg_preset', String(s.day_bg_preset ?? ''));
          if (s.night_bg_url !== undefined) mergedSettings.set('night_bg_url', String(s.night_bg_url ?? ''));
          if (s.night_bg_overlay !== undefined) mergedSettings.set('night_bg_overlay', String(s.night_bg_overlay ?? DEFAULT_NIGHT_BG_OVERLAY));
          if (s.night_bg_preset !== undefined) mergedSettings.set('night_bg_preset', String(s.night_bg_preset ?? ''));
          if (s.default_theme !== undefined) {
            try {
              mergedSettings.set('default_theme', validateDefaultTheme(s.default_theme, DEFAULT_THEME));
            } catch {
              mergedSettings.set('default_theme', DEFAULT_THEME);
            }
          }
          if (s.bg_history !== undefined) {
            mergedSettings.set('bg_history', JSON.stringify(normalizeBgHistory(s.bg_history)));
          }
          // 兼容旧版单背景字段
          if (s.site_bg_url !== undefined) mergedSettings.set('site_bg_url', String(s.site_bg_url ?? ''));
          if (s.site_bg_overlay !== undefined) mergedSettings.set('site_bg_overlay', String(s.site_bg_overlay ?? DEFAULT_NIGHT_BG_OVERLAY));
          if (s.site_bg_preset !== undefined) mergedSettings.set('site_bg_preset', String(s.site_bg_preset ?? ''));
        }

        const normalizedAppearance = buildAppearanceFromMap(mergedSettings);
        mergedSettings.set('day_bg_url', normalizedAppearance.day_bg_url);
        mergedSettings.set('day_bg_overlay', String(normalizedAppearance.day_bg_overlay));
        mergedSettings.set('day_bg_preset', normalizedAppearance.day_bg_preset);
        mergedSettings.set('night_bg_url', normalizedAppearance.night_bg_url);
        mergedSettings.set('night_bg_overlay', String(normalizedAppearance.night_bg_overlay));
        mergedSettings.set('night_bg_preset', normalizedAppearance.night_bg_preset);
        mergedSettings.set('default_theme', normalizedAppearance.default_theme);
        mergedSettings.set('bg_history', JSON.stringify(normalizedAppearance.bg_history));
        mergedSettings.set('site_bg_url', normalizedAppearance.site_bg_url);
        mergedSettings.set('site_bg_overlay', String(normalizedAppearance.site_bg_overlay));
        mergedSettings.set('site_bg_preset', normalizedAppearance.site_bg_preset);

        for (const [key, value] of mergedSettings.entries()) {
          await run(
            `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
            [key, value]
          );
        }
      }

      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await run('PRAGMA foreign_keys = ON').catch(() => {});
  }
}

function requestWebdav(target, method, username, password, body = '', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol)) return reject(new Error('WebDAV 地址必须使用 HTTP 或 HTTPS'));
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method,
      headers: {
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(username ? { Authorization: `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` } : {}),
        ...extraHeaders
      },
      timeout: 15000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => response.statusCode >= 200 && response.statusCode < 300
        ? resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) })
        : reject(new Error(`WebDAV 返回 HTTP ${response.statusCode}`)));
    });
    request.on('timeout', () => request.destroy(new Error('WebDAV 请求超时')));
    request.on('error', reject);
    request.end(body);
  });
}

function putWebdav(target, body, username, password, requestImpl = requestWebdav) {
  return requestImpl(target, 'PUT', username, password, body, { 'Content-Type': 'application/json; charset=utf-8' });
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function classifyBackupFilename(name) {
  const filename = String(name || '');
  if (/^nav-item-ai-backup-.*\.json$/i.test(filename)) {
    return { backupType: 'ai', label: '[AI变更前]' };
  }
  if (/^nav-item-backup-.*\.json$/i.test(filename)) {
    return { backupType: 'manual', label: '[手动]' };
  }
  return { backupType: 'other', label: '[云端]' };
}

function buildWebdavBackupTarget(baseUrl, { prefix = 'nav-item-backup', now = new Date() } = {}) {
  const target = new URL(baseUrl);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const isJsonPath = /\.json$/i.test(target.pathname);

  if (prefix === 'nav-item-ai-backup') {
    const dirPath = isJsonPath
      ? target.pathname.replace(/\/[^/]*$/, '')
      : target.pathname.replace(/\/+$/, '');
    target.pathname = `${dirPath}/${prefix}-${stamp}.json`;
    return target;
  }

  if (!isJsonPath) {
    target.pathname = `${target.pathname.replace(/\/+$/, '')}/${prefix}-${stamp}.json`;
  }
  return target;
}

function getWebdavDirectoryUrl(baseUrl) {
  const base = new URL(baseUrl);
  if (/\.json$/i.test(base.pathname)) {
    base.pathname = base.pathname.replace(/\/[^/]*$/, '/');
  } else if (!base.pathname.endsWith('/')) {
    base.pathname += '/';
  }
  return base;
}

async function listWebdav(target, username, password, requestImpl = requestWebdav) {
  const base = getWebdavDirectoryUrl(target);
  const response = await requestImpl(base, 'PROPFIND', username, password, '', { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' });
  const xml = response.body.toString('utf8');
  const items = [...xml.matchAll(/<[^:>]*:?response[^>]*>([\s\S]*?)<\/[^:>]*:?response>/gi)].map(match => {
    const block = match[1];
    const href = block.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/i)?.[1];
    const modified = block.match(/<[^:>]*:?getlastmodified[^>]*>([\s\S]*?)<\/[^:>]*:?getlastmodified>/i)?.[1];
    const size = block.match(/<[^:>]*:?getcontentlength[^>]*>([\s\S]*?)<\/[^:>]*:?getcontentlength>/i)?.[1];
    if (!href) return null;
    const fileUrl = new URL(decodeXml(href), base).toString();
    const pathname = new URL(fileUrl).pathname;
    if (pathname.endsWith('/') || !/\.json$/i.test(pathname)) return null;
    const name = decodeURIComponent(pathname.split('/').pop());
    const meta = classifyBackupFilename(name);
    return {
      name,
      url: fileUrl,
      modified: modified ? decodeXml(modified).trim() : '',
      size: Number(size) || 0,
      backupType: meta.backupType,
      label: meta.label
    };
  }).filter(Boolean);
  const unique = [...new Map(items.map(item => [item.url, item])).values()];
  unique.sort((a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0) || b.name.localeCompare(a.name));
  return unique;
}

async function pruneWebdavBackups(target, username, password, { backupType = null, requestImpl = requestWebdav } = {}) {
  const files = await listWebdav(target, username, password, requestImpl);
  const scoped = backupType ? files.filter(file => file.backupType === backupType) : files;
  const stale = scoped.slice(MAX_WEBDAV_BACKUPS);
  let removed = 0;
  for (const file of stale) {
    try {
      await requestImpl(file.url, 'DELETE', username, password);
      removed++;
    } catch {
      // 上传已经成功时，单个旧文件删除失败不应让用户误以为备份失败。
    }
  }
  return { kept: Math.min(scoped.length, MAX_WEBDAV_BACKUPS), removed };
}

async function getSavedWebdavConfig() {
  const row = await get('SELECT url, username, password FROM webdav_config WHERE id = 1');
  const url = String(row?.url || '').trim();
  return {
    configured: Boolean(url),
    url,
    username: String(row?.username || ''),
    password: String(row?.password || '')
  };
}

async function createAiAutoWebdavBackup({ requestImpl = requestWebdav, now = new Date() } = {}) {
  const cfg = await getSavedWebdavConfig();
  if (!cfg.configured) {
    throw new Error('尚未配置 WebDAV，请先在「用户管理」中设置 WebDAV 地址');
  }
  const target = buildWebdavBackupTarget(cfg.url, { prefix: 'nav-item-ai-backup', now });
  const backup = await createBackup();
  await putWebdav(target, JSON.stringify(backup, null, 2), cfg.username, cfg.password, requestImpl);
  try {
    await pruneWebdavBackups(cfg.url, cfg.username, cfg.password, { backupType: 'ai', requestImpl });
  } catch {
    // 清理旧备份失败不影响本次已成功上传的快照
  }
  const filename = decodeURIComponent(target.pathname.split('/').pop());
  return { filename, url: target.toString() };
}

router.get('/export', authMiddleware, async (req, res) => {
  try {
    res.json(await createBackup());
  } catch (error) {
    res.status(500).json({ message: `创建备份失败：${error.message}` });
  }
});

router.get('/webdav/config', authMiddleware, (req, res) => {
  db.get('SELECT url, username, password FROM webdav_config WHERE id = 1', (error, row) => {
    if (error) return res.status(500).json({ message: '读取 WebDAV 配置失败' });
    const data = row || { url: '', username: '', password: '' };
    res.json({ data: { ...data, configured: Boolean(String(data.url || '').trim()) } });
  });
});

router.put('/webdav/config', authMiddleware, (req, res) => {
  const { url = '', username = '', password = '' } = req.body || {};
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ message: 'WebDAV 地址必须使用 HTTP 或 HTTPS' });
  db.run(
    `INSERT INTO webdav_config (id, url, username, password, updated_at) VALUES (1, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET url=excluded.url, username=excluded.username, password=excluded.password, updated_at=excluded.updated_at`,
    [url.trim(), username.trim(), password],
    error => {
      if (error) return res.status(500).json({ message: '保存 WebDAV 配置失败' });
      res.json({ message: 'WebDAV 配置已保存到服务器' });
    }
  );
});

router.post('/restore', authMiddleware, async (req, res) => {
  try {
    await restoreBackup(req.body);
    res.json({ message: '备份还原成功，请刷新页面' });
  } catch (error) {
    res.status(400).json({ message: error.message || '备份还原失败' });
  }
});

router.post('/webdav', authMiddleware, async (req, res) => {
  try {
    const { url, username, password } = req.body || {};
    if (!url) return res.status(400).json({ message: '请输入 WebDAV 地址' });
    const target = buildWebdavBackupTarget(url, { prefix: 'nav-item-backup' });
    const backup = await createBackup();
    await putWebdav(target, JSON.stringify(backup, null, 2), username, password);
    const cleanup = await pruneWebdavBackups(url, username, password, { backupType: 'manual' });
    res.json({ message: `WebDAV 备份成功，已保留最新 ${cleanup.kept} 个手动备份`, url: target.toString() });
  } catch (error) {
    res.status(400).json({ message: `WebDAV 备份失败：${error.message}` });
  }
});

router.post('/webdav/list', authMiddleware, async (req, res) => {
  try {
    const { url, username, password } = req.body || {};
    if (!url) return res.status(400).json({ message: '请输入 WebDAV 地址' });
    res.json({ data: await listWebdav(url, username, password) });
  } catch (error) {
    res.status(400).json({ message: `读取 WebDAV 备份列表失败：${error.message}` });
  }
});

router.post('/webdav/restore', authMiddleware, async (req, res) => {
  try {
    const { fileUrl, url, username, password } = req.body || {};
    if (!fileUrl && !url) return res.status(400).json({ message: '请选择云端备份文件' });
    const response = await requestWebdav(fileUrl || url, 'GET', username, password);
    const backup = JSON.parse(response.body.toString('utf8'));
    await restoreBackup(backup);
    res.json({ message: '云端备份还原成功，请刷新页面' });
  } catch (error) {
    res.status(400).json({ message: `云端备份还原失败：${error.message}` });
  }
});

router.SCHEMA_VERSION = SCHEMA_VERSION;
router.createBackup = createBackup;
router.restoreBackup = restoreBackup;
router.validBackup = validBackup;
router.classifyBackupFilename = classifyBackupFilename;
router.buildWebdavBackupTarget = buildWebdavBackupTarget;
router.listWebdav = listWebdav;
router.getSavedWebdavConfig = getSavedWebdavConfig;
router.createAiAutoWebdavBackup = createAiAutoWebdavBackup;

module.exports = router;
