const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../web/src/utils/cardLogo.mjs');

function createImage() {
  const requests = [];
  const image = {
    onerror: null,
    onload: null,
    get src() { return requests.at(-1)?.src; },
    set src(src) { requests.push({ src, onerror: this.onerror }); }
  };
  return { image, requests };
}

function createClock() {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, delay) {
      timers.set(++nextId, { callback, delay });
      return nextId;
    },
    clearTimeout(id) { timers.delete(id); },
    next() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
      return timer.delay;
    }
  };
}

test('自定义 logo 优先，并兼容后台 logo_url 和同源上传地址', async () => {
  const { getCardLogoSources, DEFAULT_LOGO } = await helpers;
  const card = {
    url: 'https://example.com/path/page?query=1#part',
    logo: ' https://images.example/logo.png ',
    logo_url: 'https://legacy.example/logo.png',
    custom_logo_path: 'uploaded.png'
  };
  assert.deepEqual(getCardLogoSources(card), [
    'https://images.example/logo.png', 'https://example.com/favicon.ico', DEFAULT_LOGO
  ]);
  card.logo = '  ';
  assert.equal(getCardLogoSources(card)[0], 'https://legacy.example/logo.png');
  card.logo_url = '';
  assert.equal(getCardLogoSources(card)[0], '/uploads/uploaded.png');
  card.custom_logo_path = '/uploaded.png';
  assert.equal(getCardLogoSources(card)[0], '/uploads/uploaded.png');
});

test('空 logo 使用 Google 128 图标，再回退源站根目录和本地默认图', async () => {
  const { getCardLogoSources, DEFAULT_LOGO } = await helpers;
  assert.deepEqual(getCardLogoSources({ url: 'https://example.com:8443/a/b/?x=1#hash' }), [
    'https://www.google.com/s2/favicons?domain=example.com&sz=128',
    'https://example.com:8443/favicon.ico', DEFAULT_LOGO
  ]);
  assert.deepEqual(getCardLogoSources({ url: 'https://例子.中国/path' }).slice(0, 2), [
    'https://www.google.com/s2/favicons?domain=xn--fsqu00a.xn--fiqs8s&sz=128',
    'https://xn--fsqu00a.xn--fiqs8s/favicon.ico'
  ]);
  for (const url of ['', 'invalid-url', 'javascript:alert(1)', 'file:///tmp/site']) {
    assert.deepEqual(getCardLogoSources({ url }), [DEFAULT_LOGO]);
  }
  assert.deepEqual(getCardLogoSources({ logo: '/custom.png', url: 'invalid' }), ['/custom.png', DEFAULT_LOGO]);
  assert.deepEqual(getCardLogoSources({ logo: 'https://example.com/favicon.ico', url: 'https://example.com' }), [
    'https://example.com/favicon.ico', DEFAULT_LOGO
  ]);
});

test('自定义图片失败后直接回退源站，默认图赋值前就解除 onerror', async () => {
  const { getCardLogoSources, loadCardLogo, DEFAULT_LOGO } = await helpers;
  const { image, requests } = createImage();
  const clock = createClock();
  loadCardLogo(image, getCardLogoSources({ logo: '/custom.png', url: 'https://example.com' }), clock);
  assert.equal(image.src, '/custom.png');
  image.onerror();
  assert.equal(image.src, 'https://example.com/favicon.ico');
  const staleError = image.onerror;
  image.onerror();
  assert.equal(image.src, DEFAULT_LOGO);
  assert.equal(requests.at(-1).onerror, null);
  assert.equal(image.onerror, null);
  assert.equal(image.onload, null);
  assert.equal(clock.timers.size, 0);
  staleError();
  assert.equal(requests.length, 3);
});

test('Google 错误与国内网络挂起都会降级，迟到的事件不能跳过源站图标', async () => {
  const { getCardLogoSources, loadCardLogo, GOOGLE_TIMEOUT_MS, LOGO_TIMEOUT_MS, DEFAULT_LOGO } = await helpers;
  for (const mode of ['error', 'timeout']) {
    const { image, requests } = createImage();
    const clock = createClock();
    loadCardLogo(image, getCardLogoSources({ url: 'https://example.com' }), clock);
    const staleError = image.onerror;
    const staleLoad = image.onload;
    if (mode === 'error') image.onerror();
    else assert.equal(clock.next(), GOOGLE_TIMEOUT_MS);
    assert.equal(image.src, 'https://example.com/favicon.ico');
    staleError();
    staleLoad();
    assert.equal(requests.length, 2);
    assert.equal(clock.next(), LOGO_TIMEOUT_MS);
    assert.equal(image.src, DEFAULT_LOGO);
    assert.equal(image.onerror, null);
    assert.equal(clock.timers.size, 0);
  }
});

test('成功加载停止降级，切换卡片和卸载时取消旧定时器与错误回调', async () => {
  const { getCardLogoSources, loadCardLogo } = await helpers;
  const sources = getCardLogoSources({ logo: '/custom.png', url: 'https://example.com' });
  for (const mode of ['success', 'cleanup']) {
    const { image, requests } = createImage();
    const clock = createClock();
    const cleanup = loadCardLogo(image, sources, clock);
    const staleError = image.onerror;
    if (mode === 'success') image.onload();
    else cleanup();
    staleError();
    assert.equal(clock.timers.size, 0);
    assert.equal(image.onerror, null);
    assert.equal(requests.length, 1);
  }
});
