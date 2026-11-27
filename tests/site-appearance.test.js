const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const { COOKIE_NAME, JWT_SECRET } = require('../routes/session');

const dbPath = path.resolve(__dirname, '../db.js');
const settingsPath = path.resolve(__dirname, '../routes/settings.js');
const backupPath = path.resolve(__dirname, '../routes/backup.js');

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

// 合法的最小图片二进制（含标准魔数头）
const SAMPLE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);
const SAMPLE_JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01
]);
const SAMPLE_WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 ')
]);
const SAMPLE_GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00', 'binary');

test('背景配置公开读取、内置预设读取保存、鉴权更新与本地图片上传校验', async () => {
  const db = await initMemoryDb();
  const tempUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-item-bg-test-'));
  let server;
  const authCookie = `${COOKIE_NAME}=${jwt.sign({ id: 1, username: 'admin' }, JWT_SECRET, { expiresIn: 3600 })}`;

  try {
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    delete require.cache[settingsPath];
    const settingsModule = require('../routes/settings');

    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsModule.createSettingsRouter({
      uploadsDir: tempUploadsDir,
      maxFileSize: 2048 // 2KB 用于测试超大文件拦截
    }));

    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    // 1. 公开读取内置精选背景预设列表（无需登录）并校验静态 SVG 文件存在
    const presetsRes = await fetch(`${base}/api/settings/presets`);
    assert.equal(presetsRes.status, 200);
    const presetsBody = await presetsRes.json();
    assert.ok(Array.isArray(presetsBody.data));
    assert.ok(presetsBody.data.length >= 4);
    assert.ok(presetsBody.data.some(p => p.id === 'default'));
    assert.ok(presetsBody.data.some(p => p.id === 'twilight-campus' && p.url === '/backgrounds/twilight-campus.svg'));
    for (const preset of presetsBody.data) {
      if (preset.url && preset.url.startsWith('/backgrounds/')) {
        const assetPath = path.resolve(__dirname, '../web/public', preset.url.slice(1));
        assert.ok(fs.existsSync(assetPath), `内置预设静态文件缺失: ${preset.url}`);
      }
    }

    // 2. 公开读取默认外观配置（无需登录）
    const initRes = await fetch(`${base}/api/settings/appearance`);
    assert.equal(initRes.status, 200);
    assert.deepEqual(await initRes.json(), {
      site_bg_url: '',
      site_bg_overlay: 40,
      site_bg_preset: 'default'
    });

    // 3. 未登录禁止修改或上传
    const unauthUpdate = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_bg_url: 'https://example.com/bg.jpg', site_bg_overlay: 30 })
    });
    assert.equal(unauthUpdate.status, 401);

    const unauthUpload = await fetch(`${base}/api/settings/background/upload`, { method: 'POST' });
    assert.equal(unauthUpload.status, 401);

    // 4. 通过内置预设 ID 保存：自动填入预设路径与推荐遮罩
    const presetSaveRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ site_bg_preset: 'twilight-campus' })
    });
    assert.equal(presetSaveRes.status, 200);
    const presetSaved = await presetSaveRes.json();
    assert.equal(presetSaved.site_bg_url, '/backgrounds/twilight-campus.svg');
    assert.equal(presetSaved.site_bg_overlay, 28);
    assert.equal(presetSaved.site_bg_preset, 'twilight-campus');

    // 非法预设 ID 返回 400
    const badPresetRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ site_bg_preset: 'non-existent-preset' })
    });
    assert.equal(badPresetRes.status, 400);

    // 5. 合法网络图片 URL + 遮罩暗度更新（预设标识自动清空）
    const putOk = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({
        site_bg_url: 'https://cdn.example.com/wallpapers/aurora.webp',
        site_bg_overlay: 55
      })
    });
    assert.equal(putOk.status, 200);
    const putOkBody = await putOk.json();
    assert.equal(putOkBody.site_bg_url, 'https://cdn.example.com/wallpapers/aurora.webp');
    assert.equal(putOkBody.site_bg_overlay, 55);
    assert.equal(putOkBody.site_bg_preset, '');

    const afterPut = await (await fetch(`${base}/api/settings/appearance`)).json();
    assert.deepEqual(afterPut, {
      site_bg_url: 'https://cdn.example.com/wallpapers/aurora.webp',
      site_bg_overlay: 55,
      site_bg_preset: ''
    });

    // 6. 非法 URL、路径穿越与非法遮罩拦截
    for (const badUrl of [
      'javascript:alert(1)',
      'ftp://example.com/a.jpg',
      '/uploads/../secret.png',
      '/backgrounds/../secret.svg',
      'not-a-url'
    ]) {
      const badRes = await fetch(`${base}/api/settings/appearance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ site_bg_url: badUrl })
      });
      assert.equal(badRes.status, 400, `应拒绝非法背景地址: ${badUrl}`);
    }

    const badOverlay = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ site_bg_overlay: 'not-a-number' })
    });
    assert.equal(badOverlay.status, 400);

    // 超范围数字自动钳制至 0 ~ 80
    const clampedRes = await (await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ site_bg_overlay: 95 })
    })).json();
    assert.equal(clampedRes.site_bg_overlay, 80);

    // 7. 本地图片上传：支持 PNG / JPG / WebP / GIF，自动保存至 uploads 并生效
    const uploadHelper = async (buffer, filename, mimeType, overlay) => {
      const form = new FormData();
      form.append('background', new Blob([buffer], { type: mimeType }), filename);
      if (overlay !== undefined) form.append('site_bg_overlay', String(overlay));
      return fetch(`${base}/api/settings/background/upload`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: form
      });
    };

    for (const [buf, name, mime, expectedExt] of [
      [SAMPLE_PNG, 'sky.png', 'image/png', '.png'],
      [SAMPLE_JPG, 'mount.jpg', 'image/jpeg', '.jpg'],
      [SAMPLE_WEBP, 'night.webp', 'image/webp', '.webp'],
      [SAMPLE_GIF, 'anim.gif', 'image/gif', '.gif']
    ]) {
      const upRes = await uploadHelper(buf, name, mime, 25);
      assert.equal(upRes.status, 200, `应允许上传 ${name}`);
      const upData = await upRes.json();
      assert.ok(upData.url.startsWith('/uploads/bg-'));
      assert.ok(upData.url.endsWith(expectedExt));
      assert.equal(upData.site_bg_url, upData.url);
      assert.equal(upData.site_bg_overlay, 25);
      assert.equal(upData.site_bg_preset, '');
      const savedPath = path.join(tempUploadsDir, upData.filename);
      assert.ok(fs.existsSync(savedPath));
      assert.deepEqual(fs.readFileSync(savedPath), buf);
    }

    // 8. SVG 上传 + 安全清洗（移除 script / foreignObject / on* 事件 / javascript: / DOCTYPE ENTITY）
    const dirtySvg = `<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE svg [<!ENTITY xxe "evil">]>
      <svg viewBox="0 0 800 450" onload="alert(1)" onclick='evil()'>
        <script>window.alert("xss")</script>
        <scr<script>ipt>alert(2)</scr</script>ipt>
        <foreignObject width="100" height="100"><body><iframe src="https://evil.test"></iframe></body></foreignObject>
        <style>@import url("https://evil.test/x.css"); rect { fill: #1e293b; }</style>
        <rect width="800" height="450" fill="#0f172a" onmouseover="steal()" />
        <a xlink:href="javascript:alert(3)" href="&#106;avascript:alert(4)">
          <circle cx="400" cy="225" r="80" fill="#38bdf8" onerror="boom()" />
        </a>
        <use href="https://evil.test/external.svg#bad" />
        <use href="#safe-grad" />
      </svg>`;
    const svgUpRes = await uploadHelper(Buffer.from(dirtySvg, 'utf8'), 'campus.svg', 'image/svg+xml', 32);
    assert.equal(svgUpRes.status, 200);
    const svgUpData = await svgUpRes.json();
    assert.ok(svgUpData.url.startsWith('/uploads/bg-'));
    assert.ok(svgUpData.url.endsWith('.svg'));
    assert.equal(svgUpData.site_bg_url, svgUpData.url);
    assert.equal(svgUpData.site_bg_overlay, 32);
    assert.equal(svgUpData.site_bg_preset, '');

    const savedSvgText = fs.readFileSync(path.join(tempUploadsDir, svgUpData.filename), 'utf8');
    assert.match(savedSvgText, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(savedSvgText, /<rect\b[^>]*fill="#0f172a"/);
    assert.match(savedSvgText, /<circle\b[^>]*fill="#38bdf8"/);
    assert.match(savedSvgText, /<use\b[^>]*href="#safe-grad"/);
    assert.doesNotMatch(savedSvgText, /<script/i);
    assert.doesNotMatch(savedSvgText, /<foreignObject/i);
    assert.doesNotMatch(savedSvgText, /<iframe/i);
    assert.doesNotMatch(savedSvgText, /\bon(?:load|click|error|mouseover)\s*=/i);
    assert.doesNotMatch(savedSvgText, /javascript:/i);
    assert.doesNotMatch(savedSvgText, /<!DOCTYPE|<!ENTITY/i);
    assert.doesNotMatch(savedSvgText, /@import/i);
    assert.doesNotMatch(savedSvgText, /evil\.test\/external\.svg/i);

    // 9. 伪造扩展名（HTML 改名 .png 或 .svg）必须被拦截且不落盘
    const filesBeforeInvalid = fs.readdirSync(tempUploadsDir).length;
    const fakePngRes = await uploadHelper(Buffer.from('<html><script>alert(1)</script></html>'), 'fake.png', 'image/png');
    assert.equal(fakePngRes.status, 400);
    const fakeSvgRes = await uploadHelper(Buffer.from('<html><body><svg></svg></body></html>'), 'fake.svg', 'image/svg+xml');
    assert.equal(fakeSvgRes.status, 400);
    assert.equal(fs.readdirSync(tempUploadsDir).length, filesBeforeInvalid);

    // 10. 超过大小限制的文件被拒绝
    const bigPng = Buffer.concat([SAMPLE_PNG, Buffer.alloc(3072, 0x00)]);
    const bigRes = await uploadHelper(bigPng, 'huge.png', 'image/png');
    assert.equal(bigRes.status, 400);
    assert.match((await bigRes.json()).message, /不能超过/);

    // 11. 一键恢复默认背景
    const resetRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ site_bg_url: '', site_bg_overlay: 40, site_bg_preset: 'default' })
    });
    assert.equal(resetRes.status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/settings/appearance`)).json(), {
      site_bg_url: '',
      site_bg_overlay: 40,
      site_bg_preset: 'default'
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    delete require.cache[dbPath];
    delete require.cache[settingsPath];
    fs.rmSync(tempUploadsDir, { recursive: true, force: true });
    await close(db);
  }
});

test('本地 JSON 与 WebDAV 备份还原均包含 SVG 背景路径、预设标识与遮罩配置', async () => {
  const db = await initMemoryDb();
  try {
    await run(db, 'DELETE FROM cards');
    await run(db, 'DELETE FROM sub_menus');
    await run(db, 'DELETE FROM menus');
    await run(db, 'INSERT INTO menus (id, name, "order") VALUES (1, "Home", 1)');
    await run(db, 'INSERT INTO cards (id, menu_id, title, url, "order", is_deleted) VALUES (1, 1, "GitHub", "https://github.com", 1, 0)');

    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    delete require.cache[settingsPath];
    delete require.cache[backupPath];
    const settingsModule = require('../routes/settings');
    const backupModule = require('../routes/backup');

    // 1. 保存内置矢量预设并导出本地 JSON 快照
    await settingsModule.saveAppearanceSettings({
      site_bg_preset: 'aurora-peaks',
      site_bg_overlay: 26
    });

    const presetSnapshot = await backupModule.createBackup();
    assert.deepEqual(presetSnapshot.siteSettings, {
      site_bg_url: '/backgrounds/aurora-peaks.svg',
      site_bg_overlay: 26,
      site_bg_preset: 'aurora-peaks'
    });
    assert.equal(
      presetSnapshot.tables.site_settings.find(item => item.key === 'site_bg_preset')?.value,
      'aurora-peaks'
    );

    // 2. 切换为自定义上传的 SVG 路径并验证 WebDAV 备份载荷
    await settingsModule.saveAppearanceSettings({
      site_bg_url: '/uploads/bg-custom-vector.svg',
      site_bg_overlay: 62
    });
    const svgSnapshot = await backupModule.createBackup();
    assert.deepEqual(svgSnapshot.siteSettings, {
      site_bg_url: '/uploads/bg-custom-vector.svg',
      site_bg_overlay: 62,
      site_bg_preset: ''
    });

    await run(
      db,
      `INSERT INTO webdav_config (id, url, username, password, updated_at) VALUES (1, 'https://dav.example.com/nav/', 'u', 'p', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET url=excluded.url, username=excluded.username, password=excluded.password`
    );
    let uploadedPayload = null;
    await backupModule.createAiAutoWebdavBackup({
      requestImpl: async (_target, method, _u, _p, body) => {
        if (method === 'PUT') {
          uploadedPayload = JSON.parse(body);
          return { statusCode: 201, headers: {}, body: Buffer.alloc(0) };
        }
        return { statusCode: 207, headers: {}, body: Buffer.from('<d:multistatus xmlns:d="DAV:"></d:multistatus>') };
      }
    });
    assert.deepEqual(uploadedPayload?.siteSettings, {
      site_bg_url: '/uploads/bg-custom-vector.svg',
      site_bg_overlay: 62,
      site_bg_preset: ''
    });

    // 3. 还原预设快照 -> 验证预设路径、预设标识与遮罩全部精确恢复
    await backupModule.restoreBackup(presetSnapshot);
    assert.deepEqual(await settingsModule.getAppearanceSettings(), {
      site_bg_url: '/backgrounds/aurora-peaks.svg',
      site_bg_overlay: 26,
      site_bg_preset: 'aurora-peaks'
    });

    // 4. 还原自定义 SVG 快照 -> 验证 SVG 路径、空预设标识与遮罩精确恢复
    await backupModule.restoreBackup(svgSnapshot);
    assert.deepEqual(await settingsModule.getAppearanceSettings(), {
      site_bg_url: '/uploads/bg-custom-vector.svg',
      site_bg_overlay: 62,
      site_bg_preset: ''
    });

    // 5. 兼容不含 siteSettings 的旧版备份：不报错且保留现有外观配置
    await backupModule.restoreBackup({
      format: 'nav-item-backup',
      version: 1,
      tables: {
        menus: [{ id: 1, name: 'Home', order: 1 }],
        sub_menus: [],
        cards: []
      }
    });
    const rowsAfterLegacy = await all(db, 'SELECT key, value FROM site_settings ORDER BY key ASC');
    assert.equal(rowsAfterLegacy.find(r => r.key === 'site_bg_url')?.value, '/uploads/bg-custom-vector.svg');
    assert.equal(rowsAfterLegacy.find(r => r.key === 'site_bg_overlay')?.value, '62');
  } finally {
    delete require.cache[dbPath];
    delete require.cache[settingsPath];
    delete require.cache[backupPath];
    await close(db);
  }
});

test('前台顶栏精简、页脚后台入口与后台背景预设及 SVG 上传界面关键结构校验', () => {
  const homeSrc = fs.readFileSync(path.resolve(__dirname, '../web/src/views/Home.vue'), 'utf8');
  assert.doesNotMatch(homeSrc, /class="brand-badge"/);
  assert.doesNotMatch(homeSrc, /class="admin-entry-btn"/);
  assert.match(homeSrc, /<footer class="footer">[\s\S]*?<router-link to="\/admin"[\s\S]*?<\/footer>/);
  assert.match(homeSrc, /getSiteAppearance/);
  assert.match(homeSrc, /background-attachment:\s*fixed/);

  const userManageSrc = fs.readFileSync(path.resolve(__dirname, '../web/src/views/admin/UserManage.vue'), 'utf8');
  assert.match(userManageSrc, /首页背景设置/);
  assert.match(userManageSrc, /image\/svg\+xml/);
  assert.match(userManageSrc, /getSiteBgPresets/);
  assert.match(userManageSrc, /selectBgPreset/);
  assert.match(userManageSrc, /uploadSiteBackground/);
  assert.match(userManageSrc, /updateSiteAppearance/);
  assert.match(userManageSrc, /max="80"/);
});
