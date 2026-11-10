const express = require('express');
const http = require('http');
const https = require('https');
const authMiddleware = require('./authMiddleware');
const db = require('../db');

const router = express.Router();
const TABLES = ['menus', 'sub_menus', 'cards', 'users', 'friends'];

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
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
  return {
    format: 'nav-item-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    tables
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
    for (const row of backup.tables.cards) await run('INSERT INTO cards (id, menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [row.id, row.menu_id, row.sub_menu_id, row.title, row.url, row.logo_url, row.custom_logo_path, row.desc, row.order || 0]);
    for (const row of backup.tables.users) await run('INSERT INTO users (id, username, password, current_login_at, current_login_ip, last_login_at, last_login_ip) VALUES (?, ?, ?, ?, ?, ?, ?)', [row.id, row.username, row.password, row.current_login_at, row.current_login_ip, row.last_login_at, row.last_login_ip]);
    for (const row of backup.tables.friends) await run('INSERT INTO friends (id, title, url, logo) VALUES (?, ?, ?, ?)', [row.id, row.title, row.url, row.logo]);
    await run('PRAGMA foreign_keys = ON');
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    await run('PRAGMA foreign_keys = ON');
    throw error;
  }
}

function putWebdav(target, body, username, password) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol)) return reject(new Error('WebDAV 地址必须使用 HTTP 或 HTTPS'));
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...(username ? { Authorization: `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` } : {})
      },
      timeout: 10000
    }, response => {
      response.resume();
      response.on('end', () => response.statusCode >= 200 && response.statusCode < 300
        ? resolve(response.statusCode)
        : reject(new Error(`WebDAV 返回 HTTP ${response.statusCode}`)));
    });
    request.on('timeout', () => request.destroy(new Error('WebDAV 请求超时')));
    request.on('error', reject);
    request.end(body);
  });
}

router.get('/export', authMiddleware, async (req, res) => {
  try {
    res.json(await createBackup());
  } catch (error) {
    res.status(500).json({ message: `创建备份失败：${error.message}` });
  }
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
    const target = new URL(url);
    if (target.pathname.endsWith('/')) target.pathname += `nav-item-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const backup = await createBackup();
    await putWebdav(target, JSON.stringify(backup, null, 2), username, password);
    res.json({ message: 'WebDAV 备份成功', url: target.toString() });
  } catch (error) {
    res.status(400).json({ message: `WebDAV 备份失败：${error.message}` });
  }
});

module.exports = router;
