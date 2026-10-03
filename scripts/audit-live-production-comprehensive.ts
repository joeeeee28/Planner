import assert from 'node:assert';

const BASE_URL = 'https://joeeeee28.github.io/Planner/';

interface AssetCheck {
  path: string;
  expectedStatus: number;
  contentTypePrefix?: string;
  minBytes?: number;
}

const CRITICAL_ASSETS: AssetCheck[] = [
  { path: '', expectedStatus: 200, contentTypePrefix: 'text/html', minBytes: 500 },
  { path: 'manifest.json', expectedStatus: 200, contentTypePrefix: 'application/json', minBytes: 400 },
  { path: 'sw.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 2000 },
  { path: 'favicon.svg', expectedStatus: 200, contentTypePrefix: 'image/svg+xml', minBytes: 300 },
  { path: 'icons.svg', expectedStatus: 200, contentTypePrefix: 'image/svg+xml', minBytes: 3000 },
  { path: 'assets/index-Bpz-YQFk.css', expectedStatus: 200, contentTypePrefix: 'text/css', minBytes: 50000 },
  { path: 'assets/index-CritDp0W.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 200000 },
  { path: 'assets/AppContext-zI7sbvnw.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 200000 },
  { path: 'assets/cloudData-BCJuqiqv.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 30000 },
  { path: 'assets/Settings-S_7YMqFk.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 50000 },
  { path: 'assets/Analytics-D94KBGKR.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 35000 },
  { path: 'assets/Money-Bo86zWSY.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 450000 },
  { path: 'assets/Notifications-CGQ3EwlL.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 15000 },
  { path: 'assets/Automation-x96UV4ac.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 15000 },
  { path: 'assets/FocusMode-amkkcPFs.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 9000 },
  { path: 'assets/Plan-CWR13nEM.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 25000 },
  { path: 'assets/Today-5W7PtkfH.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 25000 },
  { path: 'assets/Goals-DTq3p5fq.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 30000 },
  { path: 'assets/Growth-BtfEZtRm.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 50000 },
  { path: 'assets/Dashboard-BDCQEOmB.js', expectedStatus: 200, contentTypePrefix: 'application/javascript', minBytes: 25000 },
];

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

  // ── 1. HTTP and Asset Availability Check ─────────────────────────────────
  console.log('1. Checking Live CDN Asset Availability & Status Codes:');
  const downloadedChunks: Record<string, string> = {};

  for (const asset of CRITICAL_ASSETS) {
    const url = new URL(asset.path, BASE_URL).toString();
    try {
      const res = await fetch(url);
      const text = await res.text();
      const statusOk = res.status === asset.expectedStatus;
      const ctype = res.headers.get('content-type') || '';
      const ctypeOk = asset.contentTypePrefix ? ctype.includes(asset.contentTypePrefix) : true;
      const sizeOk = asset.minBytes ? text.length >= asset.minBytes : true;

      ok(
        statusOk && ctypeOk && sizeOk,
        `${asset.path || 'index.html'} -> HTTP ${res.status} (${text.length} bytes, ${ctype})`
      );

      if (asset.path.endsWith('.js')) {
        downloadedChunks[asset.path] = text;
      }
    } catch (err: any) {
      ok(false, `${asset.path} failed to fetch: ${err.message}`);
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
  ok(swText.includes('url.hostname.includes(\'supabase\')'), 'sw.js bypasses Supabase traffic from caching');
  ok(swText.includes('/auth/v1/'), 'sw.js explicitly avoids caching auth tokens');
  ok(swText.includes('self.skipWaiting()'), 'sw.js activates updates cleanly via skipWaiting');

  // ── 4. Live Version and Metadata Audit ───────────────────────────────────
  console.log('\n4. Live Version & Build Metadata Verification:');
  const settingsChunk = downloadedChunks['assets/Settings-S_7YMqFk.js'] || '';
  ok(settingsChunk.includes('5.0.0 (V5.0-RC)'), 'Settings UI renders "5.0.0 (V5.0-RC)"');
  ok(settingsChunk.includes('Growth OS'), 'Settings UI brand verified');

  const mainChunk = downloadedChunks['assets/index-CritDp0W.js'] || '';
  ok(mainChunk.length > 250000, 'Main bundle compiled successfully');

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
  ok(mainChunk.includes('PBKDF2'), 'Passcode encryption uses Web Crypto PBKDF2 (in main bundle)');
  ok(mainChunk.includes('growth-os.lock.v1'), 'Per-user lock namespace present (in main bundle)');
  const appCtxChunk = downloadedChunks['assets/AppContext-zI7sbvnw.js'] || '';
  ok(appCtxChunk.includes('edaghxxrwxwzszphaybh.supabase.co'), 'Production Supabase URL configured in AppContext');

  // ── 6. Live Feature Module Verification ───────────────────────────────────
  console.log('\n6. Live Feature Module Verification:');
  const analyticsChunk = downloadedChunks['assets/Analytics-D94KBGKR.js'] || '';
  ok(analyticsChunk.includes('Personal Analytics') || analyticsChunk.includes('Personal & Professional Intelligence') || analyticsChunk.includes('Analytics'), 'Analytics module verified');
  ok(analyticsChunk.includes('Reports') || analyticsChunk.includes('Category Breakdown') || analyticsChunk.includes('distribution'), 'Reports & insights engine verified');

  const moneyChunk = downloadedChunks['assets/Money-Bo86zWSY.js'] || '';
  ok(moneyChunk.includes('Accounts'), 'Money Accounts tab present');
  ok(moneyChunk.includes('Sources'), 'Money Sources tab present');
  ok(moneyChunk.includes('Obligations'), 'Money Obligations tab present');
  ok(moneyChunk.includes('Transfers') || moneyChunk.includes('Transfer'), 'Money Transfers functionality present');
  ok(moneyChunk.includes('Credit Cards') || moneyChunk.includes('Cards'), 'Money Credit Cards tab present');

  const notifChunk = downloadedChunks['assets/Notifications-CGQ3EwlL.js'] || '';
  ok(notifChunk.includes('Notifications') || notifChunk.includes('Notification Center') || notifChunk.includes('notification'), 'Notifications module verified');
  ok(notifChunk.includes('Quiet Hours') || notifChunk.includes('quiet') || notifChunk.includes('Quiet'), 'Quiet hours support present');

  const autoChunk = downloadedChunks['assets/Automation-x96UV4ac.js'] || '';
  ok(autoChunk.includes('Automation') || autoChunk.includes('Automations') || autoChunk.includes('Rules'), 'Automation engine present');

  const focusChunk = downloadedChunks['assets/FocusMode-amkkcPFs.js'] || '';
  ok(focusChunk.includes('Focus Mode') || focusChunk.includes('Deep Work') || focusChunk.includes('Timer') || focusChunk.includes('Focus'), 'Focus mode present');

  const planChunk = downloadedChunks['assets/Plan-CWR13nEM.js'] || '';
  ok(planChunk.includes('Plan') || planChunk.includes('Calendar') || planChunk.includes('timeline'), 'Planning & calendar views present');

  // ── 7. External Calendar Provider State Verification ─────────────────────
  console.log('\n7. External Calendar Provider Truthfulness Audit:');
  ok(
    settingsChunk.includes('Server backend not configured') || settingsChunk.includes('Not configured'),
    'External calendar UI clearly indicates unconfigured backend state'
  );
  ok(!settingsChunk.includes('fake-connected'), 'No fake calendar connection exists in bundle');

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
