const COOKIE_NAME = 'nav_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
}

module.exports = { COOKIE_NAME, SESSION_SECONDS, JWT_SECRET, COOKIE_OPTIONS, clearSession };
