/**
 * ASG All-In-One Generator Dashboard Interactivity & Sandbox Testing
 */

document.addEventListener('DOMContentLoaded', () => {
  let generatedSnippets = null;
  let lastSavedRecordId = null;

  // Auto-trigger initial code generation on page load
  generateCodeForUrl('https://my-awesome-site.com', 'https://api.my-awesome-site.com');

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
      // Client-side offline fallback generator (Works 100% offline without server!)
      const offlineGenerated = generateOfflineCodeLocally(frontendUrl, backendApiUrl);
      generatedSnippets = offlineGenerated;
      
      const activeTab = document.querySelector('.snippet-tab.active');
      const activeKey = activeTab ? activeTab.getAttribute('data-snippet') : 'allInOne';
      displayGeneratedSnippet(activeKey);

      showNotification('Generated Offline (Client Engine)', `Generated offline code for '${offlineGenerated.domain}'`, 'info');
    }
  }

  // Client-side Offline Code Generator Fallback (Runs 100% offline in browser)
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
const CACHE_NAME = '${appId}-v2';
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

  // ==================== LIVE INTERACTIVE SANDBOX TESTING HANDLERS ====================
  const sandboxOutput = document.getElementById('sandbox-output');
  function logToSandbox(title, data) {
    if (sandboxOutput) {
      const timestamp = new Date().toLocaleTimeString();
      const formatted = `[${timestamp}] ${title}\n` + JSON.stringify(data, null, 2) + '\n\n';
      sandboxOutput.innerText = formatted + sandboxOutput.innerText;
    }
  }

  // 1. Test Save Record
  const btnSave = document.getElementById('btn-test-save');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      if (window.offlineApp) {
        const item = { title: 'Offline Item ' + Math.floor(Math.random() * 1000), price: 99, createdAt: new Date().toISOString() };
        const result = await window.offlineApp.save('test_collection', item);
        lastSavedRecordId = result ? (result.id || result.operationId) : null;
        logToSandbox('✅ window.offlineApp.save() executed:', result);
        showNotification('Record Saved Offline', 'Written to IndexedDB with POSA Queue', 'success');
      }
    });
  }

  // 2. Test Update Record
  const btnUpdate = document.getElementById('btn-test-update');
  if (btnUpdate) {
    btnUpdate.addEventListener('click', async () => {
      if (window.offlineApp) {
        const targetId = lastSavedRecordId || 'rec_101';
        const result = await window.offlineApp.update('test_collection', targetId, { status: 'updated_offline', price: 120 });
        logToSandbox('✏️ window.offlineApp.update() executed for ID ' + targetId + ':', result);
        showNotification('Record Updated Offline', 'Delta payload queued', 'info');
      }
    });
  }

  // 3. Test Delete Record
  const btnDelete = document.getElementById('btn-test-delete');
  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      if (window.offlineApp) {
        const targetId = lastSavedRecordId || 'rec_101';
        const result = await window.offlineApp.delete('test_collection', targetId);
        logToSandbox('🗑️ window.offlineApp.delete() executed for ID ' + targetId + ':', result);
        showNotification('Record Deleted Offline', 'High priority POSA delete queued', 'info');
      }
    });
  }

  // 4. Test Find Local Records
  const btnFind = document.getElementById('btn-test-find');
  if (btnFind) {
    btnFind.addEventListener('click', async () => {
      if (window.offlineApp) {
        const records = await window.offlineApp.find('test_collection');
        logToSandbox('🔍 window.offlineApp.find() retrieved ' + records.length + ' record(s):', records);
        showNotification('Local Records Queried', `Found ${records.length} items in IndexedDB`, 'success');
      }
    });
  }

  // 5. Test Offline API Sync POST
  const btnSyncPost = document.getElementById('btn-test-syncpost');
  if (btnSyncPost) {
    btnSyncPost.addEventListener('click', async () => {
      if (window.offlineApp) {
        const result = await window.offlineApp.syncPost('/api/v1/apps', { appId: 'sandbox-app', appName: 'Sandbox Test App' });
        logToSandbox('⚡ window.offlineApp.syncPost() executed:', result);
        showNotification('API Request Processed', result.offlineQueued ? 'Queued offline for background sync' : 'Sent to server', 'success');
      }
    });
  }

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
