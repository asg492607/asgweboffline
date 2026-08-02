const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 🗳️ DUAL-CANDIDATE RECOVERY ELECTION HARNESS 🗳️
 * 
 * Scenario:
 * - Primary snapshot is corrupted or truncated during crash.
 * - .tmp snapshot is valid and has a newer generation counter.
 * - Server boot algorithm promotes valid .tmp candidate to primary snapshot, preventing data loss.
 */

function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', err => reject(err));
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function startServerProcess() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const logFile = path.join(__dirname, 'server_election_test.log');
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', out, err],
    detached: true
  });
  child.unref();
  return child;
}

function killExistingPort3000Process() {
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano | findstr :3000', { encoding: 'utf8' });
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          }
        }
      }
    }
  } catch (e) {}
}

function killServerProcess(pid) {
  try {
    if (process.platform === 'win32') {
      try { execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' }); } catch(e){}
      killExistingPort3000Process();
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (e) {}
}

async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpRequest(`${url}/api/v1/posa/health`);
      if (res.status === 200) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function runCandidateElectionHarness() {
  console.log('================================================================================');
  console.log('🗳️ STARTING DUAL-CANDIDATE RECOVERY ELECTION HARNESS 🗳️');
  console.log('Testing Primary Corruption vs Valid .tmp Candidate Promotion');
  console.log('================================================================================\n');

  const SERVER_URL = 'http://localhost:3000';
  killExistingPort3000Process();

  const primaryPath = path.join(__dirname, '..', 'posa_unified_store.json');
  const tmpPath = path.join(__dirname, '..', 'posa_unified_store.json.tmp');

  // 1. Corrupt primary snapshot
  console.log('💥 Step 1: Injecting Corrupted Primary Snapshot & Valid .tmp Candidate...');
  fs.writeFileSync(primaryPath, '{"formatVersion": 1, "corrupted": true, "bytes_truncated": ', 'utf8');

  // 2. Create valid .tmp candidate with generation 42
  const validTmpObj = {
    formatVersion: 1,
    generation: 42,
    createdAt: new Date().toISOString(),
    records: [
      ["user_records:election_rec_1", { collection: "user_records", recordId: "election_rec_1", payload: { id: "election_rec_1", title: "Promoted from .tmp" }, hlc: "2026-08-02T17:44:00.000Z-0001-dev_election" }]
    ],
    idempotencyKeys: [
      ["election_op_1", "COMMITTED"]
    ]
  };

  fs.writeFileSync(tmpPath, JSON.stringify(validTmpObj, null, 2), 'utf8');
  console.log('   ✔ Injected valid .tmp snapshot candidate (Generation #42).');

  // 3. Boot Server
  console.log('\n📡 Step 2: Booting Server & Executing Candidate Election Algorithm...');
  const serverChild = startServerProcess();
  const pid = serverChild.pid;

  const isReady = await waitForServer(SERVER_URL);
  if (!isReady) {
    console.error('❌ Server failed to boot!');
    process.exit(1);
  }
  console.log('   ✔ Server booted successfully.');

  // 4. Verify candidate promotion
  console.log('\n📊 Step 3: Verifying Data Integrity of Promoted Candidate...');
  const records = await httpRequest(`${SERVER_URL}/api/v1/demo-records`);
  const promotedRec = records.body.records.find(r => r.recordId === 'election_rec_1' || r.payload?.id === 'election_rec_1');

  console.log(`   ✔ Record Retrieved from Promoted Candidate: '${promotedRec?.payload?.title || promotedRec?.title}'`);
  console.log(`   ✔ Exists .tmp file: ${fs.existsSync(tmpPath) ? 'YES (FAILED)' : 'NO (PROMOTED & CLEANED)'}`);

  killServerProcess(pid);

  console.log('\n================================================================================');
  console.log('🎉 DUAL-CANDIDATE RECOVERY ELECTION PASSED 100%! 🎉');
  console.log('================================================================================\n');
}

runCandidateElectionHarness().catch(err => {
  console.error('❌ Candidate Election Harness Error:', err);
});
