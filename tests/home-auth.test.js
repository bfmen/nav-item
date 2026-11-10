const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('首页路由要求有效登录会话', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../web/src/router.js'), 'utf8');
  assert.match(source, /path:\s*'\/'[^\n]*requiresAuth:\s*true/);
  assert.match(source, /axios\.get\('\/api\/users\/me'/);
  assert.match(source, /router\.beforeEach\(/);
  assert.match(source, /path:\s*'\/admin'/);
});
