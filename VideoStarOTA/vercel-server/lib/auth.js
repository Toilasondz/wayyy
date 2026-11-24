'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'vs_ota_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 ngày

// Giới hạn số lần đăng nhập sai theo IP (chống dò mật khẩu cơ bản trong instance)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'VideoStar@2026';
  const isDefaultCredentials = !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD;
  return { username, password, isDefaultCredentials };
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  const { username, password } = getAdminCredentials();
  return crypto
    .createHash('sha256')
    .update(`vs-ota-fallback-secret:${username}:${password}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a || '')).digest();
  const hashB = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function signToken(payloadObj) {
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  if (!safeEqual(sig, expectedSig)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload || !payload.u || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers && req.headers.cookie ? req.headers.cookie : '';
  const map = {};
  if (!header) return map;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) map[key] = decodeURIComponent(val);
  }
  return map;
}

function isSecureRequest(req) {
  const proto = req.headers && (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol']);
  return proto === 'https' || process.env.VERCEL === '1';
}

function setSessionCookie(req, res, username) {
  const now = Date.now();
  const token = signToken({
    u: username,
    iat: now,
    exp: now + SESSION_TTL_SEC * 1000
  });
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SEC}`
  ];
  if (isSecureRequest(req)) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function clearSessionCookie(req, res) {
  const flags = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (isSecureRequest(req)) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return verifyToken(token);
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'Chưa đăng nhập hoặc phiên đã hết hạn.' });
    return null;
  }
  return session;
}

function getClientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function checkRateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - entry.firstAt)) / 1000);
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - entry.count };
}

function recordFailedLogin(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function clearFailedLogins(req) {
  const ip = getClientIp(req);
  loginAttempts.delete(ip);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length > 0) {
    return JSON.parse(req.body);
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error('Payload quá lớn (tối đa 5MB).'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('JSON không hợp lệ.'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  getAdminCredentials,
  safeEqual,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAdmin,
  checkRateLimit,
  recordFailedLogin,
  clearFailedLogins,
  readJsonBody
};
