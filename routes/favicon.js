const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const ipaddr = require('ipaddr.js');
const net = require('net');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const zlib = require('zlib');
const { Parser } = require('htmlparser2');

const DEFAULT_LOGO = '/uploads/default-favicon.png';
const HTML_TIMEOUT_MS = 5000;
const IMAGE_TIMEOUT_MS = 5000;
const HTML_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_REDIRECTS = 5;
const CACHE_LIMIT = 500;
const CACHE_MEMORY_BYTES = 32 * 1024 * 1024;
const CACHE_DIRECTORY = path.join(__dirname, '..', 'database', 'favicon-cache');
const CACHE_VERSION = 'v5';
const PROBE_BUDGET_MS = 20000;
const DNS_TIMEOUT_MS = 2000;
const commonIconPaths = [
  '/favicon.ico', '/favicon.png', '/favicon.svg', '/logo.png', '/logo.svg', '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png', '/favicon-32x32.png', '/favicon-16x16.png',
  '/assets/favicon.ico', '/assets/favicon.png', '/assets/favicon.svg',
  '/images/favicon.ico', '/images/favicon.png', '/images/favicon.svg',
  '/static/favicon.ico', '/static/favicon.png', '/static/favicon.svg'
];
const imageTypes = new Set([
  'image/avif', 'image/apng', 'image/bmp', 'image/gif', 'image/icon', 'image/vnd.microsoft.icon',
  'image/x-icon', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'
]);
const memoryCache = new Map();
const inFlight = new Map();

function normalizeInput(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    try { parsed = new URL(`https://${value}`); } catch { return null; }
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

async function resolvePublicAddresses(hostname) {
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('禁止访问内网地址');
    return [{ address: hostname, family: net.isIP(hostname) }];
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new Error('目标域名解析到非公网地址');
  }
  return addresses;
}

function resolveWithinTimeout(hostname, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('域名解析超时')), Math.min(DNS_TIMEOUT_MS, timeoutMs));
    resolvePublicAddresses(hostname).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function requestOnce(url, { maxBytes, timeoutMs, accept }) {
  const startedAt = Date.now();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await resolveWithinTimeout(hostname, timeoutMs);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const selected = addresses.find(entry => entry.family === 4) || addresses[0];
    let deadline;
    const request = transport.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: net.isIP(hostname) ? undefined : hostname,
      rejectUnauthorized: false,
      lookup(_hostname, _options, callback) {
        if (_options?.all) callback(null, addresses);
        else callback(null, selected.address, selected.family);
      },
      headers: {
        'User-Agent': 'NavItem-Favicon-Fetcher/1.0 (+https://github.com/eooce/Nav-Item)',
        Accept: accept,
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'close'
      }
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error('响应超过大小限制'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        clearTimeout(deadline);
        resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          url
        });
      });
      response.on('error', error => request.destroy(error));
      response.on('aborted', () => request.destroy(new Error('目标响应中断')));
    });
    deadline = setTimeout(() => request.destroy(new Error('目标请求超时')), Math.max(1, timeoutMs - (Date.now() - startedAt)));
    request.on('error', error => {
      clearTimeout(deadline);
      reject(error);
    });
    request.on('close', () => clearTimeout(deadline));
    request.end();
  });
}

async function requestFollowingRedirects(startUrl, options) {
  let url = new URL(startUrl);
  const deadline = Date.now() + options.timeoutMs;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('重定向请求超时');
    const result = await requestOnce(url, { ...options, timeoutMs: remaining });
    if (![301, 302, 303, 307, 308].includes(result.status)) return result;
    const location = result.headers.location;
    if (!location || redirects === MAX_REDIRECTS) return result;
    const nextUrl = new URL(location, url);
    if (!['http:', 'https:'].includes(nextUrl.protocol) || nextUrl.username || nextUrl.password) {
      throw new Error('目标重定向地址无效');
    }
    url = nextUrl;
  }
  throw new Error('目标重定向过多');
}

function sniffImageType(body) {
  if (!Buffer.isBuffer(body) || body.length === 0) return null;
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 6 && /^GIF8[79]a$/.test(body.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (body.length >= 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (body.length >= 6 && body.readUInt16LE(0) === 0 && body.readUInt16LE(2) === 1) return 'image/x-icon';
  if (body.length >= 2 && body.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (body.length >= 12 && body.toString('ascii', 4, 8) === 'ftyp' && body.toString('ascii', 8, 12).startsWith('avif')) return 'image/avif';
  const text = body.subarray(0, 4096).toString('utf8')
    .replace(/^\uFEFF/, '').replace(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype[^>]*>\s*)?/i, '')
    .replace(/<!--[^]*?-->/g, '').trimStart();
  if (/^<svg(?:\s|>)/i.test(text)) return 'image/svg+xml';
  return null;
}

function getActualImageType(body, contentType) {
  const declared = (contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (!imageTypes.has(declared) && declared !== 'application/octet-stream') return null;
  return sniffImageType(body);
}

function isValidImage(body, contentType) {
  if (!Buffer.isBuffer(body) || body.length === 0) return false;
  const type = (contentType || '').split(';', 1)[0].trim().toLowerCase();
  const actualType = getActualImageType(body, type);
  if (!actualType) return false;
  // Content-Type is often wrong for favicons; accept only when the bytes independently
  // identify a real image, and let the proxy serve it with its detected MIME type.
  if (type !== actualType && !(type === 'image/vnd.microsoft.icon' && actualType === 'image/png')
    && !(type === 'image/apng' && actualType === 'image/png')) return false;
  const validatedType = actualType;
  if (validatedType === 'image/svg+xml') {
    const prefix = body.subarray(0, 4096).toString('utf8')
      .replace(/^\uFEFF/, '').replace(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype[^>]*>\s*)?/i, '')
      .replace(/<!--[^]*?-->/g, '').trimStart();
    return /^<svg(?:\s|>)/i.test(prefix);
  }
  return imageTypes.has(validatedType) || validatedType === 'image/x-icon';
}

function parseDeclaredIcons(html, pageUrl) {
  const iconLinks = [];
  const shortcutIconLinks = [];
  const appleLinks = [];
  const socialImages = [];
  const logoImages = [];
  const inlineLogoImages = [];
  let inHead = false;
  let headerNavDepth = 0;
  let documentBase = new URL(pageUrl);
  let hasBase = false;
  const elementStack = [];
  let svgCapture = null;

  const escapeAttribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const serializeAttributes = attrs => Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');

  const parser = new Parser({
    onopentag(name, attrs) {
      const tag = name.toLowerCase();
      if (svgCapture) {
        svgCapture.markup += `<${tag}${serializeAttributes(attrs)}>`;
        svgCapture.depth++;
      }
      if (tag === 'head') inHead = true;
      if (tag === 'header' || tag === 'nav') headerNavDepth++;
      if (tag === 'base' && attrs.href && !hasBase) {
        try {
          const candidateBase = new URL(attrs.href, pageUrl);
          if (['http:', 'https:'].includes(candidateBase.protocol)) {
            documentBase = candidateBase;
            hasBase = true;
          }
        } catch { /* Keep the response URL as the document base. */ }
      }
      if (tag === 'link') {
        const rels = (attrs.rel || '').toLowerCase().split(/\s+/);
        const href = (attrs.href || '').trim();
        if (!href) return;
        if (rels.includes('stylesheet')) {
          try {
            const stylesheet = new URL(href, documentBase);
          } catch { /* Ignore malformed stylesheet URLs. */ }
        }
        if (rels.includes('shortcut') && rels.includes('icon')) shortcutIconLinks.push(href);
        else if (rels.includes('icon')) iconLinks.push(href);
        else if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) appleLinks.push(href);
      }
      if (tag === 'meta' && ['og:image', 'twitter:image', 'image'].includes((attrs.property || attrs.name || attrs.itemprop || '').toLowerCase()) && attrs.content) {
        socialImages.push(attrs.content.trim());
      }
      if (tag === 'img' || tag === 'source') {
        const sources = [attrs.src, attrs['data-src'], attrs['data-lazy-src'], attrs['data-original']]
          .filter(Boolean).map(value => value.trim());
        const srcset = attrs.srcset || attrs['data-srcset'] || '';
        for (const candidate of srcset.split(',')) {
          const source = candidate.trim().split(/\s+/, 1)[0];
          if (source) sources.push(source);
        }
        const text = `${attrs.alt || ''} ${attrs.class || ''} ${attrs.id || ''} ${attrs.title || ''}`;
        if (headerNavDepth > 0 || inHead || /logo|brand|site.?icon/i.test(text)) {
          logoImages.push(...sources);
        }
      }
      if (!svgCapture && tag === 'svg') {
        const marker = `${attrs.class || ''} ${attrs.id || ''} ${attrs['aria-label'] || ''} ${attrs.title || ''}`;
        const inBrandedContainer = elementStack.some(element => /logo|brand/i.test(`${element.class || ''} ${element.id || ''}`));
        if (/logo|brand/i.test(marker) || inBrandedContainer) {
          svgCapture = { depth: 1, markup: `<svg${serializeAttributes(attrs)}>` };
        }
      }
      elementStack.push({ tag, class: attrs.class || '', id: attrs.id || '' });
    },
    ontext(text) {
      if (svgCapture) svgCapture.markup += text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    onclosetag(name) {
      const tag = name.toLowerCase();
      if (svgCapture) {
        svgCapture.markup += `</${tag}>`;
        svgCapture.depth--;
        if (svgCapture.depth === 0) {
          inlineLogoImages.push(`data:image/svg+xml,${encodeURIComponent(svgCapture.markup)}`);
          svgCapture = null;
        }
      }
      if (tag === 'head') inHead = false;
      if (tag === 'header' || tag === 'nav') headerNavDepth = Math.max(0, headerNavDepth - 1);
      for (let index = elementStack.length - 1; index >= 0; index--) {
        if (elementStack[index].tag === tag) {
          elementStack.length = index;
          break;
        }
      }
    }
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html);
  parser.end();

  const candidates = [
    ...shortcutIconLinks, ...iconLinks, ...appleLinks, ...socialImages,
    ...((shortcutIconLinks.length || iconLinks.length) ? [] : logoImages),
    ...inlineLogoImages
  ];
  return [...new Set(candidates)]
    .map(candidate => {
      try {
        const resolved = new URL(candidate, documentBase);
        if (['http:', 'https:'].includes(resolved.protocol)) return resolved;
        if (resolved.protocol === 'data:' && /^data:image\/(?:svg\+xml|png|gif|webp|jpeg|x-icon|vnd\.microsoft\.icon)/i.test(candidate)) return resolved;
        return null;
      } catch {
        return null;
      }
    }).filter(Boolean)
    .filter((url, index, values) => values.findIndex(item => item.href === url.href) === index)
    .slice(0, 24);
}

function parseCssImageUrls(css, stylesheetUrl) {
  const urls = [];
  const pattern = /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
  for (const match of css.matchAll(pattern)) {
    const value = match[1];
    if (/^(?:data:|javascript:|#)/i.test(value)) continue;
    try {
      const resolved = new URL(value, stylesheetUrl);
      if (['http:', 'https:'].includes(resolved.protocol)) urls.push(resolved);
    } catch { /* Ignore malformed CSS URLs. */ }
  }
  return [...new Map(urls.map(url => [url.href, url])).values()].slice(0, 24);
}

function parseStylesheetLinks(html, pageUrl) {
  const links = [];
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name.toLowerCase() !== 'link' || !attrs.href) return;
      const rels = (attrs.rel || '').toLowerCase().split(/\s+/);
      if (!rels.includes('stylesheet')) return;
      try {
        const url = new URL(attrs.href, pageUrl);
        if (['http:', 'https:'].includes(url.protocol)) links.push(url);
      } catch { /* Ignore malformed stylesheet URLs. */ }
    }
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html); parser.end();
  return [...new Map(links.map(url => [url.href, url])).values()].slice(0, 4);
}

function parseManifestLinks(html, pageUrl) {
  const manifests = [];
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name.toLowerCase() !== 'link' || !attrs.href) return;
      const rels = (attrs.rel || '').toLowerCase().split(/\s+/);
      if (!rels.includes('manifest')) return;
      try {
        const url = new URL(attrs.href, pageUrl);
        if (['http:', 'https:'].includes(url.protocol)) manifests.push(url);
      } catch { /* Ignore malformed manifest links. */ }
    }
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html);
  parser.end();
  return [...new Map(manifests.map(url => [url.href, url])).values()].slice(0, 3);
}

function parseManifestIcons(manifest, manifestUrl) {
  if (!manifest || !Array.isArray(manifest.icons)) return [];
  return manifest.icons.map((icon, index) => ({ icon, index }))
    .filter(({ icon }) => typeof icon.src === 'string' && icon.src.trim())
    .sort((a, b) => {
      const maskable = icon => /maskable/.test(icon.purpose || '');
      return Number(maskable(a.icon)) - Number(maskable(b.icon)) || b.index - a.index;
    })
    .map(({ icon }) => {
      try {
        const url = new URL(icon.src, manifestUrl);
        return ['http:', 'https:', 'data:'].includes(url.protocol) ? url : null;
      } catch { return null; }
    }).filter(Boolean).slice(0, 24);
}

async function fetchValidImage(url, { google = false } = {}, requester = requestFollowingRedirects) {
  let body;
  let contentType;
  let source;
  if (url.protocol === 'data:') {
    const inline = decodeDataImage(url);
    if (!inline) return null;
    ({ body, contentType, source } = inline);
  } else {
    const result = await requester(url, {
      maxBytes: IMAGE_MAX_BYTES, timeoutMs: IMAGE_TIMEOUT_MS, accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    });
    if (result.status !== 200) return null;
    body = result.body;
    contentType = (result.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    source = result.url.href;
  }
  const actualType = getActualImageType(body, contentType);
  if (!isValidImage(body, contentType) || !actualType) return null;
  // Google's uncatalogued-domain response is a generic 16×16 globe, not a site logo.
  if (google && hasGenericGoogleGlobeSize(body, actualType)) return null;
  return { body, contentType: actualType, source };
}

function decodeDataImage(url) {
  if (url.href.length > IMAGE_MAX_BYTES * 1.5) return null;
  const raw = url.href.slice(5);
  const comma = raw.indexOf(',');
  if (comma < 0) return null;
  const metadata = raw.slice(0, comma).split(';');
  const contentType = (metadata[0] || '').toLowerCase();
  if (!contentType.startsWith('image/')) return null;
  try {
    const payload = raw.slice(comma + 1);
    const body = metadata.some(part => part.toLowerCase() === 'base64')
      ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
    if (!body.length || body.length > IMAGE_MAX_BYTES || !isValidImage(body, contentType)) return null;
    return { body, contentType: getActualImageType(body, contentType), source: 'inline data image' };
  } catch { return null; }
}

function decodeHtmlBody(result) {
  const encoding = (result.headers['content-encoding'] || '').trim().toLowerCase();
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(result.body, { maxOutputLength: HTML_MAX_BYTES });
    if (encoding === 'deflate') return zlib.inflateSync(result.body, { maxOutputLength: HTML_MAX_BYTES });
    if (encoding === 'br') return zlib.brotliDecompressSync(result.body, { maxOutputLength: HTML_MAX_BYTES });
    if (!encoding || encoding === 'identity') return result.body;
  } catch { return null; }
  return null;
}

function hasGenericGoogleGlobeSize(body, type) {
  let width;
  let height;
  if (type === 'image/png' || type === 'image/apng') {
    if (body.length < 24) return true;
    width = body.readUInt32BE(16);
    height = body.readUInt32BE(20);
  } else if (type === 'image/gif') {
    if (body.length < 10) return true;
    width = body.readUInt16LE(6);
    height = body.readUInt16LE(8);
  } else if (type === 'image/webp' && body.length >= 30 && body.toString('ascii', 12, 16) === 'VP8X') {
    width = 1 + body.readUIntLE(24, 3);
    height = 1 + body.readUIntLE(27, 3);
  } else if (type === 'image/x-icon' || type === 'image/vnd.microsoft.icon' || type === 'image/icon') {
    if (body.length < 8) return true;
    width = body[6] || 256;
    height = body[7] || 256;
  }
  // Google 的未收录站点返回 16×16 地球图；未知尺寸的合法图像不误杀。
  return Number.isFinite(width) && Number.isFinite(height) && width <= 16 && height <= 16;
}

async function getPage(url, requester = requestFollowingRedirects) {
  const result = await requester(url, {
    maxBytes: HTML_MAX_BYTES, timeoutMs: HTML_TIMEOUT_MS, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
  });
  const contentType = (result.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (result.status !== 200 || !['text/html', 'application/xhtml+xml'].includes(contentType)) return null;
  const body = decodeHtmlBody(result);
  if (!body) return null;
  return { html: body.toString('utf8'), url: result.url };
}

async function probe(url, requester = requestFollowingRedirects) {
  const deadline = Date.now() + PROBE_BUDGET_MS;
  const budgetedRequest = (requestUrl, options) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('图标探测超时');
    return requester(requestUrl, { ...options, timeoutMs: Math.min(options.timeoutMs, remaining) });
  };
  let pageUrl = url;
  try {
    const page = await getPage(url, budgetedRequest);
    if (page) {
      pageUrl = page.url;
      for (const candidate of parseDeclaredIcons(page.html, page.url)) {
        try {
          const icon = await fetchValidImage(candidate, {}, budgetedRequest);
          if (icon) return icon;
        } catch { /* Try the next declared image. */ }
      }
      // A logo can be supplied through CSS (background-image, mask-image or a
      // framework sprite) without an <img>. Probe branding-like assets from
      // linked stylesheets after explicit HTML declarations.
      for (const stylesheetUrl of parseStylesheetLinks(page.html, page.url)) {
        try {
          const stylesheet = await budgetedRequest(stylesheetUrl, {
            maxBytes: HTML_MAX_BYTES, timeoutMs: 3000, accept: 'text/css,*/*;q=0.2'
          });
          if (stylesheet.status !== 200) continue;
          const cssBody = decodeHtmlBody(stylesheet);
          if (!cssBody) continue;
          for (const candidate of parseCssImageUrls(cssBody.toString('utf8'), stylesheet.url)
            .filter(candidate => /logo|brand|favicon|icon/i.test(candidate.pathname))) {
            try {
              const icon = await fetchValidImage(candidate, {}, budgetedRequest);
              if (icon) return icon;
            } catch { /* Continue with the next CSS asset. */ }
          }
        } catch { /* Continue with manifests and conventional paths. */ }
      }
      for (const manifestUrl of parseManifestLinks(page.html, page.url)) {
        try {
          const manifestResponse = await budgetedRequest(manifestUrl, {
            maxBytes: HTML_MAX_BYTES, timeoutMs: 3000, accept: 'application/manifest+json,application/json,*/*;q=0.5'
          });
          if (manifestResponse.status !== 200) continue;
          const manifestBody = decodeHtmlBody(manifestResponse);
          if (!manifestBody) continue;
          const manifest = JSON.parse(manifestBody.toString('utf8'));
          for (const candidate of parseManifestIcons(manifest, manifestResponse.url)) {
            try {
              const icon = await fetchValidImage(candidate, {}, budgetedRequest);
              if (icon) return icon;
            } catch { /* Try the next manifest icon. */ }
          }
        } catch { /* Static icons remain available if the manifest is inaccessible. */ }
      }
    }
  } catch { /* An inaccessible page can still expose a conventional favicon. */ }

  const origins = [...new Set([url.origin, pageUrl.origin])].map(origin => new URL(origin));
  for (const origin of origins) {
    for (const iconPath of commonIconPaths) {
      try {
        const icon = await fetchValidImage(new URL(iconPath, origin), {}, budgetedRequest);
        if (icon) return icon;
      } catch { /* Try the next conventional path. */ }
    }
  }

  try {
    const googleUrl = new URL('https://www.google.com/s2/favicons');
    googleUrl.searchParams.set('domain', url.hostname);
    googleUrl.searchParams.set('sz', '128');
    const icon = await fetchValidImage(googleUrl, { google: true }, budgetedRequest);
    if (icon) return icon;
  } catch { /* The local Shiba icon is the deterministic fallback. */ }

  return null;
}

function evictExpired(now = Date.now()) {
  for (const [key, item] of memoryCache) if (item.expiresAt <= now) memoryCache.delete(key);
  let bytes = [...memoryCache.values()].reduce((sum, entry) => sum + (entry.body?.length || 0), 0);
  while (memoryCache.size >= CACHE_LIMIT || bytes > CACHE_MEMORY_BYTES - IMAGE_MAX_BYTES) {
    const key = memoryCache.keys().next().value;
    if (key === undefined) break;
    bytes -= memoryCache.get(key).body?.length || 0;
    memoryCache.delete(key);
  }
}

function cacheFile(key) {
  return path.join(CACHE_DIRECTORY, `${crypto.createHash('sha256').update(key).digest('hex')}.json`);
}

async function readDiskCache(key) {
  try {
    const filename = cacheFile(key);
    const stat = await fs.stat(filename);
    if (stat.size > IMAGE_MAX_BYTES * 1.5) return null;
    const entry = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (entry.key !== key || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now()) return null;
    const body = entry.body ? Buffer.from(entry.body, 'base64') : null;
    if (body && !isValidImage(body, entry.contentType)) return null;
    return { body, contentType: entry.contentType, source: entry.source, expiresAt: entry.expiresAt };
  } catch { return null; }
}

let pruning = null;
async function writeDiskCache(key, entry) {
  const filename = cacheFile(key);
  const temporary = `${filename}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.mkdir(CACHE_DIRECTORY, { recursive: true });
    await fs.writeFile(temporary, JSON.stringify({ ...entry, key, body: entry.body?.toString('base64') || null }));
    await fs.rename(temporary, filename);
    if (!pruning) {
      pruning = (async () => {
        const names = (await fs.readdir(CACHE_DIRECTORY)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
        if (names.length <= CACHE_LIMIT) return;
        const files = await Promise.all(names.map(async name => {
          const file = path.join(CACHE_DIRECTORY, name);
          return { file, time: (await fs.stat(file)).mtimeMs };
        }));
        files.sort((a, b) => a.time - b.time);
        await Promise.all(files.slice(0, files.length - CACHE_LIMIT).map(item => fs.unlink(item.file).catch(() => {})));
      })().catch(() => {}).finally(() => { pruning = null; });
    }
  } catch {
    // 只读挂载不阻断图标服务，仍可使用有界内存缓存。
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function findFavicon(value) {
  const url = normalizeInput(value);
  if (!url) return null;
  const key = `${CACHE_VERSION}:${url.href}`;
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (inFlight.has(key)) return inFlight.get(key);

  const pending = (async () => {
    const saved = await readDiskCache(key);
    if (saved) {
      evictExpired();
      memoryCache.set(key, saved);
      return saved;
    }
    const result = await probe(url).catch(() => null);
    const entry = result || { body: null, contentType: null, source: DEFAULT_LOGO };
    evictExpired();
    const ttl = entry.body ? CACHE_TTL_MS : MISS_CACHE_TTL_MS;
    const cachedEntry = { ...entry, expiresAt: Date.now() + ttl };
    memoryCache.set(key, cachedEntry);
    if (cachedEntry.body) await writeDiskCache(key, cachedEntry);
    return cachedEntry;
  })();
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}

function createFaviconRouter(finder = findFavicon) {
  const express = require('express');
  const router = express.Router();
  router.get('/', async (req, res) => {
    if (typeof req.query.url !== 'string' || !req.query.url.trim()) {
      return res.status(400).json({ error: '请提供有效的 http 或 https 网站地址' });
    }
    let entry;
    try { entry = await finder(req.query.url); } catch {
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, DEFAULT_LOGO);
    }
    if (!entry) return res.redirect(302, DEFAULT_LOGO);
    res.set('Cache-Control', entry.body ? 'public, max-age=3600' : 'public, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!entry.body) {
      res.set('X-Favicon-Source', DEFAULT_LOGO);
      return res.redirect(302, DEFAULT_LOGO);
    }
    // SVG 只以图片子资源显示，即使直接打开代理地址也不允许运行脚本。
    res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    res.type(entry.contentType);
    res.set('X-Favicon-Source', entry.source);
    return res.send(entry.body);
  });
  return router;
}

module.exports = { createFaviconRouter, findFavicon, normalizeInput, parseDeclaredIcons, parseManifestLinks, parseManifestIcons, parseCssImageUrls, parseStylesheetLinks, isValidImage, getActualImageType, hasGenericGoogleGlobeSize, probe, isPublicAddress, requestFollowingRedirects, DEFAULT_LOGO };
