/**
 * ASG Service Worker Engine (asg-sw.js)
 * High-performance, offline-first caching worker engine.
 */

const CACHE_PREFIX = 'asg-offline-cache';
let CURRENT_CACHE_VERSION = 'v1.0.0';
let CACHE_NAME = `${CACHE_PREFIX}-${CURRENT_CACHE_VERSION}`;

let DEFAULT_PRECACHE = [
  '/',
  '/index.html',
  '/css/dashboard.css',
  '/js/dashboard.js',
  '/sdk/asg-offline.js'
];

let DEFAULT_STRATEGY = 'stale-while-revalidate';
let OFFLINE_FALLBACK_HTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline - ASG Offline Service</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }
      .container { max-width: 480px; padding: 2.5rem; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 1rem; backdrop-filter: blur(12px); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
      .icon { font-size: 3.5rem; margin-bottom: 1rem; }
      h2 { color: #818cf8; margin-top: 0; }
      p { color: #94a3b8; line-height: 1.6; font-size: 0.95rem; }
      button { background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.5rem; cursor: pointer; transition: all 0.2s; margin-top: 1rem; }
      button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4); }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="icon">📡⚡</div>
      <h2>You are Offline</h2>
      <p>ASG Offline Web Service prevented this connection error. The requested resource is not currently cached offline.</p>
      <button onclick="window.location.reload()">Retry Connection</button>
    </div>
  </body>
  </html>
`;

// Lifecycle: Install
self.addEventListener('install', (event) => {
  console.log('[ASG ServiceWorker] Installing worker engine...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[ASG ServiceWorker] Pre-caching static assets list:', DEFAULT_PRECACHE);
      // Precache files individually so single 404 does not fail entire installation
      for (const url of DEFAULT_PRECACHE) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn(`[ASG ServiceWorker] Could not precache item: ${url}`, err);
        }
      }
    })
  );
});

// Lifecycle: Activate
self.addEventListener('activate', (event) => {
  console.log('[ASG ServiceWorker] Activating new worker engine...');
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up outdated cache versions
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
              console.log('[ASG ServiceWorker] Deleting old cache bucket:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// Helper: Check if request is a static media asset (CSS, JS, Fonts, Images)
function isStaticAsset(url) {
  return /\.(css|js|woff2?|ttf|png|jpe?g|gif|svg|ico|webp)$/i.test(url.pathname);
}

// Helper: Cache-First strategy
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    // Send background update check
    fetch(request.clone()).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
      }
    }).catch(() => {});
    return cachedResponse;
  }
  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
      return new Response(OFFLINE_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } });
    }
    return new Response('', { status: 504, statusText: 'Gateway Timeout (Offline)' });
  }
}

// Helper: Stale-While-Revalidate strategy
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request.clone()).then((networkResponse) => {
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkRes = await fetchPromise;
  if (networkRes) {
    return networkRes;
  }

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    return new Response(OFFLINE_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } });
  }

  return new Response(JSON.stringify({ error: 'Offline mode active', offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Helper: Network-First strategy with Cache Fallback
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
      return new Response(OFFLINE_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response(JSON.stringify({ error: 'Offline mode active', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper: Network-Only strategy (Option A: Data/API Sync Only - Web page uses network, API syncs offline)
async function networkOnly(request) {
  try {
    return await fetch(request.clone());
  } catch (err) {
    if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
      return new Response(OFFLINE_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } });
    }
    return new Response(JSON.stringify({ error: 'Network unavailable (Network-Only mode)', offline: true }), {
      status: 504,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper: Cache-Only strategy (Pure Offline Mode)
async function cacheOnly(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    return new Response(OFFLINE_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } });
  }
  return new Response('', { status: 404, statusText: 'Resource Not In Cache' });
}

// Helper: Handle API requests with Network-First and Offline JSON Fallback
async function handleApiRequest(request) {
  const url = new URL(request.url);

  // Critical: POSA Engine internal routes MUST NOT return synthesized HTTP 200 when offline
  // Otherwise SDK receives HTTP 200 and deletes pending offline queue prematurely!
  const isPosaInternalRoute = url.pathname.includes('/api/v1/posa/') ||
                             url.pathname.includes('/api/v1/telemetry') ||
                             url.pathname.includes('/api/v1/alerts') ||
                             url.pathname.includes('/api/v1/config');

  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.log('[ASG ServiceWorker] API network request failed for:', request.url);

    if (isPosaInternalRoute) {
      return new Response(JSON.stringify({ success: false, error: 'Network unavailable for POSA engine sync', offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If it's a GET request, check cache
    if (request.method === 'GET') {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
    } else {
      // Non-GET requests (POST/PUT/DELETE) return HTTP 503 so caller knows network is down
      return new Response(JSON.stringify({ success: false, error: 'Offline mode active. Request queued locally.', offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return synthesized JSON offline fallback for GET API routes
    return new Response(
      JSON.stringify({
        success: true,
        offline: true,
        source: 'in_browser_offline_db',
        _branding: 'Powered by ASG Offline Web Service (https://github.com/asg492607/asgweboffline)',
        message: 'Request processed via In-Browser Offline API Engine (IndexedDB/CacheStorage).',
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Powered-By': 'ASG-Offline-Web-Service',
          'X-ASG-Offline-Engine': 'https://github.com/asg492607/asgweboffline',
          'X-ASG-Offline-Source': 'In-Browser-DB'
        }
      }
    );
  }
}

// Intercept Fetch Requests
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip chrome-extension or invalid schemes
  if (url.protocol.startsWith('chrome-extension')) {
    return;
  }

  // Intercept API routes (/api/) for offline fallback
  if (url.pathname.includes('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Skip non-GET static requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle static assets (use Cache-First unless Network-Only is selected)
  if (isStaticAsset(url) && DEFAULT_STRATEGY !== 'network-only') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Handle general requests according to active strategy
  if (DEFAULT_STRATEGY === 'cache-first') {
    event.respondWith(cacheFirst(request));
  } else if (DEFAULT_STRATEGY === 'network-first') {
    event.respondWith(networkFirst(request));
  } else if (DEFAULT_STRATEGY === 'network-only') {
    event.respondWith(networkOnly(request));
  } else if (DEFAULT_STRATEGY === 'cache-only') {
    event.respondWith(cacheOnly(request));
  } else {
    // Default: stale-while-revalidate (Option B: Full Offline PWA)
    event.respondWith(staleWhileRevalidate(request));
  }
});

// PostMessage Communication with Client SDK
self.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SET_CONFIG') {
    if (data.precacheUrls) DEFAULT_PRECACHE = data.precacheUrls;
    if (data.cacheStrategy) DEFAULT_STRATEGY = data.cacheStrategy;
    if (data.offlineFallbackHtml) OFFLINE_FALLBACK_HTML = data.offlineFallbackHtml;
    console.log('[ASG ServiceWorker] Config updated via Client SDK');
  }

  if (data.type === 'CLEAR_CACHE') {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    event.ports[0].postMessage({ success: true, message: 'All offline caches cleared' });
  }

  if (data.type === 'GET_CACHE_KEYS') {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    const urls = requests.map(r => r.url);
    event.ports[0].postMessage({ success: true, urls });
  }
});
