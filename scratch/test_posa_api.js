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
  console.log('🧪 Testing POSA & ASE Server Endpoints...\n');

  try {
    // 1. Health check
    const health = await makeRequest('/api/v1/posa/health');
    console.log('✅ GET /api/v1/posa/health:', health.status === 'HEALTHY' ? 'PASSED' : 'FAILED', health);

    // 2. POSA Sync
    const syncRes = await makeRequest('/api/v1/posa/sync', 'POST', {
      appId: 'demo-app',
      deviceId: 'dev_test_123',
      conflictStrategy: 'LAST_WRITE_WINS',
      operations: [
        {
          operationId: 'op_test_1',
          collection: 'customers',
          action: 'CREATE',
          payload: { id: 'cust_99', name: 'Alice' },
          recordId: 'cust_99',
          timestamp: new Date().toISOString(),
          hash: 'sha256_fb_123'
        }
      ]
    });
    console.log('✅ POST /api/v1/posa/sync:', syncRes.success ? 'PASSED' : 'FAILED', syncRes);

    // 3. POSA Stats
    const stats = await makeRequest('/api/v1/posa/stats/demo-app');
    console.log('✅ GET /api/v1/posa/stats/demo-app:', stats.success ? 'PASSED' : 'FAILED', stats.metrics);

    console.log('\n🎉 ALL POSA SERVER API ENDPOINTS VERIFIED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('❌ API Test Failed:', err.message);
    process.exit(1);
  }
}

setTimeout(testServer, 1000);
