'use strict';

const { requireAdmin, getAdminCredentials } = require('../../lib/auth');
const { getStorageMode, getManifest, getBundleFile, getHistory, listAssets } = require('../../lib/storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    const [manifest, payloadRes, configRes, panelRes, history, assets] = await Promise.all([
      getManifest(),
      getBundleFile('payload.js'),
      getBundleFile('config.json'),
      getBundleFile('panel.html'),
      getHistory(),
      listAssets()
    ]);

    const { isDefaultCredentials } = getAdminCredentials();

    return res.status(200).json({
      ok: true,
      username: session.u,
      isDefaultCredentials,
      storageMode: getStorageMode(),
      manifest,
      files: {
        payloadCode: payloadRes.buffer.toString('utf8'),
        configJson: configRes.buffer.toString('utf8'),
        panelHtml: panelRes.buffer.toString('utf8')
      },
      history,
      assets
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Không thể tải trạng thái hệ thống.' });
  }
};
