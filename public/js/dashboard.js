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
    try {
      const displayPre = document.getElementById('gen-code-display');
      if (displayPre) {
        displayPre.innerText = '// Generating tailored full-stack offline code for Frontend (' + frontendUrl + ') & Backend API (' + backendApiUrl + ')...';
      }

      const res = await fetch('/api/v1/analyze-and-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontendUrl, backendApiUrl })
      });

      const data = await res.json();
      if (data.success && data.snippets) {
        generatedSnippets = data.snippets;
        
        // Find current active snippet tab key
        const activeTab = document.querySelector('.snippet-tab.active');
        const activeKey = activeTab ? activeTab.getAttribute('data-snippet') : 'allInOne';
        displayGeneratedSnippet(activeKey);

        showNotification('Full-Stack Offline Code Generated!', `Configured for Frontend '${data.domain}' & Backend API '${data.backendApiUrl}'`, 'success');
      }
    } catch (err) {
      console.error('Failed to generate code:', err);
      showNotification('Generation Error', err.message, 'error');
    }
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
