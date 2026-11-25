const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const { COOKIE_NAME, JWT_SECRET } = require('../routes/session');
const aiModule = require('../routes/ai');

const dbPath = path.resolve(__dirname, '../db.js');

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const close = db => new Promise((resolve, reject) => db.close(err => (err ? reject(err) : resolve())));

async function initMemoryDb(existingDb = null) {
  const db = existingDb || new sqlite3.Database(':memory:');
  const localRequire = createRequire(dbPath);
  vm.runInNewContext(fs.readFileSync(dbPath, 'utf8'), {
    require(name) {
      if (name === 'sqlite3') return { verbose: () => ({ Database: function () { return db; } }) };
      if (name === 'fs') return { existsSync: () => true };
      return localRequire(name);
    },
    __dirname: path.dirname(dbPath),
    module: { exports: {} },
    console: { log() {}, error() {}, warn() {} }
  }, { filename: dbPath });
  await db.ready;
  return db;
}

test('旧版 cards 表无损迁移新增软删除与回收站字段', async () => {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, 'CREATE TABLE menus (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, "order" INTEGER DEFAULT 0)');
    await run(db, 'INSERT INTO menus (id, name, "order") VALUES (1, "Home", 1)');
    await run(db, `CREATE TABLE cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER, sub_menu_id INTEGER,
      title TEXT NOT NULL, url TEXT NOT NULL, logo_url TEXT, custom_logo_path TEXT, desc TEXT, "order" INTEGER DEFAULT 0
    )`);
    await run(db, 'INSERT INTO cards (menu_id, title, url) VALUES (1, "OldSite", "https://old.example")');

    await initMemoryDb(db);
    const rows = await all(db, 'SELECT id, title, is_deleted, deleted_at, recycle_reason FROM cards');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'OldSite');
    assert.equal(rows[0].is_deleted, 0);
    assert.equal(rows[0].deleted_at, null);
    assert.equal(rows[0].recycle_reason, null);
  } finally {
    await close(db);
  }
});

test('AI URL 归一化、模型列表与 HTML Title 提取及测活判定', async () => {
  assert.deepEqual(aiModule.buildModelsCandidateUrls('https://api.openai.com/v1/'), [
    'https://api.openai.com/v1/models'
  ]);
  assert.deepEqual(aiModule.buildModelsCandidateUrls('https://relay.example.com'), [
    'https://relay.example.com/v1/models',
    'https://relay.example.com/models'
  ]);
  assert.deepEqual(aiModule.buildChatCandidateUrls('https://generativelanguage.googleapis.com/v1beta/openai'), [
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  ]);
  assert.deepEqual(aiModule.extractModels({
    data: [{ id: 'gpt-4o-mini' }, { id: 'claude-3-5-sonnet' }, { id: 'gpt-4o-mini' }]
  }), ['claude-3-5-sonnet', 'gpt-4o-mini']);

  // 403 Cloudflare 盾提取 title 供 AI 判断，不误杀
  const cfProbe = await aiModule.probeUrl('https://cf-protected.example', {
    checkPublicHost: false,
    fetchImpl: async () => ({
      status: 403,
      headers: new Map([['content-type', 'text/html'], ['server', 'cloudflare'], ['cf-ray', 'abc123']]),
      text: async () => '<html><head><title>Just a moment...</title></head><body>Checking</body></html>'
    })
  });
  assert.equal(cfProbe.verdict, 'waf_403');
  assert.equal(cfProbe.cf_detected, true);
  assert.equal(cfProbe.page_title, 'Just a moment...');

  // 域名过期停放页
  const expiredProbe = await aiModule.probeUrl('https://expired.example', {
    checkPublicHost: false,
    fetchImpl: async () => ({
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html><head><title>This domain is for sale - Sedo</title></head></html>'
    })
  });
  assert.equal(expiredProbe.verdict, 'suspected_domain_expired');

  // 404 疑似死链
  const deadProbe = await aiModule.probeUrl('https://dead.example/404', {
    checkPublicHost: false,
    fetchImpl: async () => ({
      status: 404,
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html><head><title>404 Not Found</title></head></html>'
    })
  });
  assert.equal(deadProbe.verdict, 'suspected_dead_link');
});

test('AI 整理方案计算：防硬塞 needs_review、回收站分离与 >=3 张卡片才允许建议新增子菜单', () => {
  const menus = [
    { id: 1, name: 'Home' },
    { id: 2, name: 'AI' }
  ];
  const subMenus = [
    { id: 10, parent_id: 2, name: 'AI Chat' }
  ];
  const cards = [
    { id: 100, menu_id: 1, sub_menu_id: null, title: 'chatgpt', url: 'https://chat.openai.com', desc: '' },
    { id: 101, menu_id: 1, sub_menu_id: null, title: 'WeirdSite', url: 'https://weird.example', desc: '跨界站' },
    { id: 102, menu_id: 1, sub_menu_id: null, title: 'DeadSite', url: 'https://dead.example', desc: '' },
    { id: 103, menu_id: 1, sub_menu_id: null, title: 'ToolA', url: 'https://a.example', desc: 'A' },
    { id: 104, menu_id: 1, sub_menu_id: null, title: 'ToolB', url: 'https://b.example', desc: 'B' },
    { id: 105, menu_id: 1, sub_menu_id: null, title: 'ToolC', url: 'https://c.example', desc: 'C' }
  ];

  const plan = aiModule.computeOrganizePlan(cards, {
    updates: [
      { id: 100, menu_id: 999, sub_menu_id: 10, title: 'ChatGPT', desc: 'OpenAI 对话助手', reason: '归入 AI Chat' },
      { id: 101, menu_id: 1, sub_menu_id: null, title: 'WeirdSite', desc: '跨界站', needs_review: true, reason: '跨界歧义，保持原位待复核' },
      // 102 同时出现在 recycles 和 updates 中，应优先保留在 recycles
      { id: 102, menu_id: 2, sub_menu_id: null, title: 'DeadSite', desc: '测试' }
    ],
    recycles: [
      { id: 102, recycle_reason: 'dead_link', reason: 'NXDOMAIN 无法解析' }
    ],
    suggested_sub_menus: [
      { parent_menu_id: 1, name: '有效建议', reason: '3张同类站', card_ids: [103, 104, 105] },
      { parent_menu_id: 1, name: '不足三张应忽略', reason: '只有2张', card_ids: [103, 104] }
    ]
  }, menus, subMenus);

  assert.equal(plan.recycles.length, 1);
  assert.equal(plan.recycles[0].id, 102);
  assert.equal(plan.recycles[0].recycle_reason, 'dead_link');

  assert.equal(plan.updates.length, 2);
  assert.equal(plan.updates[0].new_menu_id, 2);
  assert.equal(plan.updates[0].new_sub_menu_id, 10);
  assert.equal(plan.updates[1].id, 101);
  assert.equal(plan.updates[1].needs_review, true);

  assert.equal(plan.suggested_sub_menus.length, 1);
  assert.equal(plan.suggested_sub_menus[0].name, '有效建议');
  assert.deepEqual(plan.suggested_sub_menus[0].card_ids, [103, 104, 105]);
});

test('拖拽排序、分类回收站完整流转、后端测活与 AI 智能整理端到端集成测试', async () => {
  const db = await initMemoryDb();
  let server;
  const moduleKeys = ['../routes/menu', '../routes/card', '../routes/ai'];
  const authCookie = `${COOKIE_NAME}=${jwt.sign({ id: 1, username: 'admin' }, JWT_SECRET, { expiresIn: 3600 })}`;

  try {
    await run(db, 'DELETE FROM cards');
    await run(db, 'DELETE FROM sub_menus');
    await run(db, 'DELETE FROM menus');

    const m1 = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['Home', 1])).lastID;
    const m2 = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['AI Stuff', 2])).lastID;
    const sm1 = (await run(db, 'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [m2, 'AI Chat', 1])).lastID;
    const sm2 = (await run(db, 'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [m2, 'AI Tools', 2])).lastID;

    const c1 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order", is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [m1, null, 'Youtube', 'https://youtube.com', 'https://yt/icon.png', '', 1])).lastID;
    const c2 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order", is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [m1, null, 'DeadBlog', 'https://dead-blog.invalid', '', '旧博客', 2])).lastID;
    const c3 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order", is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [m1, null, 'chatgpt', 'https://chat.openai.com', '', '', 3])).lastID;
    const c4 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order", is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [m2, sm1, 'ChatGPT 重复', 'https://chat.openai.com/', '', '', 1])).lastID;

    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    for (const key of moduleKeys) delete require.cache[require.resolve(key)];

    const menuRouter = require('../routes/menu');
    const cardRouter = require('../routes/card');
    const { createAiRouter } = require('../routes/ai');

    const mockProbe = async (url) => {
      if (url.includes('dead-blog.invalid')) {
        return { reachable: false, status: null, page_title: '', cf_detected: false, error_code: 'NXDOMAIN', verdict: 'suspected_dead_link', summary: 'DNS 无法解析 (NXDOMAIN)' };
      }
      if (url.includes('chat.openai.com')) {
        return { reachable: true, status: 403, page_title: 'Just a moment...', cf_detected: true, error_code: 'HTTP_403', verdict: 'waf_403', summary: 'HTTP 403 (疑似 Cloudflare/WAF 盾)' };
      }
      return { reachable: true, status: 200, page_title: 'OK', cf_detected: false, error_code: '', verdict: 'ok', summary: 'HTTP 200 正常' };
    };

    const mockFetch = async (url) => {
      if (url.endsWith('/v1/models')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'deepseek-chat' }] })
        };
      }
      if (url.endsWith('/v1/chat/completions')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  updates: [
                    { id: c1, menu_id: m1, sub_menu_id: null, title: 'YouTube', desc: '全球视频分享平台', reason: '规范大小写并补全描述' },
                    { id: c3, menu_id: m2, sub_menu_id: sm1, title: 'ChatGPT', desc: 'OpenAI 对话助手', reason: '403 为 CF 盾放行，归入 AI Chat' }
                  ],
                  recycles: [
                    { id: c2, recycle_reason: 'dead_link', reason: 'DNS 无法解析 (NXDOMAIN)' },
                    { id: c4, recycle_reason: 'duplicate', reason: '与 ChatGPT 链接重复' }
                  ],
                  suggested_sub_menus: []
                })
              }
            }]
          })
        };
      }
      return { ok: false, status: 404, text: async () => 'Not Found' };
    };

    const app = express();
    app.use(express.json());
    app.use('/api/menus', menuRouter);
    app.use('/api/cards', cardRouter);
    app.use('/api/ai', createAiRouter({ fetchImpl: mockFetch, probeImpl: mockProbe }));

    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = (endpoint, method = 'GET', body = null) => fetch(`${base}${endpoint}`, {
      method,
      headers: {
        Cookie: authCookie,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    // 1. 菜单与卡片拖拽批量排序
    assert.equal((await api('/api/menus/reorder', 'PUT', { items: [{ id: m2, order: 1 }, { id: m1, order: 2 }] })).status, 200);
    assert.equal((await api('/api/menus/submenus/reorder', 'PUT', { items: [{ id: sm2, order: 1 }, { id: sm1, order: 2 }] })).status, 200);
    assert.equal((await api('/api/cards/reorder', 'PUT', { items: [{ id: c3, order: 1 }, { id: c1, order: 2 }, { id: c2, order: 3 }] })).status, 200);

    // 2. AI 配置 + 拉取模型 + 测活与整理预览
    const createdCfg = await (await api('/api/ai/configs', 'POST', {
      name: '中转接口',
      base_url: 'https://relay.test/v1',
      api_key: 'sk-test-123'
    })).json();
    const modelsRes = await (await api('/api/ai/models', 'POST', { config_id: createdCfg.data.id })).json();
    assert.deepEqual(modelsRes.models, ['deepseek-chat', 'gpt-4o-mini']);

    const organizeRes = await (await api('/api/ai/organize', 'POST', {
      config_id: createdCfg.data.id,
      model: 'gpt-4o-mini',
      scope: 'smart'
    })).json();
    assert.equal(organizeRes.probe_stats.total, 4);
    assert.equal(organizeRes.probe_stats.waf_403, 2);
    assert.equal(organizeRes.probe_stats.suspected_dead, 1);
    assert.equal(organizeRes.updates.length, 2);
    assert.equal(organizeRes.recycles.length, 2);

    // 3. 应用更改（同时更新 2 张 + 移入回收站 2 张）
    const applyRes = await (await api('/api/ai/apply', 'POST', {
      updates: organizeRes.updates,
      recycles: organizeRes.recycles
    })).json();
    assert.equal(applyRes.updated, 2);
    assert.equal(applyRes.recycled, 2);

    // 4. 验证前台导航页自动过滤已软删除卡片
    const homeCards = await (await api(`/api/cards/${m1}`)).json();
    assert.deepEqual(homeCards.map(c => c.id), [c1]);
    assert.equal(homeCards[0].title, 'YouTube');
    const aiChatCards = await (await api(`/api/cards/${m2}?subMenuId=${sm1}`)).json();
    assert.deepEqual(aiChatCards.map(c => c.id), [c3]);

    // 5. 验证回收站双维度筛选、计数、还原、手动移入回收站、彻底删除与清空
    const countRes = await (await api('/api/cards/recycle/count')).json();
    assert.equal(countRes.count, 2);

    const deadOnly = await (await api('/api/cards/recycle?reason=dead_link')).json();
    assert.equal(deadOnly.data.length, 1);
    assert.equal(deadOnly.data[0].id, c2);
    assert.equal(deadOnly.counts.total, 2);
    assert.equal(deadOnly.counts.dead_link, 1);
    assert.equal(deadOnly.counts.duplicate, 1);

    const dupByMenu = await (await api(`/api/cards/recycle?reason=duplicate&menuId=${m2}&subMenuId=${sm1}`)).json();
    assert.equal(dupByMenu.data.length, 1);
    assert.equal(dupByMenu.data[0].id, c4);

    // 还原 c2 至原主菜单 Home
    const restoreRes = await (await api('/api/cards/recycle/restore', 'POST', { ids: [c2] })).json();
    assert.equal(restoreRes.restored, 1);
    const homeAfterRestore = await (await api(`/api/cards/${m1}`)).json();
    assert.equal(homeAfterRestore.length, 2);

    // 手动删除 c1 -> 软删除进回收站 (manual)
    assert.equal((await api(`/api/cards/${c1}`, 'DELETE')).status, 200);
    const manualRecycled = await (await api('/api/cards/recycle?reason=manual')).json();
    assert.equal(manualRecycled.data.length, 1);
    assert.equal(manualRecycled.data[0].id, c1);

    // 彻底删除 c4
    const permDel = await (await api('/api/cards/recycle/permanent-delete', 'POST', { ids: [c4] })).json();
    assert.equal(permDel.deleted, 1);

    // 一键清空回收站剩余（c1）
    const emptyRes = await (await api('/api/cards/recycle/empty', 'DELETE')).json();
    assert.equal(emptyRes.deleted, 1);
    const finalCount = await (await api('/api/cards/recycle/count')).json();
    assert.equal(finalCount.count, 0);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    delete require.cache[dbPath];
    for (const key of moduleKeys) delete require.cache[require.resolve(key)];
    await close(db);
  }
});
