/**
 * ASG Service Worker Engine (asg-sw.js)
 * High-performance, offline-first caching worker engine.
 */

const CACHE_PREFIX = 'asg-offline-cache';
let CURRENT_CACHE_VERSION = 'v3.0.0-all-in-one-fix';
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

// Helper: Check if request is a static asset, downloadable document, media, or CDN library
function isDownloadableOrStaticAsset(url) {
  const path = url.pathname.toLowerCase();
  const host = url.hostname.toLowerCase();

  // 1. Static web assets & document/media file extensions
  if (/\.(css|js|mjs|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp|pdf|xlsx?|csv|docx?|pptx?|txt|json|xml|zip|gz|tar|mp3|mp4|webm)$/i.test(path)) {
    return true;
  }

  // 2. CDN library domains & font providers
  if (host.includes('cdn.jsdelivr.net') ||
      host.includes('cdnjs.cloudflare.com') ||
      host.includes('unpkg.com') ||
      host.includes('fonts.googleapis.com') ||
      host.includes('fonts.gstatic.com') ||
      host.includes('cdn-icons-png.flaticon.com')) {
    return true;
  }

  return false;
}

function isStaticAsset(url) {
  return isDownloadableOrStaticAsset(url);
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

// Helper: Generate a cryptographically random opaque session token (Web Crypto API)
function generateOpaqueSessionToken() {
  try {
    const bytes = new Uint8Array(24);
    self.crypto.getRandomValues(bytes);
    return 'asg_off_sess_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return 'asg_off_sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }
}

// Helper: Check if request is a Firebase Auth or Google Identity request
function isFirebaseAuthRequest(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return host.includes('identitytoolkit.googleapis.com') ||
         host.includes('securetoken.googleapis.com') ||
         path.includes('accounts:signinwithpassword') ||
         path.includes('accounts:signup') ||
         path.includes('accounts:lookup') ||
         path.includes('/v1/accounts');
}

// Helper: Handle Firebase Auth Requests with Offline Authentication Continuity (OAC)
async function handleFirebaseAuthRequest(request) {
  const url = new URL(request.url);
  const cache = await caches.open('asg-auth-entitlements');

  let requestBody = null;
  try {
    const clone = request.clone();
    const text = await clone.text();
    requestBody = JSON.parse(text);
  } catch (e) {}

  const email = (requestBody && requestBody.email) ? requestBody.email.trim().toLowerCase() : '';
  const cacheKey = email ? `auth:${email}` : `auth:${url.pathname}`;

  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse && networkResponse.status === 200) {
      // Capture authentic server entitlement on successful online authentication
      try {
        const resClone = networkResponse.clone();
        const authData = await resClone.json();

        if (authData && (authData.localId || authData.email)) {
          const verifiedAt = Date.now();
          const ttlMs = 7 * 24 * 60 * 60 * 1000; // 7-day entitlement window

          const entitlementRecord = {
            kind: authData.kind || 'identitytoolkit#VerifyPasswordResponse',
            localId: authData.localId,
            email: authData.email || email,
            displayName: authData.displayName || (email ? email.split('@')[0] : 'User'),
            idToken: authData.idToken,
            refreshToken: authData.refreshToken,
            expiresIn: authData.expiresIn || '86400',
            verifiedOnlineAt: new Date(verifiedAt).toISOString(),
            allowedOfflineUntil: new Date(verifiedAt + ttlMs).toISOString(),
            mode: 'OFFLINE_VERIFIED_SESSION',
            deviceBound: true,
            serverAuthority: false
          };

          const entitlementResponse = new Response(JSON.stringify(entitlementRecord), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

          await cache.put(cacheKey, entitlementResponse);
          console.log(`[ASG ServiceWorker] 🔒 Recorded verified online auth entitlement for '${email}' (Expires: ${entitlementRecord.allowedOfflineUntil})`);
        }
      } catch (e) {
        console.warn('[ASG ServiceWorker] Could not parse online auth response:', e.message);
      }
    }
    return networkResponse;
  } catch (err) {
    console.log('[ASG ServiceWorker] 🔑 Firebase Auth offline request for:', url.pathname);

    // 1. Check if a device-bound entitlement exists for this email
    if (email && cacheKey) {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        try {
          const entitlement = await cachedResponse.json();
          const now = Date.now();
          const expiryTime = entitlement.allowedOfflineUntil ? new Date(entitlement.allowedOfflineUntil).getTime() : 0;

          if (now < expiryTime) {
            console.log(`[ASG ServiceWorker] ✅ Serving verified OFFLINE_VERIFIED_SESSION for '${email}' (Verified online: ${entitlement.verifiedOnlineAt})`);

            const verifiedOfflineResponse = {
              kind: entitlement.kind,
              localId: entitlement.localId,
              email: entitlement.email,
              displayName: entitlement.displayName,
              idToken: generateOpaqueSessionToken(),
              refreshToken: generateOpaqueSessionToken(),
              expiresIn: entitlement.expiresIn,
              registered: true,
              asgAuth: {
                mode: 'OFFLINE_VERIFIED_SESSION',
                verifiedOnlineAt: entitlement.verifiedOnlineAt,
                allowedOfflineUntil: entitlement.allowedOfflineUntil,
                deviceBound: true,
                serverAuthority: false
              }
            };

            return new Response(JSON.stringify(verifiedOfflineResponse), {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-ASG-Offline-Auth': 'OFFLINE_VERIFIED_SESSION',
                'X-ASG-Server-Authority': 'false'
              }
            });
          } else {
            console.warn(`[ASG ServiceWorker] ⛔ Auth entitlement expired for '${email}' (Expired at: ${entitlement.allowedOfflineUntil}).`);
          }
        } catch (e) {}
      }
    }

    // 2. Unverified or Expired Account: STRICTLY DENY OFFLINE AUTHENTICATION (HTTP 401)
    console.warn(`[ASG ServiceWorker] ⛔ Offline authentication DENIED for '${email || 'unspecified'}'. No prior online verification recorded on this device.`);

    return new Response(
      JSON.stringify({
        error: {
          code: 401,
          message: 'OFFLINE_AUTH_DENIED: This device has not previously verified credentials online for this account. Online authentication required.',
          errors: [
            {
              domain: 'global',
              reason: 'UNVERIFIED_OFFLINE_DEVICE',
              message: 'No active device-bound online authentication entitlement found for this account.'
            }
          ]
        }
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-ASG-Offline-Auth': 'DENIED'
        }
      }
    );
  }
}

// Helper: Determine if a request is an API / Data request
function isApiRequest(url, request) {
  const path = url.pathname.toLowerCase();
  const host = url.hostname.toLowerCase();

  // 1. Common API path patterns
  if (path.includes('/api/') || path.startsWith('/v1/') || path.startsWith('/v2/') ||
      path.includes('/graphql') || path.includes('/rest/') || path.includes('/query') ||
      path.includes('/db/') || path.includes('/data/')) {
    return true;
  }

  // 2. Firebase Auth, Google Identity, Supabase, Appwrite API domains (excluding Firestore DB transport handled by Provider Adapter)
  if (host.includes('identitytoolkit.googleapis.com') ||
      host.includes('securetoken.googleapis.com') ||
      host.includes('supabase') ||
      host.includes('appwrite')) {
    return true;
  }

  // 3. Request headers indicating API data exchange
  const accept = request.headers.get('accept') || '';
  const contentType = request.headers.get('content-type') || '';
  if (accept.includes('application/json') || contentType.includes('application/json')) {
    return true;
  }

  // 4. Non-GET requests that are not standard HTML form navigations
  if (request.method !== 'GET' && request.mode !== 'navigate') {
    return true;
  }

  return false;
}

// Helper: Handle API requests with Network-First and Offline JSON / Cache Fallback
async function handleApiRequest(request) {
  const url = new URL(request.url);

  // Critical: POSA Engine internal routes MUST NOT return synthesized HTTP 200 when offline
  // Otherwise SDK receives HTTP 200 and deletes pending offline queue prematurely!
  const isPosaInternalRoute = url.pathname.includes('/api/v1/posa/') ||
                             url.pathname.includes('/api/v1/telemetry') ||
                             url.pathname.includes('/api/v1/alerts') ||
                             url.pathname.includes('/api/v1/config');

  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse && (networkResponse.status >= 200 && networkResponse.status < 300) && request.method === 'GET') {
      try { cache.put(request, networkResponse.clone()); } catch(e){}
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

    // If it's a GET request, check cache using EXACT URL fingerprinting (ignoreSearch: false)
    if (request.method === 'GET') {
      const cachedResponse = await cache.match(request, { ignoreSearch: false });
      if (cachedResponse) {
        console.log('[ASG ServiceWorker] ✅ Serving cached API data offline (CACHE_HIT):', request.url);
        // Clone response and attach CACHE_HIT status header
        const headers = new Headers(cachedResponse.headers);
        headers.set('X-ASG-Cache-Status', 'CACHE_HIT');
        headers.set('X-ASG-Offline-Source', 'CacheStorage');
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers
        });
      }

      // GET Cache Miss when offline: Return HTTP 504 Gateway Timeout with explicit CACHE_MISS / OFFLINE_UNAVAILABLE status
      console.warn('[ASG ServiceWorker] ⚠️ API request cache miss offline (CACHE_MISS):', request.url);
      return new Response(
        JSON.stringify({
          success: false,
          offline: true,
          cacheStatus: 'CACHE_MISS',
          error: 'OFFLINE_UNAVAILABLE',
          reason: 'Requested API resource is not cached in local ASG offline storage.',
          url: request.url,
          timestamp: new Date().toISOString()
        }),
        {
          status: 504,
          headers: {
            'Content-Type': 'application/json',
            'X-ASG-Cache-Status': 'CACHE_MISS',
            'X-ASG-Offline-Source': 'None'
          }
        }
      );
    } else {
      // Non-GET mutating requests (POST/PUT/PATCH/DELETE) return HTTP 202 Accepted (LOCAL_ACCEPTED / PENDING_SERVER_COMMIT)
      return new Response(
        JSON.stringify({
          success: true,
          offlineQueued: true,
          status: 'LOCAL_ACCEPTED',
          stage: 'PENDING_SERVER_COMMIT',
          message: 'Operation accepted locally into ASG POSA journal. Pending authoritative commit upon reconnection.',
          url: request.url,
          timestamp: new Date().toISOString()
        }),
        {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
            'X-ASG-Operation-Status': 'LOCAL_ACCEPTED',
            'X-ASG-Operation-Stage': 'PENDING_SERVER_COMMIT'
          }
        }
      );
    }
  }
}

// Helper: Check if request is a provider database transport (e.g. Firestore WebChannel, REST, or streaming endpoints)
function isProviderDatabaseTransport(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const search = url.search.toLowerCase();
  return host.includes('firestore.googleapis.com') ||
         path.includes('listen/channel') ||
         path.includes('google.firestore.v1.firestore/listen') ||
         search.includes('gsessionid') ||
         search.includes('ver=8') ||
         search.includes('rid=rpc') ||
         path.includes('/$rpc/google.');
}

// Intercept Fetch Requests
self.addEventListener('fetch', (event) => {
  let request = event.request;
  const url = new URL(request.url);

  // Skip chrome-extension or invalid schemes
  if (url.protocol.startsWith('chrome-extension')) {
    return;
  }

  // Provider database transport bypass (e.g. Firestore WebChannel / REST streams)
  // Allow provider DB requests to bypass SW JSON synthesis so native provider SDK controls offline state & persistence
  if (isProviderDatabaseTransport(url)) {
    return;
  }

  // INVARIANT: Hard Local Transmission Boundary
  // Strip asg_off_sess_* tokens from outgoing network requests to external servers
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.includes('asg_off_sess_') || authHeader.includes('asg_offline_session_')) {
    const cleanHeaders = new Headers(request.headers);
    cleanHeaders.delete('Authorization');
    request = new Request(request, { headers: cleanHeaders });
    console.log('[ASG ServiceWorker] 🛡️ Stripped local offline session token from outgoing network request header:', url.pathname);
  }

  // 1. Intercept Firebase Auth / Identity requests for seamless offline login
  if (isFirebaseAuthRequest(url)) {
    event.respondWith(handleFirebaseAuthRequest(request));
    return;
  }

  // 2. Intercept API routes (including Firebase, Firestore, GraphQL, REST, and cross-origin APIs)
  if (isApiRequest(url, request)) {
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
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ success: true, message: 'All offline caches cleared' });
    }
  }

  if (data.type === 'GET_CACHE_KEYS') {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    const urls = requests.map(r => r.url);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ success: true, urls });
    }
  }
});
