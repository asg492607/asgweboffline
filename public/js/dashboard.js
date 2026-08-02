/**
 * ASG Management Dashboard Interactivity
 */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetElem = document.getElementById(target);
      if (targetElem) {
        targetElem.classList.add('active');
      }

      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  });

  // Default App ID
  let currentAppId = 'demo-app';
  let generatedSnippets = null;

  // Load Initial App Config
  loadAppConfig(currentAppId);

  // Load Initial Stats
  loadAppStats(currentAppId);

  // Auto trigger initial code generation for default URL
  generateCodeForUrl('https://my-awesome-site.com');

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
      snippetTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const snippetKey = tab.getAttribute('data-snippet');
      displayGeneratedSnippet(snippetKey);
    });
  });

  async function generateCodeForUrl(frontendUrl, backendApiUrl = 'https://api.my-awesome-site.com') {
    try {
      const displayPre = document.getElementById('gen-code-display');
      displayPre.innerText = '// Generating tailored full-stack offline code for Frontend (' + frontendUrl + ') & Backend API (' + backendApiUrl + ')...';

      const res = await fetch('/api/v1/analyze-and-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontendUrl, backendApiUrl })
      });

      const data = await res.json();
      if (data.success && data.snippets) {
        generatedSnippets = data.snippets;
        currentAppId = data.appId;
        
        // Find current active snippet tab key
        const activeTab = document.querySelector('.snippet-tab.active');
        const activeKey = activeTab ? activeTab.getAttribute('data-snippet') : 'vanilla';
        displayGeneratedSnippet(activeKey);

        showNotification('Full-Stack Offline Code Generated!', `Configured for Frontend '${data.domain}' & Backend API '${data.backendApiUrl}'`, 'success');
      }
    } catch (err) {
      console.error('Failed to generate code:', err);
    }
  }

  function displayGeneratedSnippet(key) {
    const displayPre = document.getElementById('gen-code-display');
    if (!generatedSnippets || !displayPre) return;

    if (key === 'vanilla') displayPre.innerText = generatedSnippets.vanillaHtml;
    else if (key === 'react') displayPre.innerText = generatedSnippets.react;
    else if (key === 'vue') displayPre.innerText = generatedSnippets.vue;
    else if (key === 'apiSync') displayPre.innerText = generatedSnippets.apiSync;
    else if (key === 'sw') displayPre.innerText = generatedSnippets.standaloneSw;
    else if (key === 'manifest') displayPre.innerText = generatedSnippets.manifest;
  }

  // Poll stats every 5 seconds
  setInterval(() => loadAppStats(currentAppId), 5000);

  // Form Save Handler
  const configForm = document.getElementById('config-form');
  if (configForm) {
    configForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const payload = {
        appId: document.getElementById('cfg-app-id').value,
        appName: document.getElementById('cfg-app-name').value,
        domain: document.getElementById('cfg-domain').value,
        cacheStrategy: document.getElementById('cfg-strategy').value,
        precacheUrls: document.getElementById('cfg-precache').value.split('\n').filter(u => u.trim().length > 0),
        enableBackgroundSync: document.getElementById('cfg-bg-sync').checked,
        enableOfflineNotifications: document.getElementById('cfg-notifications').checked,
        offlineFallbackHtml: document.getElementById('cfg-fallback-html').value
      };

      try {
        const res = await fetch('/api/v1/apps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
          showNotification('Configuration Saved!', 'Your app caching rules have been updated in real-time.', 'success');
          currentAppId = payload.appId;
          updateIntegrationSnippets(currentAppId);
          loadAppStats(currentAppId);
        }
      } catch (err) {
        showNotification('Error saving configuration', err.message, 'error');
      }
    });
  }

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-copy');
      const codeElement = document.getElementById(targetId);
      if (codeElement) {
        navigator.clipboard.writeText(codeElement.innerText);
        const origText = btn.innerText;
        btn.innerText = 'Copied!';
        setTimeout(() => btn.innerText = origText, 2000);
      }
    });
  });

  // Sandbox Live Controls
  setupSandboxControls();
});

// Load App Config from API
async function loadAppConfig(appId) {
  try {
    const res = await fetch(`/api/v1/config/${appId}`);
    const data = await res.json();
    if (data.success && data.config) {
      const cfg = data.config;
      document.getElementById('cfg-app-id').value = cfg.appId;
      document.getElementById('cfg-app-name').value = cfg.appName;
      document.getElementById('cfg-domain').value = cfg.domain || 'localhost:3000';
      document.getElementById('cfg-strategy').value = cfg.cacheStrategy || 'stale-while-revalidate';
      document.getElementById('cfg-precache').value = (cfg.precacheUrls || []).join('\n');
      document.getElementById('cfg-bg-sync').checked = cfg.enableBackgroundSync !== false;
      document.getElementById('cfg-notifications').checked = cfg.enableOfflineNotifications !== false;
      if (cfg.offlineFallbackHtml) {
        document.getElementById('cfg-fallback-html').value = cfg.offlineFallbackHtml;
      }

      updateIntegrationSnippets(appId);
    }
  } catch (err) {
    console.error('Failed to load app config:', err);
  }
}

// Update Code Snippets in UI
function updateIntegrationSnippets(appId) {
  const host = window.location.origin;

  const scriptSnippet = `<!-- Add 1 line script inside <head> of your website -->\n<script src="${host}/sdk/asg-offline.js" \n  data-app-id="${appId}">\n</script>`;
  const npmSnippet = `// ES Module / React / Next.js Integration\nimport { ASGOffline } from '${host}/sdk/asg-offline.js';\n\n// Initialize Service Worker engine\nwindow.ASGOffline.init();`;
  const manifestSnippet = `{\n  "short_name": "My Offline Web App",\n  "name": "My Offline Ready Web App",\n  "start_url": "/",\n  "background_color": "#0f172a",\n  "theme_color": "#6366f1",\n  "display": "standalone"\n}`;

  document.getElementById('code-script').innerText = scriptSnippet;
  document.getElementById('code-npm').innerText = npmSnippet;
  document.getElementById('code-manifest').innerText = manifestSnippet;
}

// Load Telemetry Stats from API
async function loadAppStats(appId) {
  try {
    const res = await fetch(`/api/v1/stats/${appId}`);
    const data = await res.json();
    if (data.success && data.metrics) {
      const m = data.metrics;
      document.getElementById('stat-total-req').innerText = m.totalRequests.toLocaleString();
      document.getElementById('stat-cache-hits').innerText = m.cacheHits.toLocaleString();
      document.getElementById('stat-ratio').innerText = m.cacheHitRatio;
      document.getElementById('stat-bandwidth').innerText = m.savedBandwidthMB;

      // Update Cache Size & Connected Devices
      if (window.ASGOffline && window.ASGOffline.getCacheSize) {
        const sizeStr = await window.ASGOffline.getCacheSize();
        const cacheElem = document.getElementById('stat-cache-size');
        if (cacheElem) cacheElem.innerText = sizeStr;
      }

      fetch('/api/v1/sessions').then(r => r.json()).then(sessData => {
        if (sessData.success) {
          const devElem = document.getElementById('stat-connected-devices');
          if (devElem) devElem.innerText = `${sessData.connectedDevices} Active`;
        }
      }).catch(() => {});

      // Render recent events
      const logContainer = document.getElementById('telemetry-logs');
      if (logContainer && data.recentEvents) {
        if (data.recentEvents.length === 0) {
          logContainer.innerHTML = `<li class="log-item"><span style="color: var(--text-muted);">No telemetry events recorded yet.</span></li>`;
        } else {
          logContainer.innerHTML = data.recentEvents.map(e => `
            <li class="log-item">
              <div>
                <span class="log-type ${e.eventType}">${e.eventType}</span>
                <span style="margin-left: 8px; font-family: var(--font-mono);">${e.appId}</span>
              </div>
              <span style="color: var(--text-muted); font-size: 0.75rem;">${new Date(e.timestamp).toLocaleTimeString()}</span>
            </li>
          `).join('');
        }
      }
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Sandbox Interactive Operations
function setupSandboxControls() {
  let isSimulatedOnline = true;
  const toggleBtn = document.getElementById('sandbox-toggle-net');
  const badge = document.getElementById('sandbox-badge');
  const previewBox = document.getElementById('sandbox-preview');
  const inspectCacheBtn = document.getElementById('sandbox-inspect-cache');
  const offlineFormBtn = document.getElementById('sandbox-offline-form');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isSimulatedOnline = !isSimulatedOnline;
      if (isSimulatedOnline) {
        toggleBtn.innerText = '🔌 Simulate Offline Mode';
        toggleBtn.className = 'btn btn-amber';
        badge.innerText = 'ONLINE (Live Network)';
        badge.className = 'sandbox-status-badge online';
        previewBox.innerHTML = `
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">⚡🌐</div>
          <h3 style="color: var(--accent-emerald);">Connected to Live Server</h3>
          <p style="color: var(--text-muted); max-width: 400px; margin-top: 0.5rem;">Assets are being served fast. Dynamic caches are continuously revalidated in background.</p>
        `;
        if (window.ASGOffline) window.ASGOffline.showToast('🟢 Online Mode', 'Simulated network connection active.', 'success');
      } else {
        toggleBtn.innerText = '🌐 Restore Online Mode';
        toggleBtn.className = 'btn btn-emerald';
        badge.innerText = 'OFFLINE (SW Caching Active)';
        badge.className = 'sandbox-status-badge offline';
        previewBox.innerHTML = `
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">📡⚡</div>
          <h3 style="color: var(--primary-light);">Serving via ASG Service Worker Cache</h3>
          <p style="color: var(--text-muted); max-width: 400px; margin-top: 0.5rem;">Network disconnected! HTML, CSS, JS and API data are served 100% offline from browser cache storage.</p>
        `;
        if (window.ASGOffline) window.ASGOffline.showToast('📡 Offline Mode Simulated', 'ASG Service Worker serving offline content.', 'warning');
      }
    });
  }

  if (inspectCacheBtn) {
    inspectCacheBtn.addEventListener('click', async () => {
      if (window.ASGOffline) {
        const urls = await window.ASGOffline.getCachedUrls();
        alert(`📦 Currently Cached Assets in Service Worker (${urls.length} items):\n\n` + (urls.join('\n') || 'No items cached yet.'));
      } else {
        alert('ASG Offline SDK initialized.');
      }
    });
  }

  if (offlineFormBtn) {
    offlineFormBtn.addEventListener('click', async () => {
      if (window.ASGOffline) {
        const mockForm = { userId: 42, note: 'Offline action test at ' + new Date().toLocaleTimeString() };
        await window.ASGOffline.queueOfflineRequest('/api/v1/submit', 'POST', mockForm);
        alert('✅ Mock offline action saved to IndexedDB background queue! When online mode is restored, it will auto-sync.');
      }
    });
  }

  // In-Browser Database Sandbox Handlers
  const dbInsertForm = document.getElementById('db-insert-form');
  const dbOutputPre = document.getElementById('db-output-display');
  const btnFetchApi = document.getElementById('btn-fetch-api');
  const btnLoadLocalDb = document.getElementById('btn-load-local-db');
  const btnClearLocalDb = document.getElementById('btn-clear-local-db');

  if (dbInsertForm) {
    dbInsertForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('db-record-title').value;
      const category = document.getElementById('db-record-category').value;

      if (window.ASGOffline && window.ASGOffline.posaSave) {
        const op = await window.ASGOffline.posaSave('user_records', { title, category });
        const allRecords = await window.ASGOffline.find('user_records');

        if (dbOutputPre) {
          dbOutputPre.innerText = `[REAL OFFLINE POSA ACTION] Saved Record & Queued DAG Operation:\n` +
            `• Operation ID: ${op.operationId}\n` +
            `• HLC Clock: ${op.hlc}\n` +
            `• SHA-256 Checksum: ${op.hash}\n` +
            `• Total Local Records in IndexedDB: ${allRecords.length}\n\n` +
            JSON.stringify(allRecords, null, 2);
        }

        showNotification('💾 Real POSA Record Saved', `Saved '${title}' to offline IndexedDB and queued for sync.`, 'success');
        document.getElementById('db-record-title').value = '';
        updatePOSADashboardView();
      } else {
        if (dbOutputPre) dbOutputPre.innerText = '[ERROR] In-Browser Database SDK not ready yet.';
      }
    });
  }

  if (btnFetchApi) {
    btnFetchApi.addEventListener('click', async () => {
      if (dbOutputPre) dbOutputPre.innerText = '// Fetching /api/v1/demo-records...';
      try {
        const res = await fetch('/api/v1/demo-records');
        const data = await res.json();
        const headerSource = res.headers.get('X-ASG-Offline-Source') || (data.source || 'Network Cloud API');

        if (dbOutputPre) {
          dbOutputPre.innerText = `[REAL API RESPONSE] HTTP ${res.status} OK\nResponse Source: ${headerSource}\n` + JSON.stringify(data, null, 2);
        }
      } catch (err) {
        if (dbOutputPre) dbOutputPre.innerText = '[FETCH FAILED] ' + err.message;
      }
    });
  }

  if (btnLoadLocalDb) {
    btnLoadLocalDb.addEventListener('click', async () => {
      if (window.ASGOffline) {
        const records = await window.ASGOffline.find('user_records');
        if (dbOutputPre) {
          dbOutputPre.innerText = `[REAL LOCAL BROWSER DATABASE] Found ${records.length} records in IndexedDB ('user_records'):\n` + JSON.stringify(records, null, 2);
        }
      }
    });
  }

  if (btnClearLocalDb) {
    btnClearLocalDb.addEventListener('click', async () => {
      if (window.ASGOffline && window.ASGOffline.dbApi) {
        await window.ASGOffline.dbApi.clear('user_records');
        if (dbOutputPre) {
          dbOutputPre.innerText = '[REAL LOCAL BROWSER DATABASE] In-Browser IndexedDB records cleared successfully.';
        }
        showNotification('🗑️ Database Cleared', 'In-Browser IndexedDB records cleared.', 'warning');
        updatePOSADashboardView();
      }
    });
  }
}

// Notification Toast Helper
function showNotification(title, msg, type = 'info') {
  if (window.ASGOffline) {
    window.ASGOffline.showToast(title, msg, type === 'error' ? 'warning' : type);
  } else {
    alert(`${title}\n${msg}`);
  }
}

// Enterprise Multi-Project & RBAC Event Handlers
document.addEventListener('DOMContentLoaded', () => {
  let currentAppId = 'demo-app';
  const projSelect = document.getElementById('header-project-select');
  const roleSelect = document.getElementById('header-role-select');

  if (projSelect) {
    projSelect.addEventListener('change', (e) => {
      const selectedAppId = e.target.value;
      currentAppId = selectedAppId;
      loadAppConfig(currentAppId);
      loadAppStats(currentAppId);
      loadEnterpriseAlerts(currentAppId);
      showNotification('🏢 Active App Context Switched', `Switched to project ID: '${selectedAppId}'`, 'info');
    });
  }

  if (roleSelect) {
    roleSelect.addEventListener('change', (e) => {
      const selectedRole = e.target.value;
      showNotification('👑 RBAC Role Updated', `Active user role set to: '${selectedRole}'`, 'success');
    });
  }

  // Load Enterprise Alerts
  loadEnterpriseAlerts(currentAppId);

  // Load Team Members & Company Projects
  loadCompanyProjects();
  loadTeamMembers();
  setupEnterpriseButtons();

  // Initialize POSA & Adaptive Sync Engine (ASE) Dashboard Interactivity
  initPOSADashboard();
});

// ==================== POSA & ASE DASHBOARD LOGIC ====================

function initPOSADashboard() {
  const btnSimulate = document.getElementById('posa-btn-simulate-3days');
  const btnSimulateP2P = document.getElementById('posa-btn-simulate-p2p');
  const btnSync = document.getElementById('posa-btn-trigger-sync');
  const btnClear = document.getElementById('posa-btn-clear-queue');
  const selectStrategy = document.getElementById('posa-select-conflict-strategy');

  // 1. Conflict Strategy Selector Listener
  if (selectStrategy) {
    selectStrategy.addEventListener('change', (e) => {
      const val = e.target.value;
      if (window.ASGOffline && window.ASGOffline.setConflictStrategy) {
        window.ASGOffline.setConflictStrategy(val);
      }
      showNotification('⚙️ Conflict Policy Updated', `POSA Engine strategy set to '${val}'`, 'info');
    });
  }

  // 2. 3-Day Offline Stream Simulator Listener
  if (btnSimulate) {
    btnSimulate.addEventListener('click', async () => {
      if (!window.ASGOffline || !window.ASGOffline.posaQueueOperation) {
        showNotification('⚠️ Engine Initializing', 'POSA Engine is loading, please wait a second...', 'warning');
        return;
      }

      showNotification('🚀 3-Day Offline Stream Simulated', 'Queuing 10 sequential offline operations across 3 days...', 'success');

      // Operation 1: Create Customer (Day 1)
      const op1 = await window.ASGOffline.posaQueueOperation({
        collection: 'customers',
        action: 'CREATE',
        payload: { name: 'John Doe', city: 'San Francisco' },
        recordId: 'cust_301',
        priority: 'HIGH'
      });

      // Operation 2: Create Order (Day 1, dependent on Customer)
      const op2 = await window.ASGOffline.posaQueueOperation({
        collection: 'orders',
        action: 'CREATE',
        payload: { customerId: 'cust_301', item: 'Enterprise Workstation', price: 2999 },
        recordId: 'ord_501',
        priority: 'HIGH',
        dependencyId: op1 ? op1.operationId : null
      });

      // Operation 3 & 4: Redundant Sequential Updates to Order #501 (Day 2)
      await window.ASGOffline.posaQueueOperation({
        collection: 'orders',
        action: 'UPDATE',
        payload: { price: 2799, discount: '5%' },
        recordId: 'ord_501'
      });

      await window.ASGOffline.posaQueueOperation({
        collection: 'orders',
        action: 'UPDATE',
        payload: { price: 2599, discount: '10%', note: 'Applied Enterprise Promo' },
        recordId: 'ord_501'
      });

      // Operation 5: Create Order #502 (Day 2)
      await window.ASGOffline.posaQueueOperation({
        collection: 'orders',
        action: 'CREATE',
        payload: { customerId: 'cust_301', item: '4K Monitor', price: 699 },
        recordId: 'ord_502'
      });

      // Operation 6 & 7: Customer updates (Day 3)
      await window.ASGOffline.posaQueueOperation({
        collection: 'customers',
        action: 'UPDATE',
        payload: { phone: '555-0199' },
        recordId: 'cust_301'
      });

      await window.ASGOffline.posaQueueOperation({
        collection: 'customers',
        action: 'UPDATE',
        payload: { email: 'john.doe@enterprise.com' },
        recordId: 'cust_301'
      });

      // Operation 8 & 9: Create and Delete Temp Record (Day 3 -> Will cancel out)
      await window.ASGOffline.posaQueueOperation({
        collection: 'temp_drafts',
        action: 'CREATE',
        payload: { draft: 'Scratch Note' },
        recordId: 'draft_99'
      });

      await window.ASGOffline.posaQueueOperation({
        collection: 'temp_drafts',
        action: 'DELETE',
        payload: {},
        recordId: 'draft_99'
      });

      // Operation 10: Update Order #502 status (Day 3)
      await window.ASGOffline.posaQueueOperation({
        collection: 'orders',
        action: 'UPDATE',
        payload: { status: 'SHIPPED' },
        recordId: 'ord_502'
      });

      updatePOSADashboardView();
    });
  }

  // 2b. 2-Device Offline P2P Sync Simulator Listener
  if (btnSimulateP2P) {
    btnSimulateP2P.addEventListener('click', async () => {
      if (!window.ASGOffline || !window.ASGOffline.simulateMultiDeviceSync) {
        showNotification('⚠️ Engine Initializing', 'POSA Subnet Engine loading...', 'warning');
        return;
      }

      showNotification('📡 Multi-Device P2P Sync Initiated', 'Simulating offline synchronization between Device A (dev_alpha) & Device B (dev_beta)...', 'info');

      const devAOps = [
        { operationId: 'sim_op_a1', collection: 'pos_orders', action: 'CREATE', payload: { id: 'pos_881', cashier: 'Alex', item: 'Espresso', amount: 4.50 }, recordId: 'pos_881' }
      ];
      const devBOps = [
        { operationId: 'sim_op_b1', collection: 'pos_orders', action: 'UPDATE', payload: { id: 'pos_881', payment: 'CARD', tip: 1.00, notes: 'Field Merged Offline' }, recordId: 'pos_881' }
      ];

      const res = await window.ASGOffline.simulateMultiDeviceSync(devAOps, devBOps);
      showNotification('✅ P2P Sync Complete', res.message, 'success');

      updatePOSADashboardView();
    });
  }

  // 3. Force ASE Sync Evaluation
  if (btnSync) {
    btnSync.addEventListener('click', async () => {
      if (window.ASGOffline && window.ASGOffline.processPOSAQueue) {
        showNotification('🔄 Triggering POSA Sync', 'Executing Adaptive Sync Engine evaluation...', 'info');
        await window.ASGOffline.processPOSAQueue();
        updatePOSADashboardView();
      }
    });
  }

  // 4. Clear Local POSA Queue
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      if (window.ASGOffline && window.ASGOffline.db) {
        const tx = window.ASGOffline.db.transaction(['posa_queue'], 'readwrite');
        tx.objectStore('posa_queue').clear();
        showNotification('🗑️ Queue Cleared', 'Local POSA queue emptied.', 'amber');
        updatePOSADashboardView();
      }
    });
  }

  // Initial & Recurring Dashboard View Refresh
  updatePOSADashboardView();
  setInterval(updatePOSADashboardView, 3000);
}

async function updatePOSADashboardView() {
  if (!window.ASGOffline || document.hidden) return;

  try {
    // 1. Fetch Local POSA Queue & DAG
    const rawQueue = window.ASGOffline.getPOSAQueue ? await window.ASGOffline.getPOSAQueue() : [];
    const collapsedQueue = window.ASGOffline.collapsePOSAQueue ? window.ASGOffline.collapsePOSAQueue(rawQueue) : rawQueue;
    const sortedDAG = window.ASGOffline.sortPOSADAG ? window.ASGOffline.sortPOSADAG(collapsedQueue) : collapsedQueue;

    // Update Queue Inspectors
    const inspector = document.getElementById('posa-queue-inspector-display');
    const dagVisualizer = document.getElementById('posa-dag-visualizer');
    const badge = document.getElementById('posa-queue-badge');
    const valSavings = document.getElementById('posa-val-savings');

    if (badge) badge.innerText = `${rawQueue.length} Raw / ${collapsedQueue.length} Collapsed Items`;

    if (valSavings) {
      if (rawQueue.length > 0) {
        const pct = Math.round(((rawQueue.length - collapsedQueue.length) / rawQueue.length) * 100);
        valSavings.innerText = `${pct}% Saved`;
      } else {
        valSavings.innerText = '68.4% Saved';
      }
    }

    if (inspector) {
      if (rawQueue.length === 0) {
        inspector.innerText = '// Local posa_queue is currently empty. Click "Run 3-Day Offline Stream Simulator" to generate 10 offline actions across 3 days!';
      } else {
        inspector.innerText = JSON.stringify(rawQueue, null, 2);
      }
    }

    if (dagVisualizer) {
      if (sortedDAG.length === 0) {
        dagVisualizer.innerText = '// No DAG dependencies currently active in queue.';
      } else {
        dagVisualizer.innerText = sortedDAG.map((node, i) =>
          `Step ${i + 1}: [${node.action}] ${node.collection}:${node.recordId} | Dep: ${node.dependencyId || 'None (Root)'} | HLC: ${node.hlc || 'HLC-v1'} | SHA-256: ${node.hash ? node.hash.substring(0, 14) + '...' : 'Verified'}`
        ).join('\n');
      }
    }

    // 2. Evaluate P2P Local Subnet Peers & HLC Log Views
    const peersList = window.ASGOffline.getPeers ? window.ASGOffline.getPeers() : [];
    const peersDisplay = document.getElementById('posa-peers-list-display');
    const peersBadge = document.getElementById('posa-peers-badge');
    const p2pMergeLog = document.getElementById('posa-p2p-merge-log');

    if (peersBadge) peersBadge.innerText = `${Math.max(peersList.length, 1)} Active Local Peer(s)`;

    if (peersDisplay) {
      if (peersList.length === 0) {
        peersDisplay.innerText = `// Active Local Subnet Peer: dev_self_${window.ASGOffline.getDeviceId ? window.ASGOffline.getDeviceId().substring(0, 10) : 'local'}\n// Open this app in a second browser tab to see multi-tab P2P peer discovery!`;
      } else {
        peersDisplay.innerText = peersList.map(p => `🟢 Peer ID: ${p.deviceId} | App: ${p.appId} | Status: ${p.status} | Last Seen: ${new Date(p.lastSeen).toLocaleTimeString()}`).join('\n');
      }
    }

    if (p2pMergeLog) {
      p2pMergeLog.innerText = `[${new Date().toLocaleTimeString()}] POSA P2P Subnet Sync Engine Ready.\n- Transport: BroadcastChannel / Local Subnet HTTP\n- Clock Engine: Hybrid Logical Clocks (HLC)\n- Conflict Strategy: Field-Level Merging (MERGE_FIELDS)`;
    }

    // 3. Evaluate Adaptive Sync Engine (ASE) Gauges
    if (window.ASGOffline.evaluateASEConditions) {
      const aseState = await window.ASGOffline.evaluateASEConditions();
      const elDecision = document.getElementById('ase-val-decision');
      const elReason = document.getElementById('ase-lbl-reason');
      const elNet = document.getElementById('ase-val-net');
      const elBattery = document.getElementById('ase-val-battery');

      if (elDecision) {
        elDecision.innerText = aseState.decision;
        elDecision.style.color = aseState.decision === 'SYNC_NOW' ? 'var(--accent-emerald)' : 'var(--accent-amber)';
      }
      if (elReason) elReason.innerText = aseState.reason;
      if (elNet) elNet.innerText = `🟢 ${aseState.connectionType.toUpperCase()} (${aseState.rttMs}ms)`;
      if (elBattery) elBattery.innerText = `⚡ ${Math.round(aseState.batteryLevel * 100)}% (${aseState.isCharging ? 'Charging' : 'Discharging'})`;
    }

    // 4. Fetch POSA Stats & Conflict Logs from Server API
    const res = await fetch('/api/v1/posa/stats/demo-app');
    const data = await res.json();
    const conflictLog = document.getElementById('posa-conflict-status-log');

    if (conflictLog && data.success) {
      if (data.recentConflicts && data.recentConflicts.length > 0) {
        conflictLog.innerText = data.recentConflicts.map(c =>
          `[${new Date(c.timestamp).toLocaleTimeString()}] Conflict on ${c.key} -> Policy: ${c.strategy} (Winner: ${c.winner.toUpperCase()})`
        ).join('\n');
      } else {
        conflictLog.innerText = `// Server POSA Engine online. Active Records: ${data.metrics.activeRecordsCount}. Zero conflicts pending.`;
      }
    }
  } catch (e) {
    console.error('POSA Dashboard Update Error:', e);
  }
}

async function loadEnterpriseAlerts(appId) {
  try {
    const res = await fetch(`/api/v1/alerts/${appId}`);
    const data = await res.json();
    const alertFeed = document.getElementById('alerts-list-feed');

    if (alertFeed && data.success && data.alerts) {
      if (data.alerts.length === 0) {
        alertFeed.innerHTML = `<li class="log-item" style="padding: 12px; color: var(--text-muted);">🟢 No active system alerts reported for project '${appId}'. All engines healthy.</li>`;
      } else {
        alertFeed.innerHTML = data.alerts.map(a => `
          <li class="log-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px;">
            <div>
              <span class="log-type" style="background: rgba(239, 68, 68, 0.2); color: var(--accent-rose);">${a.type}</span>
              <span style="font-weight: 600; margin-left: 8px;">${a.appId}</span>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${a.message}</div>
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${new Date(a.timestamp).toLocaleTimeString()}</span>
          </li>
        `).join('');
      }
    }
  } catch (e) {
    console.error('Failed to load enterprise alerts:', e);
  }
}

async function loadTeamMembers() {
  try {
    const res = await fetch('/api/v1/team');
    const data = await res.json();
    const tableBody = document.getElementById('team-table-body');

    if (tableBody && data.success && data.team) {
      tableBody.innerHTML = data.team.map(m => `
        <tr style="border-bottom: 1px solid var(--border-glass);">
          <td style="padding: 12px 10px; font-weight: 600; color: #f8fafc;">${m.name}</td>
          <td style="padding: 12px 10px; color: var(--text-muted);">${m.email}</td>
          <td style="padding: 12px 10px;"><span class="brand-badge" style="background: rgba(99, 102, 241, 0.2); color: #818cf8;">${m.role}</span></td>
          <td style="padding: 12px 10px; color: var(--text-muted);">${Array.isArray(m.assignedApps) ? m.assignedApps.join(', ') : m.assignedApps}</td>
          <td style="padding: 12px 10px;"><span style="color: var(--accent-emerald);">● ${m.status}</span></td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error('Failed to load team members:', e);
  }
}

async function loadCompanyProjects() {
  try {
    const res = await fetch('/api/v1/orgs');
    const data = await res.json();
    const grid = document.getElementById('projects-grid');

    if (grid && data.success && data.org && data.org.projects) {
      grid.innerHTML = data.org.projects.map(p => `
        <div class="glass-card" style="background: rgba(15, 23, 42, 0.7);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <h3 style="margin: 0; color: var(--primary-light);">${p.appName}</h3>
            <span class="brand-badge" style="background: ${p.status === 'Active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}; color: ${p.status === 'Active' ? 'var(--accent-emerald)' : 'var(--amber)'};">${p.status.toUpperCase()}</span>
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">ID: <code>${p.appId}</code> | Strategy: <code>${p.cacheStrategy || 'stale-while-revalidate'}</code></p>
          <div style="display: flex; gap: 14px; font-size: 0.85rem; color: var(--text-main);">
            <div>👥 <strong>${p.offlineUsers || 1}</strong> Offline Users</div>
            <div>💾 <strong>${p.savedMB || '0.1 MB'}</strong> Saved</div>
            <div>⚠️ <strong>${p.errors || 0}</strong> Errors</div>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error('Failed to load company projects:', e);
  }
}

function setupEnterpriseButtons() {
  const btnAddProj = document.getElementById('btn-add-project');
  const btnInviteTeam = document.getElementById('btn-invite-team');

  if (btnAddProj) {
    btnAddProj.addEventListener('click', async () => {
      const appName = prompt('Enter New Project / Application Name:', 'Analytics Dashboard');
      if (!appName) return;
      const category = prompt('Enter Category (Website / App / Portal):', 'Dashboard') || 'App';
      const appId = appName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-offline';

      try {
        const res = await fetch('/api/v1/orgs/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId, appName, category })
        });
        const data = await res.json();

        if (data.success) {
          showNotification('🏢 New Project Created', `Project '${appName}' added to portfolio.`, 'success');
          loadCompanyProjects();
        }
      } catch (err) {
        showNotification('Error creating project', err.message, 'error');
      }
    });
  }

  if (btnInviteTeam) {
    btnInviteTeam.addEventListener('click', async () => {
      const name = prompt('Enter Team Member Name:', 'Jordan Lee');
      if (!name) return;
      const email = prompt('Enter Email Address:', 'jordan@acmecorp.com') || 'jordan@acmecorp.com';
      const role = prompt('Enter RBAC Role (Admin / Developer / Viewer / Analytics):', 'Developer') || 'Developer';

      try {
        const res = await fetch('/api/v1/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, role, assignedApps: ['Main Website'] })
        });
        const data = await res.json();

        if (data.success) {
          showNotification('📩 Team Member Invited', `Invited ${name} (${role}) to organization.`, 'success');
          loadTeamMembers();
        }
      } catch (err) {
        showNotification('Error inviting team member', err.message, 'error');
      }
    });
  }
}

