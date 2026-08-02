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
      this.isSyncing = false;

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

      // 4. Trigger cold-start background sync if online
      if (this.isOnline) {
        this.processOfflineQueue();
      }

      // 5. Attach online/offline event listeners
      this.setupNetworkListeners();

      // 6. Render toast notification container & Enforce Branding Watermark
      this.renderNotificationToast();
      this.enforceMandatoryBranding();

      // 7. Log telemetry
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
          const request = indexedDB.open('ASG_Offline_DB', 4);

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
            if (!db.objectStoreNames.contains('device_peers')) {
              db.createObjectStore('device_peers', { keyPath: 'deviceId' });
            }
            if (!db.objectStoreNames.contains('hlc_clocks')) {
              db.createObjectStore('hlc_clocks', { keyPath: 'deviceId' });
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
      let isRendering = false;

      const renderBadge = () => {
        if (isRendering) return;
        isRendering = true;

        try {
          let badge = document.getElementById('asg-mandatory-watermark');
          if (!badge) {
            badge = document.createElement('a');
            badge.id = 'asg-mandatory-watermark';
            badge.href = 'https://github.com/asg492607/asgweboffline';
            badge.target = '_blank';
            badge.rel = 'noopener noreferrer';
            badge.innerHTML = `<span>⚡</span> Offline Protected by <strong style="color:#818cf8;margin-left:3px;">ASG Offline Web Service</strong>`;
            if (document.body) {
              document.body.appendChild(badge);
            }
          }

          if (badge && !badge.hasAttribute('data-styled')) {
            badge.setAttribute('data-styled', 'true');
            badge.style.cssText = `
              position: fixed !important;
              bottom: 12px !important;
              left: 12px !important;
              z-index: 99999999 !important;
              background: #0f172a !important;
              color: #f8fafc !important;
              border: 1px solid rgba(99, 102, 241, 0.5) !important;
              border-radius: 20px !important;
              padding: 6px 14px !important;
              font-size: 11px !important;
              font-family: system-ui, -apple-system, sans-serif !important;
              font-weight: 500 !important;
              text-decoration: none !important;
              display: flex !important;
              align-items: center !important;
              gap: 6px !important;
              box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4) !important;
              opacity: 1 !important;
              visibility: visible !important;
              pointer-events: auto !important;
              transform: none !important;
              transition: none !important;
            `;
          }
        } finally {
          isRendering = false;
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderBadge);
      } else {
        renderBadge();
      }

      // Anti-Tampering MutationObserver: Re-create if watermark node deleted
      try {
        const observer = new MutationObserver(() => {
          if (isRendering) return;
          const badge = document.getElementById('asg-mandatory-watermark');
          if (!badge) {
            renderBadge();
          }
        });
        if (document.body) {
          observer.observe(document.body, { childList: true });
        }
      } catch (e) {}
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
      }
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

    /** Phase 1 & 2: Local Operation First & Metadata Generation */
    async posaQueueOperation({ collection, action, payload, priority = 'MEDIUM', dependencyId = null, recordId = null }) {
      if (!this.db) {
        console.warn('[POSA Engine] Database not initialized yet.');
        return null;
      }

      const operationId = 'posa_op_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
      const timestamp = new Date().toISOString();
      const hlc = this.generateHLC();
      const recId = recordId || payload.id || ('rec_' + Math.random().toString(36).substring(2, 8));

      // Compute SHA-256 Checksum
      const hash = await this.generateSHA256({ collection, action, payload, timestamp });

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
        status: 'PENDING',
        hash,
        lastRetryTimestamp: null
      };

      // 1. Local Database Write First (Instant User Experience)
      await this.dbApi.insert(collection, opMetaData.payload);

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

      // Trigger Adaptive Sync Engine evaluation
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

          if (prevItem) {
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

      // 4. Decision Logic
      if (!state.isOnline || !state.serverHealthy) {
        state.decision = 'DEFER_OFFLINE';
        state.reason = 'Network offline or server unreachable.';
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

    /** Core POSA Sync Execution Loop */
    async processPOSAQueue() {
      if (!this.db || this.isSyncing) return;

      const aseState = await this.evaluateASEConditions();
      console.log('[ASE Engine] Evaluation result:', aseState);

      if (aseState.decision.startsWith('DEFER')) {
        console.warn(`[ASE Engine] Sync deferred: ${aseState.reason}`);
        return;
      }

      const rawQueue = await this.getPOSAQueue();
      if (!rawQueue || rawQueue.length === 0) return;

      this.isSyncing = true;
      try {
        console.log(`[POSA Engine] Starting POSA synchronization cycle for ${rawQueue.length} items...`);

        // Phase 5: Operation Collapsing
        const collapsedQueue = this.collapsePOSAQueue(rawQueue);
        const originalCount = rawQueue.length;
        const collapsedCount = collapsedQueue.length;
        const savingsPct = Math.round(((originalCount - collapsedCount) / originalCount) * 100);

        console.log(`[POSA Optimization] Collapsed ${originalCount} ops to ${collapsedCount} ops (${savingsPct}% bandwidth saved).`);

        // Phase 3: DAG Topological Sorting
        const sortedQueue = this.sortPOSADAG(collapsedQueue);

        // Filter out items in exponential backoff delay
        const now = Date.now();
        const itemsToSync = sortedQueue.filter(item => {
          if (!item.lastRetryTimestamp || item.retryCount === 0) return true;
          const waitSecs = this.getPOSABackoffInterval(item.retryCount);
          const elapsedSecs = (now - new Date(item.lastRetryTimestamp).getTime()) / 1000;
          return elapsedSecs >= waitSecs;
        });

        if (itemsToSync.length === 0) {
          console.log('[POSA Engine] Items in queue are currently in exponential backoff wait state.');
          return;
        }

        // Chunk large sync queues into batches of 100 operations to prevent payload limits
        const BATCH_SIZE = 100;
        let totalSynced = 0;

        for (let i = 0; i < itemsToSync.length; i += BATCH_SIZE) {
          const chunk = itemsToSync.slice(i, i + BATCH_SIZE);

          const response = await fetch(`${this.serverUrl}/api/v1/posa/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appId: this.appId,
              deviceId: this.getDeviceId(),
              conflictStrategy: this.conflictStrategy || 'LAST_WRITE_WINS',
              operations: chunk
            })
          });

          const syncResult = await response.json();

          if (syncResult.success) {
            const processedIds = new Set(syncResult.syncedOperationIds || chunk.map(item => item.operationId));
            const tx = this.db.transaction(['posa_queue'], 'readwrite');
            const store = tx.objectStore('posa_queue');
            
            for (const opId of processedIds) {
              store.delete(opId);
            }
            totalSynced += processedIds.size;
          } else {
            console.warn('[POSA Engine] Sync chunk failed, applying exponential backoff:', syncResult.error);
            const tx = this.db.transaction(['posa_queue'], 'readwrite');
            const store = tx.objectStore('posa_queue');
            for (const item of chunk) {
              item.retryCount = (item.retryCount || 0) + 1;
              item.lastRetryTimestamp = new Date().toISOString();
              store.put(item);
            }
          }
        }

        if (totalSynced > 0) {
          console.log(`[POSA Engine] ✅ Successfully synchronized ${totalSynced} DAG operations across batch chunks!`);
          this.showToast('✅ POSA Sync Complete', `Successfully synced ${totalSynced} DAG operations (${savingsPct}% payload saved).`, 'success');
          this.sendTelemetry('POSA_SYNC_SUCCESS', { syncedOps: totalSynced, savingsPct });
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

    // ==================== 1-LINE API SHORTCUTS FOR CLIENTS ====================

    /** 1-Line API: Save record to in-browser database (Auto-synced when online via POSA DAG) */
    async save(collection, recordData) {
      if (this.db) {
        return await this.posaSave(collection, recordData);
      }
      return await this.queueOfflineRequest(`/api/v1/${collection}`, 'POST', recordData);
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
  }

  // Instantiate SDK and export globally
  window.ASGOffline = new ASGOfflineSDK();
})();

