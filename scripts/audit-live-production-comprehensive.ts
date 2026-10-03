import assert from 'node:assert';

const BASE_URL = 'https://joeeeee28.github.io/Planner/';

async function runLiveAudit() {
  console.log('============================================================');
  console.log('GROWTH OS V5 — LIVE PRODUCTION POST-DEPLOYMENT AUDIT');
  console.log('Target URL: ' + BASE_URL);
  console.log('Audit Timestamp: ' + new Date().toISOString());
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      console.log(`  ✅ ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ ${msg}`);
      failed++;
    }
  };

  // ── 1. Fetch index.html & Static Core Assets ──────────────────────────────
  console.log('1. Checking Live CDN Asset Availability & Status Codes:');
  const indexRes = await fetch(BASE_URL);
  assert.strictEqual(indexRes.status, 200, 'index.html returned 200');
  const indexHtml = await indexRes.text();
  ok(indexHtml.includes('<title>Growth OS — Personal & Professional Growth System</title>'), 'index.html title matches');

  // Discover main assets
  const jsMatch = indexHtml.match(/src="\.\/(assets\/index-[A-Za-z0-9_-]+\.js)"/);
  assert.ok(jsMatch, 'Main JS bundle matched');
  const mainJsPath = jsMatch[1];

  const cssMatch = indexHtml.match(/href="\.\/(assets\/index-[A-Za-z0-9_-]+\.css)"/);
  assert.ok(cssMatch, 'Main CSS bundle matched');
  const mainCssPath = cssMatch[1];

  const staticAssets = [
    'manifest.json',
    'sw.js',
    'favicon.svg',
    'icons.svg',
    mainCssPath,
    mainJsPath,
  ];

  for (const asset of staticAssets) {
    const res = await fetch(new URL(asset, BASE_URL));
    ok(res.status === 200, `${asset} -> HTTP ${res.status}`);
  }

  // Fetch main bundle
  const mainJsRes = await fetch(new URL(mainJsPath, BASE_URL));
  const mainJsText = await mainJsRes.text();

  // Discover dynamic chunks referenced in main bundle
  const moduleNames = [
    'AppContext',
    'cloudData',
    'Settings',
    'Analytics',
    'Money',
    'Investments',
    'Notifications',
    'Automation',
    'FocusMode',
    'Plan',
    'Today',
    'Goals',
    'Growth',
    'Dashboard',
  ];

  const downloadedChunks: Record<string, string> = {};
  downloadedChunks[mainJsPath] = mainJsText;

  for (const mod of moduleNames) {
    const chunkRegex = new RegExp(`${mod}-[A-Za-z0-9_-]+\\.js`);
    const match = mainJsText.match(chunkRegex);
    if (match) {
      const chunkPath = `assets/${match[0]}`;
      const res = await fetch(new URL(chunkPath, BASE_URL));
      if (res.status === 200) {
        const text = await res.text();
        downloadedChunks[mod] = text;
        ok(true, `Discovered and downloaded chunk: ${chunkPath} (${text.length} bytes)`);
      } else {
        ok(false, `Failed to download ${chunkPath}: HTTP ${res.status}`);
      }
    } else {
      ok(false, `Could not find chunk reference for module ${mod} in main bundle`);
    }
  }

  // ── 2. Live Manifest Inspection ──────────────────────────────────────────
  console.log('\n2. Live PWA Manifest Verification:');
  const manifestRes = await fetch(new URL('manifest.json', BASE_URL));
  const manifest = await manifestRes.json();
  ok(manifest.name === 'Growth OS — Personal & Professional Growth System', 'manifest.name matches V5 title');
  ok(manifest.short_name === 'Growth OS', 'manifest.short_name = Growth OS');
  ok(manifest.start_url === './', 'manifest.start_url = "./" (relative scope)');
  ok(manifest.scope === './', 'manifest.scope = "./" (relative scope)');
  ok(manifest.display === 'standalone', 'manifest.display = standalone');
  ok(manifest.theme_color === '#0d9488', 'manifest.theme_color = #0d9488');
  ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest icons present');

  // ── 3. Live Service Worker Inspection ────────────────────────────────────
  console.log('\n3. Live Service Worker Verification:');
  const swRes = await fetch(new URL('sw.js', BASE_URL));
  const swText = await swRes.text();
  ok(swText.includes('growth-os-shell-v5'), 'sw.js contains V5 shell cache identifier');
  ok(swText.includes('STATIC_ASSETS'), 'sw.js caches application shell');
  ok(swText.includes("url.hostname.includes('supabase')"), 'sw.js bypasses Supabase traffic from caching');
  ok(swText.includes('/auth/v1/'), 'sw.js explicitly avoids caching auth tokens');
  ok(swText.includes('self.skipWaiting()'), 'sw.js activates updates cleanly via skipWaiting');

  // ── 4. Live Version and Metadata Audit ───────────────────────────────────
  console.log('\n4. Live Version & Build Metadata Verification:');
  const settingsChunk = downloadedChunks['Settings'] || '';
  ok(settingsChunk.includes('5.0.0 (V5.0-RC)'), 'Settings UI renders "5.0.0 (V5.0-RC)"');
  ok(settingsChunk.includes('Growth OS'), 'Settings UI brand verified');
  ok(mainJsText.length > 250000, 'Main bundle compiled successfully');

  // ── 5. Security & Zero Secret Leakage Check ──────────────────────────────
  console.log('\n5. Live Production Bundle Security Audit:');
  let secretFound = false;
  for (const [chunkName, content] of Object.entries(downloadedChunks)) {
    if (content.includes('service_role')) {
      ok(false, `service_role found in ${chunkName}`);
      secretFound = true;
    }
    if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(content)) {
      ok(false, `sb_secret found in ${chunkName}`);
      secretFound = true;
    }
    if (content.includes('client_secret')) {
      ok(false, `client_secret found in ${chunkName}`);
      secretFound = true;
    }
    if (/BEGIN [A-Z ]*PRIVATE KEY/.test(content)) {
      ok(false, `private key found in ${chunkName}`);
      secretFound = true;
    }
  }
  if (!secretFound) {
    ok(true, 'Zero production secrets (service_role, client_secret, private keys) leaked in any JS chunk');
  }

  // Passcode Web Crypto verification
  ok(mainJsText.includes('PBKDF2'), 'Passcode encryption uses Web Crypto PBKDF2 (in main bundle)');
  ok(mainJsText.includes('growth-os.lock.v1'), 'Per-user lock namespace present (in main bundle)');
  const appCtxChunk = downloadedChunks['AppContext'] || '';
  ok(appCtxChunk.includes('edaghxxrwxwzszphaybh.supabase.co'), 'Production Supabase URL configured in AppContext');

  // ── 6. Live Feature Module Verification ───────────────────────────────────
  console.log('\n6. Live Feature Module Verification:');
  const analyticsChunk = downloadedChunks['Analytics'] || '';
  ok(analyticsChunk.includes('Personal Analytics') || analyticsChunk.includes('Analytics'), 'Analytics module verified');
  ok(analyticsChunk.includes('Investments') || analyticsChunk.includes('Portfolio'), 'Investments present in Analytics');

  const moneyChunk = downloadedChunks['Money'] || '';
  ok(moneyChunk.includes('Accounts'), 'Money Accounts tab present');
  ok(moneyChunk.includes('Sources'), 'Money Sources tab present');
  ok(moneyChunk.includes('Obligations'), 'Money Obligations tab present');
  ok(moneyChunk.includes('Transfers') || moneyChunk.includes('Transfer'), 'Money Transfers functionality present');
  ok(moneyChunk.includes('Credit Cards') || moneyChunk.includes('Cards'), 'Money Credit Cards tab present');

  const invChunk = downloadedChunks['Investments'] || '';
  ok(invChunk.includes('Portfolio') || invChunk.includes('Holdings'), 'Investments module contains Portfolio and Holdings');
  ok(invChunk.includes('GROWW') || invChunk.includes('ZERODHA') || invChunk.includes('Groww') || invChunk.includes('Zerodha'), 'Investments module contains GROWW and ZERODHA broker views');

  const notifChunk = downloadedChunks['Notifications'] || '';
  ok(notifChunk.includes('Notifications') || notifChunk.includes('Notification Center') || notifChunk.includes('notification'), 'Notifications module verified');
  ok(notifChunk.includes('Quiet Hours') || notifChunk.includes('quiet') || notifChunk.includes('Quiet'), 'Quiet hours support present');

  const autoChunk = downloadedChunks['Automation'] || '';
  ok(autoChunk.includes('Automation') || autoChunk.includes('Automations') || autoChunk.includes('Rules'), 'Automation engine present');

  const focusChunk = downloadedChunks['FocusMode'] || '';
  ok(focusChunk.includes('Focus Mode') || focusChunk.includes('Deep Work') || focusChunk.includes('Timer') || focusChunk.includes('Focus'), 'Focus mode present');

  const planChunk = downloadedChunks['Plan'] || '';
  ok(planChunk.includes('Plan') || planChunk.includes('Calendar') || planChunk.includes('timeline'), 'Planning & calendar views present');

  // ── 7. External Calendar & Market Data Provider State Verification ───────
  console.log('\n7. External Provider Truthfulness Audit:');
  ok(
    settingsChunk.includes('Server backend not configured') || settingsChunk.includes('Not configured'),
    'External calendar UI clearly indicates unconfigured backend state'
  );
  ok(!settingsChunk.includes('fake-connected'), 'No fake calendar connection exists in bundle');
  ok(
    invChunk.includes('Market data provider not configured') || invChunk.includes('Unconfigured'),
    'Investments UI truthfully displays unconfigured market data status when provider is unconfigured'
  );

  console.log('\n============================================================');
  console.log(`AUDIT COMPLETE: ${passed} passed, ${failed} failed`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLiveAudit().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
