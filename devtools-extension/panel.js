/**
 * ASG Offline DevTools Inspector — panel.js
 * Provides live inspection of: Cache, POSA Queue, Dead-Letter Queue,
 * ADE Integration Map, Reconciliation Log, and Local DB.
 */

/* ─────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────── */
let lastData = null;
let activeAdeFilter = 'ALL';

/* ─────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.getAttribute('data-tab')).classList.add('active');
    });
  });

  // Header controls
  document.getElementById('btn-refresh').addEventListener('click', refresh);

  // Overview controls
  document.getElementById('btn-trigger-posa').addEventListener('click', forcePOSASync);
  document.getElementById('btn-trigger-ase').addEventListener('click', forceASEEval);
  document.getElementById('btn-sim-offline').addEventListener('click', toggleSimOffline);
  document.getElementById('btn-clear-sw-cache').addEventListener('click', clearCache);

  // Cache tab
  document.getElementById('btn-clear-cache-tab').addEventListener('click', clearCache);

  // Queue tab
  document.getElementById('btn-flush-queue').addEventListener('click', forcePOSASync);

  // DLQ tab
  document.getElementById('btn-retry-dlq').addEventListener('click', retryDLQ);
  document.getElementById('btn-clear-dlq').addEventListener('click', clearDLQ);

  // ADE tab
  document.getElementById('btn-sync-ade').addEventListener('click', syncADEToServer);
  document.getElementById('btn-clear-ade').addEventListener('click', clearADE);

  // ADE filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeAdeFilter = btn.getAttribute('data-filter');
      if (lastData) renderADE(lastData.adeRoutes || []);
    });
  });

  // Initial load + auto-refresh every 3s
  refresh();
  setInterval(refresh, 3000);
});

/* ─────────────────────────────────────────────────────────
   DATA FETCH (from inspected page via chrome.devtools)
───────────────────────────────────────────────────────── */
const EVAL_CODE = `
(async function() {
  const hasSdk = typeof window.ASGOffline !== 'undefined';
  const sdk = hasSdk ? window.ASGOffline : null;
  const isOnline = navigator.onLine;
  const appId = sdk ? sdk.appId : 'Unknown';
  const deviceId = sdk ? sdk.getDeviceId() : '—';

  let cachedUrls = [];
  try { if (sdk && sdk.getCachedUrls) cachedUrls = await sdk.getCachedUrls(); } catch(e){}

  let posaQueue = [];
  try { if (sdk && sdk.getPOSAQueue) posaQueue = await sdk.getPOSAQueue(); } catch(e){}

  let dlqItems = [];
  try {
    if (sdk && sdk.db) {
      dlqItems = await new Promise((res) => {
        const tx = sdk.db.transaction(['posa_dlq'], 'readonly');
        const req = tx.objectStore('posa_dlq').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror  = () => res([]);
      });
    }
  } catch(e){}

  let recLog = [];
  try {
    if (sdk && sdk.db) {
      recLog = await new Promise((res) => {
        const tx = sdk.db.transaction(['posa_reconciliation_log'], 'readonly');
        const req = tx.objectStore('posa_reconciliation_log').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror  = () => res([]);
      });
    }
  } catch(e){}

  // ADE routes from in-memory Map
  let adeRoutes = [];
  try {
    if (sdk && sdk.discoveredRoutes) {
      adeRoutes = Array.from(sdk.discoveredRoutes.values());
    }
  } catch(e){}

  // DB records
  let dbRecords = [];
  try {
    if (sdk && sdk.dbApi) {
      dbRecords = await sdk.dbApi.getAll();
    }
  } catch(e){}

  // Config
  const config = sdk ? (sdk.config || {}) : {};

  // Last sync telemetry from localStorage
  let lastSyncAt = null;
  try { lastSyncAt = localStorage.getItem('asg_last_sync_at'); } catch(e){}

  return {
    hasSdk, isOnline, appId, deviceId,
    cachedUrls, posaQueue, dlqItems, recLog, adeRoutes, dbRecords,
    cacheStrategy: config.cacheStrategy || 'stale-while-revalidate',
    swActive: !!navigator.serviceWorker.controller,
    lastSyncAt
  };
})();
`;

function refresh() {
  if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.inspectedWindow) {
    chrome.devtools.inspectedWindow.eval(EVAL_CODE, (result, isException) => {
      if (isException || !result) return;
      lastData = result;
      updateUI(result);
    });
  } else {
    // Standalone demo fallback
    const demo = buildDemoData();
    lastData = demo;
    updateUI(demo);
  }
}

function buildDemoData() {
  return {
    hasSdk: true,
    isOnline: navigator.onLine,
    appId: 'demo-app',
    deviceId: 'dev_abc123_1722700000',
    cachedUrls: ['/', '/index.html', '/css/dashboard.css', '/js/dashboard.js', '/sdk/asg-offline.js', '/sdk/asg-sw.js'],
    posaQueue: [
      { operationId: 'posa_op_abc_1', collection: 'products', action: 'UPDATE', recordId: 'prod_71', status: 'PENDING', priority: 'MEDIUM', retryCount: 0, hlc: '2026-08-03T15:00:00.000Z-0001-dev_abc', payload: { price: 400 }, integration: { isThirdParty: true, urlPattern: 'https://some-shop.com/api/products/:id', method: 'PATCH', authType: 'session_cookie' } },
      { operationId: 'posa_op_xyz_2', collection: 'notes',    action: 'CREATE', recordId: 'note_01', status: 'PENDING', priority: 'LOW',    retryCount: 0, hlc: '2026-08-03T15:01:00.000Z-0001-dev_abc', payload: { title: 'Offline Note', body: 'Written offline' }, integration: null }
    ],
    dlqItems: [
      { operationId: 'posa_op_fail_3', collection: 'orders', action: 'CREATE', recordId: 'ord_99', status: 'DEAD_LETTER', reason: 'Order price cannot be negative.', movedToDlqAt: new Date().toISOString(), payload: { price: -50 } }
    ],
    recLog: [
      { operationId: 'posa_op_done_4', collection: 'products', recordId: 'prod_55', status: 'RECONCILED', reconciledAt: new Date(Date.now() - 120000).toISOString() }
    ],
    adeRoutes: [
      { routeKey: 'GET:https://some-shop.com:/api/products', method: 'GET',   pathname: '/api/products',        origin: 'https://some-shop.com', collection: 'products', offlineMode: 'LOCAL_SAFE', confidence: 90, observationCount: 5, source: 'runtime_observation', integration: { isThirdParty: true } },
      { routeKey: 'PATCH:https://some-shop.com:/api/products/:id', method: 'PATCH', pathname: '/api/products/:id', origin: 'https://some-shop.com', collection: 'products', offlineMode: 'DEFERRED', confidence: 82, observationCount: 3, source: 'runtime_observation', integration: { isThirdParty: true } },
      { routeKey: 'POST:http://localhost:3000:/api/v1/demo-records', method: 'POST', pathname: '/api/v1/demo-records', origin: 'http://localhost:3000', collection: 'demo-records', offlineMode: 'LOCAL_SAFE', confidence: 97, observationCount: 8, source: 'runtime_observation', integration: { isThirdParty: false } },
      { routeKey: 'POST:https://some-shop.com:/api/checkout', method: 'POST', pathname: '/api/checkout', origin: 'https://some-shop.com', collection: 'checkout', offlineMode: 'ONLINE_REQUIRED', confidence: 20, observationCount: 1, source: 'runtime_observation', integration: { isThirdParty: true } }
    ],
    dbRecords: [],
    cacheStrategy: 'stale-while-revalidate',
    swActive: true,
    lastSyncAt: new Date(Date.now() - 300000).toISOString()
  };
}

/* ─────────────────────────────────────────────────────────
   UI UPDATE
───────────────────────────────────────────────────────── */
function updateUI(data) {
  // Header
  const badge = document.getElementById('badge-status');
  if (badge) {
    badge.textContent = data.isOnline ? 'ONLINE' : 'OFFLINE';
    badge.className = `badge ${data.isOnline ? 'online' : 'offline'}`;
  }
  const sdkBadge = document.getElementById('badge-sdk');
  if (sdkBadge) sdkBadge.className = `badge sdk ${data.hasSdk ? 'ready' : ''}`;

  const devEl = document.getElementById('val-device-id');
  if (devEl) devEl.textContent = `device: ${data.deviceId || '—'}`;

  // Overview metrics
  setText('val-app-id',   data.appId || 'demo-app');
  setText('val-net-state',data.isOnline ? 'Connected (Live)' : 'Disconnected (SW Active)');
  setText('val-sw-status',data.swActive ? 'Active / Running' : 'Not Registered');
  setText('val-strategy', data.cacheStrategy || 'stale-while-revalidate');
  setText('val-posa-count', String(data.posaQueue.length));
  setText('val-dlq-count',  String(data.dlqItems.length));
  setText('val-ade-count',  String(data.adeRoutes.length));
  setText('val-rec-count',  String(data.recLog.length));

  // Tab counters
  setText('count-cache', String(data.cachedUrls.length));
  setText('count-queue', String(data.posaQueue.length));
  setText('count-dlq',   String(data.dlqItems.length));
  setText('count-ade',   String(data.adeRoutes.length));
  setText('count-rec',   String(data.recLog.length));

  // Sync router breakdown
  const asgOps    = data.posaQueue.filter(op => !op.integration || !op.integration.isThirdParty).length;
  const replayOps = data.posaQueue.filter(op =>  op.integration &&  op.integration.isThirdParty).length;
  setText('router-asg',       `${asgOps} op${asgOps !== 1 ? 's' : ''} → /api/v1/posa/sync`);
  setText('router-replay',    `${replayOps} op${replayOps !== 1 ? 's' : ''} → original endpoints`);
  setText('router-last-sync', data.lastSyncAt ? timeAgo(data.lastSyncAt) : 'Never');

  // Tabs
  renderCache(data.cachedUrls);
  renderQueue(data.posaQueue);
  renderDLQ(data.dlqItems);
  renderADE(data.adeRoutes);
  renderRecLog(data.recLog);
  renderDB(data.dbRecords);
}

/* ─────────────────────────────────────────────────────────
   TAB RENDERERS
───────────────────────────────────────────────────────── */
function renderCache(urls) {
  const el = document.getElementById('cache-list');
  if (!el) return;
  if (!urls || urls.length === 0) {
    el.innerHTML = `<li class="empty-msg">No assets in Service Worker cache.</li>`;
    return;
  }
  el.innerHTML = urls.map(url => `
    <li class="data-item">
      <span style="color:#a5b4fc;font-family:var(--font-mono)">${escHtml(url)}</span>
      <span style="color:#10b981;font-weight:700;font-size:9px">✓ CACHED</span>
    </li>
  `).join('');
}

function renderQueue(ops) {
  const el = document.getElementById('queue-list');
  if (!el) return;
  if (!ops || ops.length === 0) {
    el.innerHTML = `<div class="empty-msg">✅ No pending POSA operations — queue is empty.</div>`;
    return;
  }
  el.innerHTML = ops.map(op => buildOpCard(op, 'pending')).join('');
}

function renderDLQ(ops) {
  const el = document.getElementById('dlq-list');
  if (!el) return;
  if (!ops || ops.length === 0) {
    el.innerHTML = `<div class="empty-msg">✅ No failed operations — dead-letter queue is clear.</div>`;
    return;
  }
  el.innerHTML = ops.map(op => buildOpCard(op, 'dlq')).join('');
}

function renderADE(routes) {
  const el = document.getElementById('ade-list');
  if (!el) return;
  if (!routes || routes.length === 0) {
    el.innerHTML = `<div class="empty-msg">No API routes discovered yet. Browse the target website to populate this map.</div>`;
    return;
  }

  let filtered = routes;
  if (activeAdeFilter !== 'ALL') {
    if (activeAdeFilter === 'third-party') {
      filtered = routes.filter(r => r.integration && r.integration.isThirdParty);
    } else {
      filtered = routes.filter(r => r.offlineMode === activeAdeFilter);
    }
  }

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-msg">No routes match the selected filter.</div>`;
    return;
  }

  el.innerHTML = filtered.map(route => {
    const isThirdParty = route.integration && route.integration.isThirdParty;
    const confPct = Math.round(route.confidence || 0);
    const confColor = confPct >= 80 ? '#10b981' : confPct >= 50 ? '#f59e0b' : '#f43f5e';
    const modeTag = buildModeTag(route.offlineMode);

    return `
      <div class="ade-card ${isThirdParty ? 'third-party' : ''}">
        <div>
          <span class="ade-method method-${route.method || 'UNKNOWN'}">${route.method || '?'}</span>
        </div>
        <div>
          <div class="ade-path">${escHtml(route.pathname || route.normalizedPath || '/')}</div>
          <div class="ade-origin">${escHtml(route.origin || window.location.origin)}
            ${isThirdParty ? ' <span style="color:#06b6d4;font-weight:700">🌐 3rd party</span>' : ''}
            · obs: ${route.observationCount || 0} · src: ${route.source || '?'}
          </div>
        </div>
        <div class="ade-meta">
          ${modeTag}
          <div class="ade-confidence" style="color:${confColor}">${confPct}%</div>
          <div class="conf-bar-wrap">
            <div class="conf-bar" style="width:${confPct}%;background:${confColor}"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecLog(entries) {
  const el = document.getElementById('rec-list');
  if (!el) return;
  if (!entries || entries.length === 0) {
    el.innerHTML = `<div class="empty-msg">No reconciled records yet.</div>`;
    return;
  }
  el.innerHTML = entries.map(entry => `
    <div class="op-card synced">
      <div class="op-header">
        <span class="op-id">${escHtml(entry.operationId)}</span>
        <span class="op-tag tag-action-CREATE" style="background:rgba(16,185,129,0.2);color:#10b981">✓ RECONCILED</span>
      </div>
      <div class="op-body">
        <div class="op-field"><span class="op-field-key">Collection</span><span class="op-field-val">${escHtml(entry.collection || '—')}</span></div>
        <div class="op-field"><span class="op-field-key">Record ID</span><span class="op-field-val">${escHtml(entry.recordId || '—')}</span></div>
        <div class="op-field"><span class="op-field-key">Reconciled</span><span class="op-field-val">${entry.reconciledAt ? timeAgo(entry.reconciledAt) : '—'}</span></div>
        <div class="op-field"><span class="op-field-key">Source</span><span class="op-field-val">Authoritative Server</span></div>
      </div>
    </div>
  `).join('');
}

function renderDB(records) {
  const el = document.getElementById('db-records-pre');
  if (!el) return;
  el.textContent = JSON.stringify(records || [], null, 2);
}

/* ─────────────────────────────────────────────────────────
   OP CARD BUILDER (shared for queue + DLQ)
───────────────────────────────────────────────────────── */
function buildOpCard(op, type) {
  const isThirdParty = op.integration && op.integration.isThirdParty;
  const actionTag = `<span class="op-tag tag-action-${op.action || 'MUTATION'}">${op.action || 'OP'}</span>`;
  const modeTag   = type === 'dlq'
    ? `<span class="op-tag" style="background:rgba(244,63,94,0.2);color:#f43f5e">☠ DEAD_LETTER</span>`
    : buildModeTag(op.offlineMode || (op.integration ? 'DEFERRED' : 'LOCAL_SAFE'));
  const tpTag = isThirdParty
    ? `<span class="op-tag tag-3p">🌐 3rd party</span>` : '';

  const retryInfo = op.retryCount > 0
    ? `<div class="op-field"><span class="op-field-key">Retries</span><span class="op-field-val" style="color:#f59e0b">${op.retryCount}</span></div>` : '';

  const integInfo = op.integration
    ? `<div class="op-field"><span class="op-field-key">Endpoint</span><span class="op-field-val">${escHtml(op.integration.urlPattern || '—')}</span></div>`
    : `<div class="op-field"><span class="op-field-key">Route</span><span class="op-field-val">ASG server /api/v1/posa/sync</span></div>`;

  const reasonBlock = (type === 'dlq' && op.reason)
    ? `<div class="op-reason">⚠ ${escHtml(op.reason)}</div>` : '';

  const dlqActions = type === 'dlq' ? `
    <div class="op-actions">
      <button class="btn btn-sm btn-warning" onclick="retrySingleOp('${escHtml(op.operationId)}')">↩ Retry</button>
      <button class="btn btn-sm btn-danger"  onclick="discardOp('${escHtml(op.operationId)}')">🗑 Discard</button>
    </div>` : '';

  return `
    <div class="op-card ${type}">
      <div class="op-header">
        <span class="op-id">${escHtml(op.operationId || '—')}</span>
        <div class="op-tags">${actionTag}${modeTag}${tpTag}</div>
      </div>
      <div class="op-body">
        <div class="op-field"><span class="op-field-key">Collection</span><span class="op-field-val">${escHtml(op.collection || '—')}</span></div>
        <div class="op-field"><span class="op-field-key">Record ID</span><span class="op-field-val">${escHtml(String(op.recordId || '—'))}</span></div>
        ${integInfo}
        <div class="op-field"><span class="op-field-key">Priority</span><span class="op-field-val">${op.priority || '—'}</span></div>
        <div class="op-field"><span class="op-field-key">HLC</span><span class="op-field-val">${op.hlc ? op.hlc.substring(0, 32) + '…' : '—'}</span></div>
        <div class="op-field"><span class="op-field-key">Auth</span><span class="op-field-val">${op.integration ? (op.integration.authType || 'session_cookie') : '—'}</span></div>
        ${retryInfo}
      </div>
      ${reasonBlock}
      ${dlqActions}
    </div>
  `;
}

function buildModeTag(mode) {
  const map = {
    'LOCAL_SAFE':      ['tag-mode-LOCAL_SAFE',      '🟢 LOCAL_SAFE'],
    'DEFERRED':        ['tag-mode-DEFERRED',         '🟡 DEFERRED'],
    'ONLINE_REQUIRED': ['tag-mode-ONLINE_REQUIRED',  '🔴 ONLINE_REQUIRED']
  };
  const [cls, label] = map[mode] || ['', mode || '?'];
  return `<span class="op-tag ${cls}">${label}</span>`;
}

/* ─────────────────────────────────────────────────────────
   ACTIONS
───────────────────────────────────────────────────────── */
function evalInPage(code, cb) {
  if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.inspectedWindow) {
    chrome.devtools.inspectedWindow.eval(code, (result, isException) => {
      if (!isException && cb) cb(result);
      setTimeout(refresh, 600);
    });
  } else {
    if (cb) cb(null);
    setTimeout(refresh, 600);
  }
}

function forcePOSASync() {
  evalInPage(`
    if (window.ASGOffline) {
      window.ASGOffline.processPOSAQueue();
      localStorage.setItem('asg_last_sync_at', new Date().toISOString());
    }
  `);
}

function forceASEEval() {
  evalInPage(`
    if (window.ASGOffline && window.ASGOffline.triggerASESync) {
      window.ASGOffline.triggerASESync();
    }
  `);
}

let simOffline = false;
function toggleSimOffline() {
  simOffline = !simOffline;
  const btn = document.getElementById('btn-sim-offline');
  if (btn) btn.textContent = simOffline ? '🟢 Restore Online' : '🔌 Simulate Offline';
  evalInPage(simOffline
    ? `window.dispatchEvent(new Event('offline')); console.log('[ASG DevTools] Simulated OFFLINE');`
    : `window.dispatchEvent(new Event('online'));  console.log('[ASG DevTools] Restored ONLINE');`
  );
}

function clearCache() {
  evalInPage(`if (window.ASGOffline) window.ASGOffline.clearCache();`, () => {
    showAlert('Cache storage cleared.');
  });
}

function retryDLQ() {
  evalInPage(`
    (async () => {
      if (!window.ASGOffline || !window.ASGOffline.db) return;
      const sdk = window.ASGOffline;
      const dlq = await new Promise(res => {
        const tx = sdk.db.transaction(['posa_dlq', 'posa_queue'], 'readwrite');
        const dlqStore = tx.objectStore('posa_dlq');
        const queueStore = tx.objectStore('posa_queue');
        const req = dlqStore.getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          items.forEach(op => {
            const restored = { ...op, status: 'PENDING', retryCount: 0, lastRetryTimestamp: null };
            delete restored.reason;
            delete restored.movedToDlqAt;
            queueStore.put(restored);
            dlqStore.delete(op.operationId);
          });
          res(items.length);
        };
      });
      sdk.triggerASESync();
    })();
  `, () => showAlert('DLQ operations moved back to POSA queue and retrying...'));
}

function clearDLQ() {
  if (!confirm('Discard all dead-letter operations? This cannot be undone.')) return;
  evalInPage(`
    (async () => {
      if (!window.ASGOffline || !window.ASGOffline.db) return;
      const tx = window.ASGOffline.db.transaction(['posa_dlq'], 'readwrite');
      tx.objectStore('posa_dlq').clear();
    })();
  `, () => showAlert('Dead-letter queue cleared.'));
}

function retrySingleOp(opId) {
  evalInPage(`
    (async () => {
      if (!window.ASGOffline || !window.ASGOffline.db) return;
      const sdk = window.ASGOffline;
      const tx = sdk.db.transaction(['posa_dlq', 'posa_queue'], 'readwrite');
      const dlqStore = tx.objectStore('posa_dlq');
      const queueStore = tx.objectStore('posa_queue');
      const req = dlqStore.get('${opId}');
      req.onsuccess = () => {
        if (!req.result) return;
        const op = { ...req.result, status: 'PENDING', retryCount: 0, lastRetryTimestamp: null };
        delete op.reason; delete op.movedToDlqAt;
        queueStore.put(op);
        dlqStore.delete('${opId}');
      };
      tx.oncomplete = () => sdk.triggerASESync();
    })();
  `);
}

function discardOp(opId) {
  if (!confirm('Discard this dead-letter operation?')) return;
  evalInPage(`
    (async () => {
      if (!window.ASGOffline || !window.ASGOffline.db) return;
      const tx = window.ASGOffline.db.transaction(['posa_dlq'], 'readwrite');
      tx.objectStore('posa_dlq').delete('${opId}');
    })();
  `);
}

function syncADEToServer() {
  evalInPage(`
    if (window.ASGOffline && window.ASGOffline._syncManifestToServer) {
      window.ASGOffline._syncManifestToServer();
    }
  `, () => showAlert('ADE manifest pushed to server.'));
}

function clearADE() {
  if (!confirm('Clear the entire ADE Integration Map? The page must reload to rebuild it.')) return;
  evalInPage(`
    (async () => {
      if (!window.ASGOffline) return;
      window.ASGOffline.discoveredRoutes.clear();
      window.ASGOffline.registeredRoutes.clear();
      if (window.ASGOffline.db) {
        const tx = window.ASGOffline.db.transaction(['api_manifest'], 'readwrite');
        tx.objectStore('api_manifest').clear();
      }
    })();
  `, () => showAlert('ADE Integration Map cleared.'));
}

/* ─────────────────────────────────────────────────────────
   UTILS
───────────────────────────────────────────────────────── */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(isoStr) {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60)  return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

function showAlert(msg) {
  // Small non-blocking toast in panel
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;bottom:14px;left:50%;transform:translateX(-50%);
    background:#1e293b;color:#f8fafc;padding:8px 16px;border-radius:20px;
    border:1px solid rgba(99,102,241,0.4);font-size:11px;font-weight:600;
    z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.5);
    animation:fadeIn 0.2s ease;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
