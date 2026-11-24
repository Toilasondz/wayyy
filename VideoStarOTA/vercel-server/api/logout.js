'use strict';

const { clearSessionCookie } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  clearSessionCookie(req, res);
  return res.status(200).json({ ok: true });
};
