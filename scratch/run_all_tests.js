const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function isServerAlive(url = 'http://127.0.0.1:3000/api/v1/config/demo-app') {
  try {
    return await new Promise((resolve) => {
      const req = http.get(url, (res) => resolve(res.statusCode === 200));
      req.on('error', () => resolve(false));
      req.end();
    });
  } catch {
    return false;
  }
}

async function ensureServerRunning() {
  if (await isServerAlive()) return null;
  const serverProc = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '3000' },
    stdio: 'ignore'
  });
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (await isServerAlive()) return serverProc;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Failed to start server on port 3000');
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🚀 ASG OFFLINE WEB SERVICE - FULL INTEGRATION TEST SUITE RUNNER');
  console.log('================================================================\n');

  let activeServer = await ensureServerRunning();

  const testFiles = [
    'test_posa.js',
    'test_posa_api.js',
    'test_asg_end_to_end_pipeline.js',
    'test_candidate_election_harness.js',
    'test_filesystem_corruption_harness.js',
    'test_hlc_tuple_ordering_harness.js',
    'test_live_postgres_sqlite_harness.js',
    'test_real_sigkill_sql_harness.js',
    'test_temp_id_cascading_rewrite.js',
    'test_transaction_boundary_kill_harness.js',
    'test_postgres_concurrent_storm_harness.js',
    'test_physical_torture_harness.js',
    'test_chaos_scenarios.js',
    'test_dual_chrome_profile_experiment.js',
    'test_mirror_commutativity_experiment.js',
    'test_destructive_process_death_harness.js',
    'test_ultimate_distributed_suite.js',
    'test_adversarial_opponent.js'
  ];

  const results = [];

  for (const testFile of testFiles) {
    const fullPath = path.join(__dirname, testFile);
    if (!fs.existsSync(fullPath)) continue;

    console.log(`----------------------------------------------------------------`);
    console.log(`🧪 Running: ${testFile}...`);
    console.log(`----------------------------------------------------------------`);

    // Ensure server is up before running test if needed
    activeServer = await ensureServerRunning();

    try {
      const output = execSync(`node ${testFile}`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, PORT: '3000' }
      });
      console.log(output);
      console.log(`✅ PASSED: ${testFile}\n`);
      results.push({ file: testFile, status: 'PASSED' });
    } catch (err) {
      console.error(`❌ FAILED: ${testFile}`);
      console.error(err.stdout || err.message);
      results.push({ file: testFile, status: 'FAILED', error: err.message });
    }
  }

  console.log('================================================================');
  console.log('📊 TEST SUMMARY REPORT');
  console.log('================================================================');
  let passedCount = 0;
  for (const r of results) {
    const icon = r.status === 'PASSED' ? '✅' : '❌';
    console.log(`${icon} ${r.file}: ${r.status}`);
    if (r.status === 'PASSED') passedCount++;
  }
  console.log(`\nTotal: ${results.length} | Passed: ${passedCount} | Failed: ${results.length - passedCount}`);

  if (activeServer) {
    activeServer.kill('SIGKILL');
  }
}

runAllTests().catch(err => {
  console.error('Fatal Test Runner Failure:', err);
  process.exit(1);
});
