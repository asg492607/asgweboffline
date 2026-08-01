# 📡 ASG Offline Web Service

> **API-based service and client SDK to make web applications work blazingly fast and offline everywhere.**

---

- ⚡ **POSA Offline Engine**: Persistent Offline Synchronization Algorithm for multi-day/multi-week offline operation with 0% data loss.
- 🔄 **Adaptive Sync Engine (ASE)**: Evaluates network stability, battery health, server RTT, and DAG priority before executing sync.
- 🛡️ **SHA-256 Checksum Protection**: Cryptographic payload integrity verification.
- 🔀 **Configurable Conflict Policies**: Last Write Wins (LWW), Server Wins, Client Wins, Field-Level Merge, Manual Resolution.
- 🗜️ **Operation Collapsing**: Compacts redundant updates and cancels out draft creates/deletes to save bandwidth.

---

## ⚡ ASG Persistent Offline Synchronization Algorithm (POSA)

POSA transforms ASG Offline into true offline-first infrastructure.

### The 10 Phases of POSA
1. **Local Operation First**: Instant IndexedDB write + promise resolve.
2. **Queue Metadata & Hash**: Operation ID, SHA-256 Checksum, Device ID, Timestamp.
3. **DAG Dependency Graph**: Topological ordering of operations (Customer ➔ Order ➔ Payment).
4. **Conflict Resolution Engine**: Multi-device policy handling (LWW, Server Wins, Merge Fields).
5. **Intelligent Operation Collapsing**: Compacts sequential `UPDATE` calls into single payload.
6. **Exponential Backoff Scheduler**: Retries on failure `(10s, 30s, 1m, 5m, 15m, 1h, 6h, 24h)`.
7. **Health Monitoring & Telemetry**: Queue size, latency, failure %, conflict metrics.
8. **Integrity Verification**: Cryptographic SHA-256 hash checks.
9. **Crash Recovery**: Resumes pending DAG queue seamlessly after tab/browser restarts.
10. **Enterprise Dashboard**: Interactive live DAG visualizer & 3-Day offline simulator.

### Developer API Examples
```javascript
// Save record with POSA DAG & offline durability
await ASGOffline.posaSave('customers', { name: 'John Doe', city: 'San Francisco' });

// Update record with POSA delta
await ASGOffline.posaUpdate('customers', 'cust_301', { phone: '555-0199' });

// Delete record with high priority
await ASGOffline.posaDelete('customers', 'cust_301', { priority: 'HIGH' });

// Inspect DAG Topological Order
const dag = await ASGOffline.getPOSADAG();

// Configure Conflict Policy
ASGOffline.setConflictStrategy('MERGE_FIELDS');
```

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
- **POSA & Adaptive Sync Engine Tab**: 3-Day Offline Simulator, DAG Visualizer, ASE Status Gauges, and Conflict Resolution Log.
- **App Configurator**: Custom caching strategy & fallback page editor.
- **Code Generator**: 1-click script tag & PWA manifest generator.
- **Live Offline Sandbox**: Interactive simulated browser tab to test online vs offline modes.
- **Telemetry Dashboard**: Monitor saved bandwidth, cache hit rates, and live request logs.

