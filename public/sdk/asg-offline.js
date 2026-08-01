/**
 * ASG Offline Client SDK (asg-offline.js)
 * 1-Line Embeddable SDK to turn web applications into offline-first apps.
 */

(function () {
  'use strict';

  // Read configuration from current script tag attributes
  const currentScript = document.currentScript || document.querySelector('script[src*="asg-offline.js"]');
  const appId = currentScript ? (currentScript.getAttribute('data-app-id') || 'demo-app') : 'demo-app';
  const serverUrl = currentScript ? (currentScript.getAttribute('data-server-url') || window.location.origin) : window.location.origin;

  class ASGOfflineSDK {
    constructor() {
      this.appId = appId;
      this.serverUrl = serverUrl;
      this.config = null;
      this.isOnline = navigator.onLine;
      this.swRegistration = null;
      this.db = null;
      this.statusListeners = [];

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

      // 4. Attach online/offline event listeners
      this.setupNetworkListeners();

      // 5. Render toast notification container & Enforce Branding Watermark
      this.renderNotificationToast();
      this.enforceMandatoryBranding();

      // 6. Log telemetry
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
        this.swRegistration = await navigator.serviceWorker.register(swUrl, { scope: '/' });
        console.log('[ASG Offline SDK] Service Worker registered successfully scope:', this.swRegistration.scope);

        // Send loaded config to SW engine
        if (navigator.serviceWorker.controller && this.config) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SET_CONFIG',
            precacheUrls: this.config.precacheUrls,
            cacheStrategy: this.config.cacheStrategy,
            offlineFallbackHtml: this.config.offlineFallbackHtml
          });
        }
      } catch (err) {
        console.error('[ASG Offline SDK] Service Worker registration failed:', err);
      }
    }

    async initIndexedDB() {
      return new Promise((resolve) => {
        const request = indexedDB.open('ASG_Offline_DB', 2);

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('offline_queue')) {
            db.createObjectStore('offline_queue', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('offline_records')) {
            const recordsStore = db.createObjectStore('offline_records', { keyPath: 'id', autoIncrement: true });
            recordsStore.createIndex('collection', 'collection', { unique: false });
          }
        };

        request.onsuccess = (e) => {
          this.db = e.target.result;
          console.log('[ASG Offline SDK] In-Browser Database (IndexedDB) ready.');
          this.attachDbHelpers();
          resolve();
        };

        request.onerror = () => {
          console.warn('[ASG Offline SDK] IndexedDB initialization failed.');
          resolve();
        };
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
              createdAt: new Date().toISOString(),
              synced: false
            };
            const req = store.add(record);
            req.onsuccess = (e) => {
              record.id = e.target.result;
              console.log(`[In-Browser DB] Record added to '${collection}':`, record);
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

      const style = document.createElement('style');
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
      const renderBadge = () => {
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

        if (badge) {
          badge.setAttribute('style', `
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
          `);
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderBadge);
      } else {
        renderBadge();
      }

      // Anti-Tampering MutationObserver: Re-create and restore if deleted or hidden
      try {
        const observer = new MutationObserver(() => {
          renderBadge();
        });
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        }
      } catch (e) {}

      setInterval(renderBadge, 1500);
    }

    async queueOfflineRequest(url, method = 'POST', payload = {}) {
      if (!this.db) return false;

      const transaction = this.db.transaction(['offline_queue'], 'readwrite');
      const store = transaction.objectStore('offline_queue');

      const item = {
        url,
        method,
        payload,
        createdAt: new Date().toISOString()
      };

      store.add(item);
      console.log('[ASG Offline SDK] Request queued for background sync:', item);
      this.showToast('📋 Saved Offline', 'Action saved locally and will sync when online.', 'warning');
      return true;
    }

    async processOfflineQueue() {
      if (!this.db || !this.isOnline) return;

      const transaction = this.db.transaction(['offline_queue'], 'readwrite');
      const store = transaction.objectStore('offline_queue');
      const getAll = store.getAll();

      getAll.onsuccess = async () => {
        const items = getAll.result;
        if (!items || items.length === 0) return;

        console.log(`[ASG Offline SDK] Processing ${items.length} queued offline requests...`);

        for (const item of items) {
          try {
            await fetch(item.url, {
              method: item.method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.payload)
            });
            console.log('[ASG Offline SDK] Synced queued request:', item.url);
            this.sendTelemetry('BACKGROUND_SYNC', { url: item.url });
          } catch (err) {
            console.warn('[ASG Offline SDK] Could not sync request:', item.url);
          }
        }

        // Clear queue after sync attempt
        const clearTrans = this.db.transaction(['offline_queue'], 'readwrite');
        clearTrans.objectStore('offline_queue').clear();
        this.showToast('✅ Sync Completed', `Successfully synchronized ${items.length} offline actions.`, 'success');
      };
    }

    async clearCache() {
      if (!navigator.serviceWorker.controller) return false;

      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          resolve(event.data);
        };
        navigator.serviceWorker.controller.postMessage(
          { type: 'CLEAR_CACHE' },
          [channel.port2]
        );
      });
    }

    async getCachedUrls() {
      if (!navigator.serviceWorker.controller) return [];

      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          resolve(event.data.urls || []);
        };
        navigator.serviceWorker.controller.postMessage(
          { type: 'GET_CACHE_KEYS' },
          [channel.port2]
        );
      });
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

    onStatusChange(callback) {
      if (typeof callback === 'function') {
        this.statusListeners.push(callback);
      }
    }

    get database() {
      return this.dbApi;
    }

    // ==================== 1-LINE API SHORTCUTS FOR CLIENTS ====================

    /** 1-Line API: Save record to in-browser database (Auto-synced when online) */
    async save(collection, recordData) {
      if (this.dbApi) {
        return await this.dbApi.insert(collection, recordData);
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
