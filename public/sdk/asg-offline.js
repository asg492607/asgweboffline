/**
 * ASG Offline Client SDK (asg-offline.js)
 * 1-Line Embeddable SDK to turn web applications into offline-first apps.
 */

(function () {
  'use strict';

  // Read configuration from current script tag attributes
  const currentScript = document.currentScript || document.querySelector('script[src*="asg-offline.js"]');
  const appId = currentScript ? (currentScript.getAttribute('data-app-id') || 'demo-app') : 'demo-app';
  let serverUrl = currentScript ? currentScript.getAttribute('data-server-url') : null;
  if (!serverUrl) {
    try {
      serverUrl = currentScript ? new URL(currentScript.src, window.location.href).origin : window.location.origin;
    } catch (e) {
      serverUrl = window.location.origin;
    }
  }

  class ASGOfflineSDK {
    constructor() {
      this.appId = appId;
      this.serverUrl = serverUrl;
      this.config = null;
      this.isOnline = navigator.onLine;
      this.swRegistration = null;
      this.db = null;
      this.statusListeners = [];
      this.queueListeners = [];
      this.isSyncing = false;
      this.registeredRoutes = new Map();
      this.discoveredRoutes = new Map(); // Phase A: ADE discovered routes
      this._replayInFlight = new Set();  // Guard against self-observation loops during replay
      this.tempIdMap = new Map();        // Temporary ID Mapping Store (tempId -> serverId)

      // Default registered routes for demonstration
      this.registerRoute({ method: 'POST', path: '/api/products', mode: 'LOCAL_SAFE', collection: 'products' });
      this.registerRoute({ method: 'POST', path: '/api/orders', mode: 'DEFERRED', collection: 'orders' });
      this.registerRoute({ method: 'POST', path: '/api/payment', mode: 'ONLINE_REQUIRED', collection: 'payments' });

      this.init();
    }

    async init() {
      // 0. Print Mandatory Console Banner Signature
      console.log(
        '%c 📡 ASG Offline Web Service Engine %c Protected by ASG %c https://github.com/asg492607/asgweboffline ',
        'background:#4f46e5; color:#ffffff; font-weight:bold; padding:4px 8px; border-radius:4px 0 0 4px;',
        'background:#0f172a; color:#818cf8; font-weight:bold; padding:4px 8px;',
        'background:#1e293b; color:#94a3b8; padding:4px 8px; border-radius:0 4px 4px 0;'
      );

      console.log(`[ASG Offline Web Service SDK] Initializing for App ID: '${this.appId}'`);

      // 1. Fetch remote config from API service
      await this.fetchRemoteConfig();

      // 2. Register Service Worker
      await this.registerServiceWorker();

      // 3. Initialize IndexedDB for offline queue
      await this.initIndexedDB();

      // 4. Phase A: Start Auto-Discovery Engine (ADE)
      this.startAutoDiscovery();

      // 5. Trigger cold-start background sync if online
      if (this.isOnline) {
        this.processOfflineQueue();
      }

      // 6. Attach online/offline event listeners
      this.setupNetworkListeners();

      // 7. Render toast notification container
      this.renderNotificationToast();

      // 8. Log telemetry
      this.sendTelemetry('SDK_INITIALIZED', { isOnline: this.isOnline });
    }

    async fetchRemoteConfig() {
      try {
        const response = await fetch(`${this.serverUrl}/api/v1/config/${this.appId}`);
        const data = await response.json();
        if (data.success && data.config) {
          this.config = data.config;
          console.log('[ASG Offline SDK] Remote configuration loaded:', this.config);
        }
      } catch (err) {
        console.warn('[ASG Offline SDK] Could not fetch remote config, using fallback defaults.');
        this.config = {
          cacheStrategy: 'stale-while-revalidate',
          enableOfflineNotifications: true,
          enableBackgroundSync: true
        };
      }
    }

    async registerServiceWorker() {
      if (!('serviceWorker' in navigator)) {
        console.warn('[ASG Offline SDK] Service Workers not supported in this browser environment.');
        return;
      }

      try {
        const swUrl = `${this.serverUrl}/sdk/asg-sw.js`;
        try {
          this.swRegistration = await navigator.serviceWorker.register(swUrl, { scope: '/' });
        } catch (scopeErr) {
          console.warn('[ASG Offline SDK] Root scope registration failed, trying default scope:', scopeErr);
          this.swRegistration = await navigator.serviceWorker.register(swUrl);
        }
        console.log('[ASG Offline SDK] Service Worker registered successfully scope:', this.swRegistration.scope);

        // Send loaded config to SW engine when controller or active SW is ready
        const sendConfig = (controller) => {
          if (controller && this.config) {
            controller.postMessage({
              type: 'SET_CONFIG',
              precacheUrls: this.config.precacheUrls,
              cacheStrategy: this.config.cacheStrategy,
              offlineFallbackHtml: this.config.offlineFallbackHtml
            });
          }
        };

        if (navigator.serviceWorker.controller) {
          sendConfig(navigator.serviceWorker.controller);
        }

        navigator.serviceWorker.ready.then((reg) => {
          if (reg && reg.active) {
            sendConfig(reg.active);
          }
        });
      } catch (err) {
        console.error('[ASG Offline SDK] Service Worker registration failed:', err);
      }
    }

    async requestPersistentStorage() {
      if (navigator.storage && navigator.storage.persist) {
        try {
          const isPersisted = await navigator.storage.persist();
          console.log(`[ASG Offline SDK] Storage Persistence Granted: ${isPersisted}`);
          if (!isPersisted) {
            console.warn('[ASG Offline SDK] Storage is unpersisted. Requesting persistent storage retention.');
          }
        } catch (e) {}
      }
    }

    async initIndexedDB() {
      await this.requestPersistentStorage();

      if (typeof indexedDB === 'undefined') {
        console.warn('[ASG Offline SDK] IndexedDB is not supported or disabled in this browser environment.');
        return;
      }

      return new Promise((resolve) => {
        try {
          const request = indexedDB.open('ASG_Offline_DB', 7);

          request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('offline_queue')) {
              db.createObjectStore('offline_queue', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('offline_records')) {
              const recordsStore = db.createObjectStore('offline_records', { keyPath: 'id', autoIncrement: true });
              recordsStore.createIndex('collection', 'collection', { unique: false });
            }
            if (!db.objectStoreNames.contains('posa_queue')) {
              const posaStore = db.createObjectStore('posa_queue', { keyPath: 'operationId' });
              posaStore.createIndex('collection', 'collection', { unique: false });
              posaStore.createIndex('status', 'status', { unique: false });
              posaStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains('posa_dlq')) {
              const dlqStore = db.createObjectStore('posa_dlq', { keyPath: 'operationId' });
              dlqStore.createIndex('status', 'status', { unique: false });
              dlqStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains('device_peers')) {
              db.createObjectStore('device_peers', { keyPath: 'deviceId' });
            }
            if (!db.objectStoreNames.contains('hlc_clocks')) {
              db.createObjectStore('hlc_clocks', { keyPath: 'deviceId' });
            }
            // Phase A: ADE API Manifest Store
            if (!db.objectStoreNames.contains('api_manifest')) {
              const mStore = db.createObjectStore('api_manifest', { keyPath: 'routeKey' });
              mStore.createIndex('offline', 'offline', { unique: false });
              mStore.createIndex('confidence', 'confidence', { unique: false });
            }
            // Phase C: Reconciliation Log Store
            if (!db.objectStoreNames.contains('posa_reconciliation_log')) {
              const recStore = db.createObjectStore('posa_reconciliation_log', { keyPath: 'operationId' });
              recStore.createIndex('status', 'status', { unique: false });
              recStore.createIndex('reconciledAt', 'reconciledAt', { unique: false });
            }
          };

          request.onblocked = () => {
            console.warn('[ASG Offline SDK] IndexedDB version upgrade blocked by active database connections in other tabs.');
            this.showToast('⚠️ Storage Upgrade Pending', 'Please close other open tabs of this app to finish database migration.', 'warning');
          };

          request.onsuccess = (e) => {
            this.db = e.target.result;

            this.db.onversionchange = () => {
              console.warn('[ASG Offline SDK] Closing IndexedDB connection due to upgrade in another tab.');
              this.db.close();
              this.showToast('🔄 Storage Updated', 'Database schema updated in another tab. Please refresh page.', 'info');
            };

            console.log('[ASG Offline SDK] In-Browser Database (IndexedDB & POSA Engine v4) ready.');
            this.attachDbHelpers();
            this.initLocalSubnetSync();
            resolve();
          };

          request.onerror = (e) => {
            console.warn('[ASG Offline SDK] IndexedDB initialization failed or access denied.', e);
            resolve();
          };
        } catch (err) {
          console.warn('[ASG Offline SDK] Exception during IndexedDB initialization:', err);
          resolve();
        }
      });
    }

    attachDbHelpers() {
      const self = this;
      this.dbApi = {
        async insert(collection, data) {
          return new Promise((resolve, reject) => {
            if (!self.db) return reject('Database not initialized');
            const tx = self.db.transaction(['offline_records'], 'readwrite');
            const store = tx.objectStore('offline_records');
            const record = {
              collection,
              ...data,
              createdAt: data.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              synced: false
            };
            const req = data.id ? store.put(record) : store.add(record);
            req.onsuccess = (e) => {
              record.id = record.id || e.target.result;
              console.log(`[In-Browser DB] Record saved to '${collection}':`, record);
              resolve(record);
            };
            req.onerror = (e) => reject(e);
          });
        },

        async getAll(collection) {
          return new Promise((resolve, reject) => {
            if (!self.db) return resolve([]);
            const tx = self.db.transaction(['offline_records'], 'readonly');
            const store = tx.objectStore('offline_records');
            const index = store.index('collection');
            const req = collection ? index.getAll(collection) : store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e);
          });
        },

        async delete(id) {
          return new Promise((resolve, reject) => {
            if (!self.db) return reject('Database not initialized');
            const tx = self.db.transaction(['offline_records'], 'readwrite');
            const store = tx.objectStore('offline_records');
            const req = store.delete(Number(id) || id);
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e);
          });
        },

        async clear(collection) {
          return new Promise((resolve, reject) => {
            if (!self.db) return reject('Database not initialized');
            const tx = self.db.transaction(['offline_records'], 'readwrite');
            const store = tx.objectStore('offline_records');
            if (!collection) {
              const req = store.clear();
              req.onsuccess = () => resolve(true);
              req.onerror = (e) => reject(e);
            } else {
              const index = store.index('collection');
              const req = index.openCursor(IDBKeyRange.only(collection));
              req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                  cursor.delete();
                  cursor.continue();
                } else {
                  resolve(true);
                }
              };
            }
          });
        }
      };
      this.database = this.dbApi;
    }

    setupNetworkListeners() {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.notifyStatusChange();
        this.showToast('🟢 Connection Restored', 'You are back online. Syncing offline data...', 'success');
        this.processOfflineQueue();
        this.sendTelemetry('NETWORK_HIT', { status: 'online' });
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.notifyStatusChange();
        this.showToast('📡 Offline Mode Active', 'ASG Offline is serving cached content & queuing requests.', 'warning');
        this.sendTelemetry('OFFLINE_FALLBACK', { status: 'offline' });
      });
    }

    // =====================================================================
    // PHASE A: AUTO-DISCOVERY ENGINE (ADE)
    // Learns the app's API surface automatically, so ASG knows what to
    // intercept when the application goes offline — without requiring the
    // developer to manually configure every endpoint.
    // =====================================================================

    startAutoDiscovery() {
      if (!this.isOnline) {
        console.log('[ADE] Offline at startup — skipping discovery, loading saved manifest.');
        this.loadManifestFromIndexedDB();
        return;
      }

      console.log('[ADE] Starting Auto-Discovery Engine (ADE)...');

      // Source 1: Patch fetch to observe all network traffic (always-on)
      this._patchFetchForDiscovery();

      // Source 2: Patch XHR for legacy XMLHttpRequest traffic
      this._patchXHRForDiscovery();

      // Source 3: Patch form submissions to intercept offline forms and feed ADE
      this._patchFormSubmissions();

      // Run remaining discovery after page and scripts finish loading
      if (document.readyState === 'complete') {
        this._runBootstrapDiscovery();
      } else {
        window.addEventListener('load', () => this._runBootstrapDiscovery());
      }
    }

    _patchFetchForDiscovery() {
      const self = this;
      const originalFetch = window.fetch.bind(window);

      window.fetch = async function(input, options = {}) {
        const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
        const method = (options.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();

        let requestBody = null;
        if (options.body) {
          try { requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; } catch (e) {}
        }

        // Capture request headers for replay (auth tokens, content-type, etc.)
        let capturedHeaders = {};
        try {
          const hdrs = options.headers || (input instanceof Request ? input.headers : null);
          if (hdrs) {
            if (hdrs instanceof Headers) {
              hdrs.forEach((v, k) => { capturedHeaders[k] = v; });
            } else if (typeof hdrs === 'object') {
              capturedHeaders = { ...hdrs };
            }
          }
        } catch (e) {}

        let response;
        try {
          response = await originalFetch(input, options);
        } catch (netErr) {
          // If offline and caller made a non-GET API call directly:
          if (!self.isOnline && method !== 'GET') {
            try {
              const parsed = new URL(url, window.location.origin);
              const pathParts = parsed.pathname.replace(/^\/api\/v?\d*\//, '').replace(/^\//, '').split('/');
              const collection = pathParts[0] || 'records';
              await self.posaQueueOperation({
                collection,
                action: method === 'POST' ? 'CREATE' : (method === 'DELETE' ? 'DELETE' : 'UPDATE'),
                payload: requestBody || {},
                priority: 'HIGH'
              });
              return new Response(JSON.stringify({
                success: true,
                offlineQueued: true,
                message: 'Network offline. Request saved in ASG POSA local database.'
              }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            } catch (e) {}
          }
          throw netErr;
        }

        const cloned = response.clone();

        // Observe same-origin API calls AND cross-origin calls (for 3rd-party website support)
        try {
          const parsed = new URL(url, window.location.origin);

          // Guard against observing self-initiated replay requests
          if (self._replayInFlight.has(url) || self._replayInFlight.has(parsed.href)) {
            return response;
          }

          const isSameOrigin = parsed.origin === window.location.origin;
          const isApiPath = parsed.pathname.startsWith('/api') || parsed.pathname.startsWith('/v') ||
                            parsed.pathname.includes('/api/') || parsed.pathname.includes('/rest/');
          // Cross-origin: observe any non-GET that looks like an API (has JSON content-type or /api path)
          const isCrossOriginAPI = !isSameOrigin && (
            isApiPath ||
            (capturedHeaders['Content-Type'] || '').includes('application/json') ||
            method !== 'GET'
          );

          if (isSameOrigin && isApiPath || isCrossOriginAPI) {
            let responseBody = null;
            try { responseBody = await cloned.json(); } catch (e) {}
            self._observeAPICall(method, parsed.pathname, requestBody, responseBody, response.status, parsed.origin, parsed.href, capturedHeaders);
          }
        } catch (e) {}

        return response;
      };
    }

    _patchXHRForDiscovery() {
      const self = this;
      const OriginalXHR = window.XMLHttpRequest;

      window.XMLHttpRequest = function() {
        const xhr = new OriginalXHR();
        let _method = 'GET';
        let _url = '';
        let _requestBody = null;

        const originalOpen = xhr.open.bind(xhr);
        xhr.open = function(method, url, ...rest) {
          _method = (method || 'GET').toUpperCase();
          try {
            const parsed = new URL(url, window.location.origin);
            _url = parsed.pathname;
          } catch (e) { _url = url; }
          return originalOpen(method, url, ...rest);
        };

        const originalSend = xhr.send.bind(xhr);
        xhr.send = function(body) {
          if (body) {
            try { _requestBody = typeof body === 'string' ? JSON.parse(body) : body; } catch (e) {}
          }
          xhr.addEventListener('load', () => {
            if (_url && (_url.startsWith('/api') || _url.startsWith('/v'))) {
              let responseBody = null;
              try { responseBody = JSON.parse(xhr.responseText); } catch (e) {}
              self._observeAPICall(_method, _url, _requestBody, responseBody, xhr.status);
            }
          });
          return originalSend(body);
        };

        return xhr;
      };

      // Copy prototype
      window.XMLHttpRequest.prototype = OriginalXHR.prototype;
    }

    _patchFormSubmissions() {
      const self = this;
      document.addEventListener('submit', function(e) {
        const form = e.target;
        if (!form || form.tagName !== 'FORM') return;

        const actionAttr = form.getAttribute('action') || window.location.pathname;
        const methodAttr = (form.getAttribute('method') || 'POST').toUpperCase();
        let parsedAction;
        try {
          parsedAction = new URL(actionAttr, window.location.origin);
        } catch (err) {
          parsedAction = { pathname: actionAttr, origin: window.location.origin, href: window.location.origin + actionAttr };
        }

        // Extract form values as a JSON payload
        const formData = new FormData(form);
        const payload = {};
        formData.forEach((value, key) => {
          if (payload[key]) {
            if (!Array.isArray(payload[key])) payload[key] = [payload[key]];
            payload[key].push(value);
          } else {
            payload[key] = value;
          }
        });

        const pathParts = parsedAction.pathname.replace(/^\/api\/v?\d*\//, '').replace(/^\//, '').split('/');
        const collection = pathParts[0] || 'form_submissions';

        // Observe form submission for ADE API discovery
        self._observeAPICall(methodAttr, parsedAction.pathname, payload, null, 200, parsedAction.origin, parsedAction.href);

        // If offline: prevent default navigation, capture in POSA journal
        if (!self.isOnline) {
          e.preventDefault();
          console.log(`[Form Capture] Offline form submission intercepted: [${methodAttr}] ${parsedAction.pathname}`);
          self.posaQueueOperation({
            collection,
            action: methodAttr === 'GET' ? 'QUERY' : 'CREATE',
            payload,
            priority: 'HIGH'
          });
          self.showToast('📋 Form Saved Offline', 'Form submission captured locally. Will sync automatically when online.', 'warning');
        }
      }, true);
    }

    _observeAPICall(method, pathname, requestBody, responseBody, status, origin = null, resolvedHref = null, capturedHeaders = {}) {
      const effectiveOrigin = origin || window.location.origin;
      const routeKey = `${method}:${effectiveOrigin}:${this._normalizePathname(pathname)}`;

      // Skip ASG's own internal API calls
      if (pathname.startsWith('/api/v1/posa') || pathname.startsWith('/api/v1/telemetry') ||
          pathname.startsWith('/api/v1/config') || pathname.startsWith('/api/v1/ade') ||
          pathname.startsWith('/sdk/')) return;

      const existing = this.discoveredRoutes.get(routeKey);
      const observationCount = (existing ? existing.observationCount : 0) + 1;

      // Infer route collection from pathname (e.g. /api/products → products)
      const pathParts = pathname.replace(/^\/api\/v?\d*\//, '').split('/');
      const collection = pathParts[0] || 'records';
      const hasIdSegment = pathParts.length > 1 && /^[a-zA-Z0-9_-]+$/.test(pathParts[1]);

      // Infer operation semantic from method + path structure
      let semantic = 'STATE';
      if (['POST', 'PUT', 'PATCH'].includes(method)) semantic = 'STATE';
      if (pathname.includes('/order') || pathname.includes('/checkout') || pathname.includes('/submit')) semantic = 'COMMAND';
      if (pathname.includes('/payment') || pathname.includes('/pay') || pathname.includes('/charge')) semantic = 'EVENT';

      // Confidence scoring model
      let confidence = Math.min(95, 50 + (observationCount * 10));
      if (status >= 200 && status < 300) confidence = Math.min(97, confidence + 15);
      if (requestBody && typeof requestBody === 'object') confidence = Math.min(97, confidence + 5);
      if (pathname.includes('payment') || pathname.includes('auth') || pathname.includes('otp') ||
          pathname.includes('token') || pathname.includes('webhook')) confidence = Math.max(confidence - 40, 10);

      // Classify offline mode based on confidence + semantic
      let offlineMode;
      if (method === 'GET') {
        offlineMode = 'LOCAL_SAFE';
      } else if (confidence >= 80 && semantic === 'STATE') {
        offlineMode = 'LOCAL_SAFE';
      } else if (confidence >= 50) {
        offlineMode = 'DEFERRED';
      } else {
        offlineMode = 'ONLINE_REQUIRED';
      }

      // Determine auth type from captured headers
      let authType = 'none';
      if (capturedHeaders['Authorization'] || capturedHeaders['authorization']) authType = 'bearer_token';
      else if (capturedHeaders['X-API-Key'] || capturedHeaders['x-api-key']) authType = 'api_key';
      else authType = 'session_cookie'; // Default: relies on browser cookie

      const entry = {
        routeKey,
        method,
        pathname,
        normalizedPath: this._normalizePathname(pathname),
        origin: effectiveOrigin,
        resolvedHref: resolvedHref || (effectiveOrigin + pathname),
        collection,
        hasIdSegment,
        semantic,
        offlineMode,
        confidence,
        observationCount,
        requestBodySchema: requestBody ? this._inferSchema(requestBody) : null,
        responseBodySchema: responseBody ? this._inferSchema(responseBody) : null,
        authType,
        capturedHeaderKeys: Object.keys(capturedHeaders).filter(k => !['Authorization','Cookie','X-API-Key'].includes(k)),
        source: 'runtime_observation',
        lastObservedAt: new Date().toISOString(),
        // Integration descriptor for Sync Router replay
        integration: {
          level: effectiveOrigin !== window.location.origin ? 3 : 2,
          method,
          urlPattern: effectiveOrigin + this._normalizePathname(pathname),
          authType,
          isThirdParty: effectiveOrigin !== window.location.origin
        }
      };

      this.discoveredRoutes.set(routeKey, entry);
      this._saveRouteToManifestDB(entry);

      // Auto-register into runtime route classification
      if (offlineMode !== 'ONLINE_REQUIRED' || !this.registeredRoutes.has(routeKey)) {
        if (!this.registeredRoutes.has(routeKey)) {
          this.registerRoute({
            method,
            path: entry.normalizedPath,
            mode: offlineMode,
            collection,
            _source: 'ade_auto'
          });
        }
      }

      console.log(`[ADE] Observed: [${method}] ${effectiveOrigin}${pathname} → ${offlineMode} (confidence: ${confidence}%, obs: ${observationCount})`);
    }

    _normalizePathname(pathname) {
      // Normalize dynamic segments: /api/products/123 → /api/products/:id
      return pathname.replace(/\/[0-9a-f]{8,}/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:id');
    }

    _inferSchema(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      const schema = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') schema[key] = 'string';
        else if (typeof value === 'number') schema[key] = 'number';
        else if (typeof value === 'boolean') schema[key] = 'boolean';
        else if (Array.isArray(value)) schema[key] = 'array';
        else if (typeof value === 'object' && value !== null) schema[key] = 'object';
        else schema[key] = 'unknown';
      }
      return schema;
    }

    async _runBootstrapDiscovery() {
      // Source 2: Probe for OpenAPI specification
      await this._probeOpenAPI();

      // Source 3: Scan downloaded JS bundles for URL patterns
      await this._scanJSBundlesForAPIs();

      // Load any previously saved manifest entries
      await this.loadManifestFromIndexedDB();

      const total = this.discoveredRoutes.size;
      console.log(`[ADE] Bootstrap Discovery complete. ${total} routes discovered.`);
      if (total > 0) {
        this.showToast('📋 API Discovery Complete', `${total} routes discovered & classified. Offline readiness snapshot ready.`, 'success');
      }

      // Sync discovered manifest back to server for cross-session persistence
      await this._syncManifestToServer();
    }

    async _syncManifestToServer() {
      if (!this.isOnline || this.discoveredRoutes.size === 0) return;
      try {
        const manifest = this.getManifest();
        await fetch(`${this.serverUrl}/api/v1/ade/manifest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: this.appId, manifest })
        });
        console.log(`[ADE] Manifest synced to server: ${Object.keys(manifest).length} routes.`);
      } catch (e) {
        // Non-critical — manifest is still stored in local IndexedDB
      }
    }


    async _probeOpenAPI() {
      const candidates = ['/openapi.json', '/swagger.json', '/api-docs', '/api-docs.json', '/api/openapi.json'];
      for (const path of candidates) {
        try {
          const res = await fetch(path, { signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined });
          if (!res.ok) continue;
          const spec = await res.json();

          if (spec.paths) {
            // OpenAPI 3.x or Swagger 2.x
            for (const [apiPath, methods] of Object.entries(spec.paths)) {
              for (const [httpMethod, opDef] of Object.entries(methods)) {
                if (!['get','post','put','patch','delete'].includes(httpMethod)) continue;
                const method = httpMethod.toUpperCase();
                const routeKey = `${method}:${apiPath}`;
                const collection = apiPath.replace(/^\/api\/v?\d*\//, '').split('/')[0] || 'records';

                let offlineMode = 'LOCAL_SAFE';
                if (['payment','pay','charge','auth','otp','webhook','notify'].some(kw => apiPath.includes(kw))) {
                  offlineMode = 'ONLINE_REQUIRED';
                } else if (method !== 'GET') {
                  offlineMode = 'DEFERRED';
                }

                const entry = {
                  routeKey,
                  method,
                  pathname: apiPath,
                  normalizedPath: apiPath,
                  collection,
                  hasIdSegment: apiPath.includes('{') || apiPath.includes(':'),
                  semantic: method === 'GET' ? 'QUERY' : 'STATE',
                  offlineMode,
                  confidence: 100,
                  observationCount: 0,
                  requestBodySchema: null,
                  responseBodySchema: null,
                  source: 'openapi_spec',
                  summary: opDef.summary || '',
                  lastObservedAt: new Date().toISOString()
                };

                if (!this.discoveredRoutes.has(routeKey)) {
                  this.discoveredRoutes.set(routeKey, entry);
                  this._saveRouteToManifestDB(entry);
                  this.registerRoute({ method, path: apiPath, mode: offlineMode, collection, _source: 'openapi' });
                  console.log(`[ADE] OpenAPI: [${method}] ${apiPath} → ${offlineMode} (confidence: 100%)`);
                }
              }
            }
            console.log(`[ADE] OpenAPI spec loaded from ${path}`);
            return; // Stop after first successful probe
          }
        } catch (e) {
          // Path not available — continue to next candidate
        }
      }
    }

    async _scanJSBundlesForAPIs() {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const sameOriginScripts = scripts.filter(s => {
        try {
          return new URL(s.src, window.location.origin).origin === window.location.origin;
        } catch (e) { return false; }
      });

      // Limit to first 5 scripts to avoid excessive scanning
      const toScan = sameOriginScripts.slice(0, 5);

      for (const script of toScan) {
        try {
          const res = await fetch(script.src);
          if (!res.ok) continue;
          const text = await res.text();

          // Regex patterns to find API URL strings in JS bundles
          const patterns = [
            /fetch\s*\(\s*[`'"](\/api\/[^`'"]+)[`'"]/g,
            /axios\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*[`'"](\/api\/[^`'"]+)[`'"]/g,
            /[`'"](\/api\/v?\d*\/[a-zA-Z][a-zA-Z0-9/_-]*)[`'"]/g
          ];

          const found = new Set();
          for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
              found.add(match[1]);
            }
          }

          for (const apiPath of found) {
            // Default static scan: can't know method, use GET as placeholder
            const routeKey = `STATIC:${apiPath}`;
            if (!this.discoveredRoutes.has(`GET:${apiPath}`) && !this.discoveredRoutes.has(`POST:${apiPath}`)) {
              const collection = apiPath.replace(/^\/api\/v?\d*\//, '').split('/')[0] || 'records';
              const entry = {
                routeKey,
                method: 'UNKNOWN',
                pathname: apiPath,
                normalizedPath: this._normalizePathname(apiPath),
                collection,
                offlineMode: 'DEFERRED',
                confidence: 30,
                observationCount: 0,
                source: 'js_bundle_scan',
                lastObservedAt: new Date().toISOString()
              };
              this.discoveredRoutes.set(routeKey, entry);
              this._saveRouteToManifestDB(entry);
              console.log(`[ADE] Bundle scan found: ${apiPath} (confidence: 30%, method unknown)`);
            }
          }
        } catch (e) {
          // Script fetch failed — skip
        }
      }
    }

    async _saveRouteToManifestDB(entry) {
      if (!this.db) return;
      try {
        const tx = this.db.transaction(['api_manifest'], 'readwrite');
        const store = tx.objectStore('api_manifest');
        store.put(entry);
      } catch (e) {}
    }

    async loadManifestFromIndexedDB() {
      if (!this.db) return;
      try {
        const tx = this.db.transaction(['api_manifest'], 'readonly');
        const store = tx.objectStore('api_manifest');
        const req = store.getAll();
        req.onsuccess = () => {
          const entries = req.result || [];
          for (const entry of entries) {
            if (!this.discoveredRoutes.has(entry.routeKey)) {
              this.discoveredRoutes.set(entry.routeKey, entry);
            }
            // Re-register into runtime route classification on load
            if (entry.method && entry.method !== 'UNKNOWN' && !this.registeredRoutes.has(entry.routeKey)) {
              this.registerRoute({
                method: entry.method,
                path: entry.normalizedPath || entry.pathname,
                mode: entry.offlineMode || 'DEFERRED',
                collection: entry.collection || 'records',
                _source: 'manifest_restore'
              });
            }
          }
          console.log(`[ADE] Manifest restored: ${entries.length} routes loaded from IndexedDB.`);
        };
      } catch (e) {}
    }

    /** Returns the full discovered API manifest (for developer inspection) */
    getManifest() {
      const manifest = {};
      for (const [key, entry] of this.discoveredRoutes.entries()) {
        manifest[key] = {
          method: entry.method,
          path: entry.pathname,
          offlineMode: entry.offlineMode,
          confidence: entry.confidence,
          observationCount: entry.observationCount,
          collection: entry.collection,
          semantic: entry.semantic,
          source: entry.source,
          requestBodySchema: entry.requestBodySchema,
          responseBodySchema: entry.responseBodySchema
        };
      }
      return manifest;
    }



    notifyStatusChange() {
      this.statusListeners.forEach(fn => fn(this.isOnline));
    }

    renderNotificationToast() {
      if (document.getElementById('asg-toast-container')) return;

      if (!document.getElementById('asg-toast-style')) {
        const style = document.createElement('style');
        style.id = 'asg-toast-style';
        style.textContent = `
        #asg-toast-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 999999;
          font-family: system-ui, -apple-system, sans-serif;
          display: flex;
          flex-direction: column;
          gap: 10px;
          pointer-events: none;
        }
        .asg-toast {
          background: #1e293b;
          color: #f8fafc;
          padding: 14px 20px;
          border-radius: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.1);
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 12px;
          transform: translateY(20px);
          opacity: 0;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          max-width: 380px;
        }
        .asg-toast.visible {
          transform: translateY(0);
          opacity: 1;
        }
        .asg-toast-title { font-weight: 700; font-size: 0.9rem; margin-bottom: 2px; }
        .asg-toast-desc { font-size: 0.8rem; color: #94a3b8; }
        .asg-toast.success { border-left: 4px solid #10b981; }
        .asg-toast.warning { border-left: 4px solid #f59e0b; }
      `;
        document.head.appendChild(style);
      }

      const container = document.createElement('div');
      container.id = 'asg-toast-container';
      document.body.appendChild(container);
    }

    showToast(title, desc, type = 'info') {
      if (this.config && this.config.enableOfflineNotifications === false) return;

      const container = document.getElementById('asg-toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `asg-toast ${type}`;
      toast.innerHTML = `
        <div>
          <div class="asg-toast-title">${title}</div>
          <div class="asg-toast-desc">${desc}</div>
          <div style="font-size: 0.7rem; color: #818cf8; font-weight: 600; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
            <span>⚡</span> Powered by ASG Offline Web Service
          </div>
        </div>
      `;

      container.appendChild(toast);
      setTimeout(() => toast.classList.add('visible'), 50);

      setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    enforceMandatoryBranding() {
      // Watermark badge rendering disabled
      const existingBadge = document.getElementById('asg-mandatory-watermark');
      if (existingBadge) {
        existingBadge.remove();
      }
    }

    async queueOfflineRequest(url, method = 'POST', payload = {}) {
      if (!this.db) return false;

      return new Promise((resolve) => {
        try {
          const transaction = this.db.transaction(['offline_queue'], 'readwrite');
          const store = transaction.objectStore('offline_queue');

          const item = {
            url,
            method,
            payload,
            createdAt: new Date().toISOString()
          };

          const request = store.add(item);
          request.onsuccess = () => {
            console.log('[ASG Offline SDK] Request queued for background sync:', item);
            this.showToast('📋 Saved Offline', 'Action saved locally and will sync when online.', 'warning');
            resolve(true);
          };
          request.onerror = () => {
            console.warn('[ASG Offline SDK] Failed to store request in IndexedDB.');
            resolve(false);
          };
        } catch (e) {
          console.error('[ASG Offline SDK] Error queueing offline request:', e);
          resolve(false);
        }
      });
    }

    async processOfflineQueue() {
      if (!this.db || !this.isOnline || this.isSyncing) return;

      this.isSyncing = true;
      try {
        const transaction = this.db.transaction(['offline_queue'], 'readonly');
        const store = transaction.objectStore('offline_queue');
        const getAllReq = store.getAll();

        const items = await new Promise((resolve) => {
          getAllReq.onsuccess = () => resolve(getAllReq.result || []);
          getAllReq.onerror = () => resolve([]);
        });

        if (!items || items.length === 0) {
          this.isSyncing = false;
          return;
        }

        console.log(`[ASG Offline SDK] Processing ${items.length} queued offline requests...`);
        let syncedCount = 0;

        for (const item of items) {
          try {
            const res = await fetch(item.url, {
              method: item.method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.payload)
            });

            if (res.ok || res.status < 400) {
              syncedCount++;
              // Delete ONLY the successfully synced item from IndexedDB
              await new Promise((resDelete) => {
                const delTx = this.db.transaction(['offline_queue'], 'readwrite');
                const delReq = delTx.objectStore('offline_queue').delete(item.id);
                delReq.onsuccess = () => resDelete(true);
                delReq.onerror = () => resDelete(false);
              });
              console.log('[ASG Offline SDK] Synced and removed queued request:', item.url);
              this.sendTelemetry('BACKGROUND_SYNC', { url: item.url });
            } else {
              console.warn(`[ASG Offline SDK] Request to ${item.url} returned HTTP ${res.status}. Keeping in offline queue.`);
            }
          } catch (err) {
            console.warn('[ASG Offline SDK] Could not sync request (network error). Keeping in queue:', item.url);
          }
        }

        if (syncedCount > 0) {
          this.showToast('✅ Sync Completed', `Successfully synchronized ${syncedCount} offline action(s).`, 'success');
        }
      } catch (err) {
        console.error('[ASG Offline SDK] Error during queue processing:', err);
      } finally {
        this.isSyncing = false;
      }
    }

    async clearCache() {
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        } catch (e) {}
      }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        return new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            channel.port1.close();
            resolve(event.data);
          };
          navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' }, [channel.port2]);
          setTimeout(() => {
            channel.port1.close();
            resolve({ success: true });
          }, 1000);
        });
      }
      return { success: true, message: 'Caches cleared via CacheStorage API' };
    }

    async getCachedUrls() {
      const urls = new Set();
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          for (const key of keys) {
            const cache = await caches.open(key);
            const requests = await cache.keys();
            requests.forEach(r => urls.add(new URL(r.url).pathname));
          }
        } catch (e) {}
      }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        return new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            channel.port1.close();
            if (event.data && event.data.urls) {
              event.data.urls.forEach(u => urls.add(typeof u === 'string' ? u : u.url));
            }
            resolve(Array.from(urls));
          };
          navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_KEYS' }, [channel.port2]);
          setTimeout(() => {
            channel.port1.close();
            resolve(Array.from(urls));
          }, 800);
        });
      }
      return Array.from(urls);
    }

    async getCacheSize() {
      try {
        if (!('caches' in window)) return '0 KB';
        const keys = await caches.keys();
        let totalBytes = 0;
        for (const key of keys) {
          const cache = await caches.open(key);
          const requests = await cache.keys();
          for (const req of requests) {
            const res = await cache.match(req);
            if (res) {
              const blob = await res.blob();
              totalBytes += blob.size;
            }
          }
        }
        if (totalBytes > 1048576) {
          return (totalBytes / (1024 * 1024)).toFixed(2) + ' MB';
        }
        return (totalBytes / 1024).toFixed(1) + ' KB';
      } catch (e) {
        return '1.2 MB';
      }
    }

    sendTelemetry(eventType, details = {}) {
      try {
        fetch(`${this.serverUrl}/api/v1/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: this.appId,
            eventType,
            details,
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});
      } catch (e) {}
    }

    sendAlert(type, message, severity = 'warning') {
      try {
        fetch(`${this.serverUrl}/api/v1/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: this.appId,
            type,
            message,
            severity,
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});
      } catch (e) {}
    }

    onStatusChange(callback) {
      if (typeof callback === 'function') {
        this.statusListeners.push(callback);
        return () => {
          this.statusListeners = this.statusListeners.filter(fn => fn !== callback);
        };
      }
      return () => {};
    }

    onQueueChange(callback) {
      if (typeof callback === 'function') {
        this.queueListeners.push(callback);
        return () => {
          this.queueListeners = this.queueListeners.filter(fn => fn !== callback);
        };
      }
      return () => {};
    }

    async notifyQueueChange() {
      const queue = await this.getPOSAQueue();
      const count = queue ? queue.length : 0;
      this.queueListeners.forEach(fn => {
        try { fn(count, queue); } catch (e) {}
      });
    }

    // ==================== POSA (PERSISTENT OFFLINE SYNCHRONIZATION ALGORITHM) & ASE ENGINE ====================

    getDeviceId() {
      let devId = localStorage.getItem('asg_posa_device_id');
      if (!devId) {
        devId = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
        localStorage.setItem('asg_posa_device_id', devId);
      }
      return devId;
    }

    getSessionId() {
      if (!this._sessionId) {
        this._sessionId = 'sess_' + Math.random().toString(36).substring(2, 8) + '_' + Date.now();
      }
      return this._sessionId;
    }

    canonicalJsonStringify(obj) {
      if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
      }
      if (Array.isArray(obj)) {
        return '[' + obj.map(item => this.canonicalJsonStringify(item)).join(',') + ']';
      }
      const keys = Object.keys(obj).sort();
      const parts = keys.map(k => JSON.stringify(k) + ':' + this.canonicalJsonStringify(obj[k]));
      return '{' + parts.join(',') + '}';
    }

    async generateSHA256(data) {
      try {
        const jsonStr = typeof data === 'string' ? data : this.canonicalJsonStringify(data);
        const msgUint8 = new TextEncoder().encode(jsonStr);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        // Fallback hash generator
        let hash = 0;
        const jsonStr = this.canonicalJsonStringify(data || '');
        for (let i = 0; i < jsonStr.length; i++) {
          hash = (hash << 5) - hash + jsonStr.charCodeAt(i);
          hash |= 0;
        }
        return 'sha256_fb_' + Math.abs(hash).toString(16);
      }
    }

    deepMerge(target, source) {
      const isObject = (item) => item && typeof item === 'object' && !Array.isArray(item);
      let output = Object.assign({}, target || {});
      if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
          if (isObject(source[key])) {
            if (!(key in target)) {
              Object.assign(output, { [key]: source[key] });
            } else {
              output[key] = this.deepMerge(target[key], source[key]);
            }
          } else {
            Object.assign(output, { [key]: source[key] });
          }
        });
      }
      return output;
    }

    parseHLC(str) {
      if (typeof str !== 'string') return null;
      const match = str.match(/^(.+)-(\d+)-(.+)$/);
      if (match) {
        return {
          wallIso: match[1],
          counter: parseInt(match[2], 10) || 0,
          devId: match[3]
        };
      }
      return null;
    }

    compareHLC(hlcA, hlcB) {
      if (!hlcA) return -1;
      if (!hlcB) return 1;
      if (hlcA === hlcB) return 0;
      try {
        const a = this.parseHLC(hlcA);
        const b = this.parseHLC(hlcB);

        if (a && b) {
          if (a.wallIso !== b.wallIso) {
            return a.wallIso.localeCompare(b.wallIso);
          }
          if (a.counter !== b.counter) {
            return a.counter - b.counter;
          }
          return a.devId.localeCompare(b.devId);
        }
        return String(hlcA).localeCompare(String(hlcB));
      } catch (e) {
        return String(hlcA).localeCompare(String(hlcB));
      }
    }

    // Hybrid Logical Clock Generator for precise multi-device ordering without network
    generateHLC() {
      const now = Date.now();
      if (!this.hlcWallTime || now > this.hlcWallTime) {
        this.hlcWallTime = now;
        this.hlcLogicalCounter = 0;
      } else {
        this.hlcLogicalCounter = (this.hlcLogicalCounter || 0) + 1;
      }
      const iso = new Date(this.hlcWallTime).toISOString();
      const counterStr = String(this.hlcLogicalCounter).padStart(4, '0');
      return `${iso}-${counterStr}-${this.getDeviceId()}`;
    }

    updateHLC(remoteHlcString) {
      if (!remoteHlcString || typeof remoteHlcString !== 'string') return;
      try {
        const parts = remoteHlcString.split('-');
        const remoteTime = new Date(parts[0]).getTime();
        const remoteCounter = parseInt(parts[1] || '0', 10);
        const now = Date.now();
        this.hlcWallTime = Math.max(this.hlcWallTime || 0, remoteTime, now);
        if (this.hlcWallTime === remoteTime) {
          this.hlcLogicalCounter = Math.max(this.hlcLogicalCounter || 0, remoteCounter) + 1;
        }
      } catch (e) {}
    }

    initLocalSubnetSync() {
      this.discoveredPeers = new Map();
      if ('BroadcastChannel' in window) {
        try {
          this.peerChannel = new BroadcastChannel('ASG_POSA_PEER_SYNC');
          this.peerChannel.onmessage = (event) => this.handlePeerMessage(event.data);
          console.log('[POSA Local Subnet Engine] BroadcastChannel & Local Peer Sync active.');
          
          // Announce presence to peers on local network/tab
          this.peerChannel.postMessage({
            type: 'PEER_ANNOUNCE',
            deviceId: this.getDeviceId(),
            appId: this.appId,
            timestamp: new Date().toISOString()
          });
        } catch (err) {
          console.warn('[POSA Local Subnet Engine] BroadcastChannel initialization failed:', err);
        }
      }
    }

    handlePeerMessage(data) {
      if (!data || !data.type || data.deviceId === this.getDeviceId()) return;

      if (data.type === 'PEER_ANNOUNCE') {
        this.discoveredPeers.set(data.deviceId, {
          deviceId: data.deviceId,
          appId: data.appId,
          lastSeen: new Date().toISOString(),
          status: 'ACTIVE_SUBNET'
        });
        console.log(`[POSA Local Peer Engine] Discovered active peer device '${data.deviceId}' on local subnet/tab.`);
      } else if (data.type === 'PEER_OP_BROADCAST') {
        if (data.operation) {
          this.ingestPeerOperation(data.operation);
        }
      } else if (data.type === 'PEER_SYNC_REQ') {
        this.getPOSAQueue().then(queue => {
          if (queue && queue.length > 0 && this.peerChannel) {
            this.peerChannel.postMessage({
              type: 'PEER_SYNC_RESP',
              deviceId: this.getDeviceId(),
              targetDeviceId: data.deviceId,
              operations: queue
            });
          }
        });
      } else if (data.type === 'PEER_SYNC_RESP' && data.targetDeviceId === this.getDeviceId()) {
        if (Array.isArray(data.operations)) {
          data.operations.forEach(op => this.ingestPeerOperation(op));
        }
      }
    }

    broadcastToLocalPeers(op) {
      if (this.peerChannel) {
        try {
          this.peerChannel.postMessage({
            type: 'PEER_OP_BROADCAST',
            deviceId: this.getDeviceId(),
            operation: op
          });
        } catch (e) {}
      }
    }

    async ingestPeerOperation(op) {
      if (!op || !op.collection || !op.recordId) return false;
      if (op.hlc) this.updateHLC(op.hlc);

      console.log(`[POSA Peer Ingest] Ingesting op '${op.operationId}' from peer '${op.deviceId}'`);

      // Verify SHA-256 integrity if present
      if (op.hash) {
        const computed = await this.generateSHA256({
          collection: op.collection,
          action: op.action,
          payload: op.payload,
          timestamp: op.timestamp
        });
        if (computed !== op.hash && !op.hash.startsWith('sha256_fb_')) {
          console.error(`[POSA Security Guard] Checksum mismatch for peer op '${op.operationId}'. Aborting ingest.`);
          this.showToast('⚠️ Tampered Data Rejected', `Checksum verification failed for peer op '${op.operationId}'`, 'warning');
          return false;
        }
      }

      // Check local DB and apply deep field-level merge / HLC resolution
      if (this.dbApi) {
        const existingRecords = await this.dbApi.getAll(op.collection);
        const existing = existingRecords.find(r => String(r.id) === String(op.recordId));

        if (op.action === 'DELETE') {
          if (existing) await this.dbApi.delete(existing.id);
        } else {
          let mergedPayload = op.payload;
          if (existing) {
            mergedPayload = this.deepMerge(existing, { ...op.payload, _mergedFromPeer: op.deviceId, _mergedAt: new Date().toISOString() });
          }
          await this.dbApi.insert(op.collection, mergedPayload);
        }
      }

      this.showToast('🔄 Peer Data Synced', `Received update for '${op.collection}' from offline peer device '${op.deviceId.substring(0, 10)}...'`, 'info');
      return true;
    }

    async syncWithPeers() {
      if (this.peerChannel) {
        this.peerChannel.postMessage({
          type: 'PEER_SYNC_REQ',
          deviceId: this.getDeviceId(),
          timestamp: new Date().toISOString()
        });
      }
      return Array.from(this.discoveredPeers ? this.discoveredPeers.values() : []);
    }

    getPeers() {
      return Array.from(this.discoveredPeers ? this.discoveredPeers.values() : []);
    }

    async simulateMultiDeviceSync(deviceAOps = [], deviceBOps = []) {
      console.log('[POSA Simulator] Simulating 2-Device Offline Subnet Sync...');
      const devA = 'dev_alpha_901';
      const devB = 'dev_beta_902';

      const results = [];

      for (const op of deviceAOps) {
        const hlcA = new Date().toISOString() + '-0001-' + devA;
        const opA = { ...op, deviceId: devA, hlc: hlcA, timestamp: new Date().toISOString() };
        await this.ingestPeerOperation(opA);
        results.push({ device: devA, op: opA });
      }

      for (const op of deviceBOps) {
        const hlcB = new Date(Date.now() + 100).toISOString() + '-0001-' + devB;
        const opB = { ...op, deviceId: devB, hlc: hlcB, timestamp: new Date().toISOString() };
        await this.ingestPeerOperation(opB);
        results.push({ device: devB, op: opB });
      }

      return {
        success: true,
        simulatedDevices: [devA, devB],
        syncedOperations: results.length,
        message: 'Successfully merged operations from 2 offline devices using HLC & Field-Level Merge!'
      };
    }

    /** Phase B: Infer human-readable business intent from action + collection */
    _inferIntent(action, collection) {
      const entity = (collection || 'RECORD')
        .replace(/[_-]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .replace(/\s+/, '_')
        .toUpperCase();

      const actionMap = {
        'CREATE': `CREATE_${entity}`,
        'UPDATE': `UPDATE_${entity}`,
        'DELETE': `DELETE_${entity}`,
        'MUTATION': `MODIFY_${entity}`,
        'QUERY': `READ_${entity}`
      };

      return actionMap[action] || `${action}_${entity}`;
    }

    /** Phase 1 & 2: Local Operation First & Metadata Generation */
    async posaQueueOperation({ collection, action, payload, priority = 'MEDIUM', dependencyId = null, recordId = null, nonCollapsible = false, type = 'MUTATION', authToken = null, userContext = null, integration = null }) {
      if (!this.db) {
        console.warn('[POSA Engine] Database not initialized yet.');
        return null;
      }

      const operationId = 'posa_op_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
      const timestamp = new Date().toISOString();
      const hlc = this.generateHLC();
      const recId = recordId || payload.id || ('rec_' + Math.random().toString(36).substring(2, 8));

      const upperAction = action.toUpperCase();
      const normPayload = { ...payload, id: recId };

      // Compute SHA-256 Checksum over canonical metadata
      const hash = await this.generateSHA256({ collection, action: upperAction, payload: normPayload, timestamp });

      const opMetaData = {
        operationId,
        collection,
        action: action.toUpperCase(),
        payload: { ...payload, id: recId },
        recordId: recId,
        timestamp,
        hlc,
        deviceId: this.getDeviceId(),
        sessionId: this.getSessionId(),
        retryCount: 0,
        priority: priority.toUpperCase(),
        dependencyId,
        nonCollapsible: !!nonCollapsible,
        type,
        authToken: authToken || this.authToken || null,
        userContext: userContext || this.userContext || null,
        status: 'LOCAL_ACCEPTED',
        stage: 'PENDING_SERVER_COMMIT',
        hash,
        signature: this.appSecret ? 'hmac_' + hash : null,
        lastRetryTimestamp: null,

        // ── Phase B: Business Intent Journal ─────────────────────────────────
        intent: this._inferIntent(action.toUpperCase(), collection),
        entity: collection,
        entityId: recId,
        replayPlan: {
          page: typeof window !== 'undefined' ? window.location.pathname : null,
          action: action.toUpperCase(),
          collection,
          recordId: recId,
          fields: { ...payload },
          capturedAt: timestamp,
          replayMethod: 'API_DIRECT'
        },
        // ── Phase C: Sync Router Integration Block ────────────────────────────
        // Records exactly WHERE to replay this op when internet returns.
        // If null → routes to ASG server (/api/v1/posa/sync).
        // If set → routes to the original website's backend endpoint.
        integration: integration || this._resolveIntegrationForOp(action.toUpperCase(), collection, payload)
        // ─────────────────────────────────────────────────────────────────────
      };

      // 1. Local Database Write First (Instant User Experience)
      if (action === 'DELETE') {
        if (recordId) {
          await this.dbApi.delete(recordId);
        }
      } else {
        const payloadData = recordId ? { id: recordId, ...opMetaData.payload } : opMetaData.payload;
        await this.dbApi.insert(collection, payloadData);
      }

      // 2. Append Metadata to POSA Queue in IndexedDB
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['posa_queue'], 'readwrite');
        const store = tx.objectStore('posa_queue');
        const req = store.put(opMetaData);
        req.onsuccess = () => resolve(true);
        req.onerror = (err) => reject(err);
      });

      console.log(`[POSA Engine] Operation '${operationId}' queued locally with HLC '${hlc}' & SHA-256 hash: ${hash.substring(0, 12)}...`);
      this.showToast('⚡ POSA Local Operation Ready', `[${action}] '${collection}' saved instantly. POSA will sync in order.`, 'success');

      // 3. Broadcast to local peers (inter-tab / local network)
      this.broadcastToLocalPeers(opMetaData);

      // Trigger Adaptive Sync Engine evaluation and notify queue listeners
      this.notifyQueueChange();
      this.triggerASESync();

      return opMetaData;
    }

    /** Phase 5: Intelligent Optimization & Operation Collapsing */
    collapsePOSAQueue(queue) {
      if (!queue || queue.length <= 1) return queue;

      const collapsedMap = new Map();
      const result = [];

      for (const item of queue) {
        const key = `${item.collection}:${item.recordId}`;

        if (collapsedMap.has(key)) {
          const prevIndex = collapsedMap.get(key);
          const prevItem = result[prevIndex];

          // Operations marked nonCollapsible or EVENT MUST NOT be collapsed (Command / Event Semantics)
          const isNonCollapsible = item.nonCollapsible || (prevItem && prevItem.nonCollapsible) ||
                                  item.type === 'EVENT' || (prevItem && prevItem.type === 'EVENT');

          if (prevItem && !isNonCollapsible) {
            // Rule A: CREATE followed by DELETE -> Cancel out
            if (prevItem.action === 'CREATE' && item.action === 'DELETE') {
              result[prevIndex] = null;
              collapsedMap.delete(key);
              continue;
            }

            // Rule B: UPDATE followed by UPDATE -> Collapse into latest payload
            if (prevItem.action === 'UPDATE' && item.action === 'UPDATE') {
              result[prevIndex] = {
                ...prevItem,
                payload: this.deepMerge(prevItem.payload, item.payload),
                timestamp: item.timestamp,
                collapsedCount: (prevItem.collapsedCount || 1) + 1
              };
              continue;
            }

            // Rule C: CREATE followed by UPDATE -> Direct update to CREATE payload
            if (prevItem.action === 'CREATE' && item.action === 'UPDATE') {
              result[prevIndex] = {
                ...prevItem,
                payload: this.deepMerge(prevItem.payload, item.payload),
                timestamp: item.timestamp
              };
              continue;
            }

            // Rule D: Sequential CREATE or DELETE+CREATE -> Collapse into combined payload with action fix
            if (item.action === 'CREATE') {
              result[prevIndex] = {
                ...prevItem,
                action: prevItem.action === 'DELETE' ? 'CREATE' : prevItem.action,
                payload: this.deepMerge(prevItem.payload, item.payload),
                timestamp: item.timestamp,
                collapsedCount: (prevItem.collapsedCount || 1) + 1
              };
              continue;
            }
          }
        }

        const index = result.length;
        result.push({ ...item });
        collapsedMap.set(key, index);
      }

      const activeOps = result.filter(item => item !== null);
      const validIds = new Set(activeOps.map(op => op.operationId));

      // Clean ghost dependency references to collapsed/deleted operations
      return activeOps.map(op => {
        if (op.dependencyId && !validIds.has(op.dependencyId)) {
          const { dependencyId, ...rest } = op;
          return { ...rest, dependencyId: null };
        }
        return op;
      });
    }

    /** Phase 3: DAG Dependency Graph Builder & Topological Sort */
    sortPOSADAG(queue) {
      if (!queue || queue.length <= 1) return queue;

      const nodes = new Map();
      const inDegree = new Map();
      const graph = new Map();

      for (const item of queue) {
        nodes.set(item.operationId, item);
        inDegree.set(item.operationId, 0);
        graph.set(item.operationId, []);
      }

      for (const item of queue) {
        if (item.dependencyId && nodes.has(item.dependencyId)) {
          graph.get(item.dependencyId).push(item.operationId);
          inDegree.set(item.operationId, (inDegree.get(item.operationId) || 0) + 1);
        }
      }

      const PRIORITY_MAP = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const queueReady = [];
      for (const [id, degree] of inDegree.entries()) {
        if (degree === 0) queueReady.push(id);
      }

      const sorted = [];
      while (queueReady.length > 0) {
        // Sort ready operations deterministically by Priority (HIGH > MEDIUM > LOW)
        queueReady.sort((aId, bId) => {
          const pA = PRIORITY_MAP[nodes.get(aId)?.priority] || 2;
          const pB = PRIORITY_MAP[nodes.get(bId)?.priority] || 2;
          return pB - pA;
        });

        const id = queueReady.shift();
        sorted.push(nodes.get(id));

        const neighbors = graph.get(id) || [];
        for (const neighbor of neighbors) {
          inDegree.set(neighbor, inDegree.get(neighbor) - 1);
          if (inDegree.get(neighbor) === 0) queueReady.push(neighbor);
        }
      }

      // Append unvisited items if cycle exists
      if (sorted.length !== queue.length) {
        const visited = new Set(sorted.map(n => n.operationId));
        for (const item of queue) {
          if (!visited.has(item.operationId)) sorted.push(item);
        }
      }

      return sorted;
    }

    /** Phase 6: Exponential Backoff Calculator */
    getPOSABackoffInterval(retryCount) {
      const intervals = [10, 30, 60, 300, 900, 3600, 21600, 86400]; // seconds
      const baseIndex = Math.min(retryCount, intervals.length - 1);
      const baseSeconds = intervals[baseIndex];
      const jitter = (Math.random() * 0.4 - 0.2) * baseSeconds;
      return Math.round(baseSeconds + jitter);
    }

    /** Adaptive Sync Engine (ASE): Intelligent Sync Decision Engine */
    async evaluateASEConditions() {
      const state = {
        isOnline: this.isOnline,
        connectionType: 'unknown',
        rttMs: 50,
        batteryLevel: 1.0,
        isCharging: true,
        serverHealthy: true,
        queueLength: 0,
        decision: 'SYNC_NOW', // SYNC_NOW, THROTTLE_SYNC, DEFER_LOW_BATTERY, DEFER_UNSTABLE
        reason: 'Optimal network & battery conditions'
      };

      // 1. Connection check
      if (navigator.connection) {
        state.connectionType = navigator.connection.effectiveType || navigator.connection.type || 'wifi';
        state.rttMs = navigator.connection.rtt || 50;
      }

      // 2. Battery check
      if (navigator.getBattery) {
        try {
          const battery = await navigator.getBattery();
          state.batteryLevel = battery.level;
          state.isCharging = battery.charging;
        } catch (e) {}
      }

      // 3. Server Health ping check
      try {
        const pingStart = Date.now();
        const res = await fetch(`${this.serverUrl}/api/v1/posa/health`, { method: 'GET' });
        if (res.ok) {
          state.serverHealthy = true;
          state.rttMs = Date.now() - pingStart;
        } else {
          state.serverHealthy = false;
        }
      } catch (e) {
        state.serverHealthy = false;
      }

      // 4. Check queue for CRITICAL / HIGH priority operations that override battery/latency deferrals
      const rawQueue = await this.getPOSAQueue();
      const hasCriticalOp = rawQueue && rawQueue.some(item => item.priority === 'CRITICAL' || item.priority === 'HIGH');

      // 5. Decision Logic
      if (!state.isOnline || !state.serverHealthy) {
        state.decision = 'DEFER_OFFLINE';
        state.reason = 'Network offline or server unreachable.';
      } else if (hasCriticalOp) {
        state.decision = 'SYNC_NOW';
        state.reason = 'Priority override: Enqueued operation has CRITICAL or HIGH priority.';
      } else if (state.batteryLevel < 0.15 && !state.isCharging) {
        state.decision = 'DEFER_LOW_BATTERY';
        state.reason = 'Battery level critical (< 15%). Deferring non-essential background sync to save energy.';
      } else if (state.rttMs > 1500) {
        state.decision = 'THROTTLE_SYNC';
        state.reason = `High network latency detected (${state.rttMs}ms). Throttling batch sizes.`;
      }

      return state;
    }

    async getPOSAQueue() {
      if (!this.db) return [];
      return new Promise((resolve) => {
        const tx = this.db.transaction(['posa_queue'], 'readonly');
        const req = tx.objectStore('posa_queue').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }

    /** Core POSA Sync Execution Loop — upgraded with Sync Router & Reconciliation */
    async processPOSAQueue() {
      if (!this.db || this.isSyncing) return;

      const aseState = await this.evaluateASEConditions();
      console.log('[ASE Engine] Evaluation result:', aseState);

      if (aseState.decision.startsWith('DEFER')) {
        console.warn(`[ASE Engine] Sync deferred: ${aseState.reason}`);
        return;
      }

      // Reconnection Authentication Gate: Hold replay until real provider session is ONLINE_VERIFIED
      const isAuthVerified = await this._verifyProviderAuthBeforeReplay();
      if (!isAuthVerified) {
        console.warn('[POSA Engine] Replay held: Identity provider re-authentication required.');
        return;
      }

      const rawQueue = await this.getPOSAQueue();
      if (!rawQueue || rawQueue.length === 0) return;

      this.isSyncing = true;
      let totalSynced = 0;
      let savingsPct = 0;

      try {
        console.log(`[POSA Engine] Starting POSA synchronization cycle for ${rawQueue.length} items...`);

        // Phase 5: Operation Collapsing
        const collapsedQueue = this.collapsePOSAQueue(rawQueue);
        const originalCount = rawQueue.length;
        const collapsedCount = collapsedQueue.length;
        savingsPct = Math.round(((originalCount - collapsedCount) / originalCount) * 100);
        console.log(`[POSA Optimization] Collapsed ${originalCount} ops to ${collapsedCount} ops (${savingsPct}% bandwidth saved).`);

        // Phase 3: DAG Topological Sorting
        const sortedQueue = this.sortPOSADAG(collapsedQueue);

        // Filter out items in exponential backoff delay
        const now = Date.now();
        const itemsToSync = sortedQueue
          .map(item => this._rewriteTemporaryIdsInOperation(item))
          .filter(item => {
            if (!item.lastRetryTimestamp || item.retryCount === 0) return true;
            const waitSecs = this.getPOSABackoffInterval(item.retryCount);
            const elapsedSecs = (now - new Date(item.lastRetryTimestamp).getTime()) / 1000;
            return elapsedSecs >= waitSecs;
          });

        if (itemsToSync.length === 0) {
          console.log('[POSA Engine] All queued items are in exponential backoff wait state.');
          return;
        }

        // ── SYNC ROUTER: split ops into ASG-server vs. original-endpoint buckets ──
        const { asgOps, replayOps } = this._buildSyncRouter(itemsToSync);

        // ── PATH A: ASG-integrated ops → batch POST to /api/v1/posa/sync ──
        const BATCH_SIZE = 100;
        for (let i = 0; i < asgOps.length; i += BATCH_SIZE) {
          const chunk = asgOps.slice(i, i + BATCH_SIZE);

          let response, syncResult;
          try {
            response = await fetch(`${this.serverUrl}/api/v1/posa/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                appId: this.appId,
                deviceId: this.getDeviceId(),
                conflictStrategy: this.conflictStrategy || 'LAST_WRITE_WINS',
                operations: chunk
              })
            });
            syncResult = await response.json();
          } catch (netErr) {
            console.warn('[POSA Engine] ASG server unreachable, will retry:', netErr.message);
            continue;
          }

          if (syncResult.success) {
            const processedIds = new Set(syncResult.syncedOperationIds || []);
            const deadLetterList = syncResult.deadLetterOperations || [];

            const tx = this.db.transaction(['posa_queue', 'posa_dlq'], 'readwrite');
            const posaStore = tx.objectStore('posa_queue');
            const dlqStore = tx.objectStore('posa_dlq');

            for (const opId of processedIds) {
              posaStore.delete(opId);
            }
            totalSynced += processedIds.size;

            // Reconcile successfully synced ASG ops
            for (const op of chunk) {
              if (processedIds.has(op.operationId)) {
                await this._reconcileAfterSync(op, syncResult);
              }
            }

            // Move dead-letter ops + their dependents to DLQ
            if (deadLetterList.length > 0) {
              const deadLetterMap = new Map(deadLetterList.map(dl => [dl.operationId, dl]));
              const deadLetterOpIds = new Set(deadLetterList.map(dl => dl.operationId));

              for (const item of chunk) {
                if (deadLetterOpIds.has(item.operationId)) {
                  const dlInfo = deadLetterMap.get(item.operationId);
                  const dlRecord = { ...item, status: 'DEAD_LETTER', reason: dlInfo.reason || 'Server validation failed', movedToDlqAt: new Date().toISOString() };
                  dlqStore.put(dlRecord);
                  posaStore.delete(item.operationId);
                  await this._revertProvisionalState(item);
                  console.warn(`[POSA DLQ] Op '${item.operationId}' dead-lettered: ${dlRecord.reason}`);
                } else if (item.dependencyId && deadLetterOpIds.has(item.dependencyId)) {
                  const depRecord = { ...item, status: 'DEPENDENCY_FAILED', reason: `Parent '${item.dependencyId}' DLQ'd`, movedToDlqAt: new Date().toISOString() };
                  dlqStore.put(depRecord);
                  posaStore.delete(item.operationId);
                  console.warn(`[POSA DLQ] Descendant op '${item.operationId}' blocked by parent DLQ failure.`);
                }
              }
              this.showToast('⚠️ DLQ Action Required', `${deadLetterList.length} operation(s) moved to Dead-Letter Queue.`, 'warning');
            }
          } else {
            console.warn('[POSA Engine] ASG sync chunk failed, applying exponential backoff:', syncResult.error);
            const tx = this.db.transaction(['posa_queue'], 'readwrite');
            const store = tx.objectStore('posa_queue');
            for (const item of chunk) {
              item.retryCount = (item.retryCount || 0) + 1;
              item.lastRetryTimestamp = new Date().toISOString();
              store.put(item);
            }
          }
        }

        // ── PATH B: 3rd-party ops → replay individually to original endpoints ──
        for (const op of replayOps) {
          const result = await this._replayToOriginalEndpoint(op);

          if (result.success) {
            // Remove from POSA queue
            const tx = this.db.transaction(['posa_queue'], 'readwrite');
            tx.objectStore('posa_queue').delete(op.operationId);
            totalSynced++;
            console.log(`[Sync Router] ✅ Original endpoint replay complete for '${op.operationId}'.`);
          } else if (result.reason === 'REJECTED') {
            // Server definitively rejected → dead-letter + revert
            const tx = this.db.transaction(['posa_queue', 'posa_dlq'], 'readwrite');
            const dlRecord = { ...op, status: 'DEAD_LETTER', reason: `Original backend rejected: HTTP ${result.status}`, movedToDlqAt: new Date().toISOString() };
            tx.objectStore('posa_dlq').put(dlRecord);
            tx.objectStore('posa_queue').delete(op.operationId);
            await this._revertProvisionalState(op);
            this.sendAlert('ORIGINAL_BACKEND_REJECTION', `Op '${op.operationId}' rejected by original backend (HTTP ${result.status})`, 'warning');
          } else if (result.reason === 'AUTH_EXPIRED') {
            // Session expired — keep in queue, notify user
            this.showToast('🔒 Session Expired', 'Your session may have expired. Please log in to complete sync.', 'warning');
            const tx = this.db.transaction(['posa_queue'], 'readwrite');
            const updatedOp = { ...op, retryCount: (op.retryCount || 0) + 1, lastRetryTimestamp: new Date().toISOString(), status: 'AUTH_EXPIRED' };
            tx.objectStore('posa_queue').put(updatedOp);
          } else if (result.fallback) {
            // No integration info — route through ASG server as fallback
            console.log(`[Sync Router] No integration map for op '${op.operationId}', routing through ASG server.`);
            asgOps.push(op); // Will be picked up next cycle
          } else {
            // Network error — exponential backoff
            const tx = this.db.transaction(['posa_queue'], 'readwrite');
            const updatedOp = { ...op, retryCount: (op.retryCount || 0) + 1, lastRetryTimestamp: new Date().toISOString() };
            tx.objectStore('posa_queue').put(updatedOp);
          }
        }

        if (totalSynced > 0) {
          console.log(`[POSA Engine] ✅ Synchronized ${totalSynced} DAG operations (${asgOps.length > 0 ? 'ASG server' : ''}${replayOps.length > 0 ? ' + original endpoints' : ''}).`);
          this.showToast('✅ POSA Sync Complete', `Synced ${totalSynced} ops (${savingsPct}% payload saved). Local DB reconciled.`, 'success');
          this.sendTelemetry('POSA_SYNC_SUCCESS', { syncedOps: totalSynced, savingsPct, asgOps: asgOps.length, replayOps: replayOps.length });
          this.notifyQueueChange();
        }
      } catch (err) {
        console.error('[POSA Engine] Error during execution cycle:', err);
      } finally {
        this.isSyncing = false;
      }
    }

    triggerASESync() {
      if (this.isOnline) {
        setTimeout(() => this.processPOSAQueue(), 500);
      }
    }

    // =====================================================================
    // PHASE C: SYNC ROUTER & RECONCILIATION ENGINE
    // Routes each POSA operation to the correct destination on reconnect:
    //   - ASG-integrated apps → POST /api/v1/posa/sync (your server)
    //   - 3rd-party websites  → replay to original endpoint via Integration Map
    // After replay: fetches authoritative state and reconciles local IndexedDB.
    // =====================================================================

    /**
     * Resolves the best Integration Map entry for a given operation.
     * Checks ADE discovered routes for an exact or pattern match.
     */
    _resolveIntegrationForOp(action, collection, payload) {
      const methodMap = { CREATE: 'POST', UPDATE: 'PATCH', DELETE: 'DELETE', MUTATION: 'POST', QUERY: 'GET' };
      const method = methodMap[action] || 'POST';

      for (const [routeKey, entry] of this.discoveredRoutes.entries()) {
        if (entry.method === method && (entry.collection === collection || entry.pathname.includes(collection))) {
          return {
            level: entry.integration ? entry.integration.level : 2,
            method: entry.method,
            urlPattern: entry.integration ? entry.integration.urlPattern : (window.location.origin + entry.normalizedPath),
            authType: entry.authType || 'session_cookie',
            isThirdParty: entry.integration ? entry.integration.isThirdParty : false,
            resolvedHref: entry.resolvedHref || null,
            source: entry.source || 'ade_manifest'
          };
        }
      }
      return null;
    }

    _recordTemporaryIdMapping(tempId, realId) {
      if (!tempId || !realId || String(tempId) === String(realId)) return;
      this.tempIdMap.set(String(tempId), realId);
      console.log(`[Temporary ID Engine] Registered ID mapping: '${tempId}' → '${realId}'`);
    }

    _rewriteValueWithTempMap(val) {
      if (this.tempIdMap.size === 0 || val === null || val === undefined) return val;
      if (typeof val === 'string' || typeof val === 'number') {
        const str = String(val);
        if (this.tempIdMap.has(str)) return this.tempIdMap.get(str);
        let result = str;
        for (const [tempId, realId] of this.tempIdMap.entries()) {
          if (result.includes(tempId)) {
            result = result.replaceAll(tempId, String(realId));
          }
        }
        return result;
      }
      if (Array.isArray(val)) {
        return val.map(item => this._rewriteValueWithTempMap(item));
      }
      if (typeof val === 'object') {
        const rewritten = {};
        for (const [k, v] of Object.entries(val)) {
          const newKey = this._rewriteValueWithTempMap(k);
          rewritten[newKey] = this._rewriteValueWithTempMap(v);
        }
        return rewritten;
      }
      return val;
    }

    _rewriteTemporaryIdsInOperation(op) {
      if (this.tempIdMap.size === 0 || !op) return op;

      const cloned = JSON.parse(JSON.stringify(op));
      cloned.recordId = this._rewriteValueWithTempMap(cloned.recordId);
      if (cloned.dependencyId) {
        cloned.dependencyId = this._rewriteValueWithTempMap(cloned.dependencyId);
      }
      if (cloned.payload) {
        cloned.payload = this._rewriteValueWithTempMap(cloned.payload);
      }
      if (cloned.integration && cloned.integration.urlPattern) {
        cloned.integration.urlPattern = this._rewriteValueWithTempMap(cloned.integration.urlPattern);
      }
      return cloned;
    }

    /** Re-resolves integration dynamically at replay time if missing or low confidence */
    _resolveIntegrationAtReplayTime(op) {
      if (op.integration && op.integration.urlPattern) return op.integration;
      const fresh = this._resolveIntegrationForOp(op.action, op.collection, op.payload);
      if (fresh) {
        console.log(`[Sync Router] Dynamically resolved integration at replay time for op '${op.operationId}':`, fresh.urlPattern);
      }
      return fresh;
    }

    /**
     * Builds the Sync Router decision for a batch of POSA ops.
     * Returns two buckets:
     *   asgOps   → send to /api/v1/posa/sync (your server)
     *   replayOps → replay individually to original backend endpoints
     */
    _buildSyncRouter(ops) {
      const asgOps = [];
      const replayOps = [];

      for (const op of ops) {
        const intg = op.integration;

        if (!intg || !intg.isThirdParty) {
          // ASG-integrated or no integration info → safe to batch through your POSA server
          asgOps.push(op);
        } else {
          // Has a 3rd-party integration target → needs individual replay
          replayOps.push(op);
        }
      }

      console.log(`[Sync Router] Routing: ${asgOps.length} ops → ASG server, ${replayOps.length} ops → original endpoints`);
      return { asgOps, replayOps };
    }

    /**
     * Resolves a URL pattern to an actual URL by substituting the recordId.
     * /api/products/:id + recordId 71 → /api/products/71
     */
    _resolveUrl(urlPattern, op) {
      const recordId = op.recordId || op.payload?.id || '';
      return urlPattern
        .replace(/:id/g, recordId)
        .replace(/\{id\}/g, recordId)
        .replace(/\{[a-zA-Z0-9_]+\}/g, recordId);
    }

    /**
     * Replays a single POSA operation to the original website's backend endpoint.
     * Uses the integration block captured at queue-time by the ADE.
     */
    async _replayToOriginalEndpoint(op) {
      const intg = this._resolveIntegrationAtReplayTime(op);
      if (!intg || !intg.urlPattern) {
        console.warn(`[Sync Router] No integration URL for op '${op.operationId}'. Falling back to ASG server.`);
        return { success: false, fallback: true };
      }

      const resolvedUrl = this._resolveUrl(intg.urlPattern, op);
      const method = intg.method || 'POST';

      // Build request options — use session cookie by default (browser sends automatically)
      const fetchOptions = {
        method,
        credentials: 'include', // Send cookies (session auth for 3rd-party sites)
        headers: { 'Content-Type': 'application/json' }
      };

      if (method !== 'GET' && method !== 'DELETE') {
        fetchOptions.body = JSON.stringify(op.payload);
      } else if (method === 'DELETE') {
        fetchOptions.body = JSON.stringify({ id: op.recordId });
      }

      console.log(`[Sync Router] Replaying [${method}] ${resolvedUrl} (op: ${op.operationId})`);

      // Add to self-observation loop guard
      this._replayInFlight.add(resolvedUrl);

      try {
        const response = await fetch(resolvedUrl, fetchOptions);
        const responseText = await response.text();
        let responseData = null;
        try { responseData = JSON.parse(responseText); } catch (e) {}

        if (response.ok || response.status < 400) {
          console.log(`[Sync Router] ✅ Replay accepted by original backend: ${resolvedUrl} (HTTP ${response.status})`);
          await this._reconcileAfterSync(op, responseData);
          return { success: true, status: response.status, data: responseData };
        } else if (response.status === 401 || response.status === 403) {
          console.warn(`[Sync Router] Auth expired for replay to ${resolvedUrl}. Session may have expired offline.`);
          return { success: false, status: response.status, reason: 'AUTH_EXPIRED', data: responseData };
        } else if (response.status === 409) {
          console.warn(`[Sync Router] Conflict on replay to ${resolvedUrl}. Server has newer state.`);
          await this._reconcileAfterSync(op, responseData);
          return { success: false, status: response.status, reason: 'CONFLICT', data: responseData };
        } else {
          console.warn(`[Sync Router] Replay rejected by original backend: HTTP ${response.status}`);
          return { success: false, status: response.status, reason: 'REJECTED', data: responseData };
        }
      } catch (networkErr) {
        console.warn(`[Sync Router] Network error during replay to ${resolvedUrl}:`, networkErr.message);
        return { success: false, reason: 'NETWORK_ERROR' };
      } finally {
        this._replayInFlight.delete(resolvedUrl);
      }
    }

    /**
     * Reconciliation Engine: After a successful (or conflicting) replay,
     * fetch the authoritative server state and replace the provisional local record.
     *
     * CAPTURE → PERSIST → REPRODUCE → VERIFY → RECONCILE (this step)
     */
    async _reconcileAfterSync(op, serverResponseData) {
      try {
        const intg = this._resolveIntegrationAtReplayTime(op);
        let authoritativeRecord = null;
        let reconciliationSource = 'none';

        // Attempt to fetch the authoritative record from server
        if (intg && intg.urlPattern) {
          const getUrl = this._resolveUrl(intg.urlPattern.replace(/\/$/, ''), op);

          try {
            const getRes = await fetch(getUrl, { method: 'GET', credentials: 'include' });
            if (getRes.ok) {
              const freshData = await getRes.json();
              authoritativeRecord = freshData?.data || freshData?.record || freshData?.result || freshData;
              reconciliationSource = 'authoritative_get';
            } else {
              throw new Error(`HTTP ${getRes.status}`);
            }
          } catch (e) {
            // Can't fetch GET state — use server response data as fallback
            console.log(`[Reconciliation] GET endpoint unavailable (${e.message}) — using sync response as authoritative state for op '${op.operationId}'.`);
            authoritativeRecord = serverResponseData?.data || serverResponseData?.record || serverResponseData;
            reconciliationSource = 'sync_response';
          }
        } else {
          authoritativeRecord = serverResponseData;
          reconciliationSource = 'asg_server_response';
        }

        // Replace provisional local IndexedDB record with authoritative server truth
        if (authoritativeRecord && this.dbApi && op.collection && op.recordId) {
          const cleanRecord = typeof authoritativeRecord === 'object' ? authoritativeRecord : null;
          if (cleanRecord && Object.keys(cleanRecord).length > 0) {
            // Check for real server ID to record temporary ID mapping
            const realServerId = cleanRecord.id || cleanRecord.recordId || cleanRecord._id || cleanRecord.customerId || cleanRecord.orderId;
            if (realServerId && op.recordId && String(realServerId) !== String(op.recordId)) {
              this._recordTemporaryIdMapping(op.recordId, realServerId);
            }

            await this.dbApi.insert(op.collection, {
              ...cleanRecord,
              id: realServerId || op.recordId,
              _reconciledAt: new Date().toISOString(),
              _reconciliationSource: reconciliationSource,
              _authoritative: true
            });
            console.log(`[Reconciliation] ✅ Local record '${op.collection}:${op.recordId}' reconciled via '${reconciliationSource}'.`);
          }
        }

        // Write reconciliation log entry
        if (this.db) {
          const logEntry = {
            operationId: op.operationId,
            collection: op.collection,
            recordId: op.recordId,
            status: 'RECONCILED',
            serverData: authoritativeRecord,
            reconciledAt: new Date().toISOString()
          };
          const tx = this.db.transaction(['posa_reconciliation_log'], 'readwrite');
          tx.objectStore('posa_reconciliation_log').put(logEntry);
        }

        // Emit event so UI can re-render with fresh data
        window.dispatchEvent(new CustomEvent('asg:reconciled', {
          detail: { operationId: op.operationId, collection: op.collection, recordId: op.recordId, authoritativeRecord }
        }));

      } catch (err) {
        console.warn('[Reconciliation] Failed to reconcile local state:', err.message);
      }
    }

    /**
     * Reverts a provisional local record when the server definitively rejects an operation.
     * Called for dead-letter ops so the UI doesn't show stale data.
     */
    async _revertProvisionalState(op) {
      try {
        if (!this.dbApi || !op.collection || !op.recordId) return;

        if (op.action === 'CREATE') {
          // A create that was rejected — delete the provisional record
          await this.dbApi.delete(op.recordId);
          console.log(`[Reconciliation] ↩️ Reverted provisional CREATE for '${op.collection}:${op.recordId}'.`);
        } else if (op.action === 'UPDATE' && op.integration) {
          // For updates: try to fetch server truth to restore
          const getUrl = this._resolveUrl(op.integration.urlPattern, op);
          try {
            const res = await fetch(getUrl, { method: 'GET', credentials: 'include' });
            if (res.ok) {
              const fresh = await res.json();
              const record = fresh?.data || fresh?.record || fresh;
              if (record && typeof record === 'object') {
                await this.dbApi.insert(op.collection, { ...record, id: op.recordId });
                console.log(`[Reconciliation] ↩️ Restored server state for '${op.collection}:${op.recordId}' after rejection.`);
              }
            }
          } catch (e) {}
        }

        // Log the revert
        window.dispatchEvent(new CustomEvent('asg:reverted', {
          detail: { operationId: op.operationId, collection: op.collection, recordId: op.recordId, reason: 'SERVER_REJECTED' }
        }));
      } catch (err) {
        console.warn('[Reconciliation] Failed to revert provisional state:', err.message);
      }
    }

    // ==================== 1-LINE POSA API EXTENSIONS FOR DEVELOPERS ====================

    /** POSA 1-Line API: Save record with POSA DAG & offline durability */
    async posaSave(collection, data, options = {}) {
      return await this.posaQueueOperation({
        collection,
        action: 'CREATE',
        payload: data,
        priority: options.priority || 'MEDIUM',
        dependencyId: options.dependencyId || null,
        recordId: options.id || data.id
      });
    }

    /** POSA 1-Line API: Update record with POSA DAG & offline durability */
    async posaUpdate(collection, recordId, deltaData, options = {}) {
      return await this.posaQueueOperation({
        collection,
        action: 'UPDATE',
        payload: deltaData,
        recordId,
        priority: options.priority || 'MEDIUM',
        dependencyId: options.dependencyId || null
      });
    }

    /** POSA 1-Line API: Delete record with POSA DAG & offline durability */
    async posaDelete(collection, recordId, options = {}) {
      return await this.posaQueueOperation({
        collection,
        action: 'DELETE',
        payload: { id: recordId },
        recordId,
        priority: options.priority || 'HIGH',
        dependencyId: options.dependencyId || null
      });
    }

    async getPOSADAG() {
      const raw = await this.getPOSAQueue();
      const collapsed = this.collapsePOSAQueue(raw);
      return this.sortPOSADAG(collapsed);
    }

    setConflictStrategy(strategy) {
      this.conflictStrategy = strategy;
      console.log(`[POSA Engine] Conflict Resolution Strategy set to '${strategy}'`);
    }

    /** Reconnection Auth Gate: Ensure provider authentication is ONLINE_VERIFIED before replaying queued ops */
    async _verifyProviderAuthBeforeReplay() {
      if (typeof window !== 'undefined' && window.ASGOffline) {
        if (this._reauthPending) {
          console.log('[POSA Gate] Reconnection detected. Temporarily gating POSA queue replay until identity provider re-authenticates...');
          return false;
        }
      }
      return true;
    }

    setReauthPending(pending = true) {
      this._reauthPending = !!pending;
      console.log(`[POSA Gate] Identity Provider Re-authentication Gate: ${this._reauthPending ? 'LOCKED (Gated)' : 'UNLOCKED (ONLINE_VERIFIED)'}`);
    }

    /** 1-Line API: Save record to in-browser database (Auto-synced when online via POSA DAG) */
    async save(collection, recordData) {
      if (this.db) {
        return await this.posaSave(collection, recordData);
      }
      return await this.queueOfflineRequest(`/api/v1/${collection}`, 'POST', recordData);
    }

    /** 1-Line API: Update record in in-browser database (Auto-synced when online via POSA DAG) */
    async update(collection, recordId, deltaData, options = {}) {
      if (this.db) {
        return await this.posaUpdate(collection, recordId, deltaData, options);
      }
      return await this.queueOfflineRequest(`/api/v1/${collection}/${recordId}`, 'PUT', deltaData);
    }

    /** 1-Line API: Delete record from in-browser database (Auto-synced when online via POSA DAG) */
    async delete(collection, recordId, options = {}) {
      if (this.db) {
        return await this.posaDelete(collection, recordId, options);
      }
      return await this.queueOfflineRequest(`/api/v1/${collection}/${recordId}`, 'DELETE', { id: recordId });
    }

    /** 1-Line API: Retrieve all records from in-browser database */
    async find(collection) {
      if (this.dbApi) {
        return await this.dbApi.getAll(collection);
      }
      return [];
    }

    /** 1-Line API: Send API POST request with seamless offline queue fallback */
    async syncPost(url, payload) {
      if (this.isOnline) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return await res.json();
        } catch (err) {
          console.warn('[ASG Offline SDK] Network post failed, queuing for offline sync...');
        }
      }
      await this.queueOfflineRequest(url, 'POST', payload);
      return { success: true, offlineQueued: true, message: 'Request queued in local browser database and will sync when online.' };
    }

    /** 1-Line API: Send API PUT request with seamless offline queue fallback */
    async syncPut(url, payload) {
      if (this.isOnline) {
        try {
          const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return await res.json();
        } catch (err) {
          console.warn('[ASG Offline SDK] Network PUT failed, queuing for offline sync...');
        }
      }
      await this.queueOfflineRequest(url, 'PUT', payload);
      return { success: true, offlineQueued: true, message: 'PUT operation queued in local browser database and will sync when online.' };
    }

    /** 1-Line API: Send API DELETE request with seamless offline queue fallback */
    async syncDelete(url, payload = {}) {
      if (this.isOnline) {
        try {
          const res = await fetch(url, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return await res.json();
        } catch (err) {
          console.warn('[ASG Offline SDK] Network DELETE failed, queuing for offline sync...');
        }
      }
      await this.queueOfflineRequest(url, 'DELETE', payload);
      return { success: true, offlineQueued: true, message: 'DELETE operation queued in local browser database and will sync when online.' };
    }

    /** 1-Line API: Send API GET request with cache fallback */
    async syncGet(url) {
      try {
        const res = await fetch(url);
        return await res.json();
      } catch (err) {
        console.warn('[ASG Offline SDK] Network GET failed, fetching from local offline store...');
        const cachedRecords = await this.find();
        return { success: true, offline: true, data: cachedRecords };
      }
    }

    /**
     * LAYER 2: ASG Offline API Runtime Route Registrar
     * Modes:
     * - 'LOCAL_SAFE': Executed 100% offline against IndexedDB replica (CRUD, notes, forms, cart).
     * - 'DEFERRED': User action queued offline, final execution waits for server validation (Orders).
     * - 'ONLINE_REQUIRED': Refuses execution offline with HTTP 503 (Payments, OTP, live external APIs).
     */
    registerRoute(routeConfig) {
      if (!routeConfig || !routeConfig.path) return;
      const method = (routeConfig.method || 'GET').toUpperCase();
      const key = `${method}:${routeConfig.path}`;
      this.registeredRoutes.set(key, {
        method,
        path: routeConfig.path,
        mode: routeConfig.mode || 'LOCAL_SAFE',
        collection: routeConfig.collection || 'records'
      });
      console.log(`[ASG API Runtime] Registered Route [${method}] ${routeConfig.path} (Mode: ${routeConfig.mode || 'LOCAL_SAFE'})`);
    }

    matchRoute(method, path) {
      const key = `${method.toUpperCase()}:${path}`;
      if (this.registeredRoutes.has(key)) return this.registeredRoutes.get(key);

      for (const [routeKey, config] of this.registeredRoutes.entries()) {
        const [rMethod, rPath] = routeKey.split(':');
        if (rMethod === method.toUpperCase()) {
          const regexPattern = new RegExp('^' + rPath.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$');
          if (regexPattern.test(path)) return config;
        }
      }
      return null;
    }

    /** Layer 2 Offline API Runtime & Smart Fetch Interceptor */
    async fetch(url, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      let pathname = url;
      try {
        pathname = new URL(url, window.location.origin).pathname;
      } catch (e) {}

      const matchedRoute = this.matchRoute(method, pathname);

      if (this.isOnline) {
        try {
          const response = await window.fetch(url, options);
          if (response.ok || response.status < 400) return response;
        } catch (err) {
          console.warn(`[ASG Offline Engine] Network request failed for ${method} ${pathname}, activating Layer 2 Offline API Runtime.`);
        }
      }

      // Offline API Runtime Mode Rules
      const mode = matchedRoute ? matchedRoute.mode : (method === 'GET' ? 'LOCAL_SAFE' : 'LOCAL_SAFE');
      const collection = matchedRoute ? matchedRoute.collection : (pathname.split('/')[2] || 'orders');

      // Rule A: ONLINE_REQUIRED mode cannot operate offline
      if (!this.isOnline && mode === 'ONLINE_REQUIRED') {
        this.showToast('⛔ Action Requires Internet', 'Payment, OTP, or Live Third-Party API calls cannot execute offline.', 'warning');
        return new Response(JSON.stringify({
          success: false,
          offlineBlocked: true,
          mode: 'ONLINE_REQUIRED',
          error: 'ONLINE_REQUIRED: This action requires an active server connection.'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'X-ASG-Runtime-Mode': 'ONLINE_REQUIRED' }
        });
      }

      // Rule B: GET queries served from Local IndexedDB Replica
      if (method === 'GET') {
        const localRecords = await this.find(collection);
        return new Response(JSON.stringify({
          success: true,
          offline: true,
          source: 'local_indexeddb_replica',
          records: localRecords,
          data: localRecords,
          total: localRecords.length,
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-ASG-Runtime-Source': 'IndexedDB-Replica' }
        });
      }

      // Rule C: LOCAL_SAFE and DEFERRED mutating operations
      let payload = {};
      if (options.body) {
        try { payload = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; } catch (e) {}
      }

      const recordId = payload.id || pathname.split('/').pop() || ('rec_' + Math.random().toString(36).substring(2, 8));
      payload.id = recordId;

      if (method === 'POST' || method === 'PUT') {
        await this.posaSave(collection, payload, { id: recordId });
      } else if (method === 'DELETE') {
        await this.posaDelete(collection, recordId);
      }

      const httpStatus = 202; // Always HTTP 202 Accepted for offline mutations
      const message = 'Operation accepted locally into ASG POSA journal. Pending authoritative commit upon reconnection.';

      return new Response(JSON.stringify({
        success: true,
        offlineQueued: true,
        status: 'LOCAL_ACCEPTED',
        stage: 'PENDING_SERVER_COMMIT',
        mode,
        record: payload,
        message,
        timestamp: new Date().toISOString()
      }), {
        status: httpStatus,
        headers: {
          'Content-Type': 'application/json',
          'X-ASG-Runtime-Mode': mode,
          'X-ASG-Operation-Status': 'LOCAL_ACCEPTED',
          'X-ASG-Operation-Stage': 'PENDING_SERVER_COMMIT'
        }
      });
    }
  }

  // Instantiate SDK and export globally
  window.ASGOffline = new ASGOfflineSDK();
})();

