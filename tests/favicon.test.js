const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  parseDeclaredIcons, probe, normalizeInput, isPublicAddress, isValidImage,
  hasGenericGoogleGlobeSize, createFaviconRouter, requestFollowingRedirects, DEFAULT_LOGO
} = require('../routes/favicon');

const png = fs.readFileSync(path.join(__dirname, '../uploads/default-favicon.png'));
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle r="12"/></svg>');
const missing = { status: 404, headers: { 'content-type': 'image/png' }, body: png };
function response(url, body, type = 'image/png', status = 200) {
  return { url: new URL(url), body: Buffer.from(body), status, headers: { 'content-type': type } };
}
function fixture(responses, calls = []) {
  return async url => {
    calls.push(url.href);
    const entry = responses[url.href];
    if (entry instanceof Error) throw entry;
    return entry || { ...missing, url: new URL(url) };
  };
}

test('HTML 声明按 icon / apple / og:image 顺序解析，支持深层路径、实体和重定向 URL', () => {
  const html = `<!-- <link rel="icon" href="/wrong.ico"> -->
    <meta property="og:image" content="/share.png">
    <link rel="apple-touch-icon" href="/apple.png">
    <script>const x = '<link rel="icon" href="/script.ico">';</script>
    <link REL='shortcut ICON' href='../images/favicon/favicon.ico?a=1&amp;b=2'>
    <link rel="icon" href="//cdn.example/icon.svg">
    <header><img src="/logo.png" alt="Logo"></header>`;
  assert.deepEqual(parseDeclaredIcons(html, 'https://site.example/new/page/').map(url => url.href), [
    'https://site.example/new/images/favicon/favicon.ico?a=1&b=2',
    'https://cdn.example/icon.svg', 'https://site.example/apple.png', 'https://site.example/share.png'
  ]);
});

test('解析 base 和 header/nav Logo；不误选正文图片或空 icon 声明', () => {
  const html = `<head><base href="/assets/"><link rel="icon" href=""></head>
    <header><nav><img src="brand-logo.svg"></nav><img src="logo.png"></header>
    <main><img src="wrong-logo.png"></main>`;
  assert.deepEqual(parseDeclaredIcons(html, 'https://site.example/').map(url => url.href), [
    'https://site.example/assets/brand-logo.svg', 'https://site.example/assets/logo.png'
  ]);
});

test('通用探测覆盖深层 ico、SVG 声明和根目录 logo.png，声明成功后不访问 Google', async () => {
  for (const [host, iconPath, body, type] of [
    ['https://n.060111.xyz', '/images/favicon/favicon.ico', svg, 'image/svg+xml'],
    ['https://svg.example', '/images/logo-no-text.svg', svg, 'image/svg+xml'],
    ['https://mail.org.edu.kg', '/logo.png', png, 'image/png']
  ]) {
    const calls = [];
    const result = await probe(new URL(host), fixture({
      [`${host}/`]: response(host, `<link rel="icon" href="${iconPath}">`, 'text/html'),
      [host + iconPath]: response(host + iconPath, body, type)
    }, calls));
    assert.equal(result.source, host + iconPath);
    assert.deepEqual(calls, [`${host}/`, host + iconPath]);
  }
});

test('HTML 不可达或声明无效后，按固定顺序尝试根目录物理路径', async () => {
  for (const physical of ['/favicon.ico', '/logo.png']) {
    const calls = [];
    const host = 'https://ocn.000806.xyz';
    const result = await probe(new URL(host), fixture({
      [`${host}/`]: new Error('timeout'),
      [host + physical]: response(host + physical, png)
    }, calls));
    assert.equal(result.source, host + physical);
    const expected = ['/favicon.ico', '/favicon.png', '/favicon.svg', '/logo.png'];
    assert.deepEqual(calls.slice(1), expected.slice(0, expected.indexOf(physical) + 1).map(p => host + p));
  }
});

test('Google 404 携带合法图片仍拒绝，200 的 16×16 占位图也拒绝', async () => {
  const small = Buffer.from(png);
  small.writeUInt32BE(16, 16);
  small.writeUInt32BE(16, 20);
  assert.equal(hasGenericGoogleGlobeSize(small, 'image/png'), true);
  assert.equal(hasGenericGoogleGlobeSize(png, 'image/png'), false);
  for (const [status, body] of [[404, png], [200, small], [200, Buffer.alloc(0)]]) {
    const calls = [];
    const host = 'http://zkks.sceea.cn';
    const google = 'https://www.google.com/s2/favicons?domain=zkks.sceea.cn&sz=128';
    const result = await probe(new URL(host), fixture({
      [host + '/']: response(host, '<link rel="icon" href="">', 'text/html'),
      [google]: response(google, body, 'image/png', status)
    }, calls));
    assert.equal(result, null);
    assert.equal(calls.at(-1), google);
    assert.equal(calls.length, 8);
  }
});

test('Google 有效大图仅在前两级全部失败之后使用', async () => {
  const host = 'https://unavailable.example';
  const google = 'https://www.google.com/s2/favicons?domain=unavailable.example&sz=128';
  const calls = [];
  const icon = await probe(new URL(host), fixture({ [google]: response(google, png) }, calls));
  assert.equal(icon.source, google);
  assert.equal(calls.at(-1), google);
  assert.equal(calls.length, 8);
});

test('无效图片、假图片 HTML、空内容及错误 Content-Type 不得阻断后续回退', () => {
  assert.equal(isValidImage(png, 'image/png'), true);
  assert.equal(isValidImage(svg, 'image/svg+xml; charset=utf-8'), true);
  assert.equal(isValidImage(Buffer.from('<?xml version="1.0"?>\n<!-- comment --><svg></svg>'), 'image/svg+xml'), true);
  assert.equal(isValidImage(Buffer.from('<!doctype html><html>not an icon</html>'), 'image/png'), false);
  assert.equal(isValidImage(Buffer.from('<html></html>'), 'image/svg+xml'), false);
  assert.equal(isValidImage(Buffer.alloc(0), 'image/png'), false);
  assert.equal(isValidImage(png, 'text/html'), false);
});

test('防止图标代理访问 loopback、内网和 link-local；按首页归一化缓存键', async () => {
  for (const address of ['127.0.0.1', '192.168.1.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  assert.equal(normalizeInput('https://example.com/a?q=1#hash').href, 'https://example.com/');
  for (const invalid of ['file:///etc/passwd', 'https://user:pass@example.com', 'javascript:alert(1)']) {
    assert.equal(normalizeInput(invalid), null);
  }
  await assert.rejects(requestFollowingRedirects(new URL('http://127.0.0.1/'), {
    timeoutMs: 100, maxBytes: 100, accept: '*/*'
  }), /内网/);
});

test('接口代理图片并设置浏览器缓存；失败重定向到统一柴犬路径', async () => {
  const app = express();
  app.use('/api/favicon', createFaviconRouter(async url => {
    if (url === 'success') return { body: png, contentType: 'image/png', source: 'https://example.com/logo.png' };
    if (url === 'missing') return { body: null, source: DEFAULT_LOGO };
    return null;
  }));
  app.get(DEFAULT_LOGO, (req, res) => res.type('png').send(png));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const found = await fetch(base + '/api/favicon?url=success');
    assert.equal(found.status, 200);
    assert.equal(found.headers.get('content-type'), 'image/png');
    assert.ok(found.headers.get('cache-control').includes('max-age=3600'));
    assert.deepEqual(Buffer.from(await found.arrayBuffer()), png);
    const fallback = await fetch(base + '/api/favicon?url=missing', { redirect: 'manual' });
    assert.equal(fallback.status, 302);
    assert.equal(fallback.headers.get('location'), '/uploads/default-favicon.png');
    const dog = await fetch(base + '/api/favicon?url=missing');
    assert.deepEqual(Buffer.from(await dog.arrayBuffer()), png);
    assert.equal((await fetch(base + '/api/favicon')).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
