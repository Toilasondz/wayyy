'use strict';

const { getBundleFile, sha256 } = require('../lib/storage');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const fileParam = (req.query && req.query.file) || '';
    if (!fileParam) {
      return res.status(400).json({ ok: false, error: 'Thiếu tham số ?file=' });
    }

    const found = await getBundleFile(String(fileParam));
    if (!found) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy tệp yêu cầu.' });
    }

    res.setHeader('Content-Type', found.contentType);
    res.setHeader('X-Content-SHA256', sha256(found.buffer));
    return res.status(200).send(found.buffer);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Lỗi tải tệp.' });
  }
};
