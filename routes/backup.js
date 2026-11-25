const express = require('express');
const http = require('http');
const https = require('https');
const authMiddleware = require('./authMiddleware');
const db = require('../db');

const router = express.Router();
const TABLES = ['menus', 'sub_menus', 'cards', 'users', 'friends'];
const MAX_WEBDAV_BACKUPS = 8;

// 配置保存在服务端 SQLite 数据库，Docker 持久化 database 目录后即可跨刷新和重启保留。
db.run(`CREATE TABLE IF NOT EXISTS webdav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL DEFAULT '',
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',
  updated_at TEXT
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
  const tables = {};
  for (const table of TABLES) tables[table] = await all(`SELECT * FROM ${table}`);
  const webdavConfig = await new Promise((resolve, reject) => {
    db.get('SELECT url, username, password FROM webdav_config WHERE id = 1', (error, row) => {
      if (error) reject(error);
      else resolve(row || { url: '', username: '', password: '' });
    });
  });
  let aiConfigs = [];
  try {
    aiConfigs = await all('SELECT id, name, base_url, api_key, model, is_active FROM ai_configs ORDER BY id ASC');
  } catch {
    aiConfigs = [];
  }
  return {
    format: 'nav-item-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    tables,
    webdavConfig,
    aiConfigs
  };
}

function validBackup(value) {
  return value && value.format === 'nav-item-backup' && value.tables &&
    TABLES.every(table => Array.isArray(value.tables[table]));
}

async function restoreBackup(backup) {
  if (!validBackup(backup)) throw new Error('备份文件格式无效');
  await run('BEGIN TRANSACTION');
  try {
    await run('PRAGMA foreign_keys = OFF');
    for (const table of [...TABLES].reverse()) await run(`DELETE FROM ${table}`);
    for (const row of backup.tables.menus) await run('INSERT INTO menus (id, name, "order") VALUES (?, ?, ?)', [row.id, row.name, row.order || 0]);
    for (const row of backup.tables.sub_menus) await run('INSERT INTO sub_menus (id, parent_id, name, "order") VALUES (?, ?, ?, ?)', [row.id, row.parent_id, row.name, row.order || 0]);
    for (const row of backup.tables.cards) await run('INSERT INTO cards (id, menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order", is_deleted, deleted_at, recycle_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [row.id, row.menu_id, row.sub_menu_id, row.title, row.url, row.logo_url, row.custom_logo_path, row.desc, row.order || 0, row.is_deleted ? 1 : 0, row.deleted_at || null, row.recycle_reason || null]);
    for (const row of backup.tables.users) await run('INSERT INTO users (id, username, password, current_login_at, current_login_ip, last_login_at, last_login_ip) VALUES (?, ?, ?, ?, ?, ?, ?)', [row.id, row.username, row.password, row.current_login_at, row.current_login_ip, row.last_login_at, row.last_login_ip]);
    for (const row of backup.tables.friends) await run('INSERT INTO friends (id, title, url, logo) VALUES (?, ?, ?, ?)', [row.id, row.title, row.url, row.logo]);
    if (backup.webdavConfig && typeof backup.webdavConfig === 'object') {
      const { url = '', username = '', password = '' } = backup.webdavConfig;
      await run(`INSERT INTO webdav_config (id, url, username, password, updated_at) VALUES (1, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET url=excluded.url, username=excluded.username, password=excluded.password, updated_at=excluded.updated_at`,
      [String(url), String(username), String(password)]);
    }
    if (Array.isArray(backup.aiConfigs)) {
      await run('DELETE FROM ai_configs');
      for (const cfg of backup.aiConfigs) {
        if (!cfg || !cfg.name || !cfg.base_url) continue;
        await run(
          `INSERT INTO ai_configs (name, base_url, api_key, model, is_active, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [String(cfg.name), String(cfg.base_url), String(cfg.api_key || ''), String(cfg.model || ''), cfg.is_active ? 1 : 0]
        );
      }
    }
    await run('PRAGMA foreign_keys = ON');
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    await run('PRAGMA foreign_keys = ON');
    throw error;
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
        ...(username ? { Authorization: `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` } : {})
        , ...extraHeaders
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

  // 手动备份：若明确填写 .json 文件直接覆盖，否则在目录下生成带时间文件名
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
  db.run(`INSERT INTO webdav_config (id, url, username, password, updated_at) VALUES (1, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET url=excluded.url, username=excluded.username, password=excluded.password, updated_at=excluded.updated_at`,
  [url.trim(), username.trim(), password], error => {
    if (error) return res.status(500).json({ message: '保存 WebDAV 配置失败' });
    res.json({ message: 'WebDAV 配置已保存到服务器' });
  });
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

router.classifyBackupFilename = classifyBackupFilename;
router.buildWebdavBackupTarget = buildWebdavBackupTarget;
router.listWebdav = listWebdav;
router.getSavedWebdavConfig = getSavedWebdavConfig;
router.createAiAutoWebdavBackup = createAiAutoWebdavBackup;

module.exports = router;
