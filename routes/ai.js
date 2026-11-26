const express = require('express');
const crypto = require('crypto');
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
const db = require('../db');
const auth = require('./authMiddleware');
const backupRoutes = require('./backup');

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

const BATCH_SIZE = 15;
const BATCH_CONCURRENCY = 2;
const PROBE_CONCURRENCY = 16;
const PROBE_TIMEOUT_MS = 5000;
const AI_IDLE_TIMEOUT_MS = 90000;
const AI_REQUEST_TIMEOUT_MS = 180000;
const PROBE_MAX_HTML_BYTES = 16384;
const TASK_TTL_MS = 30 * 60 * 1000;
const MAX_TASK_RECORDS = 100;

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

function repairTrailingCommas(text) {
  return String(text || '').replace(/,\s*([}\]])/g, '$1');
}

function tryJsonParse(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(repairTrailingCommas(trimmed));
    } catch {
      return null;
    }
  }
}

function extractBalancedJsonCandidate(text, openChar, closeChar) {
  const start = text.indexOf(openChar);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseAiJson(rawText) {
  if (rawText && typeof rawText === 'object') return rawText;
  let text = String(rawText || '').trim();
  if (!text) throw new Error('AI 返回内容为空');

  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (/^<think>/i.test(text) && !/<\/think>/i.test(text)) {
    const braceIdx = text.indexOf('{');
    if (braceIdx !== -1) text = text.slice(braceIdx);
  }

  const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fenceMatches) {
    const parsedFence = tryJsonParse(match[1]);
    if (parsedFence !== null) return parsedFence;
  }

  const direct = tryJsonParse(text);
  if (direct !== null) return direct;

  const balancedObj = extractBalancedJsonCandidate(text, '{', '}');
  if (balancedObj) {
    const parsedObj = tryJsonParse(balancedObj);
    if (parsedObj !== null) return parsedObj;
  }
  const balancedArr = extractBalancedJsonCandidate(text, '[', ']');
  if (balancedArr) {
    const parsedArr = tryJsonParse(balancedArr);
    if (parsedArr !== null) return parsedArr;
  }

  const firstObj = text.indexOf('{');
  const lastObj = text.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) {
    const fallbackObj = tryJsonParse(text.slice(firstObj, lastObj + 1));
    if (fallbackObj !== null) return fallbackObj;
  }

  const preview = text.replace(/\s+/g, ' ').slice(0, 160);
  throw new Error(`无法解析 AI 返回的 JSON 内容（返回片段：${preview}${text.length > 160 ? '...' : ''}）`);
}

function extractTextFromContentField(field) {
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    return field
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          return part.text || part.content || part.value || '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (field && typeof field === 'object' && typeof field.text === 'string') {
    return field.text;
  }
  return '';
}

function parseSseStreamText(rawText) {
  const lines = String(rawText || '').split(/\r?\n/);
  let combined = '';
  let finishReason = '';
  let parsedChunks = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const dataPart = line.slice(5).trim();
    if (!dataPart || dataPart === '[DONE]') continue;
    try {
      const chunk = JSON.parse(dataPart);
      if (chunk?.error) {
        const msg = typeof chunk.error === 'string'
          ? chunk.error
          : (chunk.error.message || JSON.stringify(chunk.error).slice(0, 200));
        throw new Error(`流式响应返回错误：${msg}`);
      }
      parsedChunks++;
      const choice = chunk?.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
      if (typeof delta === 'string') combined += delta;
      else if (Array.isArray(delta)) {
        combined += extractTextFromContentField(delta);
      } else if (typeof chunk?.delta?.text === 'string') {
        // 兼容 Anthropic 风格 SSE
        combined += chunk.delta.text;
      }
    } catch (err) {
      if (/流式响应返回错误/.test(err?.message || '')) throw err;
    }
  }

  return parsedChunks > 0 ? { content: combined, finishReason } : null;
}

function extractChatContent(completion) {
  if (!completion || typeof completion !== 'object') {
    throw new Error('AI 接口响应为空或格式无效');
  }

  if (completion.error) {
    const errMsg = typeof completion.error === 'string'
      ? completion.error
      : (completion.error.message || JSON.stringify(completion.error).slice(0, 200));
    throw new Error(`中转接口返回错误：${errMsg}`);
  }
  if (!Array.isArray(completion.choices) && completion.code !== undefined && Number(completion.code) !== 0 && Number(completion.code) !== 200) {
    throw new Error(`中转接口返回错误 (code=${completion.code})：${completion.msg || completion.message || '未知错误'}`);
  }

  const choice = Array.isArray(completion.choices) ? completion.choices[0] : null;
  const finishReason = choice?.finish_reason || completion.stop_reason || '';

  let content = '';
  if (choice) {
    content = extractTextFromContentField(choice?.message?.content)
      || extractTextFromContentField(choice?.text)
      || extractTextFromContentField(choice?.delta?.content);
  }
  if (!content && typeof completion.output_text === 'string') {
    content = completion.output_text;
  }
  if (!content && Array.isArray(completion.output)) {
    content = completion.output
      .map(item => extractTextFromContentField(item?.content))
      .filter(Boolean)
      .join('\n');
  }
  if (!content && Array.isArray(completion.content)) {
    content = extractTextFromContentField(completion.content);
  }
  if (!content && typeof completion.result === 'string') {
    content = completion.result;
  }

  if (!content || !content.trim()) {
    const keys = Object.keys(completion).slice(0, 6).join(', ');
    throw new Error(`AI 返回内容为空${finishReason ? ` (finish_reason=${finishReason})` : ''}，响应字段：[${keys}]`);
  }

  return { content, finishReason };
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
  const records = await dns.lookup(clean, { all: true, verbatim: true });
  if (!records.length) return false;
  return records.every(r => isPublicIp(r.address));
}

async function readLimitedText(response, maxBytes = PROBE_MAX_HTML_BYTES) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
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

function createAbortError(message = '任务已取消') {
  const err = new Error(message);
  err.code = 'TASK_CANCELLED';
  err.isCancelled = true;
  return err;
}

function createCombinedController(timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;

  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    resetTimeout(nextMs = timeoutMs) {
      if (timer) clearTimeout(timer);
      if (nextMs > 0 && !controller.signal.aborted) {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, nextMs);
      }
    },
    cleanup() {
      if (timer) clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };
}

async function probeUrl(rawUrl, { fetchImpl = globalThis.fetch, checkPublicHost = true, signal = null } = {}) {
  if (signal?.aborted) throw createAbortError();

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

  const combined = createCombinedController(PROBE_TIMEOUT_MS, signal);
  try {
    const response = await fetchImpl(parsed.href, {
      method: 'GET',
      redirect: 'follow',
      signal: combined.signal,
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
    if (signal?.aborted) throw createAbortError();
    const causeCode = err?.cause?.code || err?.code || '';
    const isAbort = combined.wasTimedOut() || err?.name === 'AbortError' || causeCode === 'ETIMEDOUT' || causeCode === 'UND_ERR_CONNECT_TIMEOUT';
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
    combined.cleanup();
  }
}

async function probeCardsConcurrently(cards, probeFn, { concurrency = PROBE_CONCURRENCY, signal = null, onProgress = null } = {}) {
  const results = new Map();
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < cards.length) {
      if (signal?.aborted) throw createAbortError();
      const idx = cursor++;
      const card = cards[idx];
      try {
        results.set(card.id, await probeFn(card.url, card, signal));
      } catch (err) {
        if (err?.isCancelled || signal?.aborted) throw createAbortError();
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
      completed++;
      if (typeof onProgress === 'function') {
        onProgress(completed, cards.length);
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

function normalizeSuggestionName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/·・（）()【】[\]]+/g, '');
}

function computeOrganizePlan(cards, rawOutput, menus, subMenus, probeMap = new Map(), { protectMainDirect = false, minCardsForCreate = 3 } = {}) {
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

    // 开启「保护主菜单直属卡片」时，硬性阻止将原主菜单直属卡片（sub_menu_id 为空）移走或降级到子菜单
    if (protectMainDirect && oldMenuId !== null && oldSubMenuId === null) {
      newMenuId = oldMenuId;
      newSubMenuId = null;
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

  const existingSubNamesByParent = new Map();
  for (const sm of subMenus) {
    const pid = Number(sm.parent_id);
    if (!existingSubNamesByParent.has(pid)) existingSubNamesByParent.set(pid, new Set());
    existingSubNamesByParent.get(pid).add(normalizeSuggestionName(sm.name));
  }

  const suggestedSubMenus = [];
  const seenRenameSubIds = new Set();
  const seenCreateKeys = new Set();

  for (const sug of rawSuggestions) {
    if (!sug || typeof sug !== 'object') continue;
    const name = String(sug.name || sug.new_name || '').trim();
    if (!name) continue;

    const targetSubId = sug.target_sub_menu_id !== null && sug.target_sub_menu_id !== undefined && sug.target_sub_menu_id !== ''
      ? Number(sug.target_sub_menu_id)
      : (sug.sub_menu_id !== null && sug.sub_menu_id !== undefined && sug.sub_menu_id !== '' ? Number(sug.sub_menu_id) : null);
    const isRename = (sug.action === 'rename' || Boolean(targetSubId)) && targetSubId && subMenuById.has(targetSubId);

    const validCardIds = [...new Set((Array.isArray(sug.card_ids) ? sug.card_ids : []).map(Number))]
      .filter(id => cardById.has(id) && !recycledIdSet.has(id));

    if (isRename) {
      const existingSub = subMenuById.get(targetSubId);
      const parentId = Number(existingSub.parent_id);
      if (name === existingSub.name || seenRenameSubIds.has(targetSubId)) continue;
      seenRenameSubIds.add(targetSubId);
      suggestedSubMenus.push({
        key: `rename:${targetSubId}`,
        action: 'rename',
        target_sub_menu_id: targetSubId,
        old_name: existingSub.name,
        parent_menu_id: parentId,
        parent_menu_name: menuById.get(parentId)?.name || '',
        name,
        reason: typeof sug.reason === 'string' && sug.reason.trim() ? sug.reason.trim() : `建议将子菜单「${existingSub.name}」更名为「${name}」`,
        card_ids: validCardIds,
        card_titles: validCardIds.map(id => cardById.get(id).title)
      });
      continue;
    }

    const parentId = Number(sug.parent_menu_id);
    if (!menuById.has(parentId)) continue;
    const normName = normalizeSuggestionName(name);
    if (!normName || existingSubNamesByParent.get(parentId)?.has(normName)) continue;

    const dedupeKey = `create:${parentId}:${normName}`;
    if (seenCreateKeys.has(dedupeKey)) continue;
    if (validCardIds.length < minCardsForCreate) continue;

    seenCreateKeys.add(dedupeKey);
    suggestedSubMenus.push({
      key: dedupeKey,
      action: 'create',
      target_sub_menu_id: null,
      old_name: '',
      parent_menu_id: parentId,
      parent_menu_name: menuById.get(parentId).name,
      name,
      reason: typeof sug.reason === 'string' && sug.reason.trim() ? sug.reason.trim() : `发现 ${validCardIds.length} 张相似类型卡片`,
      card_ids: validCardIds,
      card_titles: validCardIds.map(id => cardById.get(id).title)
    });
  }

  return { updates, recycles, suggested_sub_menus: suggestedSubMenus };
}

function computeOrganizeDiff(cards, rawChanges, menus, subMenus) {
  return computeOrganizePlan(cards, rawChanges, menus, subMenus).updates;
}

function extractUpstreamErrorMessage(parsed, rawText, status) {
  const candidates = [
    parsed?.error?.message,
    typeof parsed?.error === 'string' ? parsed.error : '',
    parsed?.message,
    parsed?.msg,
    parsed?.detail
  ].filter(Boolean);

  if (candidates.length) return String(candidates[0]).trim().slice(0, 320);

  const plain = String(rawText || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain ? plain.slice(0, 240) : `HTTP ${status}`;
}

async function readResponseWithIdleTimeout(response, combinedController, idleTimeoutMs) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    return typeof response?.text === 'function' ? await response.text() : '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let rawFullText = '';
  let sseBuffer = '';
  let sseContent = '';
  let sseFinishReason = '';
  let sseChunks = 0;

  const processLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const dataPart = line.slice(5).trim();
    if (!dataPart || dataPart === '[DONE]') return;
    try {
      const chunk = JSON.parse(dataPart);
      if (chunk?.error) {
        const msg = typeof chunk.error === 'string'
          ? chunk.error
          : (chunk.error.message || JSON.stringify(chunk.error).slice(0, 200));
        throw new Error(`流式响应返回错误：${msg}`);
      }
      sseChunks++;
      const choice = chunk?.choices?.[0];
      if (choice?.finish_reason) sseFinishReason = choice.finish_reason;
      const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
      if (typeof delta === 'string') sseContent += delta;
      else if (Array.isArray(delta)) sseContent += extractTextFromContentField(delta);
      else if (typeof chunk?.delta?.text === 'string') sseContent += chunk.delta.text;
    } catch (err) {
      if (/流式响应返回错误/.test(err?.message || '')) throw err;
    }
  };

  while (true) {
    combinedController.resetTimeout(idleTimeoutMs);
    const { done, value } = await reader.read();
    if (done) break;
    const textChunk = decoder.decode(value, { stream: true });
    rawFullText += textChunk;
    sseBuffer += textChunk;
    const lines = sseBuffer.split(/\r?\n/);
    sseBuffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  }
  const trailing = decoder.decode();
  if (trailing) {
    rawFullText += trailing;
    sseBuffer += trailing;
  }
  if (sseBuffer.trim()) processLine(sseBuffer);

  if (sseChunks > 0) {
    return {
      isSse: true,
      content: sseContent,
      finishReason: sseFinishReason
    };
  }
  return rawFullText;
}

async function requestOpenAiResponse(fetchImpl, candidateUrls, { method = 'GET', apiKey, body, timeoutMs = 25000, idleTimeoutMs = AI_IDLE_TIMEOUT_MS, signal = null }) {
  const isStreamRequest = Boolean(body?.stream);
  const headers = {
    Accept: isStreamRequest ? 'text/event-stream, application/json' : 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  };

  let lastError = null;
  for (let i = 0; i < candidateUrls.length; i++) {
    if (signal?.aborted) throw createAbortError();
    const url = candidateUrls[i];
    const combined = createCombinedController(timeoutMs, signal);

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        signal: combined.signal,
        ...(body ? { body: JSON.stringify(body) } : {})
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const upstreamMessage = extractUpstreamErrorMessage(parsed, text, response.status);
        lastError = new Error(`HTTP ${response.status}: ${upstreamMessage}`);
        lastError.status = response.status;
        lastError.upstreamMessage = upstreamMessage;
        lastError.url = url;

        if (response.status === 404 && i < candidateUrls.length - 1) {
          continue;
        }
        throw lastError;
      }

      const rawOrSse = isStreamRequest
        ? await readResponseWithIdleTimeout(response, combined, idleTimeoutMs)
        : await response.text();

      if (rawOrSse && typeof rawOrSse === 'object' && rawOrSse.isSse) {
        return {
          choices: [{
            message: { content: rawOrSse.content },
            finish_reason: rawOrSse.finishReason || 'stop'
          }]
        };
      }

      const text = String(rawOrSse || '');
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (parsed !== null) return parsed;

      const sseResult = parseSseStreamText(text);
      if (sseResult && sseResult.content) {
        return {
          choices: [{
            message: { content: sseResult.content },
            finish_reason: sseResult.finishReason || 'stop'
          }]
        };
      }

      const preview = text.replace(/\s+/g, ' ').slice(0, 160);
      const invalidErr = new Error(`上游接口返回了非 JSON 内容（HTTP ${response.status}）：${preview || '空响应'}`);
      invalidErr.status = response.status;
      throw invalidErr;
    } catch (err) {
      if (err?.isCancelled || signal?.aborted) throw createAbortError();
      if (err?.status) throw err;
      if (combined.wasTimedOut() || err?.name === 'AbortError') {
        const timeoutErr = new Error(`上游接口请求超时（超过 ${Math.round((isStreamRequest ? idleTimeoutMs : timeoutMs) / 1000)} 秒无响应）`);
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      if (/流式响应返回错误|上游接口返回了非 JSON/.test(err?.message || '')) {
        throw err;
      }
      const causeMsg = err?.cause?.code || err?.cause?.message || '';
      const detail = causeMsg ? `${err.message} (${causeMsg})` : (err?.message || '网络连接失败');
      const netErr = new Error(`网络请求失败：${detail}`);
      netErr.code = err?.cause?.code || err?.code || 'NETWORK_ERROR';
      throw netErr;
    } finally {
      combined.cleanup();
    }
  }
  throw lastError || new Error('接口请求失败');
}

function modelDisallowsTemperature(model) {
  return /^(?:o[134](?:-|$)|gpt-5|deepseek-r1|qwq)/i.test(String(model || '').trim());
}

function mergeSystemIntoUserMessages(messages) {
  const systemParts = messages.filter(m => m.role === 'system').map(m => m.content);
  const userParts = messages.filter(m => m.role !== 'system').map(m => m.content);
  return [{
    role: 'user',
    content: `${systemParts.join('\n\n')}\n\n${userParts.join('\n\n')}`.trim()
  }];
}

async function callChatCompletionsWithFallback(fetchImpl, candidateUrls, { apiKey, model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, signal = null }) {
  const includeTemp = !modelDisallowsTemperature(model);

  // 优先开启 stream: true（持续保活，避免中转站套 Cloudflare 触发 100s 504）
  const streamPrimaryBody = {
    model,
    messages,
    stream: true,
    ...(includeTemp ? { temperature: 0.2 } : {})
  };

  try {
    const res = await requestOpenAiResponse(fetchImpl, candidateUrls, {
      method: 'POST',
      apiKey,
      timeoutMs,
      idleTimeoutMs: AI_IDLE_TIMEOUT_MS,
      signal,
      body: streamPrimaryBody
    });
    // 确保流式确实返回了有效文本，否则触发非流式降级
    extractChatContent(res);
    return res;
  } catch (firstErr) {
    if (firstErr?.isCancelled || signal?.aborted) throw createAbortError();
    const status = Number(firstErr?.status || 0);
    const msgLower = String(firstErr?.message || '').toLowerCase();

    // 若明确是鉴权/余额/限流/模型不存在等业务错误，无需无意义降级，直接抛出清晰原因
    if ([401, 402, 403, 429].includes(status) || /insufficient_quota|invalid_api_key|api key|unauthorized|model_not_found/i.test(msgLower)) {
      throw firstErr;
    }

    const systemRejected = /system/i.test(msgLower) && /role|not supported|unsupported|invalid/i.test(msgLower);
    const baseMessages = systemRejected ? mergeSystemIntoUserMessages(messages) : messages;

    // 降级路径 A：若仅因 temperature/system 参数报 400/422 且未提到 stream 不支持，先尝试去掉 temperature 保持 stream: true
    if (includeTemp && (status === 400 || status === 422) && /temperature|system|parameter|param|unsupported|invalid/i.test(msgLower) && !/stream/i.test(msgLower)) {
      try {
        const res = await requestOpenAiResponse(fetchImpl, candidateUrls, {
          method: 'POST',
          apiKey,
          timeoutMs,
          idleTimeoutMs: AI_IDLE_TIMEOUT_MS,
          signal,
          body: {
            model,
            messages: baseMessages,
            stream: true
          }
        });
        extractChatContent(res);
        return res;
      } catch (streamRetryErr) {
        if (streamRetryErr?.isCancelled || signal?.aborted) throw createAbortError();
        // 继续降级到非流式
      }
    }

    // 降级路径 B：自动降级为非流式 stream: false（最小参数集）
    try {
      const res = await requestOpenAiResponse(fetchImpl, candidateUrls, {
        method: 'POST',
        apiKey,
        timeoutMs,
        signal,
        body: {
          model,
          messages: baseMessages,
          stream: false
        }
      });
      return res;
    } catch (nonStreamErr) {
      if (nonStreamErr?.isCancelled || signal?.aborted) throw createAbortError();
      const nonStreamMsg = String(nonStreamErr?.message || '').toLowerCase();
      if (!systemRejected && /system/i.test(nonStreamMsg) && /role|not supported|unsupported|invalid/i.test(nonStreamMsg)) {
        return await requestOpenAiResponse(fetchImpl, candidateUrls, {
          method: 'POST',
          apiKey,
          timeoutMs,
          signal,
          body: {
            model,
            messages: mergeSystemIntoUserMessages(messages)
          }
        });
      }
      throw nonStreamErr;
    }
  }
}

function buildOrganizeMessages(menusTree, cardsBatch, customPrompt, probeMap, duplicateHints, { scope = 'smart', protectMainDirect = true } = {}) {
  const isCustomMode = scope === 'custom';
  const hasPendingMenu = menusTree.some(m =>
    m.name === '待归类' || (m.sub_menus || []).some(sm => sm.name === '待归类')
  );

  let requirement;
  let systemPrompt;

  if (isCustomMode) {
    requirement = `请完全严格按照以下用户自定义指令执行导航卡片整理：\n${String(customPrompt || '').trim()}`;
    systemPrompt = [
      '你是一个高效的网站导航站自定义整理执行助手。当前处于「自定义 AI 整理模式」，请完全优先并严格执行用户的自定义指令，解除默认防乱保守限制。',
      '【交互语义说明】输入卡片中 sub_menu_id 为 null 的卡片属于「主菜单直属」卡片，前台点击主菜单（尤其是 Home）时会直接展示，属于高频常用入口。',
      '你必须只返回严格合法的 JSON 对象，不要包含任何额外解释文字。',
      '输出 JSON 结构必须为：',
      '{',
      '  "updates": [{"id": 1, "menu_id": 2, "sub_menu_id": null, "title": "新标题", "desc": "简洁描述", "needs_review": false, "reason": "执行了哪条自定义指令"}],',
      '  "recycles": [{"id": 2, "recycle_reason": "dead_link|domain_expired|duplicate", "reason": "具体判定依据"}],',
      '  "suggested_sub_menus": [{"parent_menu_id": 5, "name": "建议子菜单名", "reason": "理由", "card_ids": [10, 11, 12]}]',
      '}',
      '硬性技术约束：',
      '1. id 必须来自输入卡片列表；同一张卡片不能同时出现在 updates 和 recycles 中。',
      '2. menu_id 和 sub_menu_id 必须严格来自提供的 menus 列表，绝不可编造不存在的 ID。',
      '3. 若归入某子菜单，必须填写对应的 menu_id（父主菜单ID）和 sub_menu_id（子菜单ID）；若设为主菜单直属，sub_menu_id 必须为 null。',
      protectMainDirect
        ? '4. 【主菜单直属保护已开启】对于当前 sub_menu_id 为 null 的主菜单直属卡片，不要将其移走或降级到子菜单（仅可修改标题、描述或按测活标记死链）。'
        : '4. 【主菜单直属可按指令调整】若用户指令要求移动、精简或调整 Home 等主菜单直属卡片，请严格按指令调整其 menu_id / sub_menu_id。',
      '5. 若输入中包含 probe 测活结果且用户未禁止死链处理，对确认死链/停用/重复卡片可放入 recycles（注意 403/CF 盾勿误杀）。',
      '6. 仅返回有修改或需移入回收站的卡片；无需处理的卡片不要输出。'
    ].join('\n');
  } else {
    requirement = customPrompt && customPrompt.trim()
      ? `请严格按照以下用户自定义要求整理导航卡片（仍需遵守不捏造不存在栏目 ID 的硬性约束，并结合 probe 测活结果处理死链）：\n${customPrompt.trim()}`
      : DEFAULT_ORGANIZE_PROMPT;

    systemPrompt = [
      '你是一个严谨、克制的网站导航站内容整理与死链审核助手。',
      '【交互语义说明】输入卡片中 sub_menu_id 为 null 的卡片属于「主菜单直属」卡片，会在前台点击主菜单（尤其是 Home）时直接展示，属于用户高频常用入口。',
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
      protectMainDirect
        ? '4. 【主菜单直属保护已开启】严禁将当前 sub_menu_id 为 null 的主菜单直属卡片擅自降级移入子菜单或挪到其他主菜单（仅允许为其补全简短中文描述、规范名称大小写及进行死链/重复检测）。'
        : '4. 【主菜单直属保护已关闭】可按内容相关性将主菜单直属卡片合理归入更匹配的主菜单或子菜单。',
      `5. 当前数据库${hasPendingMenu ? '存在' : '不存在'}「待归类」栏目；若某卡片无合适分类或存在跨界歧义，${hasPendingMenu ? '请归入「待归类」' : '请保持原分类不变并设置 needs_review: true'}，绝不强行硬塞。`,
      '6. 仅当某类新主题有 ≥3 张卡片且现有栏目无法容纳时才填写 suggested_sub_menus，否则返回空数组 []。',
      '7. 仅返回有修改、需要复核（needs_review: true）或需移入回收站的卡片；无需处理的卡片不要输出。'
    ].join('\n');
  }

  const userPayload = {
    mode: isCustomMode ? 'custom' : scope,
    protect_main_direct: Boolean(protectMainDirect),
    requirement,
    menus: menusTree,
    cards: cardsBatch.map(c => {
      const probe = probeMap.get(c.id);
      const dup = duplicateHints.get(c.id);
      return {
        id: c.id,
        menu_id: c.effective_menu_id || c.menu_id || null,
        sub_menu_id: c.sub_menu_id || null,
        is_main_direct: !c.sub_menu_id,
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

const DEFAULT_MENU_ORGANIZE_PROMPT = [
  '请对当前导航站的主菜单和子菜单结构进行专业优化：',
  '1. 规范名称大小写与排版格式（例如 Al chat -> AI Chat，Ai Stuff -> AI Stuff，ai自建 -> AI 自建，dev tools -> Dev Tools，ios -> iOS），保持简洁易懂；',
  '2. 优化主菜单和各父菜单下子菜单的排列顺序（高频常用靠前，如 Home/常用放首位，Other/其他放末尾）；',
  '3. 识别含义高度重叠或功能重复的子菜单，在 merge_sub_menus 中建议将冗余子菜单合并到主子菜单（系统会自动迁移全部卡片，不会丢失）；',
  '4. 仅在发现完全空置且无存在必要（card_count === 0 且无子菜单）的栏目时，在 delete_empty_menus / delete_empty_sub_menus 中给出清理建议；',
  '5. 如无必要不要大拆大建，保持整体结构稳定清晰。'
].join('\n');

function buildMenuOrganizeMessages(menuOverview, customPrompt) {
  const isCustom = Boolean(customPrompt && customPrompt.trim());
  const requirement = isCustom
    ? `请完全严格按照以下用户自定义要求整理和重构导航栏目结构：\n${customPrompt.trim()}`
    : DEFAULT_MENU_ORGANIZE_PROMPT;

  const systemPrompt = [
    '你是一个专业的网站导航站信息架构与栏目规划助手。',
    '你必须只返回严格合法的 JSON 对象，不要包含任何额外解释文字。',
    '输出 JSON 结构必须为：',
    '{',
    '  "rename_menus": [{"id": 2, "new_name": "AI Stuff", "reason": "规范大小写"}],',
    '  "rename_sub_menus": [{"id": 1, "new_name": "AI Chat", "reason": "规范大小写"}],',
    '  "reorder_menus": [1, 2, 5, 4, 3, 6],',
    '  "reorder_sub_menus": [{"parent_id": 2, "sub_menu_ids": [1, 2], "reason": "高频优先"}],',
    '  "merge_sub_menus": [{"source_id": 3, "target_id": 1, "reason": "功能重叠，合并后卡片自动迁移"}],',
    '  "add_menus": [{"name": "新主菜单", "reason": "理由"}],',
    '  "add_sub_menus": [{"parent_id": 2, "name": "新子菜单", "reason": "理由"}],',
    '  "delete_empty_menus": [{"id": 9, "reason": "空主菜单无卡片无子菜单"}],',
    '  "delete_empty_sub_menus": [{"id": 12, "reason": "空子菜单无卡片"}]',
    '}',
    '硬性约束：',
    '1. 所有涉及的 id / parent_id / source_id / target_id 必须严格来自输入的 menus 数据，绝不可编造不存在的 ID。',
    '2. delete_empty_menus 仅可包含 direct_card_count === 0 且 sub_menus 为空的空主菜单；delete_empty_sub_menus 仅可包含 card_count === 0 的空子菜单。',
    '3. merge_sub_menus 的 source_id 与 target_id 不能相同，且不能形成循环合并。',
    '4. 某项无需变更时请返回空数组 []（reorder_menus 无需变更时返回 []）。'
  ].join('\n');

  const userPayload = {
    mode: isCustom ? 'custom' : 'default',
    requirement,
    menus: menuOverview
  };

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) }
  ];
}

function computeMenuOrganizePlan(rawOutput, menus, subMenus, cardStats) {
  const menuById = new Map(menus.map(m => [Number(m.id), m]));
  const subMenuById = new Map(subMenus.map(sm => [Number(sm.id), sm]));
  const subMenusByParent = new Map();
  for (const sm of subMenus) {
    const pid = Number(sm.parent_id);
    if (!subMenusByParent.has(pid)) subMenusByParent.set(pid, []);
    subMenusByParent.get(pid).push(sm);
  }

  const directCountByMenu = cardStats.directCountByMenu || new Map();
  const countBySubMenu = cardStats.countBySubMenu || new Map();

  // 1. 重命名（主菜单 + 子菜单）
  const renames = [];
  const seenRenameKeys = new Set();
  for (const item of (Array.isArray(rawOutput?.rename_menus) ? rawOutput.rename_menus : [])) {
    const id = Number(item?.id);
    const newName = String(item?.new_name || '').trim();
    const existing = menuById.get(id);
    if (!existing || !newName || newName === existing.name) continue;
    const key = `menu:${id}`;
    if (seenRenameKeys.has(key)) continue;
    seenRenameKeys.add(key);
    renames.push({
      key,
      kind: 'menu',
      id,
      old_name: existing.name,
      new_name: newName,
      parent_name: '',
      reason: String(item?.reason || '').trim()
    });
  }
  for (const item of (Array.isArray(rawOutput?.rename_sub_menus) ? rawOutput.rename_sub_menus : [])) {
    const id = Number(item?.id);
    const newName = String(item?.new_name || '').trim();
    const existing = subMenuById.get(id);
    if (!existing || !newName || newName === existing.name) continue;
    const key = `sub_menu:${id}`;
    if (seenRenameKeys.has(key)) continue;
    seenRenameKeys.add(key);
    renames.push({
      key,
      kind: 'sub_menu',
      id,
      old_name: existing.name,
      new_name: newName,
      parent_name: menuById.get(Number(existing.parent_id))?.name || '',
      reason: String(item?.reason || '').trim()
    });
  }

  // 2. 合并子菜单（防自环/链式冲突）
  const merges = [];
  const mergedSources = new Set();
  const mergedTargets = new Set();
  for (const item of (Array.isArray(rawOutput?.merge_sub_menus) ? rawOutput.merge_sub_menus : [])) {
    const sourceId = Number(item?.source_id);
    const targetId = Number(item?.target_id);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const source = subMenuById.get(sourceId);
    const target = subMenuById.get(targetId);
    if (!source || !target) continue;
    if (mergedSources.has(sourceId) || mergedTargets.has(sourceId) || mergedSources.has(targetId)) continue;
    mergedSources.add(sourceId);
    mergedTargets.add(targetId);
    merges.push({
      key: `merge:${sourceId}->${targetId}`,
      source_id: sourceId,
      source_name: source.name,
      source_parent_id: Number(source.parent_id),
      source_parent_name: menuById.get(Number(source.parent_id))?.name || '',
      target_id: targetId,
      target_name: target.name,
      target_parent_id: Number(target.parent_id),
      target_parent_name: menuById.get(Number(target.parent_id))?.name || '',
      card_count: Number(countBySubMenu.get(sourceId) || 0),
      reason: String(item?.reason || '').trim() || '合并重叠子菜单并自动迁移卡片'
    });
  }

  // 3. 排序调整（主菜单 + 子菜单）
  const reorders = [];
  const rawMenuOrder = Array.isArray(rawOutput?.reorder_menus) ? rawOutput.reorder_menus.map(Number) : [];
  if (rawMenuOrder.length >= 2) {
    const validMenuOrder = [...new Set(rawMenuOrder)].filter(id => menuById.has(id));
    for (const m of menus) {
      if (!validMenuOrder.includes(Number(m.id))) validMenuOrder.push(Number(m.id));
    }
    const oldMenuIds = menus.map(m => Number(m.id));
    if (validMenuOrder.join(',') !== oldMenuIds.join(',')) {
      reorders.push({
        key: 'reorder:menus',
        kind: 'menu',
        parent_id: null,
        parent_name: '全部主菜单',
        ordered_ids: validMenuOrder,
        old_order_names: oldMenuIds.map(id => menuById.get(id)?.name || `#${id}`),
        new_order_names: validMenuOrder.map(id => menuById.get(id)?.name || `#${id}`),
        reason: '优化主菜单展示顺序'
      });
    }
  }

  const seenSubReorderParents = new Set();
  for (const item of (Array.isArray(rawOutput?.reorder_sub_menus) ? rawOutput.reorder_sub_menus : [])) {
    const parentId = Number(item?.parent_id);
    if (!menuById.has(parentId) || seenSubReorderParents.has(parentId)) continue;
    const siblings = subMenusByParent.get(parentId) || [];
    if (siblings.length < 2) continue;
    const siblingIds = siblings.map(sm => Number(sm.id));
    const siblingIdSet = new Set(siblingIds);
    const rawIds = Array.isArray(item?.sub_menu_ids) ? item.sub_menu_ids.map(Number) : [];
    const validIds = [...new Set(rawIds)].filter(id => siblingIdSet.has(id));
    for (const id of siblingIds) {
      if (!validIds.includes(id)) validIds.push(id);
    }
    if (validIds.join(',') !== siblingIds.join(',')) {
      seenSubReorderParents.add(parentId);
      reorders.push({
        key: `reorder:sub:${parentId}`,
        kind: 'sub_menu',
        parent_id: parentId,
        parent_name: menuById.get(parentId).name,
        ordered_ids: validIds,
        old_order_names: siblingIds.map(id => subMenuById.get(id)?.name || `#${id}`),
        new_order_names: validIds.map(id => subMenuById.get(id)?.name || `#${id}`),
        reason: String(item?.reason || '').trim() || '优化子菜单展示顺序'
      });
    }
  }

  // 4. 新增栏目（主菜单 + 子菜单）
  const additions = [];
  const existingMenuNames = new Set(menus.map(m => String(m.name || '').trim().toLowerCase()));
  const seenAddKeys = new Set();
  for (const item of (Array.isArray(rawOutput?.add_menus) ? rawOutput.add_menus : [])) {
    const name = String(item?.name || '').trim();
    const lower = name.toLowerCase();
    if (!name || existingMenuNames.has(lower)) continue;
    const key = `add:menu:${lower}`;
    if (seenAddKeys.has(key)) continue;
    seenAddKeys.add(key);
    additions.push({
      key,
      kind: 'menu',
      parent_id: null,
      parent_name: '',
      name,
      reason: String(item?.reason || '').trim()
    });
  }
  for (const item of (Array.isArray(rawOutput?.add_sub_menus) ? rawOutput.add_sub_menus : [])) {
    const parentId = Number(item?.parent_id);
    const name = String(item?.name || '').trim();
    const lower = name.toLowerCase();
    if (!menuById.has(parentId) || !name) continue;
    const existingSibNames = new Set((subMenusByParent.get(parentId) || []).map(sm => String(sm.name || '').trim().toLowerCase()));
    if (existingSibNames.has(lower)) continue;
    const key = `add:sub:${parentId}:${lower}`;
    if (seenAddKeys.has(key)) continue;
    seenAddKeys.add(key);
    additions.push({
      key,
      kind: 'sub_menu',
      parent_id: parentId,
      parent_name: menuById.get(parentId).name,
      name,
      reason: String(item?.reason || '').trim()
    });
  }

  // 5. 删除空栏目（严格校验卡片数为 0 且主菜单无子菜单，且不与合并源重复）
  const deletions = [];
  const seenDeleteKeys = new Set();
  for (const item of (Array.isArray(rawOutput?.delete_empty_menus) ? rawOutput.delete_empty_menus : [])) {
    const id = Number(item?.id);
    const existing = menuById.get(id);
    if (!existing) continue;
    const directCount = Number(directCountByMenu.get(id) || 0);
    const subCount = (subMenusByParent.get(id) || []).length;
    if (directCount > 0 || subCount > 0) continue;
    const key = `del:menu:${id}`;
    if (seenDeleteKeys.has(key)) continue;
    seenDeleteKeys.add(key);
    deletions.push({
      key,
      kind: 'menu',
      id,
      name: existing.name,
      parent_name: '',
      card_count: 0,
      sub_menu_count: 0,
      reason: String(item?.reason || '').trim() || '空主菜单（无卡片且无子菜单）'
    });
  }
  for (const item of (Array.isArray(rawOutput?.delete_empty_sub_menus) ? rawOutput.delete_empty_sub_menus : [])) {
    const id = Number(item?.id);
    const existing = subMenuById.get(id);
    if (!existing || mergedSources.has(id)) continue;
    const cardCount = Number(countBySubMenu.get(id) || 0);
    if (cardCount > 0) continue;
    const key = `del:sub:${id}`;
    if (seenDeleteKeys.has(key)) continue;
    seenDeleteKeys.add(key);
    deletions.push({
      key,
      kind: 'sub_menu',
      id,
      name: existing.name,
      parent_name: menuById.get(Number(existing.parent_id))?.name || '',
      card_count: 0,
      sub_menu_count: 0,
      reason: String(item?.reason || '').trim() || '空子菜单（无卡片）'
    });
  }

  return { renames, reorders, merges, additions, deletions };
}

function mergeBatchSuggestions(plans, menus, subMenus) {
  const existingSubNamesByParent = new Map();
  const subMenuById = new Map();
  for (const sm of subMenus) {
    const pid = Number(sm.parent_id);
    subMenuById.set(Number(sm.id), sm);
    if (!existingSubNamesByParent.has(pid)) existingSubNamesByParent.set(pid, new Set());
    existingSubNamesByParent.get(pid).add(normalizeSuggestionName(sm.name));
  }
  const menuById = new Map(menus.map(m => [Number(m.id), m]));

  // 1) 重命名建议严格按 target_sub_menu_id 去重防冲突（同一现有子菜单绝不输出多条冲突改名）
  const renameBySubId = new Map();
  // 2) 新增建议严格按 parent_menu_id + 规范化名称 去重合并
  const createByKey = new Map();

  for (const plan of plans) {
    if (!plan?.suggested_sub_menus) continue;
    for (const sug of plan.suggested_sub_menus) {
      if (!sug || typeof sug !== 'object') continue;
      const action = sug.action === 'rename' || sug.target_sub_menu_id ? 'rename' : 'create';
      const name = String(sug.name || '').trim();
      if (!name) continue;

      if (action === 'rename') {
        const subId = Number(sug.target_sub_menu_id);
        const existingSub = subMenuById.get(subId);
        if (!existingSub || name === existingSub.name) continue;
        const parentId = Number(existingSub.parent_id);
        const cardIds = Array.isArray(sug.card_ids) ? sug.card_ids : [];
        const cardTitles = Array.isArray(sug.card_titles) ? sug.card_titles : [];

        if (!renameBySubId.has(subId)) {
          renameBySubId.set(subId, {
            key: `rename:${subId}`,
            action: 'rename',
            target_sub_menu_id: subId,
            old_name: existingSub.name,
            parent_menu_id: parentId,
            parent_menu_name: menuById.get(parentId)?.name || sug.parent_menu_name || '',
            name,
            reason: sug.reason || `建议更名为「${name}」`,
            card_ids: [...cardIds],
            card_titles: [...cardTitles],
            _bestWeight: cardIds.length
          });
        } else {
          const prev = renameBySubId.get(subId);
          // 冲突解决：若后续批次候选名关联卡片数更多，采用票数更高的名称；始终只保留一条记录
          if (cardIds.length > prev._bestWeight) {
            prev.name = name;
            if (sug.reason) prev.reason = sug.reason;
            prev._bestWeight = cardIds.length;
          }
          const existingIds = new Set(prev.card_ids);
          cardIds.forEach((id, idx) => {
            if (!existingIds.has(id)) {
              existingIds.add(id);
              prev.card_ids.push(id);
              prev.card_titles.push(cardTitles[idx] || `#${id}`);
            }
          });
        }
        continue;
      }

      const parentId = Number(sug.parent_menu_id);
      if (!menuById.has(parentId)) continue;
      const normName = normalizeSuggestionName(name);
      if (!normName || existingSubNamesByParent.get(parentId)?.has(normName)) continue;

      const key = `create:${parentId}:${normName}`;
      const cardIds = Array.isArray(sug.card_ids) ? sug.card_ids : [];
      const cardTitles = Array.isArray(sug.card_titles) ? sug.card_titles : [];

      if (!createByKey.has(key)) {
        createByKey.set(key, {
          key,
          action: 'create',
          target_sub_menu_id: null,
          old_name: '',
          parent_menu_id: parentId,
          parent_menu_name: menuById.get(parentId)?.name || sug.parent_menu_name || '',
          name,
          reason: sug.reason || '',
          card_ids: [...cardIds],
          card_titles: [...cardTitles]
        });
      } else {
        const prev = createByKey.get(key);
        const existingIds = new Set(prev.card_ids);
        cardIds.forEach((id, idx) => {
          if (!existingIds.has(id)) {
            existingIds.add(id);
            prev.card_ids.push(id);
            prev.card_titles.push(cardTitles[idx] || `#${id}`);
          }
        });
      }
    }
  }

  const renames = [...renameBySubId.values()].map(({ _bestWeight, ...rest }) => rest);
  const creates = [...createByKey.values()].filter(s => s.card_ids.length >= 3);
  return [...renames, ...creates];
}

function createAiRouter({ fetchImpl = globalThis.fetch, probeImpl = null, backupImpl = null } = {}) {
  const router = express.Router();
  const tasks = new Map();
  const performAutoBackup = backupImpl || (() => backupRoutes.createAiAutoWebdavBackup());

  ensureAiTable().catch(err => console.error('初始化 ai_configs 表失败:', err));

  function pruneExpiredTasks() {
    const now = Date.now();
    for (const [id, task] of tasks.entries()) {
      if (task.status !== 'running' && now - task.updatedAt > TASK_TTL_MS) {
        tasks.delete(id);
      }
    }
    if (tasks.size > MAX_TASK_RECORDS) {
      const finished = [...tasks.entries()]
        .filter(([, t]) => t.status !== 'running')
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      for (const [id] of finished.slice(0, tasks.size - MAX_TASK_RECORDS)) {
        tasks.delete(id);
      }
    }
  }

  function serializeTask(task) {
    return {
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      message: task.message,
      probed_done: task.probed_done,
      probed_total: task.probed_total,
      batch_done: task.batch_done,
      batch_total: task.batch_total,
      result: task.result,
      error: task.error,
      updated_at: task.updatedAt
    };
  }

  async function resolveOrganizeParams(body = {}) {
    await ensureAiTable();
    let config = null;
    if (body.config_id) {
      config = await get('SELECT * FROM ai_configs WHERE id = ?', [Number(body.config_id)]);
    } else {
      config = await get('SELECT * FROM ai_configs WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    }

    const baseUrl = body.base_url ? normalizeBaseUrl(body.base_url) : (config ? normalizeBaseUrl(config.base_url) : '');
    const apiKey = String(body.api_key || config?.api_key || '').trim();
    const model = String(body.model || config?.model || '').trim();
    const customPrompt = String(body.prompt || '').trim();
    const scope = String(body.scope || 'smart');
    const enableProbe = body.enable_probe !== false;
    const protectMainDirect = body.protect_main_direct !== undefined
      ? Boolean(body.protect_main_direct)
      : scope !== 'custom';

    if (!baseUrl || !apiKey) {
      throw new Error('请先在步骤 1 添加并激活一个有效的 AI 接口配置');
    }
    if (!model) {
      throw new Error('当前激活的 AI 接口尚未配置模型，请点击编辑按钮拉取或输入模型并保存');
    }
    if (scope === 'custom' && !customPrompt) {
      throw new Error('选择「自定义 AI 整理」模式时，请务必填写整理指令');
    }

    return {
      config,
      baseUrl,
      apiKey,
      model,
      customPrompt,
      scope,
      enableProbe,
      protectMainDirect,
      menu_id: body.menu_id,
      sub_menu_id: body.sub_menu_id,
      card_ids: body.card_ids
    };
  }

  async function executeOrganizePipeline(params, { signal = null, onProgress = null } = {}) {
    const updateProgress = (patch) => {
      if (typeof onProgress === 'function') onProgress(patch);
    };

    if (signal?.aborted) throw createAbortError();
    updateProgress({ stage: 'preparing', progress: 3, message: '正在读取栏目与卡片数据...' });

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
    const cardIds = Array.isArray(params.card_ids)
      ? params.card_ids.map(Number).filter(id => Number.isInteger(id) && id > 0)
      : [];

    if (cardIds.length) {
      const idSet = new Set(cardIds);
      probeTargetCards = allActiveCards.filter(c => idSet.has(c.id));
    } else if (params.scope === 'current' && params.menu_id && params.menu_id !== 'all') {
      const targetMenuId = Number(params.menu_id);
      if (params.sub_menu_id && params.sub_menu_id !== 'all' && params.sub_menu_id !== 'main') {
        const targetSubId = Number(params.sub_menu_id);
        probeTargetCards = allActiveCards.filter(c => Number(c.sub_menu_id) === targetSubId);
      } else if (params.sub_menu_id === 'main') {
        probeTargetCards = allActiveCards.filter(c => Number(c.menu_id) === targetMenuId && !c.sub_menu_id);
      } else {
        probeTargetCards = allActiveCards.filter(c => Number(c.effective_menu_id) === targetMenuId);
      }
    }

    if (!probeTargetCards.length) {
      return {
        updates: [],
        changes: [],
        recycles: [],
        suggested_sub_menus: [],
        probe_stats: { total: 0, reachable: 0, waf_403: 0, suspected_dead: 0, suspected_expired: 0 },
        total_analyzed: 0,
        total_probed: 0,
        model: params.model,
        used_default_prompt: !params.customPrompt,
        message: '当前范围内没有可整理的卡片'
      };
    }

    // 第一步：后端并发真实测活
    let probeMap = new Map();
    if (params.enableProbe) {
      updateProgress({
        stage: 'probing',
        progress: 5,
        probed_done: 0,
        probed_total: probeTargetCards.length,
        message: `正在测活 0/${probeTargetCards.length}...`
      });
      const probeFn = probeImpl || ((url, _card, sig) => probeUrl(url, { fetchImpl, signal: sig }));
      try {
        probeMap = await probeCardsConcurrently(probeTargetCards, probeFn, {
          concurrency: PROBE_CONCURRENCY,
          signal,
          onProgress(done, total) {
            const pct = 5 + Math.round((done / Math.max(1, total)) * 30);
            updateProgress({
              stage: 'probing',
              progress: pct,
              probed_done: done,
              probed_total: total,
              message: `正在测活 ${done}/${total}...`
            });
          }
        });
      } catch (probeErr) {
        if (probeErr?.isCancelled || signal?.aborted) throw createAbortError();
        throw new Error(`测活阶段失败：${probeErr.message}`);
      }
    }

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

    let aiCards = probeTargetCards;
    if (params.scope === 'smart' && !params.customPrompt && !cardIds.length) {
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

    const candidateUrls = buildChatCandidateUrls(params.baseUrl);
    const batches = [];
    for (let start = 0; start < aiCards.length; start += BATCH_SIZE) {
      batches.push(aiCards.slice(start, start + BATCH_SIZE));
    }

    const batchPlans = new Array(batches.length);
    const basePct = params.enableProbe ? 35 : 8;
    const spanPct = 98 - basePct;
    let nextBatchIndex = 0;
    let completedBatches = 0;

    if (batches.length > 0) {
      updateProgress({
        stage: 'organizing',
        progress: basePct,
        batch_done: 0,
        batch_total: batches.length,
        message: `正在 AI 整理第 1/${batches.length} 批（每批最多 ${BATCH_SIZE} 张，流式保活）...`
      });
    }

    async function runSingleBatchWithRetry(batch, batchIdx) {
      const batchNo = batchIdx + 1;
      const totalBatches = batches.length;
      const messages = buildOrganizeMessages(menusTree, batch, params.customPrompt, probeMap, duplicateHints, {
        scope: params.scope,
        protectMainDirect: params.protectMainDirect
      });
      let lastErr = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (signal?.aborted) throw createAbortError();
        try {
          const completion = await callChatCompletionsWithFallback(fetchImpl, candidateUrls, {
            apiKey: params.apiKey,
            model: params.model,
            messages,
            timeoutMs: AI_REQUEST_TIMEOUT_MS,
            signal
          });
          const { content, finishReason } = extractChatContent(completion);
          let parsed;
          try {
            parsed = parseAiJson(content);
          } catch (parseErr) {
            if (finishReason === 'length') {
              throw new Error('AI 输出因长度限制被截断 (finish_reason=length)');
            }
            throw parseErr;
          }
          return computeOrganizePlan(batch, parsed, menus, subMenus, probeMap, {
            protectMainDirect: params.protectMainDirect,
            minCardsForCreate: 1
          });
        } catch (err) {
          if (err?.isCancelled || signal?.aborted) throw createAbortError();
          lastErr = err;
          const status = Number(err?.status || 0);
          // 鉴权、余额或模型不存在错误不重试，直接报错
          if ([401, 402, 403].includes(status) || /invalid_api_key|insufficient_quota|model_not_found/i.test(err?.message || '')) {
            break;
          }
          if (attempt < 2) {
            updateProgress({
              stage: 'organizing',
              message: `调用中转站第 ${batchNo}/${totalBatches} 批出现波动，正在自动重试（第 2 次尝试）...`
            });
          }
        }
      }

      const wrapped = new Error(`调用中转站第 ${batchNo}/${totalBatches} 批失败：${lastErr?.message || '未知错误'}`);
      wrapped.status = lastErr?.status;
      throw wrapped;
    }

    async function runBatchWorker() {
      while (nextBatchIndex < batches.length) {
        if (signal?.aborted) throw createAbortError();
        const currentIdx = nextBatchIndex++;
        const batch = batches[currentIdx];
        updateProgress({
          stage: 'organizing',
          batch_done: completedBatches,
          batch_total: batches.length,
          message: `正在 AI 整理第 ${currentIdx + 1}/${batches.length} 批（已完成 ${completedBatches}/${batches.length} 批）...`
        });
        batchPlans[currentIdx] = await runSingleBatchWithRetry(batch, currentIdx);
        completedBatches++;
        const pct = basePct + Math.round((completedBatches / Math.max(1, batches.length)) * spanPct);
        updateProgress({
          stage: 'organizing',
          progress: Math.min(98, pct),
          batch_done: completedBatches,
          batch_total: batches.length,
          message: completedBatches < batches.length
            ? `已完成第 ${completedBatches}/${batches.length} 批，正在整理下一批...`
            : `全部 ${batches.length} 批 AI 整理完成，正在汇总 Diff 预览...`
        });
      }
    }

    if (batches.length > 0) {
      const workerCount = Math.min(BATCH_CONCURRENCY, batches.length);
      await Promise.all(Array.from({ length: workerCount }, () => runBatchWorker()));
    }

    if (signal?.aborted) throw createAbortError();

    const aggregatedUpdates = [];
    const aggregatedRecycles = [];
    for (const plan of batchPlans) {
      if (!plan) continue;
      aggregatedUpdates.push(...plan.updates);
      aggregatedRecycles.push(...plan.recycles);
    }
    const aggregatedSuggestions = mergeBatchSuggestions(batchPlans, menus, subMenus);

    return {
      updates: aggregatedUpdates,
      changes: aggregatedUpdates,
      recycles: aggregatedRecycles,
      suggested_sub_menus: aggregatedSuggestions,
      probe_stats: probeStats,
      total_analyzed: aiCards.length,
      total_probed: probeTargetCards.length,
      batch_count: batches.length,
      model: params.model,
      used_default_prompt: !params.customPrompt
    };
  }

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

  // 拉取模型列表（支持直接传表单中的 base_url + api_key，无需先保存配置）
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
        if (!active) return res.status(400).json({ message: '请先填写 API Base URL 和 API Key' });
        baseUrl = active.base_url;
        apiKey = active.api_key;
      }

      if (!apiKey) return res.status(400).json({ message: '请输入 API Key' });

      const candidateUrls = buildModelsCandidateUrls(baseUrl);
      const payload = await requestOpenAiResponse(fetchImpl, candidateUrls, {
        method: 'GET',
        apiKey: String(apiKey).trim(),
        timeoutMs: 25000
      });
      const models = extractModels(payload);
      res.json({ models });
    } catch (err) {
      res.status(400).json({ message: `拉取模型列表失败：${err.message}` });
    }
  });

  // 1) 启动异步 AI 整理任务（立即返回 taskId，彻底避免 Cloudflare 100s 504）
  router.post('/organize/start', auth, async (req, res) => {
    try {
      pruneExpiredTasks();
      const params = await resolveOrganizeParams(req.body);
      const taskId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const task = {
        id: taskId,
        status: 'running',
        stage: 'preparing',
        progress: 2,
        message: '任务已启动，正在准备数据...',
        probed_done: 0,
        probed_total: 0,
        batch_done: 0,
        batch_total: 0,
        result: null,
        error: null,
        abortController: new AbortController(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      tasks.set(taskId, task);

      // 后台异步执行，绝不阻塞 HTTP 响应
      setImmediate(async () => {
        try {
          const result = await executeOrganizePipeline(params, {
            signal: task.abortController.signal,
            onProgress(patch) {
              if (task.status !== 'running') return;
              Object.assign(task, patch, { updatedAt: Date.now() });
            }
          });
          if (task.status === 'cancelled' || task.abortController.signal.aborted) {
            task.status = 'cancelled';
            task.stage = 'cancelled';
            task.message = '任务已取消';
            task.updatedAt = Date.now();
            return;
          }
          task.status = 'completed';
          task.stage = 'completed';
          task.progress = 100;
          task.message = '整理完成，请预览确认变更';
          task.result = result;
          task.updatedAt = Date.now();
        } catch (err) {
          if (err?.isCancelled || task.status === 'cancelled' || task.abortController.signal.aborted) {
            task.status = 'cancelled';
            task.stage = 'cancelled';
            task.message = '任务已取消';
            task.updatedAt = Date.now();
            return;
          }
          task.status = 'failed';
          task.stage = 'failed';
          task.error = err?.message || '未知错误';
          task.message = `AI 智能整理失败：${task.error}`;
          task.updatedAt = Date.now();
        }
      });

      res.json({
        taskId,
        status: task.status,
        stage: task.stage,
        progress: task.progress,
        message: task.message
      });
    } catch (err) {
      res.status(400).json({ message: err.message || '启动 AI 整理任务失败' });
    }
  });

  // 2) 轮询异步任务进度与结果
  router.get('/organize/status/:taskId', auth, (req, res) => {
    pruneExpiredTasks();
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: '任务不存在或已过期，请重新发起整理' });
    }
    res.json(serializeTask(task));
  });

  // 3) 中途取消异步任务
  router.post('/organize/cancel/:taskId', auth, (req, res) => {
    pruneExpiredTasks();
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: '任务不存在或已结束' });
    }
    if (task.status === 'running') {
      task.status = 'cancelled';
      task.stage = 'cancelled';
      task.message = '任务已取消';
      task.updatedAt = Date.now();
      task.abortController.abort();
    }
    res.json(serializeTask(task));
  });

  // 兼容同步入口（内部复用同一流式小批次管线）
  router.post('/organize', auth, async (req, res) => {
    try {
      const params = await resolveOrganizeParams(req.body);
      const result = await executeOrganizePipeline(params);
      res.json(result);
    } catch (err) {
      const upstreamStatus = Number(err?.status || 0);
      res.status(400).json({
        message: `AI 智能整理失败：${err.message}`,
        detail: err.message,
        upstream_status: upstreamStatus || undefined
      });
    }
  });

  async function executeMenuOrganizePipeline(params, { signal = null, onProgress = null } = {}) {
    const updateProgress = (patch) => {
      if (typeof onProgress === 'function') onProgress(patch);
    };

    if (signal?.aborted) throw createAbortError();
    updateProgress({ stage: 'preparing', progress: 10, message: '正在统计所有主菜单、子菜单及下属卡片样本...' });

    const menus = await all('SELECT * FROM menus ORDER BY "order" ASC, id ASC');
    const subMenus = await all('SELECT * FROM sub_menus ORDER BY "order" ASC, id ASC');
    const activeCards = await all(`
      SELECT id, menu_id, sub_menu_id, title
      FROM cards
      WHERE COALESCE(is_deleted, 0) = 0
      ORDER BY "order" ASC, id ASC
    `);

    const directCardsByMenu = new Map();
    const cardsBySubMenu = new Map();
    for (const card of activeCards) {
      if (card.sub_menu_id) {
        const sid = Number(card.sub_menu_id);
        if (!cardsBySubMenu.has(sid)) cardsBySubMenu.set(sid, []);
        cardsBySubMenu.get(sid).push(card.title);
      } else if (card.menu_id) {
        const mid = Number(card.menu_id);
        if (!directCardsByMenu.has(mid)) directCardsByMenu.set(mid, []);
        directCardsByMenu.get(mid).push(card.title);
      }
    }

    const directCountByMenu = new Map();
    const countBySubMenu = new Map();
    const menuOverview = menus.map(m => {
      const mid = Number(m.id);
      const directList = directCardsByMenu.get(mid) || [];
      directCountByMenu.set(mid, directList.length);
      const children = subMenus
        .filter(sm => Number(sm.parent_id) === mid)
        .map(sm => {
          const sid = Number(sm.id);
          const subList = cardsBySubMenu.get(sid) || [];
          countBySubMenu.set(sid, subList.length);
          return {
            id: sid,
            name: sm.name,
            order: sm.order,
            card_count: subList.length,
            sample_cards: subList.slice(0, 6)
          };
        });
      return {
        id: mid,
        name: m.name,
        order: m.order,
        direct_card_count: directList.length,
        direct_sample_cards: directList.slice(0, 6),
        sub_menus: children
      };
    });

    if (!menus.length) {
      return {
        renames: [],
        reorders: [],
        merges: [],
        additions: [],
        deletions: [],
        model: params.model,
        total_menus: 0,
        total_sub_menus: 0
      };
    }

    updateProgress({ stage: 'organizing', progress: 35, batch_done: 0, batch_total: 1, message: '正在调用 AI 分析栏目结构与卡片分布（流式保活）...' });
    const candidateUrls = buildChatCandidateUrls(params.baseUrl);
    const messages = buildMenuOrganizeMessages(menuOverview, params.customPrompt);

    let lastErr = null;
    let completion = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) throw createAbortError();
      try {
        completion = await callChatCompletionsWithFallback(fetchImpl, candidateUrls, {
          apiKey: params.apiKey,
          model: params.model,
          messages,
          timeoutMs: AI_REQUEST_TIMEOUT_MS,
          signal
        });
        break;
      } catch (err) {
        if (err?.isCancelled || signal?.aborted) throw createAbortError();
        lastErr = err;
        const status = Number(err?.status || 0);
        if ([401, 402, 403].includes(status) || /invalid_api_key|insufficient_quota|model_not_found/i.test(err?.message || '')) {
          break;
        }
        if (attempt < 2) {
          updateProgress({ stage: 'organizing', message: '调用中转站整理栏目出现波动，正在自动重试（第 2 次尝试）...' });
        }
      }
    }

    if (!completion) {
      throw new Error(`调用中转站整理栏目失败：${lastErr?.message || '未知错误'}`);
    }

    const { content, finishReason } = extractChatContent(completion);
    let parsed;
    try {
      parsed = parseAiJson(content);
    } catch (parseErr) {
      if (finishReason === 'length') {
        throw new Error('AI 栏目整理输出因长度限制被截断 (finish_reason=length)');
      }
      throw parseErr;
    }

    const plan = computeMenuOrganizePlan(parsed, menus, subMenus, { directCountByMenu, countBySubMenu });
    return {
      ...plan,
      model: params.model,
      total_menus: menus.length,
      total_sub_menus: subMenus.length,
      used_default_prompt: !params.customPrompt
    };
  }

  // 启动栏目管理 AI 整理异步任务（复用同一任务队列与流式机制）
  router.post('/menus/organize/start', auth, async (req, res) => {
    try {
      pruneExpiredTasks();
      const body = { ...(req.body || {}), scope: 'menu' };
      const params = await resolveOrganizeParams(body);
      const taskId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const task = {
        id: taskId,
        status: 'running',
        stage: 'preparing',
        progress: 5,
        message: '栏目整理任务已启动，正在读取栏目数据...',
        probed_done: 0,
        probed_total: 0,
        batch_done: 0,
        batch_total: 1,
        result: null,
        error: null,
        abortController: new AbortController(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      tasks.set(taskId, task);

      setImmediate(async () => {
        try {
          const result = await executeMenuOrganizePipeline(params, {
            signal: task.abortController.signal,
            onProgress(patch) {
              if (task.status !== 'running') return;
              Object.assign(task, patch, { updatedAt: Date.now() });
            }
          });
          if (task.status === 'cancelled' || task.abortController.signal.aborted) {
            task.status = 'cancelled';
            task.stage = 'cancelled';
            task.message = '任务已取消';
            task.updatedAt = Date.now();
            return;
          }
          task.status = 'completed';
          task.stage = 'completed';
          task.progress = 100;
          task.batch_done = 1;
          task.message = '栏目分析完成，请预览确认变更';
          task.result = result;
          task.updatedAt = Date.now();
        } catch (err) {
          if (err?.isCancelled || task.status === 'cancelled' || task.abortController.signal.aborted) {
            task.status = 'cancelled';
            task.stage = 'cancelled';
            task.message = '任务已取消';
            task.updatedAt = Date.now();
            return;
          }
          task.status = 'failed';
          task.stage = 'failed';
          task.error = err?.message || '未知错误';
          task.message = `AI 整理栏目失败：${task.error}`;
          task.updatedAt = Date.now();
        }
      });

      res.json({
        taskId,
        status: task.status,
        stage: task.stage,
        progress: task.progress,
        message: task.message
      });
    } catch (err) {
      res.status(400).json({ message: err.message || '启动栏目整理任务失败' });
    }
  });

  // 应用用户勾选确认的栏目 AI 整理更改（事务执行 + 合并子菜单无损迁移卡片 + 变更前可选 WebDAV 自动备份）
  router.post('/menus/apply', auth, async (req, res) => {
    const renames = Array.isArray(req.body?.renames) ? req.body.renames : [];
    const reorders = Array.isArray(req.body?.reorders) ? req.body.reorders : [];
    const merges = Array.isArray(req.body?.merges) ? req.body.merges : [];
    const additions = Array.isArray(req.body?.additions) ? req.body.additions : [];
    const deletions = Array.isArray(req.body?.deletions) ? req.body.deletions : [];
    const autoBackup = Boolean(req.body?.auto_backup);

    if (!renames.length && !reorders.length && !merges.length && !additions.length && !deletions.length) {
      return res.status(400).json({ message: '请至少勾选一条要应用的栏目更改' });
    }

    let backupInfo = null;
    if (autoBackup) {
      try {
        backupInfo = await performAutoBackup();
      } catch (backupErr) {
        return res.status(502).json({
          message: `变更前自动备份到 WebDAV 失败，已中止数据库修改：${backupErr.message}`,
          backup_failed: true,
          detail: backupErr.message
        });
      }
    }

    try {
      await run('BEGIN TRANSACTION');
      const summary = { renamed: 0, merged: 0, migrated_cards: 0, added: 0, deleted: 0, reordered: 0 };

      // 1. 重命名
      for (const item of renames) {
        const id = Number(item?.id);
        const newName = String(item?.new_name || '').trim();
        if (!Number.isInteger(id) || id <= 0 || !newName) continue;
        if (item.kind === 'menu') {
          const r = await run('UPDATE menus SET name = ? WHERE id = ?', [newName, id]);
          summary.renamed += r.changes;
        } else if (item.kind === 'sub_menu') {
          const r = await run('UPDATE sub_menus SET name = ? WHERE id = ?', [newName, id]);
          summary.renamed += r.changes;
        }
      }

      // 2. 合并子菜单（无损迁移源子菜单下全部卡片含回收站卡片，再删除源子菜单）
      for (const item of merges) {
        const sourceId = Number(item?.source_id);
        const targetId = Number(item?.target_id);
        if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId === targetId) continue;
        const source = await get('SELECT id FROM sub_menus WHERE id = ?', [sourceId]);
        const target = await get('SELECT id, parent_id FROM sub_menus WHERE id = ?', [targetId]);
        if (!source || !target) continue;

        const maxOrderRow = await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE sub_menu_id = ?', [targetId]);
        let nextOrder = Number(maxOrderRow?.maxOrder || 0);
        const sourceCards = await all('SELECT id FROM cards WHERE sub_menu_id = ? ORDER BY "order" ASC, id ASC', [sourceId]);
        for (const c of sourceCards) {
          nextOrder += 1;
          const r = await run(
            'UPDATE cards SET menu_id = ?, sub_menu_id = ?, "order" = ? WHERE id = ?',
            [Number(target.parent_id), targetId, nextOrder, c.id]
          );
          summary.migrated_cards += r.changes;
        }
        await run('DELETE FROM sub_menus WHERE id = ?', [sourceId]);
        summary.merged += 1;
      }

      // 3. 新增主菜单 / 子菜单
      for (const item of additions) {
        const name = String(item?.name || '').trim();
        if (!name) continue;
        if (item.kind === 'menu') {
          const maxRow = await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM menus');
          await run('INSERT INTO menus (name, "order") VALUES (?, ?)', [name, Number(maxRow?.maxOrder || 0) + 1]);
          summary.added += 1;
        } else if (item.kind === 'sub_menu') {
          const parentId = Number(item?.parent_id);
          const parent = await get('SELECT id FROM menus WHERE id = ?', [parentId]);
          if (!parent) continue;
          const maxRow = await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM sub_menus WHERE parent_id = ?', [parentId]);
          await run('INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)', [parentId, name, Number(maxRow?.maxOrder || 0) + 1]);
          summary.added += 1;
        }
      }

      // 4. 删除空栏目（事务内二次校验确保零活跃卡片，避免误删非空栏目或产生孤儿卡片）
      for (const item of deletions) {
        const id = Number(item?.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        if (item.kind === 'sub_menu') {
          const activeCnt = await get('SELECT COUNT(*) AS cnt FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND sub_menu_id = ?', [id]);
          if (Number(activeCnt?.cnt || 0) > 0) continue;
          // 若回收站有软删除卡片引用此子菜单，保留其父主菜单并解除 sub_menu_id 引用
          const sub = await get('SELECT parent_id FROM sub_menus WHERE id = ?', [id]);
          if (sub) {
            await run('UPDATE cards SET menu_id = COALESCE(menu_id, ?), sub_menu_id = NULL WHERE sub_menu_id = ? AND COALESCE(is_deleted, 0) = 1', [sub.parent_id, id]);
          }
          const r = await run('DELETE FROM sub_menus WHERE id = ?', [id]);
          summary.deleted += r.changes;
        } else if (item.kind === 'menu') {
          const subCnt = await get('SELECT COUNT(*) AS cnt FROM sub_menus WHERE parent_id = ?', [id]);
          const activeCnt = await get('SELECT COUNT(*) AS cnt FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND menu_id = ?', [id]);
          if (Number(subCnt?.cnt || 0) > 0 || Number(activeCnt?.cnt || 0) > 0) continue;
          const fallbackMenu = await get('SELECT id FROM menus WHERE id != ? ORDER BY "order" ASC, id ASC LIMIT 1', [id]);
          if (fallbackMenu) {
            await run('UPDATE cards SET menu_id = ?, sub_menu_id = NULL WHERE menu_id = ? AND COALESCE(is_deleted, 0) = 1', [fallbackMenu.id, id]);
          }
          const r = await run('DELETE FROM menus WHERE id = ?', [id]);
          summary.deleted += r.changes;
        }
      }

      // 5. 排序调整
      for (const item of reorders) {
        const ids = Array.isArray(item?.ordered_ids) ? item.ordered_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
        if (!ids.length) continue;
        if (item.kind === 'menu') {
          for (let i = 0; i < ids.length; i++) {
            await run('UPDATE menus SET "order" = ? WHERE id = ?', [i + 1, ids[i]]);
          }
          summary.reordered += 1;
        } else if (item.kind === 'sub_menu') {
          for (let i = 0; i < ids.length; i++) {
            await run('UPDATE sub_menus SET "order" = ? WHERE id = ?', [i + 1, ids[i]]);
          }
          summary.reordered += 1;
        }
      }

      await run('COMMIT');
      res.json({
        summary,
        backup: backupInfo,
        message: `栏目整理已应用（重命名 ${summary.renamed}、合并 ${summary.merged} 迁移 ${summary.migrated_cards} 张卡片、排序 ${summary.reordered}、新增 ${summary.added}、清理空栏目 ${summary.deleted}）`
      });
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      res.status(500).json({ message: `应用栏目更改失败：${err.message}` });
    }
  });

  // 批量同意 AI 建议的新增 / 重命名子菜单（单事务执行，去重防冲突）
  router.post('/suggestions/apply', auth, async (req, res) => {
    const suggestions = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
    if (!suggestions.length) {
      return res.status(400).json({ message: '请至少勾选一条子菜单建议' });
    }

    try {
      const menus = await all('SELECT id, name FROM menus');
      const subMenus = await all('SELECT id, parent_id, name FROM sub_menus');
      const menuById = new Map(menus.map(m => [Number(m.id), m]));
      const subMenuById = new Map(subMenus.map(sm => [Number(sm.id), sm]));

      await run('BEGIN TRANSACTION');
      const applied = [];
      const handledRenameIds = new Set();
      const createdByKey = new Map();

      for (const item of suggestions) {
        if (!item || typeof item !== 'object') continue;
        const name = String(item.name || '').trim();
        if (!name) continue;
        const action = item.action === 'rename' || item.target_sub_menu_id ? 'rename' : 'create';

        if (action === 'rename') {
          const subId = Number(item.target_sub_menu_id);
          const existingSub = subMenuById.get(subId);
          if (!existingSub || handledRenameIds.has(subId)) continue;
          handledRenameIds.add(subId);
          await run('UPDATE sub_menus SET name = ? WHERE id = ?', [name, subId]);
          const parentId = Number(existingSub.parent_id);
          applied.push({
            key: item.key || `rename:${subId}`,
            action: 'rename',
            sub_menu_id: subId,
            parent_menu_id: parentId,
            parent_menu_name: menuById.get(parentId)?.name || item.parent_menu_name || '',
            old_name: existingSub.name,
            name,
            card_ids: Array.isArray(item.card_ids) ? item.card_ids.map(Number).filter(n => n > 0) : [],
            card_titles: Array.isArray(item.card_titles) ? item.card_titles : []
          });
          continue;
        }

        const parentId = Number(item.parent_menu_id);
        if (!menuById.has(parentId)) continue;
        const normKey = `${parentId}:${normalizeSuggestionName(name)}`;

        let subMenuId;
        if (createdByKey.has(normKey)) {
          subMenuId = createdByKey.get(normKey);
        } else {
          const existingSame = subMenus.find(
            sm => Number(sm.parent_id) === parentId && normalizeSuggestionName(sm.name) === normalizeSuggestionName(name)
          );
          if (existingSame) {
            subMenuId = Number(existingSame.id);
          } else {
            const maxRow = await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM sub_menus WHERE parent_id = ?', [parentId]);
            const insertRes = await run(
              'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)',
              [parentId, name, Number(maxRow?.maxOrder || 0) + 1]
            );
            subMenuId = insertRes.lastID;
          }
          createdByKey.set(normKey, subMenuId);
        }

        applied.push({
          key: item.key || `create:${normKey}`,
          action: 'create',
          sub_menu_id: subMenuId,
          parent_menu_id: parentId,
          parent_menu_name: menuById.get(parentId).name,
          name,
          card_ids: Array.isArray(item.card_ids) ? item.card_ids.map(Number).filter(n => n > 0) : [],
          card_titles: Array.isArray(item.card_titles) ? item.card_titles : []
        });
      }

      await run('COMMIT');
      res.json({ applied, message: `已批量应用 ${applied.length} 条子菜单建议` });
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      res.status(500).json({ message: `批量应用子菜单建议失败：${err.message}` });
    }
  });

  // 应用用户勾选确认的 AI 整理更改（支持变更前自动 WebDAV 备份）
  router.post('/apply', auth, async (req, res) => {
    const updates = Array.isArray(req.body?.updates)
      ? req.body.updates
      : (Array.isArray(req.body?.changes) ? req.body.changes : []);
    const recycles = Array.isArray(req.body?.recycles) ? req.body.recycles : [];
    const autoBackup = Boolean(req.body?.auto_backup);

    if (!updates.length && !recycles.length) {
      return res.status(400).json({ message: '请至少勾选一条要应用的更改' });
    }

    let backupInfo = null;
    if (autoBackup) {
      try {
        backupInfo = await performAutoBackup();
      } catch (backupErr) {
        return res.status(502).json({
          message: `变更前自动备份到 WebDAV 失败，已中止数据库写入：${backupErr.message}`,
          backup_failed: true,
          detail: backupErr.message
        });
      }
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
        backup: backupInfo,
        message: `已更新 ${updated} 张卡片，移入回收站 ${recycled} 张卡片${backupInfo ? `（变更前已自动备份：${backupInfo.filename}）` : ''}`
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
defaultRouter.BATCH_SIZE = BATCH_SIZE;
defaultRouter.normalizeBaseUrl = normalizeBaseUrl;
defaultRouter.buildModelsCandidateUrls = buildModelsCandidateUrls;
defaultRouter.buildChatCandidateUrls = buildChatCandidateUrls;
defaultRouter.extractModels = extractModels;
defaultRouter.extractHtmlTitle = extractHtmlTitle;
defaultRouter.probeUrl = probeUrl;
defaultRouter.detectDuplicateHints = detectDuplicateHints;
defaultRouter.parseAiJson = parseAiJson;
defaultRouter.parseSseStreamText = parseSseStreamText;
defaultRouter.extractChatContent = extractChatContent;
defaultRouter.callChatCompletionsWithFallback = callChatCompletionsWithFallback;
defaultRouter.buildOrganizeMessages = buildOrganizeMessages;
defaultRouter.buildMenuOrganizeMessages = buildMenuOrganizeMessages;
defaultRouter.computeOrganizePlan = computeOrganizePlan;
defaultRouter.computeMenuOrganizePlan = computeMenuOrganizePlan;
defaultRouter.mergeBatchSuggestions = mergeBatchSuggestions;
defaultRouter.normalizeSuggestionName = normalizeSuggestionName;
defaultRouter.computeOrganizeDiff = computeOrganizeDiff;
defaultRouter.DEFAULT_ORGANIZE_PROMPT = DEFAULT_ORGANIZE_PROMPT;

module.exports = defaultRouter;
