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
      document.getElementById(target).classList.add('active');
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
      const websiteUrl = document.getElementById('gen-url-input').value;
      await generateCodeForUrl(websiteUrl);
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

  async function generateCodeForUrl(websiteUrl) {
    try {
      const displayPre = document.getElementById('gen-code-display');
      displayPre.innerText = '// Generating tailored offline APIs and code for ' + websiteUrl + '...';

      const res = await fetch('/api/v1/analyze-and-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl })
      });

      const data = await res.json();
      if (data.success && data.snippets) {
        generatedSnippets = data.snippets;
        currentAppId = data.appId;
        
        // Find current active snippet tab key
        const activeTab = document.querySelector('.snippet-tab.active');
        const activeKey = activeTab ? activeTab.getAttribute('data-snippet') : 'vanilla';
        displayGeneratedSnippet(activeKey);

        showNotification('Offline Engine Code Generated!', `Configured for domain '${data.domain}' (${data.appId})`, 'success');
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

      if (window.ASGOffline && window.ASGOffline.database) {
        const record = await window.ASGOffline.database.insert('demo_collection', { title, category });
        if (dbOutputPre) {
          dbOutputPre.innerText = `[SUCCESS] Inserted Record to In-Browser Database (IndexedDB):\n` + JSON.stringify(record, null, 2);
        }
        showNotification('💾 In-Browser DB Record Saved', `Saved '${title}' to Chrome local storage.`, 'success');
        document.getElementById('db-record-title').value = '';
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
          dbOutputPre.innerText = `[API RESPONSE] HTTP ${res.status} OK\nResponse Source: ${headerSource}\n` + JSON.stringify(data, null, 2);
        }
      } catch (err) {
        if (dbOutputPre) dbOutputPre.innerText = '[FETCH FAILED] ' + err.message;
      }
    });
  }

  if (btnLoadLocalDb) {
    btnLoadLocalDb.addEventListener('click', async () => {
      if (window.ASGOffline && window.ASGOffline.database) {
        const records = await window.ASGOffline.database.getAll('demo_collection');
        if (dbOutputPre) {
          dbOutputPre.innerText = `[LOCAL BROWSER DATABASE] Found ${records.length} records in IndexedDB ('demo_collection'):\n` + JSON.stringify(records, null, 2);
        }
      }
    });
  }

  if (btnClearLocalDb) {
    btnClearLocalDb.addEventListener('click', async () => {
      if (window.ASGOffline && window.ASGOffline.database) {
        await window.ASGOffline.database.clear('demo_collection');
        if (dbOutputPre) {
          dbOutputPre.innerText = '[LOCAL BROWSER DATABASE] In-Browser Database cleared successfully.';
        }
        showNotification('🗑️ Database Cleared', 'In-Browser IndexedDB collection cleared.', 'warning');
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
