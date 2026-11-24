'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_PREFIX = 'vs-ota/';
const DEFAULTS_DIR = path.join(__dirname, '..', 'defaults');

let vercelBlob = null;
try {
  vercelBlob = require('@vercel/blob');
} catch {
  vercelBlob = null;
}

function getStorageMode() {
  if (process.env.BLOB_READ_WRITE_TOKEN && vercelBlob) {
    return 'vercel_blob';
  }
  if (process.env.VERCEL === '1') {
    return 'ephemeral_tmp';
  }
  return 'local_fs';
}

function getLocalBaseDir() {
  if (process.env.VERCEL === '1') {
    return '/tmp/vs-ota-storage';
  }
  return path.join(process.cwd(), '.ota-storage');
}

function sha256(bufferOrString) {
  const buf = Buffer.isBuffer(bufferOrString)
    ? bufferOrString
    : Buffer.from(String(bufferOrString), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sanitizeAssetName(name) {
  const clean = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!clean || clean === '.' || clean === '..') {
    throw new Error('Tên tệp không hợp lệ.');
  }
  return clean;
}

async function readDefaultFile(filename) {
  const fullPath = path.join(DEFAULTS_DIR, filename);
  return fs.promises.readFile(fullPath);
}

async function putRaw(key, buffer, contentType = 'application/octet-stream') {
  const mode = getStorageMode();
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');

  if (mode === 'vercel_blob') {
    const pathname = `${STORAGE_PREFIX}${key}`;
    const result = await vercelBlob.put(pathname, data, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType
    });
    return { url: result.url, size: data.length, sha256: sha256(data) };
  }

  const fullPath = path.join(getLocalBaseDir(), key);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, data);
  return { url: null, size: data.length, sha256: sha256(data) };
}

async function getRaw(key) {
  const mode = getStorageMode();

  if (mode === 'vercel_blob') {
    const pathname = `${STORAGE_PREFIX}${key}`;
    const { blobs } = await vercelBlob.list({ prefix: pathname, limit: 10 });
    const match = blobs.find((b) => b.pathname === pathname);
    if (!match) return null;
    const sep = match.url.includes('?') ? '&' : '?';
    const resp = await fetch(`${match.url}${sep}t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  }

  const fullPath = path.join(getLocalBaseDir(), key);
  try {
    return await fs.promises.readFile(fullPath);
  } catch {
    return null;
  }
}

async function deleteRaw(key) {
  const mode = getStorageMode();
  if (mode === 'vercel_blob') {
    const pathname = `${STORAGE_PREFIX}${key}`;
    const { blobs } = await vercelBlob.list({ prefix: pathname, limit: 10 });
    const match = blobs.find((b) => b.pathname === pathname);
    if (match) {
      await vercelBlob.del(match.url);
      return true;
    }
    return false;
  }

  const fullPath = path.join(getLocalBaseDir(), key);
  try {
    await fs.promises.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function listAssets() {
  const mode = getStorageMode();
  const prefix = 'assets/';

  if (mode === 'vercel_blob') {
    const { blobs } = await vercelBlob.list({ prefix: `${STORAGE_PREFIX}${prefix}`, limit: 100 });
    return blobs.map((b) => ({
      name: b.pathname.slice(`${STORAGE_PREFIX}${prefix}`.length),
      size: b.size,
      uploadedAt: b.uploadedAt,
      url: b.url
    }));
  }

  const dir = path.join(getLocalBaseDir(), prefix);
  try {
    const names = await fs.promises.readdir(dir);
    const items = [];
    for (const name of names) {
      const stat = await fs.promises.stat(path.join(dir, name));
      if (stat.isFile()) {
        items.push({
          name,
          size: stat.size,
          uploadedAt: stat.mtime.toISOString(),
          url: `/api/bundle?file=assets/${encodeURIComponent(name)}`
        });
      }
    }
    return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  } catch {
    return [];
  }
}

async function getBundleFile(filename) {
  const allowedCore = {
    'payload.js': 'application/javascript; charset=utf-8',
    'config.json': 'application/json; charset=utf-8',
    'panel.html': 'text/html; charset=utf-8'
  };

  if (allowedCore[filename]) {
    let buf = await getRaw(`current/${filename}`);
    if (!buf) {
      buf = await readDefaultFile(filename);
    }
    return { buffer: buf, contentType: allowedCore[filename] };
  }

  if (filename.startsWith('assets/')) {
    const clean = sanitizeAssetName(filename.slice('assets/'.length));
    const buf = await getRaw(`assets/${clean}`);
    if (!buf) return null;
    const ext = path.extname(clean).toLowerCase();
    const mimeMap = {
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.zip': 'application/zip'
    };
    return { buffer: buf, contentType: mimeMap[ext] || 'application/octet-stream' };
  }

  return null;
}

async function getManifest() {
  const raw = await getRaw('current/manifest.json');
  if (raw) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      // Fallback to generated default
    }
  }

  const [payloadBuf, configBuf, panelBuf] = await Promise.all([
    readDefaultFile('payload.js'),
    readDefaultFile('config.json'),
    readDefaultFile('panel.html')
  ]);

  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    changelog: 'Phiên bản khởi tạo mặc định (VideoStarOTA)',
    killSwitch: false,
    announcement: '',
    minDylibVersion: '1.0.0',
    files: {
      payload: { path: '/api/bundle?file=payload.js', sha256: sha256(payloadBuf), size: payloadBuf.length },
      config: { path: '/api/bundle?file=config.json', sha256: sha256(configBuf), size: configBuf.length },
      panel: { path: '/api/bundle?file=panel.html', sha256: sha256(panelBuf), size: panelBuf.length }
    }
  };
}

async function getHistory() {
  const raw = await getRaw('history/index.json');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function bumpPatchVersion(ver) {
  const m = String(ver || '1.0.0').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return '1.0.1';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

async function publishRelease({
  version,
  changelog,
  killSwitch,
  announcement,
  payloadCode,
  configJson,
  panelHtml,
  author
}) {
  const currentManifest = await getManifest();

  const currentPayload = payloadCode !== undefined
    ? Buffer.from(payloadCode, 'utf8')
    : (await getBundleFile('payload.js')).buffer;

  const currentConfig = configJson !== undefined
    ? Buffer.from(configJson, 'utf8')
    : (await getBundleFile('config.json')).buffer;

  const currentPanel = panelHtml !== undefined
    ? Buffer.from(panelHtml, 'utf8')
    : (await getBundleFile('panel.html')).buffer;

  // Kiểm tra cú pháp JSON hợp lệ trước khi xuất bản
  try {
    JSON.parse(currentConfig.toString('utf8'));
  } catch (err) {
    throw new Error(`config.json sai cú pháp JSON: ${err.message}`);
  }

  const nextVersion = (version && String(version).trim()) || bumpPatchVersion(currentManifest.version);
  const now = new Date().toISOString();

  const [payloadInfo, configInfo, panelInfo] = await Promise.all([
    putRaw('current/payload.js', currentPayload, 'application/javascript; charset=utf-8'),
    putRaw('current/config.json', currentConfig, 'application/json; charset=utf-8'),
    putRaw('current/panel.html', currentPanel, 'text/html; charset=utf-8')
  ]);

  const manifest = {
    version: nextVersion,
    updatedAt: now,
    updatedBy: author || 'admin',
    changelog: String(changelog || '').trim() || `Cập nhật phiên bản ${nextVersion}`,
    killSwitch: Boolean(killSwitch),
    announcement: String(announcement || '').trim(),
    minDylibVersion: currentManifest.minDylibVersion || '1.0.0',
    files: {
      payload: { path: '/api/bundle?file=payload.js', sha256: payloadInfo.sha256, size: payloadInfo.size },
      config: { path: '/api/bundle?file=config.json', sha256: configInfo.sha256, size: configInfo.size },
      panel: { path: '/api/bundle?file=panel.html', sha256: panelInfo.sha256, size: panelInfo.size }
    }
  };

  await putRaw('current/manifest.json', JSON.stringify(manifest, null, 2), 'application/json; charset=utf-8');

  // Lưu snapshot vào lịch sử để Rollback 1-click
  const snapId = `${nextVersion.replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}`;
  const snapshot = {
    id: snapId,
    version: nextVersion,
    updatedAt: now,
    updatedBy: manifest.updatedBy,
    changelog: manifest.changelog,
    killSwitch: manifest.killSwitch,
    announcement: manifest.announcement,
    payloadSha256: payloadInfo.sha256,
    configSha256: configInfo.sha256,
    panelSha256: panelInfo.sha256
  };

  await Promise.all([
    putRaw(`history/${snapId}/payload.js`, currentPayload, 'application/javascript; charset=utf-8'),
    putRaw(`history/${snapId}/config.json`, currentConfig, 'application/json; charset=utf-8'),
    putRaw(`history/${snapId}/panel.html`, currentPanel, 'text/html; charset=utf-8')
  ]);

  const history = await getHistory();
  history.unshift(snapshot);
  const trimmed = history.slice(0, 20);
  await putRaw('history/index.json', JSON.stringify(trimmed, null, 2), 'application/json; charset=utf-8');

  return { manifest, history: trimmed };
}

async function rollbackToSnapshot(snapId, author) {
  const history = await getHistory();
  const snap = history.find((item) => item.id === snapId);
  if (!snap) {
    throw new Error('Không tìm thấy bản sao lưu phiên bản này.');
  }

  const [payloadBuf, configBuf, panelBuf] = await Promise.all([
    getRaw(`history/${snapId}/payload.js`),
    getRaw(`history/${snapId}/config.json`),
    getRaw(`history/${snapId}/panel.html`)
  ]);

  if (!payloadBuf || !configBuf || !panelBuf) {
    throw new Error('Thiếu tệp trong bản sao lưu để khôi phục.');
  }

  return publishRelease({
    version: bumpPatchVersion((await getManifest()).version),
    changelog: `Rollback về bản ${snap.version} (${snap.changelog})`,
    killSwitch: snap.killSwitch,
    announcement: snap.announcement,
    payloadCode: payloadBuf.toString('utf8'),
    configJson: configBuf.toString('utf8'),
    panelHtml: panelBuf.toString('utf8'),
    author
  });
}

module.exports = {
  getStorageMode,
  sha256,
  sanitizeAssetName,
  putRaw,
  getRaw,
  deleteRaw,
  listAssets,
  getBundleFile,
  getManifest,
  getHistory,
  publishRelease,
  rollbackToSnapshot
};
