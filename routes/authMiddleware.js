const jwt = require('jsonwebtoken');
const { COOKIE_NAME, JWT_SECRET, clearSession } = require('./session');

function authMiddleware(req, res, next) {
  try {
    const cookie = (req.headers.cookie || '').split(';')
      .map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
    if (!cookie) {
      clearSession(res);
      return res.status(401).json({ error: '请重新登录' });
    }
    const token = decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1));
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    clearSession(res);
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

module.exports = authMiddleware;
