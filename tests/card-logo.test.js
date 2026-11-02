const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../web/src/utils/cardLogo.mjs');

function createImage() {
  const requests = [];
  return { requests, onerror: null, onload: null,
    get src() { return requests.at(-1)?.src; },
    set src(src) { requests.push({ src, onerror: this.onerror }); }
  };
}

function createClock() {
  let id = 0;
  const timers = new Map();
  return { timers,
    setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; },
    clearTimeout(key) { timers.delete(key); },
    next() {
      const [key, entry] = timers.entries().next().value;
      timers.delete(key); entry.callback(); return entry.delay;
    }
  };
}

test('自定义 logo / logo_url / 同源上传优先，失败后只允许柴犬兜底', async () => {
  const { getCardLogoSources, DEFAULT_LOGO } = await helpers;
  assert.equal(DEFAULT_LOGO, '/uploads/default-favicon.png');
  const card = { url: 'https://example.com/page', logo: ' https://cdn.example/logo.svg ',
    logo_url: '/legacy.png', custom_logo_path: 'uploaded.png' };
  assert.deepEqual(getCardLogoSources(card), ['https://cdn.example/logo.svg', DEFAULT_LOGO]);
  card.logo = ' ';
  assert.deepEqual(getCardLogoSources(card), ['/legacy.png', DEFAULT_LOGO]);
  card.logo_url = '';
  assert.deepEqual(getCardLogoSources(card), ['/uploads/uploaded.png', DEFAULT_LOGO]);
});

test('自动图标只请求本站接口，不再从浏览器请求 Google 或目标站点', async () => {
  const { getCardLogoSources, DEFAULT_LOGO } = await helpers;
  const url = 'https://example.com:8443/page?a=1&b=2';
  assert.deepEqual(getCardLogoSources({ url }), [`/api/favicon?url=${encodeURIComponent(url)}`, DEFAULT_LOGO]);
  for (const url of ['', 'invalid-url', 'javascript:alert(1)', 'file:///tmp/site']) {
    assert.deepEqual(getCardLogoSources({ url }), [DEFAULT_LOGO]);
  }
});

test('自定义和代理图片错误或超时，默认图赋值前立即解除 onerror', async () => {
  const { getCardLogoSources, loadCardLogo, DEFAULT_LOGO, LOGO_TIMEOUT_MS } = await helpers;
  for (const card of [{ logo: '/custom.png' }, { url: 'https://example.com' }]) {
    for (const mode of ['error', 'timeout']) {
      const image = createImage();
      const clock = createClock();
      loadCardLogo(image, getCardLogoSources(card), clock);
      const staleError = image.onerror;
      if (mode === 'error') image.onerror();
      else assert.equal(clock.next(), card.logo ? LOGO_TIMEOUT_MS : 30000);
      assert.equal(image.src, DEFAULT_LOGO);
      assert.equal(image.requests.at(-1).onerror, null);
      assert.equal(image.onerror, null);
      assert.equal(image.onload, null);
      assert.equal(clock.timers.size, 0);
      staleError();
      assert.equal(image.requests.length, 2);
    }
  }
});

test('成功加载和组件卸载均取消旧计时器，迟到事件不会覆盖图片', async () => {
  const { getCardLogoSources, loadCardLogo } = await helpers;
  for (const mode of ['success', 'cleanup']) {
    const image = createImage();
    const clock = createClock();
    const cleanup = loadCardLogo(image, getCardLogoSources({ logo: '/custom.png' }), clock);
    const staleError = image.onerror;
    if (mode === 'success') image.onload(); else cleanup();
    staleError();
    assert.equal(clock.timers.size, 0);
    assert.equal(image.onerror, null);
    assert.equal(image.requests.length, 1);
  }
});
