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

async function initMemoryDb() {
  const db = new sqlite3.Database(':memory:');
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

test('AI URL 归一化与模型列表解析兼容官方与中转地址', () => {
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
});

test('AI JSON 解析兼容思考过程标签与 Markdown 代码块', () => {
  const raw = `<think>先分析一下分类</think>\n\`\`\`json\n{"changes":[{"id":1,"title":"YouTube","desc":"视频平台"}]}\n\`\`\``;
  const parsed = aiModule.parseAiJson(raw);
  assert.equal(parsed.changes.length, 1);
  assert.equal(parsed.changes[0].title, 'YouTube');
});

test('AI 整理 Diff 计算正确过滤未变更项并校验合法栏目 ID', () => {
  const menus = [
    { id: 1, name: 'Home' },
    { id: 2, name: 'AI' }
  ];
  const subMenus = [
    { id: 10, parent_id: 2, name: 'AI Chat' }
  ];
  const cards = [
    { id: 100, menu_id: 1, sub_menu_id: null, title: 'chatgpt', url: 'https://chat.openai.com', desc: '' },
    { id: 101, menu_id: 1, sub_menu_id: null, title: 'GitHub', url: 'https://github.com', desc: '代码托管平台' }
  ];
  const diffs = aiModule.computeOrganizeDiff(cards, {
    changes: [
      { id: 100, menu_id: 999, sub_menu_id: 10, title: 'ChatGPT', desc: 'OpenAI 对话助手', reason: '归入 AI Chat 子菜单' },
      { id: 101, menu_id: 1, sub_menu_id: null, title: 'GitHub', desc: '代码托管平台' },
      { id: 9999, menu_id: 1, sub_menu_id: null, title: 'Fake' }
    ]
  }, menus, subMenus);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].id, 100);
  // 即使 AI 给了错误父 menu_id=999，根据 sub_menu_id=10 自动纠正为真实父菜单 2
  assert.equal(diffs[0].new_menu_id, 2);
  assert.equal(diffs[0].new_sub_menu_id, 10);
  assert.equal(diffs[0].old_category, 'Home');
  assert.equal(diffs[0].new_category, 'AI / AI Chat');
  assert.deepEqual(diffs[0].changed_fields, ['category', 'title', 'desc']);
});

test('卡片与栏目批量排序、筛选、移动、删除及 AI 全流程集成测试', async () => {
  const db = await initMemoryDb();
  let server;
  const moduleKeys = ['../routes/menu', '../routes/card', '../routes/ai'];
  const authCookie = `${COOKIE_NAME}=${jwt.sign({ id: 1, username: 'admin' }, JWT_SECRET, { expiresIn: 3600 })}`;

  try {
    // 清理初始化默认数据，构造干净测试夹具
    await run(db, 'DELETE FROM cards');
    await run(db, 'DELETE FROM sub_menus');
    await run(db, 'DELETE FROM menus');

    const m1 = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['Home', 1])).lastID;
    const m2 = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['AI Stuff', 2])).lastID;
    const sm1 = (await run(db, 'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [m2, 'AI Chat', 1])).lastID;
    const sm2 = (await run(db, 'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [m2, 'AI Tools', 2])).lastID;

    const c1 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?)',
      [m1, null, 'Youtube', 'https://youtube.com', 'https://yt/icon.png', '', 1])).lastID;
    const c2 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?)',
      [m1, null, 'Gmail', 'https://mail.google.com', '', '邮箱', 2])).lastID;
    const c3 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?)',
      [m1, null, 'chatgpt', 'https://chat.openai.com', '', '', 3])).lastID;

    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    for (const key of moduleKeys) delete require.cache[require.resolve(key)];

    const menuRouter = require('../routes/menu');
    const cardRouter = require('../routes/card');
    const { createAiRouter } = require('../routes/ai');

    const fetchCalls = [];
    const mockFetch = async (url, options = {}) => {
      fetchCalls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
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
                  changes: [
                    { id: c1, menu_id: m1, sub_menu_id: null, title: 'YouTube', desc: '全球视频分享平台', reason: '规范标题大小写并补全描述' },
                    { id: c3, menu_id: m2, sub_menu_id: sm1, title: 'ChatGPT', desc: 'OpenAI 智能对话助手', reason: '归类到 AI Chat 子菜单' }
                  ]
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
    app.use('/api/ai', createAiRouter({ fetchImpl: mockFetch }));

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

    // 1. 菜单与子菜单拖拽批量排序
    assert.equal((await api('/api/menus/reorder', 'PUT', {
      items: [{ id: m2, order: 1 }, { id: m1, order: 2 }]
    })).status, 200);
    assert.equal((await api('/api/menus/submenus/reorder', 'PUT', {
      items: [{ id: sm2, order: 1 }, { id: sm1, order: 2 }]
    })).status, 200);
    const menusAfter = await (await api('/api/menus')).json();
    assert.deepEqual(menusAfter.map(m => m.id), [m2, m1]);
    assert.deepEqual(menusAfter[0].subMenus.map(sm => sm.id), [sm2, sm1]);

    // 2. 卡片拖拽批量排序
    assert.equal((await api('/api/cards/reorder', 'PUT', {
      items: [{ id: c2, order: 1 }, { id: c1, order: 2 }, { id: c3, order: 3 }]
    })).status, 200);
    const cardsOrdered = await (await api(`/api/cards?menuId=${m1}&subMenuId=main`)).json();
    assert.deepEqual(cardsOrdered.map(c => c.id), [c2, c1, c3]);

    // 3. AI 接口配置 CRUD + 拉取模型 + AI 整理预览 + 勾选应用
    const createdCfg = await (await api('/api/ai/configs', 'POST', {
      name: '测试中转',
      base_url: 'https://relay.test/v1',
      api_key: 'sk-test-123'
    })).json();
    assert.equal(createdCfg.data.is_active, 1);

    const modelsRes = await (await api('/api/ai/models', 'POST', { config_id: createdCfg.data.id })).json();
    assert.deepEqual(modelsRes.models, ['deepseek-chat', 'gpt-4o-mini']);

    const organizeRes = await (await api('/api/ai/organize', 'POST', {
      config_id: createdCfg.data.id,
      model: 'gpt-4o-mini',
      prompt: ''
    })).json();
    assert.equal(organizeRes.used_default_prompt, true);
    assert.equal(organizeRes.changes.length, 2);

    // 仅勾选应用其中 1 条（c3 移动到 AI Chat），验证 c1 未被改动且 c3 已更新
    const c3Change = organizeRes.changes.find(item => item.id === c3);
    const applyRes = await (await api('/api/ai/apply', 'POST', { changes: [c3Change] })).json();
    assert.equal(applyRes.updated, 1);

    const dbCards = await all(db, 'SELECT * FROM cards ORDER BY id ASC');
    const updatedC1 = dbCards.find(c => c.id === c1);
    const updatedC3 = dbCards.find(c => c.id === c3);
    assert.equal(updatedC1.title, 'Youtube');
    assert.equal(updatedC1.logo_url, 'https://yt/icon.png');
    assert.equal(updatedC3.title, 'ChatGPT');
    assert.equal(updatedC3.menu_id, m2);
    assert.equal(updatedC3.sub_menu_id, sm1);

    // 4. 批量移动与批量删除
    assert.equal((await api('/api/cards/batch-move', 'POST', {
      ids: [c1, c2],
      menu_id: m2,
      sub_menu_id: sm2
    })).status, 200);
    const movedCards = await (await api(`/api/cards?menuId=${m2}&subMenuId=${sm2}`)).json();
    assert.equal(movedCards.length, 2);

    const delRes = await (await api('/api/cards/batch-delete', 'POST', { ids: [c1, c2] })).json();
    assert.equal(delRes.deleted, 2);
    const remaining = await (await api('/api/cards')).json();
    assert.deepEqual(remaining.map(c => c.id), [c3]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    delete require.cache[dbPath];
    for (const key of moduleKeys) delete require.cache[require.resolve(key)];
    await close(db);
  }
});
