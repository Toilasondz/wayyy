'use strict';

const { requireAdmin, readJsonBody } = require('../../lib/auth');
const { sanitizeAssetName, putRaw, deleteRaw, listAssets, publishRelease } = require('../../lib/storage');

module.exports = async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'DELETE') {
    try {
      const body = await readJsonBody(req);
      const name = sanitizeAssetName(body.name || (req.query && req.query.name));
      const deleted = await deleteRaw(`assets/${name}`);
      const assets = await listAssets();
      return res.status(200).json({ ok: true, deleted, assets });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Không thể xóa tệp.' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const target = String(body.target || 'asset'); // 'payload' | 'config' | 'panel' | 'asset'
    const contentBase64 = String(body.contentBase64 || '');
    if (!contentBase64) {
      return res.status(400).json({ ok: false, error: 'Tệp tải lên đang trống.' });
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.length > 4 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: 'Tệp vượt quá giới hạn 4MB của Vercel Serverless.' });
    }

    if (target === 'payload' || target === 'config' || target === 'panel') {
      const text = buffer.toString('utf8');
      const opts = {
        version: body.version,
        changelog: body.changelog || `Upload tệp ${body.filename || target} trực tiếp từ Admin Web`,
        author: session.u
      };
      if (target === 'payload') opts.payloadCode = text;
      if (target === 'config') opts.configJson = text;
      if (target === 'panel') opts.panelHtml = text;

      const published = await publishRelease(opts);
      return res.status(200).json({
        ok: true,
        target,
        manifest: published.manifest,
        history: published.history
      });
    }

    // Upload tài nguyên bổ sung (preset JSON, ảnh QR, icon, file phụ...)
    const safeName = sanitizeAssetName(body.filename || `file-${Date.now()}.bin`);
    const contentType = String(body.contentType || 'application/octet-stream');
    const saved = await putRaw(`assets/${safeName}`, buffer, contentType);
    const assets = await listAssets();

    return res.status(200).json({
      ok: true,
      target: 'asset',
      asset: {
        name: safeName,
        size: saved.size,
        sha256: saved.sha256,
        bundlePath: `/api/bundle?file=assets/${encodeURIComponent(safeName)}`
      },
      assets
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Lỗi tải tệp lên.' });
  }
};
