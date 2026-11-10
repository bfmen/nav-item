const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('首页路由要求有效登录会话', () => {
  const routerSource = fs.readFileSync(
    path.resolve(__dirname, '../web/src/router.js'),
    'utf8'
  );

  assert.match(routerSource, /path:\s*'\/'[^\n]*requiresAuth:\s*true/);
  assert.match(routerSource, /axios\.get\('\/api\/users\/me'/);
  assert.match(routerSource, /router\.beforeEach\(/);
  assert.match(routerSource, /path:\s*'\/admin'/);
});
