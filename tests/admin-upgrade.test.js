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

test('第三方中转站响应兼容、JSON 容错解析与参数自动降级重试', async () => {
  // 1. 含思考块、尾部多余花括号与尾随逗号的 JSON 容错
  const messy = '<think>分析中</think>好的，结果如下：\n{"updates":[{"id":1,"title":"YouTube",}],"recycles":[]}\n注：{} 为空对象';
  const parsed = aiModule.parseAiJson(messy);
  assert.equal(parsed.updates[0].title, 'YouTube');

  // 2. 多模态块数组 content 兼容 & HTTP 200 内嵌 error 暴露
  const blockRes = aiModule.extractChatContent({
    choices: [{ message: { content: [{ type: 'text', text: '{"updates":[]}' }] }, finish_reason: 'stop' }]
  });
  assert.equal(blockRes.content, '{"updates":[]}');
  assert.throws(
    () => aiModule.extractChatContent({ error: { message: 'insufficient_quota' } }),
    /insufficient_quota/
  );

  // 3. 强制返回 SSE 流的中转站文本重建
  const sseText = [
    'data: {"choices":[{"delta":{"content":"{\\"updates\\":"}}]}',
    'data: {"choices":[{"delta":{"content":"[]}"},"finish_reason":"stop"}]}',
    'data: [DONE]'
  ].join('\n');
  const sseParsed = aiModule.parseSseStreamText(sseText);
  assert.equal(sseParsed.content, '{"updates":[]}');

  // 4. 优先 stream: true 流式拼接（含跨块拆分的 SSE 帧）以及不支持流式时自动降级为 stream: false
  const streamBodies = [];
  const encoder = new TextEncoder();
  const makeStreamResponse = (chunks) => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/event-stream']]),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    })
  });

  const streamRes = await aiModule.callChatCompletionsWithFallback(
    async (_url, opts) => {
      const body = JSON.parse(opts.body);
      streamBodies.push(body);
      const sseLine = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"updates":[{"id":1,"title":"YouTube"}],"recycles":[]}' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
      return makeStreamResponse([sseLine.slice(0, 42), sseLine.slice(42)]);
    },
    ['https://relay.test/v1/chat/completions'],
    {
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]
    }
  );
  assert.equal(streamBodies.length, 1);
  assert.equal(streamBodies[0].stream, true);
  assert.equal(aiModule.parseAiJson(streamRes.choices[0].message.content).updates[0].title, 'YouTube');

  // 中转站拒绝 stream: true 时自动降级为 stream: false 重试成功
  const seenBodies = [];
  const fallbackResult = await aiModule.callChatCompletionsWithFallback(
    async (_url, opts) => {
      const body = JSON.parse(opts.body);
      seenBodies.push(body);
      if (body.stream === true) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message: 'stream parameter is not supported' } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '{"updates":[],"recycles":[]}' } }] })
      };
    },
    ['https://relay.test/v1/chat/completions'],
    {
      apiKey: 'sk-test',
      model: 'custom-strict-model',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]
    }
  );
  assert.equal(seenBodies.length, 2);
  assert.equal(seenBodies[0].stream, true);
  assert.equal(seenBodies[1].stream, false);
  assert.equal(fallbackResult.choices[0].message.content, '{"updates":[],"recycles":[]}');
});

test('异步任务队列 start/status/cancel、小批次拆分合并与未保存配置直接拉取模型', async () => {
  const db = await initMemoryDb();
  let server;
  const moduleKeys = ['../routes/ai'];
  const authCookie = `${COOKIE_NAME}=${jwt.sign({ id: 1, username: 'admin' }, JWT_SECRET, { expiresIn: 3600 })}`;

  try {
    await run(db, 'DELETE FROM cards');
    await run(db, 'DELETE FROM sub_menus');
    await run(db, 'DELETE FROM menus');

    const m1 = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['Home', 1])).lastID;
    // 插入 32 张卡片，验证按 BATCH_SIZE=15 自动拆分为 3 批并合并结果
    const cardIds = [];
    for (let i = 1; i <= 32; i++) {
      const id = (await run(
        db,
        'INSERT INTO cards (menu_id, sub_menu_id, title, url, desc, "order", is_deleted) VALUES (?, NULL, ?, ?, "", ?, 0)',
        [m1, `site${i}`, `https://site${i}.example`, i]
      )).lastID;
      cardIds.push(id);
    }

    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    delete require.cache[require.resolve('../routes/ai')];
    const { createAiRouter, BATCH_SIZE } = require('../routes/ai');
    assert.ok(BATCH_SIZE >= 12 && BATCH_SIZE <= 15);

    const seenBatchSizes = [];
    const mockFetch = async (url, opts = {}) => {
      if (url.endsWith('/v1/models')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'claude-3-5-sonnet' }] })
        };
      }
      if (url.endsWith('/v1/chat/completions')) {
        const body = JSON.parse(opts.body);
        const payload = JSON.parse(body.messages[body.messages.length - 1].content);
        seenBatchSizes.push(payload.cards.length);
        const updates = payload.cards.map(c => ({
          id: c.id,
          menu_id: m1,
          sub_menu_id: null,
          title: c.title.toUpperCase(),
          desc: `站点 ${c.id} 说明`,
          reason: '补全描述'
        }));
        const contentStr = JSON.stringify({ updates, recycles: [], suggested_sub_menus: [] });
        return {
          ok: true,
          status: 200,
          text: async () => `data: ${JSON.stringify({ choices: [{ delta: { content: contentStr }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        };
      }
      return { ok: false, status: 404, text: async () => 'Not Found' };
    };

    const app = express();
    app.use(express.json());
    app.use('/api/ai', createAiRouter({
      fetchImpl: mockFetch,
      probeImpl: async () => ({ reachable: true, status: 200, page_title: 'OK', cf_detected: false, error_code: '', verdict: 'ok', summary: 'HTTP 200 正常' })
    }));

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

    // 1. 无需先保存配置，直接用表单的 base_url + api_key 拉取模型列表
    const rawModelsRes = await (await api('/api/ai/models', 'POST', {
      base_url: 'https://unsaved-relay.test',
      api_key: 'sk-unsaved'
    })).json();
    assert.deepEqual(rawModelsRes.models, ['claude-3-5-sonnet', 'gpt-4o-mini']);

    // 2. 创建未配置模型的接口，直接启动应返回明确引导错误
    const noModelCfg = await (await api('/api/ai/configs', 'POST', {
      name: '未配模型接口',
      base_url: 'https://relay.test/v1',
      api_key: 'sk-test'
    })).json();
    const rejectStart = await api('/api/ai/organize/start', 'POST', { config_id: noModelCfg.data.id });
    assert.equal(rejectStart.status, 400);
    assert.match((await rejectStart.json()).message, /尚未配置模型/);

    // 3. 更新接口保存模型后，启动异步任务并轮询至完成
    await api(`/api/ai/configs/${noModelCfg.data.id}`, 'PUT', { model: 'gpt-4o-mini' });
    const startRes = await (await api('/api/ai/organize/start', 'POST', {
      config_id: noModelCfg.data.id,
      scope: 'all'
    })).json();
    assert.ok(startRes.taskId);
    assert.equal(startRes.status, 'running');

    let statusData = null;
    for (let i = 0; i < 40; i++) {
      statusData = await (await api(`/api/ai/organize/status/${startRes.taskId}`)).json();
      if (statusData.status !== 'running') break;
      await new Promise(r => setTimeout(r, 25));
    }

    assert.equal(statusData.status, 'completed');
    assert.equal(statusData.progress, 100);
    assert.equal(statusData.result.updates.length, 32);
    assert.equal(statusData.result.batch_count, 3);
    assert.deepEqual(seenBatchSizes.sort((a, b) => b - a), [15, 15, 2]);

    // 4. 验证取消接口可正常取消任务
    const cancelRes = await api(`/api/ai/organize/cancel/${startRes.taskId}`, 'POST');
    assert.equal(cancelRes.status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    delete require.cache[dbPath];
    for (const key of moduleKeys) delete require.cache[require.resolve(key)];
    await close(db);
  }
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

    // 2. AI 配置 + 拉取模型 + 测活与整理预览（且临时切换模型不覆盖接口已保存的默认模型）
    const createdCfg = await (await api('/api/ai/configs', 'POST', {
      name: '中转接口',
      base_url: 'https://relay.test/v1',
      api_key: 'sk-test-123',
      model: 'saved-default-model'
    })).json();
    const modelsRes = await (await api('/api/ai/models', 'POST', { config_id: createdCfg.data.id })).json();
    assert.deepEqual(modelsRes.models, ['deepseek-chat', 'gpt-4o-mini']);

    const organizeRes = await (await api('/api/ai/organize', 'POST', {
      config_id: createdCfg.data.id,
      model: 'gpt-4o-mini',
      scope: 'smart',
      protect_main_direct: false
    })).json();
    assert.equal(organizeRes.probe_stats.total, 4);
    assert.equal(organizeRes.probe_stats.waf_403, 2);
    assert.equal(organizeRes.probe_stats.suspected_dead, 1);
    assert.equal(organizeRes.updates.length, 2);
    assert.equal(organizeRes.recycles.length, 2);

    // 验证已保存的默认模型未被临时执行模型覆盖
    const configsAfter = await (await api('/api/ai/configs')).json();
    assert.equal(configsAfter.data[0].model, 'saved-default-model');

    // 验证新增卡片接口同时支持 description 与 desc 字段
    const addedWithDescription = await (await api('/api/cards', 'POST', {
      menu_id: m1,
      title: 'DescTest',
      url: 'https://desctest.example',
      description: '通过 description 传入的描述'
    })).json();
    const addedRows = await all(db, 'SELECT desc FROM cards WHERE id = ?', [addedWithDescription.id]);
    assert.equal(addedRows[0].desc, '通过 description 传入的描述');
    await run(db, 'DELETE FROM cards WHERE id = ?', [addedWithDescription.id]);

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

test('主菜单直属保护逻辑与自定义 AI 模式指令透传', () => {
  const menus = [
    { id: 1, name: 'Home', sub_menus: [] },
    { id: 2, name: 'AI Stuff', sub_menus: [{ sub_menu_id: 10, name: 'AI Chat' }] }
  ];
  const subMenus = [{ id: 10, parent_id: 2, name: 'AI Chat' }];
  const cards = [
    { id: 1, menu_id: 1, sub_menu_id: null, title: 'chatgpt', url: 'https://chatgpt.com', desc: '' }
  ];

  // 开启主菜单直属保护时：即使 AI 试图移入子菜单 10，后端硬性保留在 Home 直属，仅允许标题与描述更新
  const protectedPlan = aiModule.computeOrganizePlan(
    cards,
    { updates: [{ id: 1, menu_id: 2, sub_menu_id: 10, title: 'ChatGPT', desc: 'AI 对话助手' }] },
    menus,
    subMenus,
    new Map(),
    { protectMainDirect: true }
  );
  assert.equal(protectedPlan.updates.length, 1);
  assert.equal(protectedPlan.updates[0].new_menu_id, 1);
  assert.equal(protectedPlan.updates[0].new_sub_menu_id, null);
  assert.deepEqual(protectedPlan.updates[0].changed_fields, ['title', 'desc']);

  // 关闭主菜单直属保护时：允许按 AI 建议移入子菜单 10
  const unprotectedPlan = aiModule.computeOrganizePlan(
    cards,
    { updates: [{ id: 1, menu_id: 2, sub_menu_id: 10, title: 'ChatGPT', desc: 'AI 对话助手' }] },
    menus,
    subMenus,
    new Map(),
    { protectMainDirect: false }
  );
  assert.equal(unprotectedPlan.updates[0].new_menu_id, 2);
  assert.equal(unprotectedPlan.updates[0].new_sub_menu_id, 10);
  assert.deepEqual(unprotectedPlan.updates[0].changed_fields, ['category', 'title', 'desc']);

  // 自定义 AI 整理模式提示词透传：包含主菜单直属语义与解除默认保守规则声明
  const customMsgs = aiModule.buildOrganizeMessages(
    menus,
    cards,
    '把 Home 直属只保留 8 个最常用站，其余移入对应子菜单',
    new Map(),
    new Map(),
    { scope: 'custom', protectMainDirect: false }
  );
  assert.match(customMsgs[0].content, /自定义 AI 整理模式/);
  assert.match(customMsgs[0].content, /主菜单直属/);
  assert.match(customMsgs[1].content, /把 Home 直属只保留 8 个最常用站/);
});

test('WebDAV AI 变更前自动备份命名区分与云端列表兼容识别', async () => {
  const backupRoutes = require('../routes/backup');
  const fixedDate = new Date('2026-11-25T08:30:44.235Z');

  // 1. 独立命名区分：手动 vs AI 变更前自动备份
  const manualTarget = backupRoutes.buildWebdavBackupTarget('https://dav.example.com/nav/', {
    prefix: 'nav-item-backup',
    now: fixedDate
  });
  const aiTarget = backupRoutes.buildWebdavBackupTarget('https://dav.example.com/nav/', {
    prefix: 'nav-item-ai-backup',
    now: fixedDate
  });
  assert.equal(manualTarget.pathname, '/nav/nav-item-backup-2026-11-25T08-30-44-235Z.json');
  assert.equal(aiTarget.pathname, '/nav/nav-item-ai-backup-2026-11-25T08-30-44-235Z.json');

  // 即使配置的 WebDAV 路径指向具体手动 .json 文件，AI 备份也放到同目录独立文件名，不覆盖手动备份
  const aiFromFileUrl = backupRoutes.buildWebdavBackupTarget('https://dav.example.com/nav/my-manual.json', {
    prefix: 'nav-item-ai-backup',
    now: fixedDate
  });
  assert.equal(aiFromFileUrl.pathname, '/nav/nav-item-ai-backup-2026-11-25T08-30-44-235Z.json');

  // 2. listWebdav 同时识别手动与 AI 自动备份并正确标注类别
  const mockPropfindXml = `<?xml version="1.0" encoding="utf-8"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:href>/nav/nav-item-ai-backup-2026-11-25T08-30-44-235Z.json</d:href>
        <d:propstat><d:prop>
          <d:getlastmodified>Wed, 25 Nov 2026 08:30:44 GMT</d:getlastmodified>
          <d:getcontentlength>2048</d:getcontentlength>
        </d:prop></d:propstat>
      </d:response>
      <d:response>
        <d:href>/nav/nav-item-backup-2026-11-25T08-00-00-000Z.json</d:href>
        <d:propstat><d:prop>
          <d:getlastmodified>Wed, 25 Nov 2026 08:00:00 GMT</d:getlastmodified>
          <d:getcontentlength>1024</d:getcontentlength>
        </d:prop></d:propstat>
      </d:response>
    </d:multistatus>`;

  const listed = await backupRoutes.listWebdav('https://dav.example.com/nav/', 'u', 'p', async () => ({
    statusCode: 207,
    headers: {},
    body: Buffer.from(mockPropfindXml)
  }));
  assert.equal(listed.length, 2);
  assert.equal(listed[0].backupType, 'ai');
  assert.equal(listed[0].label, '[AI变更前]');
  assert.equal(listed[1].backupType, 'manual');
  assert.equal(listed[1].label, '[手动]');
});

test('栏目 AI 整理、子菜单合并无损迁移卡片及 WebDAV 备份失败中止保护', async () => {
  const db = await initMemoryDb();
  let server;
  const authCookie = `${COOKIE_NAME}=${jwt.sign({ id: 1, username: 'admin' }, JWT_SECRET, { expiresIn: 3600 })}`;

  try {
    await run(db, 'DELETE FROM cards');
    await run(db, 'DELETE FROM sub_menus');
    await run(db, 'DELETE FROM menus');

    const mHome = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['Home', 1])).lastID;
    const mAi = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['ai stuff', 2])).lastID;
    const mEmpty = (await run(db, 'INSERT INTO menus (name, "order") VALUES (?, ?)', ['空栏目', 3])).lastID;

    const smChat = (await run(db, 'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [mAi, 'Al chat', 1])).lastID;
    const smDupChat = (await run(db, 'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [mAi, 'AI 对话重复', 2])).lastID;
    const smEmpty = (await run(db, 'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [mAi, '空子菜单', 3])).lastID;

    const cInChat = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, "order", is_deleted) VALUES (?, ?, ?, ?, 1, 0)', [mAi, smChat, 'ChatGPT', 'https://chatgpt.com'])).lastID;
    const cInDup1 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, "order", is_deleted) VALUES (?, ?, ?, ?, 1, 0)', [mAi, smDupChat, 'Claude', 'https://claude.ai'])).lastID;
    const cInDup2 = (await run(db, 'INSERT INTO cards (menu_id, sub_menu_id, title, url, "order", is_deleted) VALUES (?, ?, ?, ?, 2, 0)', [mAi, smDupChat, 'Gemini', 'https://gemini.google.com'])).lastID;

    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    delete require.cache[require.resolve('../routes/ai')];
    const { createAiRouter } = require('../routes/ai');

    let shouldFailBackup = true;
    let backupCalls = 0;
    const mockBackup = async () => {
      backupCalls++;
      if (shouldFailBackup) throw new Error('WebDAV 返回 HTTP 503');
      return {
        filename: 'nav-item-ai-backup-2026-11-25T08-30-44-235Z.json',
        url: 'https://dav.example.com/nav/nav-item-ai-backup-2026-11-25T08-30-44-235Z.json'
      };
    };

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              rename_menus: [{ id: mAi, new_name: 'AI Stuff', reason: '规范大小写' }],
              rename_sub_menus: [{ id: smChat, new_name: 'AI Chat', reason: '修正拼写 Al -> AI' }],
              reorder_menus: [mHome, mAi, mEmpty],
              reorder_sub_menus: [],
              merge_sub_menus: [{ source_id: smDupChat, target_id: smChat, reason: '重复的对话子菜单合并' }],
              add_menus: [],
              add_sub_menus: [{ parent_id: mAi, name: 'AI 绘图', reason: '补充常用子分类' }],
              delete_empty_menus: [{ id: mEmpty, reason: '无卡片无子菜单' }, { id: mAi, reason: '非空主菜单应被后端拦截' }],
              delete_empty_sub_menus: [{ id: smEmpty, reason: '无卡片空子菜单' }]
            })
          }
        }]
      })
    });

    const app = express();
    app.use(express.json());
    app.use('/api/ai', createAiRouter({ fetchImpl: mockFetch, backupImpl: mockBackup }));

    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = (endpoint, method = 'GET', body = null) => fetch(`${base}${endpoint}`, {
      method,
      headers: { Cookie: authCookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const cfg = await (await api('/api/ai/configs', 'POST', {
      name: 'Menu Test API',
      base_url: 'https://relay.test/v1',
      api_key: 'sk-test',
      model: 'gpt-5.6-luna'
    })).json();

    // 1. 自定义卡片整理未填指令应直接返回 400
    const badCustom = await api('/api/ai/organize/start', 'POST', { config_id: cfg.data.id, scope: 'custom', prompt: '' });
    assert.equal(badCustom.status, 400);

    // 2. 启动栏目 AI 整理异步任务并轮询至完成
    const startRes = await (await api('/api/ai/menus/organize/start', 'POST', { config_id: cfg.data.id })).json();
    assert.ok(startRes.taskId);

    let statusData;
    for (let i = 0; i < 40; i++) {
      statusData = await (await api(`/api/ai/organize/status/${startRes.taskId}`)).json();
      if (statusData.status !== 'running') break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(statusData.status, 'completed');
    const menuPlan = statusData.result;
    assert.equal(menuPlan.renames.length, 2);
    assert.equal(menuPlan.merges.length, 1);
    assert.equal(menuPlan.merges[0].card_count, 2);
    assert.equal(menuPlan.additions.length, 1);
    // 非空的 mAi 必须被后端安全拦截，deletions 只保留 mEmpty 与 smEmpty
    assert.equal(menuPlan.deletions.length, 2);

    // 3. 勾选自动备份但 WebDAV 失败 -> 必须返回 502 backup_failed 且数据库零修改
    const failedApply = await api('/api/ai/menus/apply', 'POST', { ...menuPlan, auto_backup: true });
    assert.equal(failedApply.status, 502);
    const failedBody = await failedApply.json();
    assert.equal(failedBody.backup_failed, true);
    const subMenusUnchanged = await all(db, 'SELECT * FROM sub_menus');
    assert.equal(subMenusUnchanged.length, 3);

    // 4. WebDAV 恢复正常 -> 先备份成功，再事务应用合并/重命名/新增/清理，验证零孤儿卡片
    shouldFailBackup = false;
    const okApply = await api('/api/ai/menus/apply', 'POST', { ...menuPlan, auto_backup: true });
    assert.equal(okApply.status, 200);
    const okBody = await okApply.json();
    assert.equal(backupCalls, 2);
    assert.equal(okBody.backup.filename, 'nav-item-ai-backup-2026-11-25T08-30-44-235Z.json');
    assert.equal(okBody.summary.merged, 1);
    assert.equal(okBody.summary.migrated_cards, 2);

    const menusAfter = await all(db, 'SELECT * FROM menus ORDER BY id ASC');
    assert.deepEqual(menusAfter.map(m => m.name), ['Home', 'AI Stuff']);

    const subMenusAfter = await all(db, 'SELECT * FROM sub_menus ORDER BY id ASC');
    assert.deepEqual(subMenusAfter.map(sm => sm.name), ['AI Chat', 'AI 绘图']);

    const cardsAfter = await all(db, 'SELECT id, menu_id, sub_menu_id FROM cards ORDER BY id ASC');
    assert.equal(cardsAfter.length, 3);
    // 原 smDupChat 的两张卡片全部无损迁移到 smChat，无孤儿卡片
    assert.deepEqual(cardsAfter.map(c => c.id), [cInChat, cInDup1, cInDup2]);
    assert.ok(cardsAfter.every(c => c.menu_id === mAi && c.sub_menu_id === smChat));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    delete require.cache[dbPath];
    delete require.cache[require.resolve('../routes/ai')];
    await close(db);
  }
});
