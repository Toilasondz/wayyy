'use strict';

const { getManifest } = require('../lib/storage');

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
    const manifest = await getManifest();
    const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
    const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
    const baseUrl = host ? `${proto}://${host}` : '';

    const response = {
      ok: true,
      ...manifest,
      serverTime: new Date().toISOString(),
      files: {
        payload: {
          ...manifest.files.payload,
          url: baseUrl ? `${baseUrl}${manifest.files.payload.path}&v=${encodeURIComponent(manifest.version)}` : manifest.files.payload.path
        },
        config: {
          ...manifest.files.config,
          url: baseUrl ? `${baseUrl}${manifest.files.config.path}&v=${encodeURIComponent(manifest.version)}` : manifest.files.config.path
        },
        panel: {
          ...manifest.files.panel,
          url: baseUrl ? `${baseUrl}${manifest.files.panel.path}&v=${encodeURIComponent(manifest.version)}` : manifest.files.panel.path
        }
      }
    };

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Lỗi đọc manifest.' });
  }
};
