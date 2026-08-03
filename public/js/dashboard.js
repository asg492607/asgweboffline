/**
 * ASG Offline Web Service — Developer Portal Logic
 * Handles: onboarding form, snippet tabs, My Apps table, copy buttons
 */

document.addEventListener('DOMContentLoaded', () => {

  /* ─────────────────────────────────────────────────────────
     1. GLOBAL TAB SWITCHING
  ───────────────────────────────────────────────────────── */
  const mainTabs  = document.querySelectorAll('.tabs .tab-btn');
  const mainPanes = document.querySelectorAll('.tab-content');

  mainTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mainTabs.forEach(t  => t.classList.remove('active'));
      mainPanes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = document.getElementById(tab.dataset.tab);
      if (pane) pane.classList.add('active');

      // Load apps list when switching to My Apps
      if (tab.dataset.tab === 'tab-myapps') loadApps();
    });
  });

  /* ─────────────────────────────────────────────────────────
     2. NETWORK STATUS
  ───────────────────────────────────────────────────────── */
  const netLabel = document.getElementById('network-status-label');
  const netDot   = document.getElementById('net-dot');

  function updateNetStatus(isOnline) {
    if (netLabel) netLabel.textContent = isOnline ? 'Engine Active' : 'Offline Mode';
    if (netDot)   netDot.style.background = isOnline ? 'var(--accent-emerald)' : 'var(--accent-amber)';
  }

  window.addEventListener('online',  () => updateNetStatus(true));
  window.addEventListener('offline', () => updateNetStatus(false));
  updateNetStatus(navigator.onLine);

  if (window.ASGOffline) {
    window.ASGOffline.onStatusChange(updateNetStatus);
  }

  /* ─────────────────────────────────────────────────────────
     3. ONBOARDING FORM
  ───────────────────────────────────────────────────────── */
  let currentSnippets = null;
  let currentActiveSnippet = 'html';

  const onboardForm  = document.getElementById('onboard-form');
  const btnOnboard   = document.getElementById('btn-onboard');
  const resultPanel  = document.getElementById('result-panel');

  onboardForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const appName    = document.getElementById('inp-appname').value.trim();
    const frontendUrl= document.getElementById('inp-frontend').value.trim();
    const backendUrl = document.getElementById('inp-backend').value.trim();
    const email      = document.getElementById('inp-email').value.trim();

    if (!frontendUrl || !backendUrl) {
      showToast('Missing URLs', 'Please provide both Frontend and Backend URLs.', 'error');
      return;
    }

    // Loading state
    btnOnboard.disabled = true;
    btnOnboard.innerHTML = '<span class="btn-icon">⏳</span> Registering App…';

    try {
      const res = await fetch('/api/v1/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName, frontendUrl, backendUrl, contactEmail: email || null })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Registration failed');
      }

      // Store snippets + render result
      currentSnippets = data.snippets;
      renderResult(data);
      showToast('App Registered!', `${data.appId} is ready. Copy your embed tag below.`, 'success');

    } catch (err) {
      showToast('Registration Failed', err.message, 'error');
    } finally {
      btnOnboard.disabled = false;
      btnOnboard.innerHTML = '<span class="btn-icon">🚀</span> Create App & Generate Code';
    }
  });

  function renderResult(data) {
    // Fill info
    document.getElementById('result-domain-line').textContent =
      `${data.appId} · Frontend: ${data.frontendUrl} · Backend: ${data.backendUrl}`;

    document.getElementById('result-api-key').textContent  = data.apiKey;
    document.getElementById('result-appid').textContent    = data.appId;
    document.getElementById('result-frontend').textContent = data.frontendUrl;
    document.getElementById('result-backend').textContent  = data.backendUrl;
    document.getElementById('result-embed-tag').textContent= data.embedTag;

    // Show result panel with scroll
    resultPanel.style.display = 'block';
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Set default snippet tab
    currentActiveSnippet = 'html';
    document.querySelectorAll('.snippet-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.snippet === 'html');
    });
    renderSnippet('html');
  }

  /* ─────────────────────────────────────────────────────────
     4. SNIPPET TABS
  ───────────────────────────────────────────────────────── */
  document.querySelectorAll('.snippet-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.snippet-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentActiveSnippet = tab.dataset.snippet;
      renderSnippet(currentActiveSnippet);
    });
  });

  function renderSnippet(key) {
    const pre = document.getElementById('snippet-display');
    if (!pre || !currentSnippets) return;
    pre.textContent = currentSnippets[key] || `// No snippet available for '${key}'`;
  }

  /* ─────────────────────────────────────────────────────────
     5. COPY BUTTONS
  ───────────────────────────────────────────────────────── */
  function setupCopy(btnId, getText, label = 'Copy') {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const text = typeof getText === 'function' ? getText() : getText;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
      } catch (e) {
        showToast('Copy Failed', 'Please copy manually.', 'error');
      }
    });
  }

  setupCopy('btn-copy-apikey',  () => document.getElementById('result-api-key')?.textContent,  'Copy Key');
  setupCopy('btn-copy-embed',   () => document.getElementById('result-embed-tag')?.textContent, 'Copy Tag');
  setupCopy('btn-copy-snippet', () => document.getElementById('snippet-display')?.textContent,  'Copy Code');

  /* ─────────────────────────────────────────────────────────
     6. MY APPS TABLE
  ───────────────────────────────────────────────────────── */
  const btnRefreshApps = document.getElementById('btn-refresh-apps');
  if (btnRefreshApps) btnRefreshApps.addEventListener('click', loadApps);

  async function loadApps() {
    const container = document.getElementById('apps-table-container');
    if (!container) return;
    container.innerHTML = '<div class="loading-row">⏳ Loading registered apps…</div>';

    try {
      const res  = await fetch('/api/v1/apps');
      const data = await res.json();

      if (!data.success || !data.apps || data.apps.length === 0) {
        container.innerHTML = `
          <div class="empty-row">
            No apps registered yet.
            <a href="#" id="go-create-tab" style="color:var(--primary-light);margin-left:6px">Create your first app →</a>
          </div>`;
        document.getElementById('go-create-tab')?.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById('tabBtn-create')?.click();
        });
        return;
      }

      const tableHtml = `
        <table class="apps-table">
          <thead>
            <tr>
              <th>App ID</th>
              <th>Domain</th>
              <th>Backend URL</th>
              <th>API Key</th>
              <th>Registered</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.apps.map(app => `
              <tr data-appid="${escHtml(app.appId)}">
                <td><code>${escHtml(app.appId)}</code></td>
                <td>${escHtml(app.domain || '—')}</td>
                <td><span style="color:var(--text-dim);font-size:.8rem">${escHtml(app.backendUrl || app.backendApiUrl || '—')}</span></td>
                <td>
                  <code style="font-size:.75rem;opacity:.7">${escHtml(app.apiKey || '—')}</code>
                </td>
                <td style="font-size:.8rem;color:var(--text-dim)">${app.createdAt ? new Date(app.createdAt).toLocaleDateString() : '—'}</td>
                <td><span class="app-badge-active">● Active</span></td>
                <td>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-secondary" style="font-size:.75rem;padding:4px 10px"
                      onclick="viewAppSnippets('${escHtml(app.appId)}')">View Code</button>
                    <button class="btn btn-danger" style="font-size:.75rem;padding:4px 10px"
                      onclick="deleteApp('${escHtml(app.appId)}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      container.innerHTML = tableHtml;
    } catch (err) {
      container.innerHTML = `<div class="empty-row">⚠ Could not load apps: ${escHtml(err.message)}</div>`;
    }
  }

  // View app snippets — switches to Create tab and shows stored snippets for that app
  window.viewAppSnippets = async (appId) => {
    // Switch to Create tab
    document.getElementById('tabBtn-create')?.click();

    const res  = await fetch(`/api/v1/apps/${appId}`);
    const data = await res.json();
    if (!data.success) {
      showToast('Not Found', `App '${appId}' not found.`, 'error');
      return;
    }

    // Re-generate snippets by calling onboard with existing config
    // (since we don't store full snippets, regenerate from config)
    const cfg = data.config;
    if (!cfg.frontendUrl && !cfg.websiteUrl) return;

    // Fill form + submit
    document.getElementById('inp-appname').value  = cfg.appName || '';
    document.getElementById('inp-frontend').value = cfg.frontendUrl || cfg.websiteUrl || '';
    document.getElementById('inp-backend').value  = cfg.backendUrl  || cfg.backendApiUrl || '';
    document.getElementById('inp-email').value    = cfg.contactEmail || '';

    document.getElementById('onboard-form').dispatchEvent(new Event('submit'));
  };

  // Delete app
  window.deleteApp = async (appId) => {
    if (!confirm(`Delete app '${appId}' and revoke its API key? This cannot be undone.`)) return;

    try {
      const res  = await fetch(`/api/v1/apps/${appId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast('App Deleted', `'${appId}' has been removed.`, 'success');
      loadApps();
    } catch (err) {
      showToast('Delete Failed', err.message, 'error');
    }
  };

  /* ─────────────────────────────────────────────────────────
     7. TOAST HELPER
  ───────────────────────────────────────────────────────── */
  function showToast(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-title">${escHtml(title)}</div>
      <div class="toast-sub">${escHtml(message)}</div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all .3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /* ─────────────────────────────────────────────────────────
     8. ESCAPE HTML
  ───────────────────────────────────────────────────────── */
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────
     9. DEMO AUTO-FILL (make it easy to test)
  ───────────────────────────────────────────────────────── */
  // If ?demo=1 in URL, pre-fill and auto-submit
  if (new URLSearchParams(location.search).get('demo') === '1') {
    document.getElementById('inp-appname').value  = 'Demo Store';
    document.getElementById('inp-frontend').value = 'https://demo-store.com';
    document.getElementById('inp-backend').value  = 'https://api.demo-store.com';
    setTimeout(() => onboardForm.dispatchEvent(new Event('submit')), 600);
  }

});
