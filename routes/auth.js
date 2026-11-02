const express = require('express');
const db = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { COOKIE_NAME, SESSION_SECONDS, JWT_SECRET, COOKIE_OPTIONS, clearSession } = require('./session');

function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
  if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  return ip;
}

function getShanghaiTime() {
  const date = new Date();
  // 获取上海时区时间
  const shanghaiTime = new Date(date.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
  
  // 格式化为 YYYY-MM-DD HH:mm:ss
  const year = shanghaiTime.getFullYear();
  const month = String(shanghaiTime.getMonth() + 1).padStart(2, '0');
  const day = String(shanghaiTime.getDate()).padStart(2, '0');
  const hours = String(shanghaiTime.getHours()).padStart(2, '0');
  const minutes = String(shanghaiTime.getMinutes()).padStart(2, '0');
  const seconds = String(shanghaiTime.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }
  db.get('SELECT * FROM users WHERE username=?', [username], (err, user) => {
    if (err || !user) return res.status(401).json({ error: '用户名或密码错误' });
    bcrypt.compare(password, user.password, (err, result) => {
      if (err) return res.status(500).json({ error: '登录失败，请稍后重试' });
      if (result) {
        const now = getShanghaiTime();
        const ip = getClientIp(req);
        // 在同一条语句中将本次记录移到历史记录，刷新页面不会再更新它。
        db.run(`UPDATE users SET last_login_at=current_login_at, last_login_ip=current_login_ip,
          current_login_at=?, current_login_ip=? WHERE id=?`, [now, ip, user.id], (err) => {
          if (err) return res.status(500).json({ error: '保存登录记录失败' });
          db.get('SELECT last_login_at, last_login_ip FROM users WHERE id=?', [user.id], (err, info) => {
            if (err || !info) return res.status(500).json({ error: '获取登录记录失败' });
            const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: SESSION_SECONDS });
            res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: SESSION_SECONDS * 1000 });
            res.json(info);
          });
        });
      } else {
        res.status(401).json({ error: '用户名或密码错误' });
      }
    });
  });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ message: '已退出登录' });
});

module.exports = router;
