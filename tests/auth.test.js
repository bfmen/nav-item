const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { COOKIE_NAME, JWT_SECRET, SESSION_SECONDS } = require('../routes/session');

const dbPath = path.resolve(__dirname, '../db.js');
const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, err => err ? reject(err) : resolve());
});
const get = (db, sql) => new Promise((resolve, reject) => {
  db.get(sql, (err, row) => err ? reject(err) : resolve(row));
});
const close = db => new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));

// 执行实际初始化和迁移代码，SQLite 数据只保存在内存中。
async function initialize(db) {
  const localRequire = createRequire(dbPath);
  vm.runInNewContext(fs.readFileSync(dbPath, 'utf8'), {
    require(name) {
      if (name === 'sqlite3') return { verbose: () => ({ Database: function () { return db; } }) };
      if (name === 'fs') return { existsSync: () => true };
      return localRequire(name);
    },
    __dirname: path.dirname(dbPath), module: { exports: {} }, console: { log() {}, error() {} }
  }, { filename: dbPath });
  await db.ready;
}

test('旧登录记录迁移正确且重复初始化不会覆盖历史记录', async () => {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE,
      password TEXT, last_login_time TEXT, last_login_ip TEXT)`);
    await run(db, 'INSERT INTO users VALUES (1, ?, ?, ?, ?)', [
      'migration-user', 'unused', '2026-10-01 12:00:00', '192.0.2.10'
    ]);
    await initialize(db);
    const migrated = await get(db, 'SELECT * FROM users WHERE id=1');
    assert.equal(migrated.current_login_at, '2026-10-01 12:00:00');
    assert.equal(migrated.current_login_ip, '192.0.2.10');
    assert.equal(migrated.last_login_at, null);
    assert.equal(migrated.last_login_ip, null);
    await run(db, "UPDATE users SET last_login_at='2026-09-01 12:00:00', last_login_ip='192.0.2.9'");
    await initialize(db);
    const repeated = await get(db, 'SELECT * FROM users WHERE id=1');
    assert.equal(repeated.last_login_at, '2026-09-01 12:00:00');
    assert.equal(repeated.last_login_ip, '192.0.2.9');
  } finally {
    await close(db);
  }
});

test('Cookie 登录、历史记录、过期、退出和广告接口移除', async () => {
  const db = new sqlite3.Database(':memory:');
  let server;
  try {
    await initialize(db);
    await run(db, 'INSERT INTO users (username, password) VALUES (?, ?)', [
      'session-test', bcrypt.hashSync('test-password', 4)
    ]);
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    const app = require('../app');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = ip => fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ username: 'session-test', password: 'test-password' })
    });
    const first = await login('192.0.2.1');
    assert.equal(first.status, 200);
    const setCookie = first.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=604800', 'Path=/']) {
      assert.ok(setCookie.includes(flag), flag);
    }
    const cookie = setCookie.split(';')[0];
    const token = jwt.verify(cookie.slice(COOKIE_NAME.length + 1), JWT_SECRET);
    assert.equal(token.exp - token.iat, SESSION_SECONDS);
    assert.deepEqual(await first.json(), { last_login_at: null, last_login_ip: null });
    const firstInfo = await (await fetch(`${base}/api/users/me`, { headers: { Cookie: cookie } })).json();
    assert.equal(firstInfo.current_login_ip, '192.0.2.1');

    const second = await login('::ffff:192.0.2.2, 192.0.2.3');
    assert.equal(second.status, 200);
    const historical = await second.json();
    assert.equal(historical.last_login_at, firstInfo.current_login_at);
    assert.equal(historical.last_login_ip, '192.0.2.1');
    const secondCookie = second.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: secondCookie };
    const info = await (await fetch(`${base}/api/users/me`, { headers })).json();
    assert.equal(info.current_login_ip, '192.0.2.2');
    assert.equal(info.last_login_at, historical.last_login_at);
    assert.equal(info.last_login_ip, historical.last_login_ip);
    assert.deepEqual(await (await fetch(`${base}/api/users/me`, { headers })).json(), info);

    const expired = jwt.sign({ id: token.id }, JWT_SECRET, { expiresIn: -1 });
    for (const badCookie of ['', `${COOKIE_NAME}=${expired}`, `${COOKIE_NAME}=%ZZ`, `${COOKIE_NAME}=invalid`]) {
      const denied = await fetch(`${base}/api/users/me`, { headers: { Cookie: badCookie } });
      assert.equal(denied.status, 401);
      assert.ok(denied.headers.get('set-cookie').includes('Expires=Thu, 01 Jan 1970'));
    }
    const invalidLogin = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'session-test', password: 'incorrect' })
    });
    assert.equal(invalidLogin.status, 401);
    assert.deepEqual(await (await fetch(`${base}/api/users/me`, { headers })).json(), info);
    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers });
    assert.equal(logout.status, 200);
    assert.ok(logout.headers.get('set-cookie').includes('Expires=Thu, 01 Jan 1970'));
    assert.equal((await fetch(`${base}/api/users/me`)).status, 401);
    assert.equal((await fetch(`${base}/api/ads`)).status, 404);
    assert.equal((await fetch(`${base}/api/menus`)).status, 200);
    const favicon = await fetch(`${base}/api/favicon?url=${encodeURIComponent('http://127.0.0.1/metadata')}`, { redirect: 'manual' });
    assert.equal(favicon.status, 302);
    assert.equal(favicon.headers.get('location'), '/uploads/default-favicon.png');
    const localLogo = await fetch(`${base}/uploads/default-favicon.png`);
    const shibaLogo = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../uploads/default-favicon.png'));
    assert.deepEqual(Buffer.from(await localLogo.arrayBuffer()), shibaLogo);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    delete require.cache[dbPath];
    await close(db);
  }
});

test('前端 401 清除旧凭据、通知后台退回登录表单并跳转 /admin', async () => {
  let rejectResponse;
  const removed = [];
  const events = [];
  const routes = [];
  const axios = { defaults: {}, interceptors: { response: { use(ok, failed) { rejectResponse = failed; } } } };
  const source = fs.readFileSync(path.resolve(__dirname, '../web/src/api.js'), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(source, {
    axios, router: { replace: path => routes.push(path) },
    localStorage: { removeItem: key => removed.push(key) },
    window: { dispatchEvent: event => events.push(event.type) }, Event
  });
  assert.equal(axios.defaults.withCredentials, true);
  const error = { response: { status: 401 }, config: { url: '/api/users/me' } };
  await assert.rejects(rejectResponse(error), value => value === error);
  assert.deepEqual(removed, ['token']);
  assert.deepEqual(events, ['auth:unauthorized']);
  assert.deepEqual(routes, ['/admin']);
  await assert.rejects(rejectResponse({ response: { status: 401 }, config: { url: '/api/login' } }));
  assert.equal(routes.length, 1);
  await assert.rejects(rejectResponse({ response: { status: 500 } }));
  assert.equal(events.length, 2);
});
