const express = require('express');
const db = require('../db');
const auth = require('./authMiddleware');

const DEFAULT_ORGANIZE_PROMPT = [
  '请根据现有主菜单和子菜单结构，对提供的网站导航卡片进行智能归类与信息优化：',
  '1. 智能归类：识别每个网站的实际用途，将未分类或分类不合理的卡片归入最匹配的主菜单或子菜单（若有合适的子菜单优先归入子菜单，否则归入对应主菜单）；原本分类已合理的保持不变。',
  '2. 描述补全与优化：为缺少描述（空字符串）或描述过于敷衍/重复标题的卡片，补全简洁准确的中文描述（控制在 6~18 个字以内，说明核心功能即可）；已有清晰中文描述的可保留或微调。',
  '3. 标题规范化：统一常见网站名称的大小写与书写规范（如 Youtube -> YouTube，github -> GitHub，chatgpt -> ChatGPT，Huggingface -> Hugging Face，Deepseek -> DeepSeek，ip.sb -> IP.SB，webssh -> WebSSH 等），但不要随意更改用户自定义的中文简称。'
].join('\n');

const BATCH_SIZE = 50;

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

function ensureAiTable() {
  return run(`CREATE TABLE IF NOT EXISTS ai_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT DEFAULT '',
    is_active INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

function normalizeBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('请输入 API Base URL');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('API Base URL 格式无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('API Base URL 必须使用 HTTP 或 HTTPS');
  }
  return trimmed;
}

function buildModelsCandidateUrls(baseUrl) {
  const clean = normalizeBaseUrl(baseUrl);
  if (/\/models$/i.test(clean)) return [clean];
  if (/\/v\d+(?:beta\d*)?(?:\/openai)?$/i.test(clean)) return [`${clean}/models`];
  return [`${clean}/v1/models`, `${clean}/models`];
}

function buildChatCandidateUrls(baseUrl) {
  const clean = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(clean)) return [clean];
  if (/\/v\d+(?:beta\d*)?(?:\/openai)?$/i.test(clean)) return [`${clean}/chat/completions`];
  return [`${clean}/v1/chat/completions`, `${clean}/chat/completions`];
}

function extractModels(payload) {
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];

  const names = rawList
    .map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const raw = item.id || item.name || item.model || '';
        return String(raw).trim().replace(/^models\//, '');
      }
      return '';
    })
    .filter(Boolean);

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function parseAiJson(rawText) {
  if (rawText && typeof rawText === 'object') return rawText;
  let text = String(rawText || '').trim();
  if (!text) throw new Error('AI 返回内容为空');

  // 移除推理模型可能输出的 <think>...</think> 标签
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 优先提取 ```json ... ``` 或 ``` ... ``` 代码块
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // 回退到下面的通用括号提取
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    // 尝试提取最外层 JSON 对象或数组
    const firstObj = text.indexOf('{');
    const lastObj = text.lastIndexOf('}');
    if (firstObj !== -1 && lastObj > firstObj) {
      try {
        return JSON.parse(text.slice(firstObj, lastObj + 1));
      } catch {
        // 继续尝试数组
      }
    }
    const firstArr = text.indexOf('[');
    const lastArr = text.lastIndexOf(']');
    if (firstArr !== -1 && lastArr > firstArr) {
      try {
        return JSON.parse(text.slice(firstArr, lastArr + 1));
      } catch {
        // 解析失败
      }
    }
    throw new Error('无法解析 AI 返回的 JSON 结果，请重试或更换模型');
  }
}

function formatCategoryLabel(menuId, subMenuId, menuById, subMenuById) {
  if (subMenuId && subMenuById.has(subMenuId)) {
    const sub = subMenuById.get(subMenuId);
    const parent = menuById.get(sub.parent_id);
    return parent ? `${parent.name} / ${sub.name}` : sub.name;
  }
  if (menuId && menuById.has(menuId)) {
    return menuById.get(menuId).name;
  }
  return '未分类';
}

function computeOrganizeDiff(cards, rawChanges, menus, subMenus) {
  const menuById = new Map(menus.map(m => [Number(m.id), m]));
  const subMenuById = new Map(subMenus.map(sm => [Number(sm.id), sm]));
  const cardById = new Map(cards.map(c => [Number(c.id), c]));

  const list = Array.isArray(rawChanges)
    ? rawChanges
    : Array.isArray(rawChanges?.changes)
      ? rawChanges.changes
      : Array.isArray(rawChanges?.cards)
        ? rawChanges.cards
        : Array.isArray(rawChanges?.items)
          ? rawChanges.items
          : [];

  const seenIds = new Set();
  const diffs = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const cardId = Number(item.id);
    if (!cardById.has(cardId) || seenIds.has(cardId)) continue;
    seenIds.add(cardId);

    const card = cardById.get(cardId);
    const oldSubMenuId = card.sub_menu_id ? Number(card.sub_menu_id) : null;
    const oldMenuId = oldSubMenuId && subMenuById.has(oldSubMenuId)
      ? Number(subMenuById.get(oldSubMenuId).parent_id)
      : (card.menu_id ? Number(card.menu_id) : null);

    let newSubMenuId = oldSubMenuId;
    let newMenuId = oldMenuId;

    const hasSubMenuField = Object.prototype.hasOwnProperty.call(item, 'sub_menu_id');
    const hasMenuField = Object.prototype.hasOwnProperty.call(item, 'menu_id');

    if (hasSubMenuField || hasMenuField) {
      const candidateSub = item.sub_menu_id !== null && item.sub_menu_id !== '' && item.sub_menu_id !== undefined
        ? Number(item.sub_menu_id)
        : null;
      const candidateMenu = item.menu_id !== null && item.menu_id !== '' && item.menu_id !== undefined
        ? Number(item.menu_id)
        : null;

      if (candidateSub && subMenuById.has(candidateSub)) {
        newSubMenuId = candidateSub;
        newMenuId = Number(subMenuById.get(candidateSub).parent_id);
      } else if (candidateMenu && menuById.has(candidateMenu)) {
        newMenuId = candidateMenu;
        newSubMenuId = null;
      }
    }

    const oldTitle = String(card.title || '').trim();
    const oldDesc = String(card.desc || '').trim();
    const newTitle = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : oldTitle;
    const newDesc = typeof item.desc === 'string' ? item.desc.trim() : oldDesc;

    const changedFields = [];
    if (newMenuId !== oldMenuId || newSubMenuId !== oldSubMenuId) changedFields.push('category');
    if (newTitle !== oldTitle) changedFields.push('title');
    if (newDesc !== oldDesc) changedFields.push('desc');

    if (!changedFields.length) continue;

    diffs.push({
      id: cardId,
      url: card.url,
      old_menu_id: oldMenuId,
      old_sub_menu_id: oldSubMenuId,
      old_category: formatCategoryLabel(oldMenuId, oldSubMenuId, menuById, subMenuById),
      new_menu_id: newMenuId,
      new_sub_menu_id: newSubMenuId,
      new_category: formatCategoryLabel(newMenuId, newSubMenuId, menuById, subMenuById),
      old_title: oldTitle,
      new_title: newTitle,
      old_desc: oldDesc,
      new_desc: newDesc,
      changed_fields: changedFields,
      reason: typeof item.reason === 'string' ? item.reason.trim() : ''
    });
  }

  return diffs;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function requestOpenAiJson(fetchImpl, candidateUrls, { method = 'GET', apiKey, body, timeoutMs = 20000 }) {
  const headers = {
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  };

  let lastError = null;
  for (let i = 0; i < candidateUrls.length; i++) {
    const url = candidateUrls[i];
    const response = await fetchWithTimeout(fetchImpl, url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    }, timeoutMs);

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (response.ok) {
      if (parsed === null) throw new Error('上游接口返回的不是有效的 JSON 数据');
      return parsed;
    }

    const upstreamMessage = parsed?.error?.message || parsed?.message || text.slice(0, 200) || `HTTP ${response.status}`;
    lastError = new Error(`接口请求失败 (${response.status}): ${upstreamMessage}`);

    // 若首个候选路径 404 且存在备用路径，继续尝试下一个候选路径
    if (response.status === 404 && i < candidateUrls.length - 1) {
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error('接口请求失败');
}

function buildOrganizeMessages(menusTree, cardsBatch, customPrompt) {
  const requirement = customPrompt && customPrompt.trim()
    ? `请严格按照以下用户自定义要求整理导航卡片：\n${customPrompt.trim()}`
    : DEFAULT_ORGANIZE_PROMPT;

  const systemPrompt = [
    '你是一个专业的网站导航站内容整理助手。',
    '你必须只返回严格合法的 JSON 对象，不要包含任何解释文字或 Markdown 代码块以外的文本。',
    '输出 JSON 结构必须为：',
    '{"changes":[{"id":1,"menu_id":2,"sub_menu_id":null,"title":"新标题","desc":"简洁中文描述","reason":"简短变更说明"}]}',
    '重要约束：',
    '1. id 必须来自输入卡片列表。',
    '2. menu_id 和 sub_menu_id 必须严格来自提供的栏目结构，绝不可编造不存在的 ID。',
    '3. 若归入某子菜单，必须填写对应的 menu_id（父主菜单ID）和 sub_menu_id（子菜单ID）；若直接归入主菜单，sub_menu_id 必须为 null。',
    '4. 仅返回确实需要修改（分类、标题或描述任一有改动）的卡片；不需要改动的卡片不要包含在 changes 中。',
    '5. 若全部卡片都无需修改，请返回 {"changes":[]}。'
  ].join('\n');

  const userPayload = {
    requirement,
    menus: menusTree,
    cards: cardsBatch.map(c => ({
      id: c.id,
      menu_id: c.effective_menu_id || c.menu_id || null,
      sub_menu_id: c.sub_menu_id || null,
      title: c.title,
      url: c.url,
      desc: c.desc || ''
    }))
  };

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) }
  ];
}

function createAiRouter({ fetchImpl = globalThis.fetch } = {}) {
  const router = express.Router();

  // 确保表存在
  ensureAiTable().catch(err => console.error('初始化 ai_configs 表失败:', err));

  // 获取所有 AI 配置
  router.get('/configs', auth, async (req, res) => {
    try {
      await ensureAiTable();
      const rows = await all('SELECT id, name, base_url, api_key, model, is_active, created_at, updated_at FROM ai_configs ORDER BY is_active DESC, id ASC');
      res.json({ data: rows });
    } catch (err) {
      res.status(500).json({ message: `读取 AI 配置失败：${err.message}` });
    }
  });

  // 新增 AI 配置
  router.post('/configs', auth, async (req, res) => {
    try {
      await ensureAiTable();
      const name = String(req.body?.name || '').trim();
      const apiKey = String(req.body?.api_key || '').trim();
      const model = String(req.body?.model || '').trim();
      if (!name) return res.status(400).json({ message: '请输入配置名称' });
      if (!apiKey) return res.status(400).json({ message: '请输入 API Key' });
      const baseUrl = normalizeBaseUrl(req.body?.base_url);

      const countRow = await get('SELECT COUNT(*) AS count FROM ai_configs');
      const shouldActivate = Boolean(req.body?.is_active) || Number(countRow?.count || 0) === 0;

      await run('BEGIN TRANSACTION');
      if (shouldActivate) {
        await run('UPDATE ai_configs SET is_active = 0');
      }
      const result = await run(
        `INSERT INTO ai_configs (name, base_url, api_key, model, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [name, baseUrl, apiKey, model, shouldActivate ? 1 : 0]
      );
      await run('COMMIT');
      const created = await get('SELECT id, name, base_url, api_key, model, is_active, created_at, updated_at FROM ai_configs WHERE id = ?', [result.lastID]);
      res.json({ data: created });
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      res.status(400).json({ message: err.message || '新增 AI 配置失败' });
    }
  });

  // 更新 AI 配置
  router.put('/configs/:id', auth, async (req, res) => {
    try {
      await ensureAiTable();
      const id = Number(req.params.id);
      const existing = await get('SELECT * FROM ai_configs WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ message: '配置不存在' });

      const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
      const baseUrl = req.body?.base_url !== undefined ? normalizeBaseUrl(req.body.base_url) : existing.base_url;
      const apiKey = req.body?.api_key !== undefined ? String(req.body.api_key).trim() : existing.api_key;
      const model = req.body?.model !== undefined ? String(req.body.model).trim() : (existing.model || '');
      const activateRequested = req.body?.is_active !== undefined ? Boolean(req.body.is_active) : Boolean(existing.is_active);

      if (!name) return res.status(400).json({ message: '配置名称不能为空' });
      if (!apiKey) return res.status(400).json({ message: 'API Key 不能为空' });

      await run('BEGIN TRANSACTION');
      if (activateRequested) {
        await run('UPDATE ai_configs SET is_active = 0 WHERE id != ?', [id]);
      }
      await run(
        `UPDATE ai_configs SET name = ?, base_url = ?, api_key = ?, model = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
        [name, baseUrl, apiKey, model, activateRequested ? 1 : 0, id]
      );
      await run('COMMIT');
      const updated = await get('SELECT id, name, base_url, api_key, model, is_active, created_at, updated_at FROM ai_configs WHERE id = ?', [id]);
      res.json({ data: updated });
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      res.status(400).json({ message: err.message || '更新 AI 配置失败' });
    }
  });

  // 切换当前激活的 AI 接口
  router.put('/configs/:id/activate', auth, async (req, res) => {
    try {
      await ensureAiTable();
      const id = Number(req.params.id);
      const existing = await get('SELECT id FROM ai_configs WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ message: '配置不存在' });

      await run('BEGIN TRANSACTION');
      await run('UPDATE ai_configs SET is_active = 0');
      await run(`UPDATE ai_configs SET is_active = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
      await run('COMMIT');
      res.json({ active_id: id });
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      res.status(500).json({ message: err.message || '切换激活配置失败' });
    }
  });

  // 删除 AI 配置
  router.delete('/configs/:id', auth, async (req, res) => {
    try {
      await ensureAiTable();
      const id = Number(req.params.id);
      const existing = await get('SELECT id, is_active FROM ai_configs WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ message: '配置不存在' });

      await run('BEGIN TRANSACTION');
      await run('DELETE FROM ai_configs WHERE id = ?', [id]);
      if (existing.is_active) {
        const nextConfig = await get('SELECT id FROM ai_configs ORDER BY id ASC LIMIT 1');
        if (nextConfig) {
          await run('UPDATE ai_configs SET is_active = 1 WHERE id = ?', [nextConfig.id]);
        }
      }
      await run('COMMIT');
      res.json({ deleted: 1 });
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      res.status(500).json({ message: err.message || '删除 AI 配置失败' });
    }
  });

  // 拉取模型列表（支持传入 config_id 或实时表单的 base_url + api_key）
  router.post('/models', auth, async (req, res) => {
    try {
      await ensureAiTable();
      let baseUrl = req.body?.base_url;
      let apiKey = req.body?.api_key;

      if ((!baseUrl || !apiKey) && req.body?.config_id) {
        const cfg = await get('SELECT base_url, api_key FROM ai_configs WHERE id = ?', [Number(req.body.config_id)]);
        if (!cfg) return res.status(404).json({ message: '未找到对应的 AI 接口配置' });
        baseUrl = baseUrl || cfg.base_url;
        apiKey = apiKey || cfg.api_key;
      } else if (!baseUrl && !apiKey) {
        const active = await get('SELECT base_url, api_key FROM ai_configs WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
        if (!active) return res.status(400).json({ message: '请先添加并激活一个 AI 接口配置' });
        baseUrl = active.base_url;
        apiKey = active.api_key;
      }

      if (!apiKey) return res.status(400).json({ message: '请输入 API Key' });

      const candidateUrls = buildModelsCandidateUrls(baseUrl);
      const payload = await requestOpenAiJson(fetchImpl, candidateUrls, {
        method: 'GET',
        apiKey: String(apiKey).trim(),
        timeoutMs: 20000
      });
      const models = extractModels(payload);
      res.json({ models });
    } catch (err) {
      res.status(400).json({ message: `拉取模型列表失败：${err.message}` });
    }
  });

  // 执行 AI 智能整理（只返回 Diff 预览，不直接修改数据库）
  router.post('/organize', auth, async (req, res) => {
    try {
      await ensureAiTable();
      let config = null;
      if (req.body?.config_id) {
        config = await get('SELECT * FROM ai_configs WHERE id = ?', [Number(req.body.config_id)]);
      } else {
        config = await get('SELECT * FROM ai_configs WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
      }

      const baseUrl = req.body?.base_url ? normalizeBaseUrl(req.body.base_url) : (config ? normalizeBaseUrl(config.base_url) : '');
      const apiKey = String(req.body?.api_key || config?.api_key || '').trim();
      const model = String(req.body?.model || config?.model || '').trim();
      const customPrompt = String(req.body?.prompt || '').trim();

      if (!baseUrl || !apiKey) {
        return res.status(400).json({ message: '请先配置并选择一个有效的 AI 接口' });
      }
      if (!model) {
        return res.status(400).json({ message: '请先选择或输入一个 AI 模型名称' });
      }

      const menus = await all('SELECT * FROM menus ORDER BY "order" ASC, id ASC');
      const subMenus = await all('SELECT * FROM sub_menus ORDER BY "order" ASC, id ASC');
      const menusTree = menus.map(m => ({
        menu_id: m.id,
        name: m.name,
        sub_menus: subMenus
          .filter(sm => sm.parent_id === m.id)
          .map(sm => ({ sub_menu_id: sm.id, name: sm.name }))
      }));

      const baseCardSql = `
        SELECT c.*, COALESCE(c.menu_id, sm.parent_id) AS effective_menu_id
        FROM cards c
        LEFT JOIN sub_menus sm ON c.sub_menu_id = sm.id
      `;

      let cards = [];
      const cardIds = Array.isArray(req.body?.card_ids)
        ? req.body.card_ids.map(Number).filter(id => Number.isInteger(id) && id > 0)
        : [];
      if (cardIds.length) {
        const placeholders = cardIds.map(() => '?').join(',');
        cards = await all(`${baseCardSql} WHERE c.id IN (${placeholders}) ORDER BY c."order" ASC, c.id ASC`, cardIds);
      } else if (req.body?.sub_menu_id && req.body.sub_menu_id !== 'all' && req.body.sub_menu_id !== 'main') {
        cards = await all(`${baseCardSql} WHERE c.sub_menu_id = ? ORDER BY c."order" ASC, c.id ASC`, [Number(req.body.sub_menu_id)]);
      } else if (req.body?.menu_id && req.body.menu_id !== 'all') {
        if (req.body?.sub_menu_id === 'main') {
          cards = await all(`${baseCardSql} WHERE c.menu_id = ? AND c.sub_menu_id IS NULL ORDER BY c."order" ASC, c.id ASC`, [Number(req.body.menu_id)]);
        } else {
          cards = await all(`${baseCardSql} WHERE COALESCE(c.menu_id, sm.parent_id) = ? ORDER BY c."order" ASC, c.id ASC`, [Number(req.body.menu_id)]);
        }
      } else {
        cards = await all(`${baseCardSql} ORDER BY c."order" ASC, c.id ASC`);
      }

      if (!cards.length) {
        return res.json({
          changes: [],
          total_analyzed: 0,
          model,
          used_default_prompt: !customPrompt,
          message: '当前范围内没有可整理的卡片'
        });
      }

      const candidateUrls = buildChatCandidateUrls(baseUrl);
      const aggregatedChanges = [];

      for (let start = 0; start < cards.length; start += BATCH_SIZE) {
        const batch = cards.slice(start, start + BATCH_SIZE);
        const messages = buildOrganizeMessages(menusTree, batch, customPrompt);
        const completion = await requestOpenAiJson(fetchImpl, candidateUrls, {
          method: 'POST',
          apiKey,
          timeoutMs: 120000,
          body: {
            model,
            temperature: 0.2,
            messages
          }
        });

        const content = completion?.choices?.[0]?.message?.content;
        const parsed = parseAiJson(content);
        const batchDiffs = computeOrganizeDiff(batch, parsed, menus, subMenus);
        aggregatedChanges.push(...batchDiffs);
      }

      // 若本次使用的配置已保存在数据库且模型有变化，顺便记住上次使用的模型
      if (config && model && model !== config.model) {
        await run(`UPDATE ai_configs SET model = ?, updated_at = datetime('now') WHERE id = ?`, [model, config.id]).catch(() => {});
      }

      res.json({
        changes: aggregatedChanges,
        total_analyzed: cards.length,
        model,
        used_default_prompt: !customPrompt
      });
    } catch (err) {
      res.status(400).json({ message: `AI 智能整理失败：${err.message}` });
    }
  });

  // 应用用户勾选确认的 AI 整理更改
  router.post('/apply', auth, async (req, res) => {
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    if (!changes.length) {
      return res.status(400).json({ message: '请至少勾选一条要应用的更改' });
    }

    try {
      const menus = await all('SELECT id FROM menus');
      const subMenus = await all('SELECT id, parent_id FROM sub_menus');
      const menuIdSet = new Set(menus.map(m => Number(m.id)));
      const subMenuById = new Map(subMenus.map(sm => [Number(sm.id), Number(sm.parent_id)]));

      await run('BEGIN TRANSACTION');
      let updated = 0;

      for (const item of changes) {
        const id = Number(item?.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        const existing = await get('SELECT * FROM cards WHERE id = ?', [id]);
        if (!existing) continue;

        let targetSubMenuId = existing.sub_menu_id ? Number(existing.sub_menu_id) : null;
        let targetMenuId = existing.menu_id ? Number(existing.menu_id) : null;

        if (item.new_sub_menu_id !== undefined || item.sub_menu_id !== undefined || item.new_menu_id !== undefined || item.menu_id !== undefined) {
          const rawSub = item.new_sub_menu_id !== undefined ? item.new_sub_menu_id : item.sub_menu_id;
          const rawMenu = item.new_menu_id !== undefined ? item.new_menu_id : item.menu_id;
          const parsedSub = rawSub !== null && rawSub !== '' && rawSub !== undefined ? Number(rawSub) : null;
          const parsedMenu = rawMenu !== null && rawMenu !== '' && rawMenu !== undefined ? Number(rawMenu) : null;

          if (parsedSub && subMenuById.has(parsedSub)) {
            targetSubMenuId = parsedSub;
            targetMenuId = subMenuById.get(parsedSub);
          } else if (parsedMenu && menuIdSet.has(parsedMenu)) {
            targetMenuId = parsedMenu;
            targetSubMenuId = null;
          }
        }

        const rawTitle = item.new_title !== undefined ? item.new_title : item.title;
        const rawDesc = item.new_desc !== undefined ? item.new_desc : item.desc;
        const finalTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : existing.title;
        const finalDesc = typeof rawDesc === 'string' ? rawDesc.trim() : (existing.desc || '');

        const result = await run(
          'UPDATE cards SET menu_id = ?, sub_menu_id = ?, title = ?, desc = ? WHERE id = ?',
          [targetMenuId, targetSubMenuId, finalTitle, finalDesc, id]
        );
        updated += result.changes;
      }

      await run('COMMIT');
      res.json({ updated, message: `已成功应用 ${updated} 条更改` });
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      res.status(500).json({ message: `应用更改失败：${err.message}` });
    }
  });

  return router;
}

const defaultRouter = createAiRouter();
defaultRouter.createAiRouter = createAiRouter;
defaultRouter.normalizeBaseUrl = normalizeBaseUrl;
defaultRouter.buildModelsCandidateUrls = buildModelsCandidateUrls;
defaultRouter.buildChatCandidateUrls = buildChatCandidateUrls;
defaultRouter.extractModels = extractModels;
defaultRouter.parseAiJson = parseAiJson;
defaultRouter.computeOrganizeDiff = computeOrganizeDiff;
defaultRouter.DEFAULT_ORGANIZE_PROMPT = DEFAULT_ORGANIZE_PROMPT;

module.exports = defaultRouter;
