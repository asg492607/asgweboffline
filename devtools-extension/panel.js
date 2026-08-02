/**
 * ASG Offline DevTools Panel Interactivity
 */

document.addEventListener('DOMContentLoaded', () => {
  // Tab Switching
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.getElementById(target).classList.add('active');
    });
  });

  // Refresh Button
  document.getElementById('btn-refresh').addEventListener('click', inspectCurrentTab);
  document.getElementById('btn-clear-cache-tab').addEventListener('click', clearCacheStorage);
  document.getElementById('btn-clear-sw-cache').addEventListener('click', clearCacheStorage);
  document.getElementById('btn-flush-queue').addEventListener('click', flushQueue);

  // Initial Load
  inspectCurrentTab();
  setInterval(inspectCurrentTab, 3000);
});

function inspectCurrentTab() {
  const code = `
    (async function() {
      const isOnline = navigator.onLine;
      const hasSdk = typeof window.ASGOffline !== 'undefined';
      const appId = hasSdk ? window.ASGOffline.appId : 'Unknown';

      let cachedUrls = [];
      if (hasSdk && window.ASGOffline.getCachedUrls) {
        try { cachedUrls = await window.ASGOffline.getCachedUrls(); } catch(e){}
      }

      let queuedItems = [];
      if (hasSdk) {
        try {
          const recs = window.ASGOffline.database ? await window.ASGOffline.database.getAll('offline_records') : [];
          const posa = window.ASGOffline.getPOSAQueue ? await window.ASGOffline.getPOSAQueue() : [];
          queuedItems = [...recs, ...posa];
        } catch(e){}
      }

      return {
        isOnline,
        hasSdk,
        appId,
        cachedCount: cachedUrls.length,
        cachedUrls,
        queuedCount: queuedItems.length,
        queuedItems
      };
    })();
  `;

  if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.inspectedWindow) {
    chrome.devtools.inspectedWindow.eval(code, (result, isException) => {
      if (isException || !result) {
        return;
      }
      updateUi(result);
    });
  } else {
    // Demo Mock Fallback when opened standalone
    updateUi({
      isOnline: navigator.onLine,
      hasSdk: true,
      appId: 'demo-app',
      cachedCount: 6,
      cachedUrls: ['/', '/index.html', '/css/dashboard.css', '/js/dashboard.js', '/sdk/asg-offline.js', '/sdk/asg-sw.js'],
      queuedCount: 0,
      queuedItems: []
    });
  }
}

function updateUi(data) {
  const badge = document.getElementById('badge-status');
  if (badge) {
    badge.innerText = data.isOnline ? 'ONLINE' : 'OFFLINE';
    badge.className = `badge ${data.isOnline ? 'online' : 'offline'}`;
  }

  document.getElementById('val-app-id').innerText = data.appId || 'demo-app';
  document.getElementById('val-net-state').innerText = data.isOnline ? 'Connected (Live Network)' : 'Disconnected (Offline SW Active)';
  document.getElementById('count-cache').innerText = data.cachedCount || 0;
  document.getElementById('count-queue').innerText = data.queuedCount || 0;

  // Render Cache List
  const cacheList = document.getElementById('cache-list');
  if (cacheList) {
    if (!data.cachedUrls || data.cachedUrls.length === 0) {
      cacheList.innerHTML = `<li class="empty-msg">No assets currently cached in Service Worker.</li>`;
    } else {
      cacheList.innerHTML = data.cachedUrls.map(url => `
        <li class="data-item">
          <span>${url}</span>
          <span style="color: #10b981; font-weight: bold;">Cached</span>
        </li>
      `).join('');
    }
  }

  // Render Queue / DB List
  const dbPre = document.getElementById('db-records-pre');
  if (dbPre) {
    dbPre.innerText = JSON.stringify(data.queuedItems || [], null, 2);
  }
}

function clearCacheStorage() {
  const code = `
    if (window.ASGOffline) {
      window.ASGOffline.clearCache();
    }
  `;
  if (typeof chrome !== 'undefined' && chrome.devtools) {
    chrome.devtools.inspectedWindow.eval(code, () => {
      alert('Cache storage cleared!');
      inspectCurrentTab();
    });
  }
}

function flushQueue() {
  const code = `
    if (window.ASGOffline && window.ASGOffline.processOfflineQueue) {
      window.ASGOffline.processOfflineQueue();
    }
  `;
  if (typeof chrome !== 'undefined' && chrome.devtools) {
    chrome.devtools.inspectedWindow.eval(code, () => {
      alert('Offline queue flushed and synchronized!');
      inspectCurrentTab();
    });
  }
}
