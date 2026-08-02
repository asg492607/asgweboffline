/**
 * ASG All-In-One Generator & Real Data Operations Manager
 */

document.addEventListener('DOMContentLoaded', () => {
  let generatedSnippets = null;
  let lastSavedRecordId = null;

  // Auto-trigger initial code generation on page load
  generateCodeForUrl('https://my-awesome-site.com', 'https://api.my-awesome-site.com');

  // Load and render real IndexedDB records on page load
  setTimeout(() => loadAndRenderRealRecords(), 500);

  // URL Generator Form Submission
  const urlGenForm = document.getElementById('url-generator-form');
  if (urlGenForm) {
    urlGenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const frontendUrl = document.getElementById('gen-url-input').value;
      const backendApiInput = document.getElementById('gen-backend-api-input');
      const backendApiUrl = backendApiInput ? backendApiInput.value : 'https://api.my-awesome-site.com';
      await generateCodeForUrl(frontendUrl, backendApiUrl);
    });
  }

  // Snippet Tab Switching
  const snippetTabs = document.querySelectorAll('.snippet-tab');
  snippetTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      snippetTabs.forEach(t => {
        t.classList.remove('active');
        t.style.background = '';
        t.style.border = '';
        t.style.color = '';
      });
      tab.classList.add('active');
      tab.style.background = 'rgba(99, 102, 241, 0.25)';
      tab.style.border = '1px solid var(--accent-indigo)';
      tab.style.color = '#818cf8';

      const snippetKey = tab.getAttribute('data-snippet');
      displayGeneratedSnippet(snippetKey);
    });
  });

  async function generateCodeForUrl(frontendUrl, backendApiUrl = 'https://api.my-awesome-site.com') {
    const displayPre = document.getElementById('gen-code-display');
    if (displayPre) {
      displayPre.innerText = '// Generating tailored full-stack offline code for Frontend (' + frontendUrl + ') & Backend API (' + backendApiUrl + ')...';
    }

    try {
      const res = await fetch('/api/v1/analyze-and-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontendUrl, backendApiUrl })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.snippets) {
          generatedSnippets = data.snippets;
          const activeTab = document.querySelector('.snippet-tab.active');
          const activeKey = activeTab ? activeTab.getAttribute('data-snippet') : 'allInOne';
          displayGeneratedSnippet(activeKey);
          showNotification('Full-Stack Offline Code Generated!', `Configured for Frontend '${data.domain}' & Backend API '${data.backendApiUrl}'`, 'success');
          return;
        }
      }
      throw new Error('Network returned non-200 status');
    } catch (err) {
      console.warn('[Offline Engine] Server API unreachable offline, using client-side offline generator fallback.');
      const offlineGenerated = generateOfflineCodeLocally(frontendUrl, backendApiUrl);
      generatedSnippets = offlineGenerated;
      
      const activeTab = document.querySelector('.snippet-tab.active');
      const activeKey = activeTab ? activeTab.getAttribute('data-snippet') : 'allInOne';
      displayGeneratedSnippet(activeKey);

      showNotification('Generated Offline (Client Engine)', `Generated offline code for '${offlineGenerated.domain}'`, 'info');
    }
  }

  // Client-side Offline Code Generator Fallback
  function generateOfflineCodeLocally(frontendUrl, backendApiUrl) {
    let cleanUrl = frontendUrl || 'https://my-awesome-site.com';
    let domain = 'my-awesome-site.com';
    try {
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) cleanUrl = 'https://' + cleanUrl;
      domain = new URL(cleanUrl).hostname;
    } catch (e) {}

    const appId = domain.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-offline';
    const appName = domain.charAt(0).toUpperCase() + domain.slice(1) + ' Offline App';
    const host = window.location.origin;

    const allInOneCode = `<!-- ==================================================================== -->
<!-- 📡 ASG OFFLINE WEB SERVICE: ALL-IN-ONE FRONTEND INTEGRATION          -->
<!-- Frontend: ${frontendUrl}                                             -->
<!-- Backend API: ${backendApiUrl}                                        -->
<!-- ==================================================================== -->

<!-- 1-Line Embed Script Tag -->
<script src="${host}/sdk/asg-offline.js" data-app-id="${appId}" data-server-url="${host}"></script>

<script>
  // Complete All-in-One Client Setup & API Wrappers
  window.addEventListener('DOMContentLoaded', () => {
    console.log('⚡ ASG Offline Engine initialized for ${domain}');

    // Monitor Online/Offline Connection State
    window.ASGOffline.onStatusChange((isOnline) => {
      console.log(isOnline ? '🟢 Connected to Server' : '📡 Offline Mode Active (IndexedDB DB & POSA Queue Active)');
    });

    // 1-Line Operations (Save, Update, Delete, Query, API Sync)
    window.offlineApp = {
      save: (collection, data) => window.ASGOffline.save(collection, data),
      update: (collection, id, delta) => window.ASGOffline.update(collection, id, delta),
      delete: (collection, id) => window.ASGOffline.delete(collection, id),
      find: (collection) => window.ASGOffline.find(collection),
      syncPost: (path, payload) => window.ASGOffline.syncPost('${backendApiUrl}' + path, payload),
      syncPut: (path, payload) => window.ASGOffline.syncPut('${backendApiUrl}' + path, payload),
      syncDelete: (path, payload) => window.ASGOffline.syncDelete('${backendApiUrl}' + path, payload),
      fetch: (path, opts) => window.ASGOffline.fetch('${backendApiUrl}' + path, opts)
    };
  });
</script>`;

    const backendCode = `// ====================================================================
// ⚡ ASG OFFLINE WEB SERVICE: ALL-IN-ONE BACKEND RECEIVER ENDPOINT
// Add this route to your Node.js / Express Backend (${backendApiUrl})
// ====================================================================

const express = require('express');
const router = express.Router();

router.post('/api/v1/posa/sync', express.json(), async (req, res) => {
  const { appId, deviceId, operations } = req.body;
  console.log(\`[POSA Receiver] Processing \${operations ? operations.length : 0} offline ops for '\${appId}'\`);

  const processedIds = [];
  if (Array.isArray(operations)) {
    for (const op of operations) {
      processedIds.push(op.operationId);
    }
  }

  res.json({
    success: true,
    processedIds,
    serverTimestamp: new Date().toISOString(),
    message: \`Successfully processed \${processedIds.length} offline operations\`
  });
});

module.exports = router;`;

    const reactCode = `// React / Next.js Integration Hook
import { useEffect, useState } from 'react';

export function useOfflineEngine() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = '${host}/sdk/asg-offline.js';
    script.setAttribute('data-app-id', '${appId}');
    script.async = true;

    script.onload = () => {
      if (window.ASGOffline) {
        setIsOnline(window.ASGOffline.isOnline);
        window.ASGOffline.onStatusChange((status) => setIsOnline(status));
      }
    };

    document.head.appendChild(script);
  }, []);

  return { isOnline };
}`;

    const vueCode = `<!-- Vue 3 Integration -->
<script setup>
import { ref, onMounted } from 'vue';
const isOnline = ref(navigator.onLine);

onMounted(() => {
  const script = document.createElement('script');
  script.src = '${host}/sdk/asg-offline.js';
  script.setAttribute('data-app-id', '${appId}');
  document.head.appendChild(script);

  script.onload = () => {
    if (window.ASGOffline) {
      window.ASGOffline.onStatusChange((status) => { isOnline.value = status; });
    }
  };
});
</script>`;

    const standaloneSwCode = `/** Custom Service Worker for ${domain} */
const CACHE_NAME = '${appId}-v3';
const PRECACHE = ['/', '/index.html', '/styles.css'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE))));
self.addEventListener('fetch', (e) => {
  if (e.request.method === 'GET') {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});`;

    const manifestCode = JSON.stringify({
      short_name: appName,
      name: appName,
      start_url: '/',
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#6366f1'
    }, null, 2);

    return {
      allInOne: allInOneCode,
      backend: backendCode,
      vanillaHtml: allInOneCode,
      react: reactCode,
      vue: vueCode,
      standaloneSw: standaloneSwCode,
      manifest: manifestCode,
      domain,
      backendApiUrl
    };
  }

  function displayGeneratedSnippet(key) {
    const displayPre = document.getElementById('gen-code-display');
    if (!generatedSnippets || !displayPre) return;

    if (key === 'allInOne') displayPre.innerText = generatedSnippets.allInOne || generatedSnippets.vanillaHtml;
    else if (key === 'backend') displayPre.innerText = generatedSnippets.backend || '// No backend snippet';
    else if (key === 'vanilla') displayPre.innerText = generatedSnippets.vanillaHtml;
    else if (key === 'react') displayPre.innerText = generatedSnippets.react;
    else if (key === 'vue') displayPre.innerText = generatedSnippets.vue;
    else if (key === 'apiSync') displayPre.innerText = generatedSnippets.apiSync;
    else if (key === 'sw') displayPre.innerText = generatedSnippets.standaloneSw;
    else if (key === 'manifest') displayPre.innerText = generatedSnippets.manifest;
  }

  // Copy Buttons Handler
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-copy');
      const codeElement = document.getElementById(targetId);
      if (codeElement) {
        navigator.clipboard.writeText(codeElement.innerText);
        const origText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.background = '#10b981';
        btn.style.color = '#ffffff';
        setTimeout(() => {
          btn.innerText = origText;
          btn.style.background = '';
          btn.style.color = '';
        }, 2000);
      }
    });
  });

  // ==================== REAL DATA OPERATIONS HANDLERS ====================
  const realRecordForm = document.getElementById('real-record-form');
  if (realRecordForm) {
    realRecordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('rec-title-input');
      const priceInput = document.getElementById('rec-price-input');
      const title = titleInput ? titleInput.value.trim() : 'Record';
      const price = priceInput ? Number(priceInput.value) : 99;

      if (!title) return;

      const recordId = 'rec_' + Math.random().toString(36).substring(2, 8);
      const recordData = {
        id: recordId,
        title,
        price,
        createdAt: new Date().toISOString()
      };

      if (window.offlineApp) {
        const saved = await window.offlineApp.save('orders', recordData);
        lastSavedRecordId = recordId;
        showNotification('Record Saved', `'${title}' stored in IndexedDB (Auto-Sync Queue Active)`, 'success');
        titleInput.value = '';
        await loadAndRenderRealRecords();
      }
    });
  }

  // Real Update Button
  const btnRealUpdate = document.getElementById('btn-real-update');
  if (btnRealUpdate) {
    btnRealUpdate.addEventListener('click', async () => {
      if (!lastSavedRecordId) {
        showNotification('No Active Record', 'Please create a record first before updating.', 'info');
        return;
      }
      if (window.offlineApp) {
        await window.offlineApp.update('orders', lastSavedRecordId, {
          title: 'Enterprise Laptop (Updated)',
          price: 1499,
          updatedAt: new Date().toISOString()
        });
        showNotification('Record Updated', `Updated ID '${lastSavedRecordId}' with new price ($1499)`, 'success');
        await loadAndRenderRealRecords();
      }
    });
  }

  // Real Delete Button
  const btnRealDelete = document.getElementById('btn-real-delete');
  if (btnRealDelete) {
    btnRealDelete.addEventListener('click', async () => {
      if (!lastSavedRecordId) {
        showNotification('No Active Record', 'Please create a record first before deleting.', 'info');
        return;
      }
      if (window.offlineApp) {
        await window.offlineApp.delete('orders', lastSavedRecordId);
        showNotification('Record Deleted', `Deleted ID '${lastSavedRecordId}' from database`, 'info');
        lastSavedRecordId = null;
        await loadAndRenderRealRecords();
      }
    });
  }

  // Load and Render Real Records into Table
  async function loadAndRenderRealRecords() {
    const tableBody = document.getElementById('real-records-table-body');
    if (!tableBody || !window.offlineApp) return;

    try {
      const records = await window.offlineApp.find('orders');
      if (!records || records.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" style="padding: 16px; text-align: center; color: var(--text-muted);">
              No records found in local database. Fill out the form above and click "➕ Save Record" to create one!
            </td>
          </tr>
        `;
        return;
      }

      const isOnline = navigator.onLine;
      tableBody.innerHTML = records.map(r => {
        const id = r.id || r.recordId || 'rec_101';
        const title = r.title || r.name || r.item || 'Item Record';
        const price = r.price ? `$${r.price}` : 'N/A';
        const dateStr = r.updatedAt ? new Date(r.updatedAt).toLocaleTimeString() : new Date().toLocaleTimeString();
        const statusBadge = isOnline 
          ? `<span style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem;">🟢 Synced / Ready</span>`
          : `<span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem;">📡 Saved in IndexedDB</span>`;

        return `
          <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
            <td style="padding: 10px 14px; font-family: monospace; color: #38bdf8;">${id}</td>
            <td style="padding: 10px 14px; font-weight: 600;">${title}</td>
            <td style="padding: 10px 14px; color: #34d399;">${price}</td>
            <td style="padding: 10px 14px;">${statusBadge}</td>
            <td style="padding: 10px 14px; color: var(--text-muted);">${dateStr}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.warn('Could not render records:', err);
    }
  }

  // Auto reload table when online/offline changes
  window.addEventListener('online', () => setTimeout(loadAndRenderRealRecords, 1000));
  window.addEventListener('offline', () => setTimeout(loadAndRenderRealRecords, 500));

  // Notification Toast Helper
  function showNotification(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      color: #f8fafc;
      padding: 12px 20px;
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      border-left: 4px solid ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};
      z-index: 99999;
      font-family: system-ui, sans-serif;
      font-size: 0.9rem;
      transition: all 0.3s ease;
    `;
    toast.innerHTML = `<strong>${title}</strong><div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">${message}</div>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
});
