# 📡 ASG Offline Web Service

> **API-based service and client SDK to make web applications work blazingly fast and offline everywhere.**

---

## 🌟 Key Features

- ⚡ **Instant Asset Pre-caching**: Pre-caches critical HTML, CSS, JavaScript, fonts, and images upon page load.
- 📡 **Seamless Offline Capability**: When connection drops, Service Worker serves app shell and offline fallbacks seamlessly.
- ⚙️ **Configurable Caching Strategies**:
  - `stale-while-revalidate` (Fastest initial load with background cache updates)
  - `cache-first` (Ideal for static media and static sites)
  - `network-first` (Ideal for dynamic APIs with offline fallback)
- 📋 **IndexedDB Background Sync**: Captures form submissions or API calls made while offline and auto-syncs them when connection restores.
- 🔔 **Customizable Connection Toasts**: Beautiful non-intrusive online/offline notifications.
- 📊 **Real-time Telemetry & Saved Bandwidth Analytics**: Track cache hit ratios, saved bandwidth MB, and load time performance.
- 🛠️ **1-Line Embed Script**: Works with any framework (React, Vue, Angular, Vanilla HTML/JS, PHP, etc.).

---

## 🚀 Quickstart

### 1. Install & Start Server

```bash
npm install
npm start
```

The service will start at `http://localhost:3000`.

### 2. Embed SDK into Any Website

Add this single line of code inside the `<head>` of any website:

```html
<script src="http://localhost:3000/sdk/asg-offline.js" data-app-id="demo-app"></script>
```

---

## 📡 REST API Reference

### `GET /api/v1/config/:appId`
Fetch caching strategy, precache asset list, and offline options for an application.

### `POST /api/v1/apps`
Create or update application settings and caching strategy rules.

**Body Payload:**
```json
{
  "appId": "my-app",
  "appName": "My Web App",
  "domain": "mywebsite.com",
  "cacheStrategy": "stale-while-revalidate",
  "precacheUrls": ["/", "/css/app.css", "/js/app.js"],
  "enableBackgroundSync": true,
  "enableOfflineNotifications": true
}
```

### `POST /api/v1/telemetry`
Log cache performance metrics, offline hits, and background sync events.

### `GET /api/v1/stats/:appId`
Retrieve aggregated statistics (Cache hit ratio, saved MB bandwidth, event logs).

---

## 💻 Client JavaScript SDK API (`window.ASGOffline`)

### ⚡ 1-Line API Shortcuts for Developers
```javascript
// 1. Save data directly to in-browser database (auto-synced when online)
await ASGOffline.save('orders', { product: 'Laptop', price: 999 });

// 2. Fetch all offline database records
const orders = await ASGOffline.find('orders');

// 3. Send API POST request with automatic offline queue fallback
await ASGOffline.syncPost('/api/v1/submit', { name: 'John Doe' });
```

### Advanced SDK Methods
```javascript
// Check online status
const isOnline = window.ASGOffline.isOnline;

// Queue request for offline sync
await window.ASGOffline.queueOfflineRequest('/api/v1/submit', 'POST', { name: 'John Doe' });

// Clear all offline cache storage
await window.ASGOffline.clearCache();

// Inspect cached URLs in Service Worker
const cachedUrls = await window.ASGOffline.getCachedUrls();

// Listen to connection status changes
window.ASGOffline.onStatusChange((onlineStatus) => {
  console.log('Network state changed:', onlineStatus);
});
```

---

## 🎨 Interactive Management Dashboard

Open `http://localhost:3000` in your web browser to access:
- **App Configurator**: Custom caching strategy & fallback page editor.
- **Code Generator**: 1-click script tag & PWA manifest generator.
- **Live Offline Sandbox**: Interactive simulated browser tab to test online vs offline modes.
- **Telemetry Dashboard**: Monitor saved bandwidth, cache hit rates, and live request logs.
