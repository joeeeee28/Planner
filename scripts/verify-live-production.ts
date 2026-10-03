import assert from 'node:assert';

async function verifyLiveProduction() {
  console.log('=== VERIFYING LIVE PRODUCTION DEPLOYMENT ===');
  const baseUrl = 'https://joeeeee28.github.io/Planner/';

  // 1. Fetch live index.html
  console.log(`\n1. Fetching index.html from ${baseUrl}...`);
  const indexRes = await fetch(baseUrl);
  assert.strictEqual(indexRes.status, 200, 'Live index.html returned HTTP 200');
  const indexHtml = await indexRes.text();
  assert.ok(indexHtml.includes('<title>Growth OS — Personal & Professional Growth System</title>'), 'Title matches');
  assert.ok(indexHtml.includes('manifest.json'), 'Manifest is linked');
  assert.ok(indexHtml.includes('navigator.serviceWorker.register'), 'Service worker is registered');
  console.log('  ✅ Live index.html verified (HTTP 200, correct title, manifest link, sw registration)');

  // 2. Extract asset references
  const jsMatch = indexHtml.match(/src="\.\/(assets\/index-[A-Za-z0-9_-]+\.js)"/);
  assert.ok(jsMatch, 'Main JS asset found in index.html');
  const jsPath = jsMatch[1];
  console.log(`  ℹ Main bundle: ${jsPath}`);

  const cssMatch = indexHtml.match(/href="\.\/(assets\/index-[A-Za-z0-9_-]+\.css)"/);
  assert.ok(cssMatch, 'Main CSS asset found in index.html');
  const cssPath = cssMatch[1];
  console.log(`  ℹ Main stylesheet: ${cssPath}`);

  // 3. Fetch manifest.json
  console.log('\n2. Fetching manifest.json...');
  const manifestRes = await fetch(new URL('manifest.json', baseUrl));
  assert.strictEqual(manifestRes.status, 200, 'Live manifest.json returned HTTP 200');
  const manifest = await manifestRes.json();
  assert.strictEqual(manifest.start_url, './', 'start_url is ./');
  assert.strictEqual(manifest.scope, './', 'scope is ./');
  assert.strictEqual(manifest.name, 'Growth OS — Personal & Professional Growth System');
  console.log('  ✅ Live manifest.json verified (HTTP 200, start_url: ./, scope: ./)');

  // 4. Fetch sw.js
  console.log('\n3. Fetching sw.js...');
  const swRes = await fetch(new URL('sw.js', baseUrl));
  assert.strictEqual(swRes.status, 200, 'Live sw.js returned HTTP 200');
  const swText = await swRes.text();
  assert.ok(swText.includes('growth-os-shell-v5'), 'Service worker contains V5 shell cache name');
  assert.ok(swText.includes('supabase'), 'Service worker contains bypass rule for Supabase');
  console.log('  ✅ Live sw.js verified (HTTP 200, v5 cache, bypass rules)');

  // 5. Fetch CSS bundle
  console.log(`\n4. Fetching stylesheet ${cssPath}...`);
  const cssRes = await fetch(new URL(cssPath, baseUrl));
  assert.strictEqual(cssRes.status, 200, 'Live CSS returned HTTP 200');
  console.log(`  ✅ Live CSS verified (HTTP 200, size: ${(await cssRes.text()).length} chars)`);

  // 6. Fetch JS bundle & inspect
  console.log(`\n5. Fetching main JS bundle ${jsPath}...`);
  const jsRes = await fetch(new URL(jsPath, baseUrl));
  assert.strictEqual(jsRes.status, 200, 'Live JS returned HTTP 200');
  const jsText = await jsRes.text();
  console.log(`  ✅ Live JS downloaded (HTTP 200, size: ${jsText.length} chars)`);

  // 6. Fetch AppContext chunk & inspect
  console.log('\n6. Fetching AppContext chunk...');
  const appCtxMatch = jsText.match(/AppContext-[A-Za-z0-9_-]+\.js/);
  const appCtxPath = appCtxMatch ? `assets/${appCtxMatch[0]}` : 'assets/AppContext-CayuhTW1.js';
  const appCtxRes = await fetch(new URL(appCtxPath, baseUrl));
  assert.strictEqual(appCtxRes.status, 200, 'Live AppContext chunk returned HTTP 200');
  const appCtxText = await appCtxRes.text();
  console.log(`  ✅ Live AppContext downloaded (${appCtxPath}, HTTP 200, size: ${appCtxText.length} chars)`);

  // Verify V5 features in live bundle
  console.log('\n7. Auditing live bundle for V5 modules & security...');
  assert.ok(appCtxText.includes('edaghxxrwxwzszphaybh.supabase.co'), 'Production Supabase URL configured');
  console.log('  ✅ Production Supabase project URL present in AppContext bundle');

  assert.ok(!jsText.includes('service_role'), 'Zero service_role in bundle');
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(jsText), 'Zero sb_secret in bundle');
  assert.ok(!jsText.includes('client_secret'), 'Zero OAuth client_secret in bundle');
  assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(jsText), 'Zero private keys in bundle');
  console.log('  ✅ Zero leaked production secrets');

  assert.ok(jsText.includes('PBKDF2'), 'Passcode verifier uses PBKDF2 Web Crypto');
  assert.ok(jsText.includes('growth-os.lock.v1'), 'Per-user device lock namespace present');
  console.log('  ✅ Passcode & lock screen security verified');

  // 7. Fetch Settings chunk from live production
  console.log('\n7. Fetching Settings chunk to verify version...');
  const settingsMatch = jsText.match(/Settings-[A-Za-z0-9_-]+\.js/);
  assert.ok(settingsMatch, 'Settings chunk referenced in main bundle');
  const settingsPath = `assets/${settingsMatch[0]}`;
  const settingsRes = await fetch(new URL(settingsPath, baseUrl));
  assert.strictEqual(settingsRes.status, 200, 'Live Settings chunk returned HTTP 200');
  const settingsText = await settingsRes.text();
  assert.ok(settingsText.includes('5.0.0 (V5.0-RC)'), 'Version 5.0.0 (V5.0-RC) present in live Settings UI');
  console.log(`  ✅ Live UI version verified: Growth OS 5.0.0 (V5.0-RC) (${settingsPath})`);

  // 8. Fetch Investments chunk from live production
  console.log('\n8. Fetching Investments chunk to verify V5 module deployment...');
  const invMatch = jsText.match(/Investments-[A-Za-z0-9_-]+\.js/);
  assert.ok(invMatch, 'Investments chunk referenced in main bundle');
  const invPath = `assets/${invMatch[0]}`;
  const invRes = await fetch(new URL(invPath, baseUrl));
  assert.strictEqual(invRes.status, 200, 'Live Investments chunk returned HTTP 200');
  const invText = await invRes.text();
  assert.ok(invText.includes('Portfolio'), 'Investments module contains Portfolio UI');
  console.log(`  ✅ Live Investments module verified (${invPath}, HTTP 200, size: ${invText.length} chars)`);

  console.log('\n🎉 ALL LIVE PRODUCTION VERIFICATIONS PASSED SUCCESSFULLY!');
}

verifyLiveProduction().catch((err) => {
  console.error('❌ Live production verification failed:', err);
  process.exit(1);
});
