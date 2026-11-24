'use strict';

const {
  getAdminCredentials,
  safeEqual,
  setSessionCookie,
  getSession,
  checkRateLimit,
  recordFailedLogin,
  clearFailedLogins,
  readJsonBody
} = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getSession(req);
    const { isDefaultCredentials } = getAdminCredentials();
    return res.status(200).json({
      ok: true,
      authenticated: Boolean(session),
      username: session ? session.u : null,
      isDefaultCredentials
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const rl = checkRateLimit(req);
  if (!rl.allowed) {
    return res.status(429).json({
      ok: false,
      error: `Thử sai quá nhiều lần. Vui lòng thử lại sau ${rl.retryAfterSec} giây.`
    });
  }

  try {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    const creds = getAdminCredentials();
    const userOk = safeEqual(username, creds.username);
    const passOk = safeEqual(password, creds.password);

    if (!userOk || !passOk) {
      recordFailedLogin(req);
      return res.status(401).json({
        ok: false,
        error: 'Sai tên đăng nhập hoặc mật khẩu.'
      });
    }

    clearFailedLogins(req);
    setSessionCookie(req, res, creds.username);

    return res.status(200).json({
      ok: true,
      username: creds.username,
      isDefaultCredentials: creds.isDefaultCredentials
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Yêu cầu không hợp lệ.' });
  }
};
