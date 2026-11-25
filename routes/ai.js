const express = require('express');
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
const db = require('../db');
const auth = require('./authMiddleware');

const RECYCLE_REASONS = new Set(['dead_link', 'domain_expired', 'duplicate', 'manual']);

const DEFAULT_ORGANIZE_PROMPT = [
  '请严格遵循以下「防乱 + 防硬塞平衡版」规则整理导航卡片：',
  '1. 严格限制只能归入当前数据库已有的主菜单/子菜单，严禁 AI 自动创建新菜单或修改现有菜单名称；',
  '2. 若某卡片与现有分类匹配度不足或存在明显跨界歧义，归入名为「待归类」的栏目（若当前栏目列表中不存在「待归类」，则保持原分类不变并在输出中标记 needs_review: true），严禁为凑数而强行塞入不相关栏目；',
  '3. 若识别出 ≥3 张相似新类型卡片且现有分类确实无法准确容纳，可在 suggested_sub_menus 中给出「建议新增子菜单」提示（仅作建议，不得直接当作已有分类使用）；',
  '4. 已在合理栏目中的卡片默认保持分类不变，不打乱原有布局，仅补全缺失或过于敷衍的简短中文描述（15字以内）并规范网站名称大小写（如 Youtube -> YouTube、github -> GitHub、chatgpt -> ChatGPT、Deepseek -> DeepSeek 等）；',
  '5. 结合后端真实测活结果（probe 字段）与重复提示（duplicate_of 字段）：',
  '   - 注意：遇到 HTTP 403 且 probe.verdict 为 waf_403 时，请结合 probe.page_title 与 probe.cf_detected 仔细判断是否为 Cloudflare/WAF 防火墙盾，若是正常站点开启了防护盾，绝不可误判为死链！',
  '   - 确认无法访问（如 NXDOMAIN/连接超时/404/410 且非防爬盾）标为 dead_link 放入 recycles；',
  '   - 确认域名停用/过期/出售停放页标为 domain_expired 放入 recycles；',
  '   - 确认与其他卡片重复指向同一站点功能页（保留信息最完整的一张，将其余重复项移入回收站）标为 duplicate 放入 recycles。'
].join('\n');

const BATCH_SIZE = 45;
const PROBE_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 8000;
const PROBE_MAX_HTML_BYTES = 16384;

const EXPIRED_DOMAIN_PATTERNS = [
  /domain\s+(is\s+)?for\s+sale/i,
  /buy\s+this\s+domain/i,
  /this\s+domain\s+(has\s+)?expired/i,
  /domain\s+expired/i,
  /parked\s+(free|domain)/i,
  /sedoparking|hugedomains|afternic|dan\.com|bodis\.com|undeveloped/i,
  /域名已过期|域名过期|域名出售|该域名正在出售|该域名已停用|网站已关闭|域名未续费/i
];

const WAF_TITLE_PATTERNS = [
  /just\s+a\s+moment/i,
  /attention\s+required/i,
  /cloudflare/i,
  /checking\s+your\s+browser/i,
  /verify\s+you\s+are\s+human/i,
  /ddos-guard/i,
  /access\s+denied/i,
  /security\s+check/i,
  /人机验证|安全验证|正在检查您的浏览器/i
];

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

  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // 回退到通用括号提取
    }
  }

  try {
    return JSON.parse(text);
  } catch {
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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const code = parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHtmlTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return decodeHtmlEntities(match[1]).slice(0, 120);
}

function isPublicIp(address) {
  try {
    const parsed = ipaddr.parse(address);
    const normalized = parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()
      ? parsed.toIPv4Address()
      : parsed;
    return normalized.range() === 'unicast';
  } catch {
    return false;
  }
}

async function isPublicHostname(hostname) {
  if (!hostname) return false;
  const clean = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (clean === 'localhost' || clean.endsWith('.local') || clean.endsWith('.internal')) {
    return false;
  }
  if (ipaddr.isValid(clean)) {
    return isPublicIp(clean);
  }
  try {
    const records = await dns.lookup(clean, { all: true, verbatim: true });
    if (!records.length) return false;
    return records.every(r => isPublicIp(r.address));
  } catch (err) {
    // DNS 查询抛出的 ENOTFOUND 交由外层识别为 NXDOMAIN
    throw err;
  }
}

async function readLimitedText(response, maxBytes = PROBE_MAX_HTML_BYTES) {
  if (!response?.body) {
    if (typeof response?.text === 'function') {
      const text = await response.text();
      return text.slice(0, maxBytes);
    }
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - total;
      chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
      total += Math.min(chunk.length, remaining);
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    // 读取中断时保留已读部分用于提取标题
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function probeUrl(rawUrl, { fetchImpl = globalThis.fetch, checkPublicHost = true } = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return {
      reachable: false,
      status: null,
      page_title: '',
      cf_detected: false,
      error_code: 'INVALID_URL',
      verdict: 'suspected_dead_link',
      summary: 'URL 格式无效'
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      reachable: false,
      status: null,
      page_title: '',
      cf_detected: false,
      error_code: 'UNSUPPORTED_PROTOCOL',
      verdict: 'suspected_dead_link',
      summary: '不支持的协议'
    };
  }

  if (checkPublicHost) {
    try {
      const ok = await isPublicHostname(parsed.hostname);
      if (!ok) {
        return {
          reachable: true,
          status: null,
          page_title: '',
          cf_detected: false,
          error_code: 'PRIVATE_ADDRESS_SKIPPED',
          verdict: 'skipped_private',
          summary: '内网/本地地址跳过公网测活'
        };
      }
    } catch (dnsErr) {
      const code = dnsErr?.code || 'DNS_ERROR';
      if (code === 'ENOTFOUND' || code === 'EAI_NONAME') {
        return {
          reachable: false,
          status: null,
          page_title: '',
          cf_detected: false,
          error_code: 'NXDOMAIN',
          verdict: 'suspected_dead_link',
          summary: 'DNS 无法解析 (NXDOMAIN)'
        };
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(parsed.href, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });

    const status = Number(response.status || 0);
    const getHeader = name => {
      if (typeof response.headers?.get === 'function') return response.headers.get(name) || '';
      if (response.headers && typeof response.headers === 'object') {
        return response.headers[name] || response.headers[name.toLowerCase()] || '';
      }
      return '';
    };

    const contentType = getHeader('content-type').toLowerCase();
    const serverHeader = getHeader('server').toLowerCase();
    const cfRay = getHeader('cf-ray');
    const cfMitigated = getHeader('cf-mitigated');
    const isHtmlLike = !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml') || status === 403 || status === 503;

    let html = '';
    if (isHtmlLike) {
      html = await readLimitedText(response, PROBE_MAX_HTML_BYTES);
    } else if (response.body?.cancel) {
      await response.body.cancel().catch(() => {});
    }

    const pageTitle = extractHtmlTitle(html);
    const cfDetected = Boolean(
      cfMitigated ||
      serverHeader.includes('cloudflare') ||
      (cfRay && (status === 403 || status === 503)) ||
      WAF_TITLE_PATTERNS.some(re => re.test(pageTitle))
    );

    if (status === 403 || (status === 503 && cfDetected) || status === 429) {
      return {
        reachable: true,
        status,
        page_title: pageTitle,
        cf_detected: cfDetected,
        error_code: `HTTP_${status}`,
        verdict: 'waf_403',
        summary: `HTTP ${status}${cfDetected ? ' (疑似 Cloudflare/WAF 盾)' : ''}${pageTitle ? ` · 标题: ${pageTitle}` : ''}`
      };
    }

    if (status >= 200 && status < 400) {
      const sampleText = `${pageTitle} ${html.slice(0, 2000)}`;
      const looksExpired = EXPIRED_DOMAIN_PATTERNS.some(re => re.test(sampleText));
      if (looksExpired) {
        return {
          reachable: true,
          status,
          page_title: pageTitle,
          cf_detected: false,
          error_code: 'DOMAIN_PARKED',
          verdict: 'suspected_domain_expired',
          summary: `HTTP ${status} · 疑似域名停放/过期页面${pageTitle ? ` (${pageTitle})` : ''}`
        };
      }
      return {
        reachable: true,
        status,
        page_title: pageTitle,
        cf_detected: false,
        error_code: '',
        verdict: 'ok',
        summary: `HTTP ${status} 正常`
      };
    }

    return {
      reachable: false,
      status,
      page_title: pageTitle,
      cf_detected: cfDetected,
      error_code: `HTTP_${status}`,
      verdict: 'suspected_dead_link',
      summary: `HTTP ${status}${pageTitle ? ` · ${pageTitle}` : ''}`
    };
  } catch (err) {
    const causeCode = err?.cause?.code || err?.code || '';
    const isAbort = err?.name === 'AbortError' || causeCode === 'ETIMEDOUT' || causeCode === 'UND_ERR_CONNECT_TIMEOUT';
    const isNxdomain = causeCode === 'ENOTFOUND' || causeCode === 'EAI_NONAME';
    const errorCode = isNxdomain ? 'NXDOMAIN' : (isAbort ? 'TIMEOUT' : (causeCode || err?.message || 'FETCH_ERROR'));
    const summary = isNxdomain
      ? 'DNS 无法解析 (NXDOMAIN)'
      : isAbort
        ? `连接超时 (>${Math.round(PROBE_TIMEOUT_MS / 1000)}s)`
        : `连接失败 (${errorCode})`;

    return {
      reachable: false,
      status: null,
      page_title: '',
      cf_detected: false,
      error_code: errorCode,
      verdict: 'suspected_dead_link',
      summary
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeCardsConcurrently(cards, probeFn, concurrency = PROBE_CONCURRENCY) {
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < cards.length) {
      const idx = cursor++;
      const card = cards[idx];
      try {
        results.set(card.id, await probeFn(card.url, card));
      } catch (err) {
        results.set(card.id, {
          reachable: false,
          status: null,
          page_title: '',
          cf_detected: false,
          error_code: err?.message || 'PROBE_ERROR',
          verdict: 'suspected_dead_link',
          summary: `探测异常 (${err?.message || 'unknown'})`
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, cards.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeUrlForDuplicate(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${pathname}${parsed.search}`.toLowerCase();
  } catch {
    return String(rawUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  }
}

function detectDuplicateHints(allActiveCards) {
  const groups = new Map();
  for (const card of allActiveCards) {
    const key = normalizeUrlForDuplicate(card.url);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }

  const hints = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // 优先保留有描述/排序靠前的第一张作为主保留参考
    const sorted = [...group].sort((a, b) => {
      const descDiff = (b.desc ? 1 : 0) - (a.desc ? 1 : 0);
      if (descDiff !== 0) return descDiff;
      return a.id - b.id;
    });
    const primary = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      hints.set(sorted[i].id, {
        primary_id: primary.id,
        primary_title: primary.title,
        group_ids: sorted.map(c => c.id)
      });
    }
  }
  return hints;
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

function computeOrganizePlan(cards, rawOutput, menus, subMenus, probeMap = new Map()) {
  const menuById = new Map(menus.map(m => [Number(m.id), m]));
  const subMenuById = new Map(subMenus.map(sm => [Number(sm.id), sm]));
  const cardById = new Map(cards.map(c => [Number(c.id), c]));

  const rawRecycles = Array.isArray(rawOutput?.recycles) ? rawOutput.recycles : [];
  const rawUpdates = Array.isArray(rawOutput?.updates)
    ? rawOutput.updates
    : Array.isArray(rawOutput?.changes)
      ? rawOutput.changes
      : Array.isArray(rawOutput)
        ? rawOutput
        : [];
  const rawSuggestions = Array.isArray(rawOutput?.suggested_sub_menus) ? rawOutput.suggested_sub_menus : [];

  const recycles = [];
  const recycledIdSet = new Set();

  for (const item of rawRecycles) {
    if (!item || typeof item !== 'object') continue;
    const cardId = Number(item.id);
    if (!cardById.has(cardId) || recycledIdSet.has(cardId)) continue;
    recycledIdSet.add(cardId);

    const card = cardById.get(cardId);
    const oldSubMenuId = card.sub_menu_id ? Number(card.sub_menu_id) : null;
    const oldMenuId = oldSubMenuId && subMenuById.has(oldSubMenuId)
      ? Number(subMenuById.get(oldSubMenuId).parent_id)
      : (card.menu_id ? Number(card.menu_id) : null);

    const reasonKey = RECYCLE_REASONS.has(item.recycle_reason) && item.recycle_reason !== 'manual'
      ? item.recycle_reason
      : 'dead_link';
    const probe = probeMap.get(cardId);

    recycles.push({
      id: cardId,
      title: String(card.title || '').trim(),
      url: card.url,
      old_menu_id: oldMenuId,
      old_sub_menu_id: oldSubMenuId,
      old_category: formatCategoryLabel(oldMenuId, oldSubMenuId, menuById, subMenuById),
      recycle_reason: reasonKey,
      reason: typeof item.reason === 'string' && item.reason.trim()
        ? item.reason.trim()
        : (probe?.summary || 'AI 判定为失效或重复链接'),
      probe_summary: probe?.summary || ''
    });
  }

  const seenUpdateIds = new Set();
  const updates = [];

  for (const item of rawUpdates) {
    if (!item || typeof item !== 'object') continue;
    const cardId = Number(item.id);
    if (!cardById.has(cardId) || seenUpdateIds.has(cardId) || recycledIdSet.has(cardId)) continue;
    seenUpdateIds.add(cardId);

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
    const needsReview = Boolean(item.needs_review);

    const changedFields = [];
    if (newMenuId !== oldMenuId || newSubMenuId !== oldSubMenuId) changedFields.push('category');
    if (newTitle !== oldTitle) changedFields.push('title');
    if (newDesc !== oldDesc) changedFields.push('desc');

    if (!changedFields.length && !needsReview) continue;

    updates.push({
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
      needs_review: needsReview,
      reason: typeof item.reason === 'string' ? item.reason.trim() : ''
    });
  }

  // 校验「建议新增子菜单」：必须存在合法父菜单、名称非空且不重名、且涉及 ≥3 张有效卡片
  const existingSubNamesByParent = new Map();
  for (const sm of subMenus) {
    const pid = Number(sm.parent_id);
    if (!existingSubNamesByParent.has(pid)) existingSubNamesByParent.set(pid, new Set());
    existingSubNamesByParent.get(pid).add(String(sm.name || '').trim().toLowerCase());
  }

  const suggestedSubMenus = [];
  const seenSuggestionKeys = new Set();
  for (const sug of rawSuggestions) {
    if (!sug || typeof sug !== 'object') continue;
    const parentId = Number(sug.parent_menu_id);
    const name = String(sug.name || '').trim();
    if (!menuById.has(parentId) || !name) continue;
    const lowerName = name.toLowerCase();
    if (existingSubNamesByParent.get(parentId)?.has(lowerName)) continue;

    const dedupeKey = `${parentId}:${lowerName}`;
    if (seenSuggestionKeys.has(dedupeKey)) continue;

    const validCardIds = [...new Set((Array.isArray(sug.card_ids) ? sug.card_ids : []).map(Number))]
      .filter(id => cardById.has(id) && !recycledIdSet.has(id));
    if (validCardIds.length < 3) continue;

    seenSuggestionKeys.add(dedupeKey);
    suggestedSubMenus.push({
      parent_menu_id: parentId,
      parent_menu_name: menuById.get(parentId).name,
      name,
      reason: typeof sug.reason === 'string' ? sug.reason.trim() : `发现 ${validCardIds.length} 张相似类型卡片`,
      card_ids: validCardIds,
      card_titles: validCardIds.map(id => cardById.get(id).title)
    });
  }

  return { updates, recycles, suggested_sub_menus: suggestedSubMenus };
}

// 兼容旧测试导出名
function computeOrganizeDiff(cards, rawChanges, menus, subMenus) {
  return computeOrganizePlan(cards, rawChanges, menus, subMenus).updates;
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

    if (response.status === 404 && i < candidateUrls.length - 1) {
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error('接口请求失败');
}

function buildOrganizeMessages(menusTree, cardsBatch, customPrompt, probeMap, duplicateHints) {
  const requirement = customPrompt && customPrompt.trim()
    ? `请严格按照以下用户自定义要求整理导航卡片（仍需遵守不捏造不存在栏目 ID 的硬性约束，并结合 probe 测活结果处理死链）：\n${customPrompt.trim()}`
    : DEFAULT_ORGANIZE_PROMPT;

  const hasPendingMenu = menusTree.some(m =>
    m.name === '待归类' || (m.sub_menus || []).some(sm => sm.name === '待归类')
  );

  const systemPrompt = [
    '你是一个严谨、克制的网站导航站内容整理与死链审核助手。',
    '你必须只返回严格合法的 JSON 对象，不要包含任何额外解释文字。',
    '输出 JSON 结构必须为：',
    '{',
    '  "updates": [{"id": 1, "menu_id": 2, "sub_menu_id": null, "title": "新标题", "desc": "15字以内中文描述", "needs_review": false, "reason": "简短说明"}],',
    '  "recycles": [{"id": 2, "recycle_reason": "dead_link|domain_expired|duplicate", "reason": "具体判定依据"}],',
    '  "suggested_sub_menus": [{"parent_menu_id": 5, "name": "建议子菜单名", "reason": "发现>=3张同类卡片的理由", "card_ids": [10, 11, 12]}]',
    '}',
    '硬性约束：',
    '1. id 必须来自输入卡片列表；同一张卡片不能同时出现在 updates 和 recycles 中。',
    '2. menu_id 和 sub_menu_id 必须严格来自提供的 menus 列表，绝不可编造不存在的 ID 或改名。',
    '3. 若归入某子菜单，必须填写对应的 menu_id（父主菜单ID）和 sub_menu_id（子菜单ID）；若直属主菜单，sub_menu_id 必须为 null。',
    `4. 当前数据库${hasPendingMenu ? '存在' : '不存在'}「待归类」栏目；若某卡片无合适分类或存在跨界歧义，${hasPendingMenu ? '请归入「待归类」' : '请保持原分类不变并设置 needs_review: true'}，绝不强行硬塞。`,
    '5. 仅当某类新主题有 ≥3 张卡片且现有栏目无法容纳时才填写 suggested_sub_menus，否则返回空数组 []。',
    '6. 仅返回有修改、需要复核（needs_review: true）或需移入回收站的卡片；无需处理的卡片不要输出。'
  ].join('\n');

  const userPayload = {
    requirement,
    menus: menusTree,
    cards: cardsBatch.map(c => {
      const probe = probeMap.get(c.id);
      const dup = duplicateHints.get(c.id);
      return {
        id: c.id,
        menu_id: c.effective_menu_id || c.menu_id || null,
        sub_menu_id: c.sub_menu_id || null,
        title: c.title,
        url: c.url,
        desc: c.desc || '',
        ...(probe ? {
          probe: {
            verdict: probe.verdict,
            status: probe.status,
            page_title: probe.page_title,
            cf_detected: probe.cf_detected,
            error_code: probe.error_code
          }
        } : {}),
        ...(dup ? { duplicate_of: dup } : {})
      };
    })
  };

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) }
  ];
}

function createAiRouter({ fetchImpl = globalThis.fetch, probeImpl = null } = {}) {
  const router = express.Router();

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

  // 拉取模型列表
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

  // 执行后端测活 + AI 智能整理（仅返回 Diff 预览，不修改数据库）
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
      const scope = String(req.body?.scope || 'smart'); // smart | all | current
      const enableProbe = req.body?.enable_probe !== false;

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
        WHERE COALESCE(c.is_deleted, 0) = 0
      `;

      const allActiveCards = await all(`${baseCardSql} ORDER BY c."order" ASC, c.id ASC`);
      const duplicateHints = detectDuplicateHints(allActiveCards);

      let probeTargetCards = allActiveCards;
      const cardIds = Array.isArray(req.body?.card_ids)
        ? req.body.card_ids.map(Number).filter(id => Number.isInteger(id) && id > 0)
        : [];

      if (cardIds.length) {
        const idSet = new Set(cardIds);
        probeTargetCards = allActiveCards.filter(c => idSet.has(c.id));
      } else if (scope === 'current' && req.body?.menu_id && req.body.menu_id !== 'all') {
        const targetMenuId = Number(req.body.menu_id);
        if (req.body?.sub_menu_id && req.body.sub_menu_id !== 'all' && req.body.sub_menu_id !== 'main') {
          const targetSubId = Number(req.body.sub_menu_id);
          probeTargetCards = allActiveCards.filter(c => Number(c.sub_menu_id) === targetSubId);
        } else if (req.body?.sub_menu_id === 'main') {
          probeTargetCards = allActiveCards.filter(c => Number(c.menu_id) === targetMenuId && !c.sub_menu_id);
        } else {
          probeTargetCards = allActiveCards.filter(c => Number(c.effective_menu_id) === targetMenuId);
        }
      }

      if (!probeTargetCards.length) {
        return res.json({
          updates: [],
          changes: [],
          recycles: [],
          suggested_sub_menus: [],
          probe_stats: { total: 0, reachable: 0, waf_403: 0, suspected_dead: 0, suspected_expired: 0 },
          total_analyzed: 0,
          model,
          used_default_prompt: !customPrompt,
          message: '当前范围内没有可整理的卡片'
        });
      }

      // 第一步：后端并发真实测活
      const probeFn = probeImpl || (url => probeUrl(url, { fetchImpl }));
      const probeMap = enableProbe
        ? await probeCardsConcurrently(probeTargetCards, probeFn, PROBE_CONCURRENCY)
        : new Map();

      const probeStats = {
        total: probeTargetCards.length,
        reachable: 0,
        waf_403: 0,
        suspected_dead: 0,
        suspected_expired: 0
      };
      for (const result of probeMap.values()) {
        if (result.verdict === 'ok' || result.verdict === 'skipped_private') probeStats.reachable++;
        else if (result.verdict === 'waf_403') probeStats.waf_403++;
        else if (result.verdict === 'suspected_domain_expired') probeStats.suspected_expired++;
        else probeStats.suspected_dead++;
      }

      // 根据范围决定交给 AI 分析的卡片集合
      let aiCards = probeTargetCards;
      if (scope === 'smart' && !customPrompt && !cardIds.length) {
        const pendingMenuIds = new Set(menus.filter(m => m.name === '待归类' || m.name === 'Other').map(m => m.id));
        aiCards = probeTargetCards.filter(c => {
          const probe = probeMap.get(c.id);
          const missingDesc = !String(c.desc || '').trim();
          const uncategorized = !c.effective_menu_id || pendingMenuIds.has(Number(c.effective_menu_id));
          const probeAbnormal = probe && probe.verdict !== 'ok' && probe.verdict !== 'skipped_private';
          const isDup = duplicateHints.has(c.id);
          return missingDesc || uncategorized || probeAbnormal || isDup;
        });
      }

      const candidateUrls = buildChatCandidateUrls(baseUrl);
      const aggregatedUpdates = [];
      const aggregatedRecycles = [];
      const aggregatedSuggestions = [];

      for (let start = 0; start < aiCards.length; start += BATCH_SIZE) {
        const batch = aiCards.slice(start, start + BATCH_SIZE);
        const messages = buildOrganizeMessages(menusTree, batch, customPrompt, probeMap, duplicateHints);
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
        const plan = computeOrganizePlan(batch, parsed, menus, subMenus, probeMap);
        aggregatedUpdates.push(...plan.updates);
        aggregatedRecycles.push(...plan.recycles);
        aggregatedSuggestions.push(...plan.suggested_sub_menus);
      }

      if (config && model && model !== config.model) {
        await run(`UPDATE ai_configs SET model = ?, updated_at = datetime('now') WHERE id = ?`, [model, config.id]).catch(() => {});
      }

      res.json({
        updates: aggregatedUpdates,
        changes: aggregatedUpdates,
        recycles: aggregatedRecycles,
        suggested_sub_menus: aggregatedSuggestions,
        probe_stats: probeStats,
        total_analyzed: aiCards.length,
        total_probed: probeTargetCards.length,
        model,
        used_default_prompt: !customPrompt
      });
    } catch (err) {
      res.status(400).json({ message: `AI 智能整理失败：${err.message}` });
    }
  });

  // 应用用户勾选确认的 AI 整理更改（支持更新卡片 + 将失效/重复卡片移入回收站）
  router.post('/apply', auth, async (req, res) => {
    const updates = Array.isArray(req.body?.updates)
      ? req.body.updates
      : (Array.isArray(req.body?.changes) ? req.body.changes : []);
    const recycles = Array.isArray(req.body?.recycles) ? req.body.recycles : [];

    if (!updates.length && !recycles.length) {
      return res.status(400).json({ message: '请至少勾选一条要应用的更改' });
    }

    try {
      const menus = await all('SELECT id FROM menus');
      const subMenus = await all('SELECT id, parent_id FROM sub_menus');
      const menuIdSet = new Set(menus.map(m => Number(m.id)));
      const subMenuById = new Map(subMenus.map(sm => [Number(sm.id), Number(sm.parent_id)]));

      await run('BEGIN TRANSACTION');
      let updated = 0;
      let recycled = 0;

      for (const item of updates) {
        const id = Number(item?.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        const existing = await get('SELECT * FROM cards WHERE id = ? AND COALESCE(is_deleted, 0) = 0', [id]);
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

      for (const item of recycles) {
        const id = Number(item?.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        const reason = RECYCLE_REASONS.has(item.recycle_reason) ? item.recycle_reason : 'dead_link';
        const result = await run(
          "UPDATE cards SET is_deleted = 1, deleted_at = datetime('now'), recycle_reason = ? WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
          [reason, id]
        );
        recycled += result.changes;
      }

      await run('COMMIT');
      res.json({
        updated,
        recycled,
        message: `已更新 ${updated} 张卡片，移入回收站 ${recycled} 张卡片`
      });
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
defaultRouter.extractHtmlTitle = extractHtmlTitle;
defaultRouter.probeUrl = probeUrl;
defaultRouter.detectDuplicateHints = detectDuplicateHints;
defaultRouter.parseAiJson = parseAiJson;
defaultRouter.computeOrganizePlan = computeOrganizePlan;
defaultRouter.computeOrganizeDiff = computeOrganizeDiff;
defaultRouter.DEFAULT_ORGANIZE_PROMPT = DEFAULT_ORGANIZE_PROMPT;

module.exports = defaultRouter;
