#!/usr/bin/env node

/**
 * ASG Offline CLI Initializer (bin/cli.js)
 * Usage: npx asg-offline init
 */

const fs = require('fs');
const path = require('path');

const CWD = process.cwd();

function printBanner() {
  console.log('\x1b[36m%s\x1b[0m', '====================================================');
  console.log('\x1b[1m\x1b[34m  📡⚡ ASG Offline Web Service - CLI Initializer\x1b[0m');
  console.log('\x1b[36m%s\x1b[0m', '====================================================\n');
}

async function runInit() {
  printBanner();

  console.log('🔍 Analyzing project environment in:', CWD);

  let projectType = 'Vanilla HTML / JS';
  let pkgJson = null;
  const pkgPath = path.join(CWD, 'package.json');

  if (fs.existsSync(pkgPath)) {
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };

      if (deps['next']) projectType = 'Next.js';
      else if (deps['nuxt'] || deps['nuxt3']) projectType = 'Nuxt.js';
      else if (deps['react']) projectType = 'React';
      else if (deps['vue']) projectType = 'Vue.js';
      else if (deps['@angular/core']) projectType = 'Angular';
    } catch (e) {}
  }

  console.log(`\x1b[32m✔ Framework Detected:\x1b[0m \x1b[1m${projectType}\x1b[0m`);

  const appId = (pkgJson && pkgJson.name ? pkgJson.name : path.basename(CWD)).toLowerCase().replace(/[^a-z0-9]/g, '-') + '-offline';
  const appName = pkgJson && pkgJson.name ? pkgJson.name : 'My Offline App';

  // 1. Create asg-offline.config.json
  const configPath = path.join(CWD, 'asg-offline.config.json');
  const configData = {
    appId,
    appName,
    cacheStrategy: 'stale-while-revalidate',
    precacheUrls: ['/', '/index.html'],
    enableBackgroundSync: true,
    enableOfflineNotifications: true,
    serverUrl: 'http://localhost:3000'
  };

  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
  console.log('  \x1b[32m✔ Created config file:\x1b[0m asg-offline.config.json');

  // 2. Determine public directory
  let publicDir = path.join(CWD, 'public');
  if (!fs.existsSync(publicDir)) {
    if (fs.existsSync(path.join(CWD, 'static'))) {
      publicDir = path.join(CWD, 'static');
    } else {
      fs.mkdirSync(publicDir, { recursive: true });
    }
  }

  // 3. Create manifest.json
  const manifestPath = path.join(publicDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const manifestData = {
      short_name: appName,
      name: appName,
      start_url: '/',
      background_color: '#0f172a',
      theme_color: '#6366f1',
      display: 'standalone'
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));
    console.log('  \x1b[32m✔ Created Web App Manifest:\x1b[0m public/manifest.json');
  }

  // 4. Create local Service Worker helper script
  const swPath = path.join(publicDir, 'asg-sw.js');
  const swCode = `/**
 * ASG Service Worker Engine for ${appName}
 */
importScripts('${configData.serverUrl}/sdk/asg-sw.js');
`;
  if (!fs.existsSync(swPath)) {
    fs.writeFileSync(swPath, swCode);
    console.log('  \x1b[32m✔ Registered Service Worker:\x1b[0m public/asg-sw.js');
  }

  console.log('\n\x1b[32m\x1b[1m🎉 ASG Offline initialized successfully!\x1b[0m\n');
  console.log('\x1b[33mNext Steps:\x1b[0m');

  if (projectType === 'React' || projectType === 'Next.js') {
    console.log('  Add this single line in your root component (_app.js or App.js):\n');
    console.log(`  \x1b[36mimport '${configData.serverUrl}/sdk/asg-offline.js';\x1b[0m`);
    console.log(`  \x1b[36m// Or use React Hook: import { useASGOffline } from '${configData.serverUrl}/sdk/frameworks/react.js';\x1b[0m\n`);
  } else if (projectType === 'Vue.js' || projectType === 'Nuxt.js') {
    console.log('  Add this single line in main.js or App.vue:\n');
    console.log(`  \x1b[36mimport { useASGOffline } from '${configData.serverUrl}/sdk/frameworks/vue.js';\x1b[0m\n`);
  } else {
    console.log('  Insert this script tag inside the <head> of index.html:\n');
    console.log(`  \x1b[36m<script src="${configData.serverUrl}/sdk/asg-offline.js" data-app-id="${appId}"></script>\x1b[0m\n`);
  }
}

const command = process.argv[2];
if (command === 'init' || !command) {
  runInit();
} else {
  console.log(`Unknown command: ${command}. Use: npx asg-offline init`);
}
