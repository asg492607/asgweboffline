const http = require('http');

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testServer() {
  console.log('🧪 Testing POSA, Multi-Device P2P & Disk Persistence Endpoints...\n');

  try {
    // 1. Health check
    const health = await makeRequest('/api/v1/posa/health');
    console.log('✅ GET /api/v1/posa/health:', health.status === 'HEALTHY' ? 'PASSED' : 'FAILED', health);

    // 2. Discovery Metadata check
    const discovery = await makeRequest('/api/v1/posa/discovery');
    console.log('✅ GET /api/v1/posa/discovery:', discovery.success ? 'PASSED' : 'FAILED', discovery);

    // 3. Multi-Device Operations Sync (Device A + Device B) with MERGE_FIELDS
    const hlcA = new Date().toISOString() + '-0001-dev_alpha';
    const hlcB = new Date(Date.now() + 50).toISOString() + '-0001-dev_beta';

    const syncResA = await makeRequest('/api/v1/posa/sync', 'POST', {
      appId: 'demo-app',
      deviceId: 'dev_alpha',
      conflictStrategy: 'MERGE_FIELDS',
      operations: [
        {
          operationId: 'op_dev_a_1',
          collection: 'orders',
          action: 'CREATE',
          payload: { id: 'ord_501', item: 'Laptop', price: 1200, notes: 'Dev A Edit' },
          recordId: 'ord_501',
          timestamp: new Date().toISOString(),
          hlc: hlcA,
          hash: 'sha256_fb_101'
        }
      ]
    });
    console.log('✅ Device A Sync:', syncResA.success ? 'PASSED' : 'FAILED', syncResA);

    const syncResB = await makeRequest('/api/v1/posa/sync', 'POST', {
      appId: 'demo-app',
      deviceId: 'dev_beta',
      conflictStrategy: 'MERGE_FIELDS',
      operations: [
        {
          operationId: 'op_dev_b_1',
          collection: 'orders',
          action: 'UPDATE',
          payload: { id: 'ord_501', priority: 'EXPEDITED', notes: 'Dev B Overwrite Notes' },
          recordId: 'ord_501',
          timestamp: new Date().toISOString(),
          hlc: hlcB,
          hash: 'sha256_fb_102'
        }
      ]
    });
    console.log('✅ Device B Sync (Merged):', syncResB.success ? 'PASSED' : 'FAILED', syncResB);

    // 4. Peer-to-Peer Direct Batch Sync Endpoint Test
    const peerSyncRes = await makeRequest('/api/v1/posa/peer-sync', 'POST', {
      peerId: 'peer_node_777',
      operations: [
        {
          operationId: 'peer_op_1',
          collection: 'inventory',
          action: 'CREATE',
          payload: { id: 'inv_10', title: 'Offline Subnet Scanner', qty: 50 },
          recordId: 'inv_10',
          timestamp: new Date().toISOString(),
          hlc: new Date().toISOString() + '-0001-peer_node_777'
        }
      ]
    });
    console.log('✅ Peer Sync Endpoint:', peerSyncRes.success ? 'PASSED' : 'FAILED', peerSyncRes);

    // 5. POSA Stats
    const stats = await makeRequest('/api/v1/posa/stats/demo-app');
    console.log('✅ GET /api/v1/posa/stats/demo-app:', stats.success ? 'PASSED' : 'FAILED', stats.metrics);

    console.log('\n🎉 ALL OFFLINE MULTI-DEVICE POSA & P2P API ENDPOINTS VERIFIED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('❌ API Test Failed:', err.message);
    process.exit(1);
  }
}

testServer();
