// ─────────────────────────────────────────────────────────────────────────────
// Production bundle gate — reproduces the live regression that shipped a
// build with NO Supabase configuration, which silently degraded production to
// a local default account.
//
// Run: npx tsx scripts/check-production-build.ts [distDir]
//
// It inspects the COMPILED output (not the source), because the failure mode
// is invisible in source: `readEnvConfig()` reads the right literals, but Vite
// substitutes empty values when the build environment lacks the variables and
// the whole function collapses to `function fc(){return null}` — after which
// isCloudConfigured() is permanently false and the app boots into local mode.
//
// Exit codes: 0 = bundle is production-ready, 1 = would regress.
//
// Set GROWTH_OS_EXPECT_CLOUD=1 to REQUIRE a cloud-configured bundle (used by
// the deploy workflow, where the secrets must be present).
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const expectCloud = process.env.GROWTH_OS_EXPECT_CLOUD === '1';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) {
    pass++;
    console.log(`  ✅ ${m}`);
  } else {
    fail++;
    console.log(`  ❌ ${m}`);
  }
};

if (!existsSync(dist)) {
  console.error(`No build found at ${dist}/ — run \`npm run build\` first.`);
  process.exit(1);
}

const assetsDir = join(dist, 'assets');
const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
const bundle = jsFiles.map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n');

console.log(`\nProduction bundle audit — ${dist}/ (${jsFiles.length} JS chunks)\n`);

// ── 1. Deployment artifact shape ─────────────────────────────────────────────
console.log('Artifact');
ok(existsSync(join(dist, 'index.html')), 'index.html present');
ok(existsSync(join(dist, '.nojekyll')), '.nojekyll present (GitHub Pages)');
ok(jsFiles.length > 0, 'hashed JS assets emitted');
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
const referenced = indexHtml.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
ok(!!referenced && existsSync(join(dist, referenced.replace('assets/', 'assets/'))), 'index.html references an emitted bundle');
ok(!/src=["']\/(?!Planner)/.test(indexHtml) && indexHtml.includes('./assets/'), 'relative asset paths (works under /Planner/)');

// ── 2. THE REGRESSION: was the Supabase config compiled in? ──────────────────
console.log('\nSupabase configuration (the live regression)');
// The tell-tale of a credential-less build: the env reader collapsed to a
// constant null, so isCloudConfigured() can never be true at runtime.
const collapsedReader = /function [A-Za-z0-9_$]{1,4}\(\)\{return null\}/.test(bundle);
const hasProjectUrl = /https:\/\/[a-z0-9]{8,}\.supabase\.co/.test(bundle);
const cloudConfigured = hasProjectUrl && !collapsedReader;

if (hasProjectUrl) {
  // Never print the value itself — only its shape.
  const ref = bundle.match(/https:\/\/([a-z0-9]{8,})\.supabase\.co/)?.[1] ?? '';
  console.log(`  ℹ  Supabase project URL compiled in (ref length ${ref.length}, value withheld)`);
} else {
  console.log('  ℹ  No Supabase project URL in the bundle → build ran without credentials');
}

if (expectCloud) {
  ok(hasProjectUrl, 'VITE_SUPABASE_URL was injected at build time');
  ok(!collapsedReader, 'env reader was NOT eliminated as constant-null');
  ok(cloudConfigured, 'bundle boots in cloud-authenticated mode → login screen for visitors');
} else {
  console.log(
    cloudConfigured
      ? '  ✅ cloud-authenticated build (unauthenticated visitors get the LOGIN screen)'
      : '  ⚠️  development-local build — an unauthenticated visitor will get a LOCAL DEFAULT ACCOUNT.\n' +
        '      This is exactly the production regression. Supply VITE_SUPABASE_URL and\n' +
        '      VITE_SUPABASE_ANON_KEY at build time (see .github/workflows/deploy.yml).',
  );
}

// ── 3. Secret audit — these must NEVER reach the browser ─────────────────────
console.log('\nSecret audit');
ok(!/service_role/.test(bundle), 'no service_role key');
// Match an actual secret VALUE (sb_secret_ followed by key characters), not the
// vendor supabase-js key-format detector which merely mentions the prefix.
ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(bundle), 'no sb_secret_ key');
ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(bundle), 'no private keys');
ok(!/postgres(ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/.test(bundle), 'no database connection string');
ok(!/["'`]passcode["'`]\s*:\s*["'`]\d+["'`]/.test(bundle), 'no plaintext passcode');
ok(!/client_secret/.test(bundle), 'no OAuth client secret');

// ── 4. Auth/lock code actually shipped ───────────────────────────────────────
console.log('\nAuth + passcode surfaces present');
ok(bundle.includes('PBKDF2'), 'passcode verifier uses PBKDF2 (Web Crypto)');
ok(bundle.includes('growth-os.lock.v1'), 'per-user device lock namespace');
ok(bundle.includes('Enter passcode'), 'lock screen shipped');
ok(bundle.includes('Sign in') || bundle.includes('Welcome back'), 'login screen shipped');

// ── 5. No localhost auth redirect in production ──────────────────────────────
console.log('\nProduction redirects');
// The app derives its redirect from window.location.origin; only vendor
// (supabase-js) internals may mention localhost.
const appLocalhostRedirect = /redirectTo\s*:\s*["'`]https?:\/\/(localhost|127\.0\.0\.1)/.test(bundle);
ok(!appLocalhostRedirect, 'no hard-coded localhost auth redirect');

console.log(`\n${fail === 0 ? '✅' : '❌'} production bundle audit: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
