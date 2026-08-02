/**
 * ASG All-In-One Generator Dashboard Interactivity
 */

document.addEventListener('DOMContentLoaded', () => {
  let generatedSnippets = null;

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
