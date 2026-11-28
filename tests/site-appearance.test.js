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

test('全量纯 SVG 预设加载、白天/夜晚双模式独立读写、历史壁纸自动入栈去重与上限 2 条校验', async () => {
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

    // 1. 公开读取全量纯 SVG 内置预设列表，校园白天/夜晚排首位且无重体积位图
    const presetsRes = await fetch(`${base}/api/settings/presets`);
    assert.equal(presetsRes.status, 200);
    const presetsBody = await presetsRes.json();
    assert.ok(Array.isArray(presetsBody.data));
    assert.ok(presetsBody.data.length >= 6);
    assert.equal(presetsBody.data[0].id, 'campus-day');
    assert.equal(presetsBody.data[0].url, '/backgrounds/campus-day.svg');
    assert.equal(presetsBody.data[0].tag, '白天推荐');
    assert.equal(presetsBody.data[0].recommended_theme, 'light');
    assert.equal(presetsBody.data[1].id, 'campus-night');
    assert.equal(presetsBody.data[1].url, '/backgrounds/campus-night.svg');
    assert.equal(presetsBody.data[1].tag, '夜晚推荐');
    assert.equal(presetsBody.data[1].recommended_theme, 'dark');

    // 所有内置预设均为纯 SVG 且静态文件真实存在
    for (const preset of presetsBody.data) {
      assert.equal(preset.type, 'svg', `预设 ${preset.id} 应为纯 SVG`);
      assert.match(preset.url, /^\/backgrounds\/[a-z0-9-]+\.svg$/);
      assert.match(preset.preview_url, /^\/backgrounds\/[a-z0-9-]+\.svg$/);
      const assetPath = path.resolve(__dirname, '../web/public', preset.url.slice(1));
      assert.ok(fs.existsSync(assetPath), `内置预设静态文件缺失: ${preset.url}`);
      const svgContent = fs.readFileSync(assetPath, 'utf8');
      assert.match(svgContent, /<svg[\s>]/i);
    }
    // web/public/backgrounds 下全部为 .svg 文件且旧位图已移除
    const bgFiles = fs.readdirSync(path.resolve(__dirname, '../web/public/backgrounds'));
    assert.ok(bgFiles.length >= 6);
    assert.ok(bgFiles.every(file => file.endsWith('.svg')));
    assert.equal(fs.existsSync(path.resolve(__dirname, '../web/public/background.webp')), false);

    // 2. 公开读取默认双模式外观配置（白天 campus-day 0%，夜晚 campus-night 24%，默认主题 auto，空历史）
    const initRes = await fetch(`${base}/api/settings/appearance`);
    assert.equal(initRes.status, 200);
    const initCfg = await initRes.json();
    assert.equal(initCfg.day_bg_url, '/backgrounds/campus-day.svg');
    assert.equal(initCfg.day_bg_overlay, 0);
    assert.equal(initCfg.day_bg_preset, 'campus-day');
    assert.equal(initCfg.night_bg_url, '/backgrounds/campus-night.svg');
    assert.equal(initCfg.night_bg_overlay, 24);
    assert.equal(initCfg.night_bg_preset, 'campus-night');
    assert.equal(initCfg.default_theme, 'auto');
    assert.deepEqual(initCfg.bg_history, []);
    // 兼容旧版单背景字段
    assert.equal(initCfg.site_bg_url, '/backgrounds/campus-night.svg');
    assert.equal(initCfg.site_bg_overlay, 24);

    // 3. 未登录禁止修改或上传
    const unauthUpdate = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day_bg_url: 'https://example.com/day.jpg' })
    });
    assert.equal(unauthUpdate.status, 401);

    const unauthUpload = await fetch(`${base}/api/settings/background/upload`, { method: 'POST' });
    assert.equal(unauthUpload.status, 401);

    // 4. 独立更新白天模式 -> 仅影响白天，夜晚保持不变，且旧白天壁纸自动入栈
    const dayUpdateRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({
        day_bg_url: '/backgrounds/dawn-horizon.svg',
        day_bg_overlay: 8,
        default_theme: 'light'
      })
    });
    assert.equal(dayUpdateRes.status, 200);
    const dayUpdated = await dayUpdateRes.json();
    assert.equal(dayUpdated.day_bg_url, '/backgrounds/dawn-horizon.svg');
    assert.equal(dayUpdated.day_bg_overlay, 8);
    assert.equal(dayUpdated.day_bg_preset, 'dawn-horizon');
    assert.equal(dayUpdated.night_bg_url, '/backgrounds/campus-night.svg');
    assert.equal(dayUpdated.night_bg_overlay, 24);
    assert.equal(dayUpdated.default_theme, 'light');
    assert.equal(dayUpdated.bg_history.length, 1);
    assert.equal(dayUpdated.bg_history[0].url, '/backgrounds/campus-day.svg');
    assert.equal(dayUpdated.bg_history[0].overlay, 0);
    assert.equal(dayUpdated.bg_history[0].theme, 'light');
    assert.ok(dayUpdated.bg_history[0].savedAt);

    // 仅调整遮罩暗度而不变更壁纸 URL：不应重复写入历史记录
    const overlayOnlyRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ day_bg_overlay: 6 })
    });
    assert.equal(overlayOnlyRes.status, 200);
    const overlayOnly = await overlayOnlyRes.json();
    assert.equal(overlayOnly.day_bg_overlay, 6);
    assert.equal(overlayOnly.bg_history.length, 1);

    // 5. 独立更新夜晚模式 -> 仅影响夜晚，旧夜晚壁纸入栈（共 2 条）
    const nightUpdateRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ night_bg_preset: 'aurora-peaks' })
    });
    assert.equal(nightUpdateRes.status, 200);
    const nightUpdated = await nightUpdateRes.json();
    assert.equal(nightUpdated.night_bg_url, '/backgrounds/aurora-peaks.svg');
    assert.equal(nightUpdated.night_bg_overlay, 24);
    assert.equal(nightUpdated.night_bg_preset, 'aurora-peaks');
    assert.equal(nightUpdated.day_bg_url, '/backgrounds/dawn-horizon.svg');
    assert.equal(nightUpdated.bg_history.length, 2);
    assert.equal(nightUpdated.bg_history[0].url, '/backgrounds/campus-night.svg');
    assert.equal(nightUpdated.bg_history[0].theme, 'dark');
    assert.equal(nightUpdated.bg_history[1].url, '/backgrounds/campus-day.svg');
    assert.equal(nightUpdated.bg_history[1].theme, 'light');

    // 6. 第 3 次壁纸变更 -> 自动淘汰最旧记录（上限严格为 2 条）
    const thirdUpdateRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({
        night_bg_url: 'https://cdn.example.com/wallpapers/starry.webp',
        night_bg_overlay: 35
      })
    });
    assert.equal(thirdUpdateRes.status, 200);
    const thirdUpdated = await thirdUpdateRes.json();
    assert.equal(thirdUpdated.bg_history.length, 2);
    assert.equal(thirdUpdated.bg_history[0].url, '/backgrounds/aurora-peaks.svg');
    assert.equal(thirdUpdated.bg_history[1].url, '/backgrounds/campus-night.svg');

    // 7. 切回历史壁纸后再次更换 -> 去重检验（不产生重复 URL）
    const restoreBackRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ night_bg_url: '/backgrounds/aurora-peaks.svg', night_bg_overlay: 24 })
    });
    assert.equal(restoreBackRes.status, 200);
    const afterRestore = await restoreBackRes.json();
    assert.equal(afterRestore.bg_history.length, 2);
    assert.equal(afterRestore.bg_history[0].url, 'https://cdn.example.com/wallpapers/starry.webp');
    assert.equal(afterRestore.bg_history[1].url, '/backgrounds/aurora-peaks.svg');

    const dedupRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ night_bg_url: '/backgrounds/deep-blue-geo.svg', night_bg_overlay: 20 })
    });
    assert.equal(dedupRes.status, 200);
    const deduped = await dedupRes.json();
    assert.equal(deduped.bg_history.length, 2);
    assert.deepEqual(
      deduped.bg_history.map(item => item.url),
      ['/backgrounds/aurora-peaks.svg', 'https://cdn.example.com/wallpapers/starry.webp']
    );

    // 8. 非法预设 ID、非法 URL、非法主题与非法遮罩拦截
    const badPresetRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ night_bg_preset: 'non-existent-preset' })
    });
    assert.equal(badPresetRes.status, 400);

    const badThemeRes = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ default_theme: 'sepia' })
    });
    assert.equal(badThemeRes.status, 400);

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
        body: JSON.stringify({ day_bg_url: badUrl })
      });
      assert.equal(badRes.status, 400, `应拒绝非法背景地址: ${badUrl}`);
    }

    const badOverlay = await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ night_bg_overlay: 'not-a-number' })
    });
    assert.equal(badOverlay.status, 400);

    // 超范围数字自动钳制至 0 ~ 80
    const clampedRes = await (await fetch(`${base}/api/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ night_bg_overlay: 95 })
    })).json();
    assert.equal(clampedRes.night_bg_overlay, 80);

    // 9. 本地图片上传：支持指定 theme（白天/夜晚独立生效），并自动把变更前壁纸压入历史记录
    const uploadHelper = async (buffer, filename, mimeType, overlay, theme = 'dark') => {
      const form = new FormData();
      form.append('background', new Blob([buffer], { type: mimeType }), filename);
      if (overlay !== undefined) form.append('overlay', String(overlay));
      if (theme) form.append('theme', theme);
      return fetch(`${base}/api/settings/background/upload`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: form
      });
    };

    const dayUploadRes = await uploadHelper(SAMPLE_PNG, 'day-sky.png', 'image/png', 5, 'light');
    assert.equal(dayUploadRes.status, 200);
    const dayUploadData = await dayUploadRes.json();
    assert.equal(dayUploadData.theme, 'light');
    assert.equal(dayUploadData.day_bg_url, dayUploadData.url);
    assert.equal(dayUploadData.day_bg_overlay, 5);
    assert.equal(dayUploadData.night_bg_url, '/backgrounds/deep-blue-geo.svg');
    // 旧白天壁纸 /backgrounds/dawn-horizon.svg 自动入栈
    assert.equal(dayUploadData.bg_history[0].url, '/backgrounds/dawn-horizon.svg');
    assert.equal(dayUploadData.bg_history[0].theme, 'light');

    for (const [buf, name, mime, expectedExt] of [
      [SAMPLE_JPG, 'mount.jpg', 'image/jpeg', '.jpg'],
      [SAMPLE_WEBP, 'night.webp', 'image/webp', '.webp'],
      [SAMPLE_GIF, 'anim.gif', 'image/gif', '.gif']
    ]) {
      const upRes = await uploadHelper(buf, name, mime, 25, 'dark');
      assert.equal(upRes.status, 200, `应允许上传 ${name}`);
      const upData = await upRes.json();
      assert.ok(upData.url.startsWith('/uploads/bg-'));
      assert.ok(upData.url.endsWith(expectedExt));
      assert.equal(upData.night_bg_url, upData.url);
      assert.equal(upData.night_bg_overlay, 25);
      assert.equal(upData.bg_history.length, 2);
      const savedPath = path.join(tempUploadsDir, upData.filename);
      assert.ok(fs.existsSync(savedPath));
      assert.deepEqual(fs.readFileSync(savedPath), buf);
    }

    // 10. SVG 上传 + 安全清洗（移除 script / foreignObject / on* 事件 / javascript: / DOCTYPE ENTITY）
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
    const svgUpRes = await uploadHelper(Buffer.from(dirtySvg, 'utf8'), 'campus.svg', 'image/svg+xml', 22, 'dark');
    assert.equal(svgUpRes.status, 200);
    const svgUpData = await svgUpRes.json();
    assert.ok(svgUpData.url.endsWith('.svg'));
    assert.equal(svgUpData.night_bg_url, svgUpData.url);
    assert.equal(svgUpData.night_bg_overlay, 22);

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

    // 11. 伪造扩展名与超大文件拦截
    const filesBeforeInvalid = fs.readdirSync(tempUploadsDir).length;
    const fakePngRes = await uploadHelper(Buffer.from('<html><script>alert(1)</script></html>'), 'fake.png', 'image/png');
    assert.equal(fakePngRes.status, 400);
    const fakeSvgRes = await uploadHelper(Buffer.from('<html><body><svg></svg></body></html>'), 'fake.svg', 'image/svg+xml');
    assert.equal(fakeSvgRes.status, 400);
    assert.equal(fs.readdirSync(tempUploadsDir).length, filesBeforeInvalid);

    const bigPng = Buffer.concat([SAMPLE_PNG, Buffer.alloc(3072, 0x00)]);
    const bigRes = await uploadHelper(bigPng, 'huge.png', 'image/png');
    assert.equal(bigRes.status, 400);
    assert.match((await bigRes.json()).message, /不能超过/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    delete require.cache[dbPath];
    delete require.cache[settingsPath];
    fs.rmSync(tempUploadsDir, { recursive: true, force: true });
    await close(db);
  }
});

test('本地 JSON 与 WebDAV 备份还原完整支持白天/夜晚双模式、历史壁纸及旧版单背景兼容', async () => {
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

    // 1. 分别配置白天/夜晚壁纸并产生历史记录，然后导出本地 JSON 快照
    await settingsModule.saveAppearanceSettings({
      day_bg_url: '/backgrounds/dawn-horizon.svg',
      day_bg_overlay: 6,
      night_bg_preset: 'aurora-peaks',
      night_bg_overlay: 26,
      default_theme: 'dark'
    });

    const dualSnapshot = await backupModule.createBackup();
    assert.equal(dualSnapshot.siteSettings.day_bg_url, '/backgrounds/dawn-horizon.svg');
    assert.equal(dualSnapshot.siteSettings.day_bg_overlay, 6);
    assert.equal(dualSnapshot.siteSettings.day_bg_preset, 'dawn-horizon');
    assert.equal(dualSnapshot.siteSettings.night_bg_url, '/backgrounds/aurora-peaks.svg');
    assert.equal(dualSnapshot.siteSettings.night_bg_overlay, 26);
    assert.equal(dualSnapshot.siteSettings.night_bg_preset, 'aurora-peaks');
    assert.equal(dualSnapshot.siteSettings.default_theme, 'dark');
    assert.equal(dualSnapshot.siteSettings.bg_history.length, 2);
    assert.equal(
      dualSnapshot.tables.site_settings.find(item => item.key === 'default_theme')?.value,
      'dark'
    );

    // 2. 切换为自定义上传 SVG 路径并验证 WebDAV 备份载荷包含双模式与历史记录
    await settingsModule.saveAppearanceSettings({
      day_bg_url: '/uploads/bg-custom-day.svg',
      day_bg_overlay: 4,
      night_bg_url: '/uploads/bg-custom-night.svg',
      night_bg_overlay: 30,
      default_theme: 'light'
    });
    const customSnapshot = await backupModule.createBackup();

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
    assert.equal(uploadedPayload?.siteSettings?.day_bg_url, '/uploads/bg-custom-day.svg');
    assert.equal(uploadedPayload?.siteSettings?.night_bg_url, '/uploads/bg-custom-night.svg');
    assert.equal(uploadedPayload?.siteSettings?.default_theme, 'light');
    assert.equal(uploadedPayload?.siteSettings?.bg_history?.length, 2);

    // 3. 还原双模式预设快照 -> 验证白天/夜晚配置、默认主题与历史壁纸全部精确恢复
    await backupModule.restoreBackup(dualSnapshot);
    const restoredDual = await settingsModule.getAppearanceSettings();
    assert.equal(restoredDual.day_bg_url, '/backgrounds/dawn-horizon.svg');
    assert.equal(restoredDual.day_bg_overlay, 6);
    assert.equal(restoredDual.night_bg_url, '/backgrounds/aurora-peaks.svg');
    assert.equal(restoredDual.night_bg_overlay, 26);
    assert.equal(restoredDual.default_theme, 'dark');
    assert.equal(restoredDual.bg_history.length, 2);

    // 4. 向后兼容旧版单背景备份（仅含 site_bg_url / site_bg_overlay / site_bg_preset）
    await backupModule.restoreBackup({
      format: 'nav-item-backup',
      version: 2,
      tables: {
        menus: [{ id: 1, name: 'Home', order: 1 }],
        sub_menus: [],
        cards: [],
        site_settings: [
          { key: 'site_bg_url', value: '/uploads/legacy-wall.webp' },
          { key: 'site_bg_overlay', value: '38' },
          { key: 'site_bg_preset', value: '' }
        ]
      },
      siteSettings: {
        site_bg_url: '/uploads/legacy-wall.webp',
        site_bg_overlay: 38,
        site_bg_preset: ''
      }
    });
    const restoredLegacySingle = await settingsModule.getAppearanceSettings();
    assert.equal(restoredLegacySingle.night_bg_url, '/uploads/legacy-wall.webp');
    assert.equal(restoredLegacySingle.night_bg_overlay, 38);
    assert.equal(restoredLegacySingle.day_bg_url, '/backgrounds/campus-day.svg');
    assert.equal(restoredLegacySingle.day_bg_overlay, 0);
    assert.equal(restoredLegacySingle.default_theme, 'auto');

    // 5. 还原自定义双模式快照后再测试兼容不含 siteSettings 的 v1 旧版备份（保留现有外观配置）
    await backupModule.restoreBackup(customSnapshot);
    await backupModule.restoreBackup({
      format: 'nav-item-backup',
      version: 1,
      tables: {
        menus: [{ id: 1, name: 'Home', order: 1 }],
        sub_menus: [],
        cards: []
      }
    });
    const rowsAfterV1 = await all(db, 'SELECT key, value FROM site_settings ORDER BY key ASC');
    assert.equal(rowsAfterV1.find(r => r.key === 'day_bg_url')?.value, '/uploads/bg-custom-day.svg');
    assert.equal(rowsAfterV1.find(r => r.key === 'night_bg_url')?.value, '/uploads/bg-custom-night.svg');
  } finally {
    delete require.cache[dbPath];
    delete require.cache[settingsPath];
    delete require.cache[backupPath];
    await close(db);
  }
});

test('前台白天/夜晚切换、亮暗双套 CSS 变量、移动端固定背景与后台历史壁纸槽位关键结构校验', () => {
  const homeSrc = fs.readFileSync(path.resolve(__dirname, '../web/src/views/Home.vue'), 'utf8');
  // 顶栏严禁塞入主题切换或品牌/后台按钮
  assert.doesNotMatch(homeSrc, /class="brand-badge"/);
  assert.doesNotMatch(homeSrc, /class="admin-entry-btn"/);
  assert.doesNotMatch(homeSrc, /<header class="top-bar">[\s\S]*?switchTheme[\s\S]*?<\/header>/);
  // 底部页脚胶囊整合白天/夜晚切换与后台入口
  assert.match(homeSrc, /<footer class="footer">[\s\S]*?浅色[\s\S]*?深色[\s\S]*?<router-link to="\/admin"[\s\S]*?<\/footer>/);
  assert.match(homeSrc, /data-theme/);
  assert.match(homeSrc, /localStorage/);
  assert.match(homeSrc, /getSiteAppearance/);
  // 移动端背景渲染修复：移除 background-attachment: fixed，改为独立固定底层容器
  assert.doesNotMatch(homeSrc, /background-attachment:\s*fixed/);
  assert.match(homeSrc, /\.bg-backdrop\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*-1;/);
  assert.match(homeSrc, /env\(safe-area-inset-bottom/);

  const menuBarSrc = fs.readFileSync(path.resolve(__dirname, '../web/src/components/MenuBar.vue'), 'utf8');
  assert.match(menuBarSrc, /var\(--glass-menu-bg/);
  assert.match(menuBarSrc, /calc\(100vw - 24px\)/);

  const cardGridSrc = fs.readFileSync(path.resolve(__dirname, '../web/src/components/CardGrid.vue'), 'utf8');
  assert.match(cardGridSrc, /var\(--card-bg/);
  assert.match(cardGridSrc, /max-width:\s*520px/);

  const userManageSrc = fs.readFileSync(path.resolve(__dirname, '../web/src/views/admin/UserManage.vue'), 'utf8');
  assert.match(userManageSrc, /首页背景设置/);
  assert.match(userManageSrc, /白天模式配置/);
  assert.match(userManageSrc, /夜晚模式配置/);
  assert.match(userManageSrc, /暂无历史记录，更换壁纸后自动保留最近 2 次/);
  assert.match(userManageSrc, /恢复此壁纸/);
  assert.match(userManageSrc, /image\/svg\+xml/);
  assert.match(userManageSrc, /getSiteBgPresets/);
  assert.match(userManageSrc, /selectBgPreset/);
  assert.match(userManageSrc, /uploadSiteBackground/);
  assert.match(userManageSrc, /updateSiteAppearance/);
  assert.match(userManageSrc, /max="80"/);
});
