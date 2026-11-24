'use strict';

const { requireAdmin, readJsonBody } = require('../../lib/auth');
const { rollbackToSnapshot } = require('../../lib/storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    const body = await readJsonBody(req);
    const snapId = String(body.snapshotId || '').trim();
    if (!snapId) {
      return res.status(400).json({ ok: false, error: 'Thiếu mã phiên bản cần khôi phục.' });
    }
    const result = await rollbackToSnapshot(snapId, session.u);
    return res.status(200).json({
      ok: true,
      manifest: result.manifest,
      history: result.history
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Không thể khôi phục phiên bản.' });
  }
};
