'use strict';

const { requireAdmin, readJsonBody } = require('../../lib/auth');
const { publishRelease } = require('../../lib/storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    const body = await readJsonBody(req);
    const result = await publishRelease({
      version: body.version,
      changelog: body.changelog,
      killSwitch: body.killSwitch,
      announcement: body.announcement,
      payloadCode: body.payloadCode,
      configJson: body.configJson,
      panelHtml: body.panelHtml,
      author: session.u
    });

    return res.status(200).json({
      ok: true,
      manifest: result.manifest,
      history: result.history
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Không thể xuất bản bản cập nhật.' });
  }
};
