import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHealthPhotoStore, validatePhotoFile, HEALTH_PHOTO_MAX_BYTES, HEALTH_PHOTO_URL_SECONDS, type HealthPhotoClient } from '../src/lib/health/photoStorage';
import type { HealthPhoto } from '../src/lib/health/types';

let passed = 0;
async function ok(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const png = new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4])], 'original.png', { type: 'image/png' });
const jpeg = new File([new Uint8Array([0xff,0xd8,0xff,0xe0,1,2,3,4])], 'original.jpg', { type: 'image/jpeg' });

function fakeServer() {
  let currentUser: string | null = A; let configured = true; let failUpload = false; let failObjectDelete = false; let failMetadataDelete = false;
  const rows = new Map<string, Record<string, unknown>>(); const objects = new Map<string, Uint8Array>(); const signed = new Map<string, number>();
  const result = <T>(data: T, error: unknown | null = null) => ({ data, error });
  const visibleRows = () => [...rows.values()].filter((r) => r.user_id === currentUser);
  const query = (filters: Record<string, unknown> = {}) => {
    const q = {
      eq: (k: string, v: unknown) => query({ ...filters, [k]: v }),
      order: () => q, range: (from: number, to: number) => { const data = visibleRows().filter((r) => Object.entries(filters).every(([k,v]) => r[k] === v)); return Promise.resolve(result(data.slice(from, to + 1))); },
      then: (resolve: (v: unknown) => unknown) => resolve(result(visibleRows().filter((r) => Object.entries(filters).every(([k,v]) => r[k] === v)))),
    }; return q;
  };
  const client = {
    auth: { getUser: async () => currentUser ? result({ user: { id: currentUser } }) : result({ user: null }, { message: 'no session' }) },
    rpc: async () => result(configured),
    from: () => ({
      select: () => query(),
      insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => {
        if (!currentUser || row.user_id !== currentUser || String(row.private_object_key).split('/')[0] !== currentUser) return result(null, { message: 'RLS denied' });
        rows.set(String(row.id), { ...row, created_at: new Date().toISOString() }); return result(rows.get(String(row.id)));
      } }) }),
      update: (patch: Record<string, unknown>) => ({ eq: async (_k: string, id: unknown) => {
        const row = rows.get(String(id)); if (!row || row.user_id !== currentUser) return result(null, { message: 'RLS denied' });
        rows.set(String(id), { ...row, ...patch }); return result(null);
      } }),
      delete: () => ({ eq: async (_k: string, id: unknown) => {
        if (failMetadataDelete) return result(null, { message: 'metadata unavailable' });
        const row = rows.get(String(id)); if (!row || row.user_id !== currentUser) return result(null, { message: 'RLS denied' });
        rows.delete(String(id)); return result(null);
      } }),
    }),
    storage: { from: (bucket: string) => {
      assert.equal(bucket, 'health-photos');
      return {
        upload: async (key: string, file: File) => {
          if (failUpload) return result(null, { message: 'network' });
          if (!currentUser || key.split('/')[0] !== currentUser || !configured) return result(null, { message: 'storage RLS denied' });
          objects.set(key, new Uint8Array(await file.arrayBuffer())); return result({ path: key });
        },
        createSignedUrl: async (key: string, seconds: number) => {
          if (!currentUser || key.split('/')[0] !== currentUser || !objects.has(key)) return result(null, { message: 'denied' });
          const expires = Date.now() + seconds * 1000; const url = `private-fixture://health/${key}?expires=${expires}`; signed.set(url, expires); return result({ signedUrl: url });
        },
        remove: async (keys: string[]) => {
          if (failObjectDelete) return result(null, { message: 'storage unavailable' });
          for (const key of keys) { if (!currentUser || key.split('/')[0] !== currentUser) return result(null, { message: 'denied' }); objects.delete(key); }
          return result([]);
        },
        list: async (folder: string) => result([...objects.keys()].filter((k) => k.startsWith(`${folder}/`)).map((k) => ({ name: k.split('/')[1] }))),
      };
    } },
  } as unknown as HealthPhotoClient;
  return { client, rows, objects, signed,
    setUser: (id: string | null) => { currentUser = id; }, setConfigured: (v: boolean) => { configured = v; }, setFailUpload: (v: boolean) => { failUpload = v; }, setFailObjectDelete: (v: boolean) => { failObjectDelete = v; }, setFailMetadataDelete: (v: boolean) => { failMetadataDelete = v; } };
}

console.log('Phase 30 · private photo adapter/security contract (fixture-backed, not live cloud)');
await ok('file validation accepts original JPEG/PNG/WebP and rejects type/signature/size/empty', async () => {
  assert.equal(await validatePhotoFile(png), null); assert.equal(await validatePhotoFile(jpeg), null);
  assert.ok(await validatePhotoFile(new File(['x'], 'x.gif', { type: 'image/gif' })));
  assert.ok(await validatePhotoFile(new File(['not a png'], 'fake.png', { type: 'image/png' })));
  assert.ok(await validatePhotoFile(new File([new Uint8Array(HEALTH_PHOTO_MAX_BYTES + 1)], 'big.png', { type: 'image/png' })));
  assert.ok(await validatePhotoFile(new File([], 'empty.png', { type: 'image/png' })));
});
await ok('unconfigured storage and signed-out sessions fail closed', async () => {
  const server = fakeServer(); const store = createHealthPhotoStore(server.client);
  server.setConfigured(false); assert.equal((await store.probe()).state, 'unavailable'); await assert.rejects(() => store.upload(png, { entryDate: '2026-10-30', category: 'front' }));
  server.setConfigured(true); server.setUser(null); assert.equal((await store.probe()).state, 'unavailable'); assert.equal(server.objects.size, 0);
});
await ok('authenticated upload preserves original bytes and creates private metadata', async () => {
  const server = fakeServer(); const store = createHealthPhotoStore(server.client); const phases: string[] = [];
  const photo = await store.upload(png, { entryDate: '2026-10-30', category: 'front' }, (p) => phases.push(p.phase));
  assert.equal(photo.userId, A); assert.equal(photo.privateObjectKey.split('/')[0], A); assert.deepEqual(server.objects.get(photo.privateObjectKey), new Uint8Array(await png.arrayBuffer())); assert.equal(server.rows.size, 1); assert.deepEqual(phases, ['validating','uploading','saving','done']);
});
await ok('multiple uploads, failure and retry do not create public URLs', async () => {
  const server = fakeServer(); const store = createHealthPhotoStore(server.client);
  await store.upload(png, { entryDate: '2026-10-30', category: 'front' }); server.setFailUpload(true);
  await assert.rejects(() => store.upload(jpeg, { entryDate: '2026-10-30', category: 'side' })); assert.equal(server.objects.size, 1);
  server.setFailUpload(false); await store.upload(jpeg, { entryDate: '2026-10-30', category: 'side' }); assert.equal(server.objects.size, 2); assert.equal(server.rows.size, 2);
  for (const key of server.objects.keys()) assert.ok(key.startsWith(`${A}/`));
});
await ok('signed access is short-lived; cross-user and unauthorized access are denied', async () => {
  const server = fakeServer(); const storeA = createHealthPhotoStore(server.client); const photo = await storeA.upload(png, { entryDate: '2026-10-30', category: 'back' });
  const signed = await storeA.signedUrl(photo); assert.ok(signed.expiresAt <= Date.now() + HEALTH_PHOTO_URL_SECONDS * 1000); assert.ok(signed.url.startsWith('private-fixture://'));
  server.setUser(B); const storeB = createHealthPhotoStore(server.client); assert.equal((await storeB.list()).length, 0); await assert.rejects(() => storeB.signedUrl(photo)); const deniedDelete = await storeB.remove([photo]); assert.deepEqual(deniedDelete.failed, [photo.id]); assert.equal(server.objects.size, 1);
  server.setUser(null); await assert.rejects(() => createHealthPhotoStore(server.client).signedUrl(photo));
});
await ok('delete removes object and metadata; delete-all also removes interrupted-upload orphans', async () => {
  const server = fakeServer(); const store = createHealthPhotoStore(server.client); const photo = await store.upload(png, { entryDate: '2026-10-30', category: 'front' });
  const report = await store.remove([photo]); assert.deepEqual(report.deleted, [photo.id]); assert.equal(server.objects.size, 0); assert.equal(server.rows.size, 0);
  server.objects.set(`${A}/orphan.png`, new Uint8Array([1])); const all = await store.removeAll(); assert.equal(all.message, undefined); assert.equal(server.objects.size, 0);
});
await ok('partial deletion is reported honestly and metadata remains retryable', async () => {
  const server = fakeServer(); const store = createHealthPhotoStore(server.client); const photo = await store.upload(png, { entryDate: '2026-10-30', category: 'front' });
  server.setFailObjectDelete(true); const report = await store.remove([photo]); assert.equal(report.deleted.length, 0); assert.deepEqual(report.failed, [photo.id]); assert.ok(report.message); assert.equal(server.objects.size, 1); assert.equal(server.rows.get(photo.id)?.deletion_pending, true);
  server.setFailObjectDelete(false); const retry = await store.remove([photo]); assert.deepEqual(retry.deleted, [photo.id]); assert.equal(server.objects.size, 0); assert.equal(server.rows.size, 0);
});
await ok('SQL contract enforces private bucket, auth.uid ownership, limits and no browser service role', () => {
  const sql = readFileSync('supabase/migrations/202610300001_phase30_private_health.sql', 'utf8');
  assert.ok(sql.includes("'health-photos', false, 10485760")); assert.ok(sql.includes('enable row level security')); assert.ok(sql.includes('auth.uid() = user_id')); assert.ok(sql.includes("(storage.foldername(name))[1] = auth.uid()::text")); assert.ok(sql.includes('health_photo_storage_status')); assert.ok(!sql.includes('service_role'));
  const files = readdirSync('src', { recursive: true }) as string[];
  for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f))) { const source = readFileSync(`src/${f}`, 'utf8'); assert.ok(!/VITE_.*SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY\s*=/.test(source), f); assert.ok(!source.includes('getPublicUrl'), f); }
  assert.equal(HEALTH_PHOTO_URL_SECONDS, 60);
});
console.log(`\nPHASE 30 PHOTO CONTRACT: ${passed} passed, 0 failed (fixture-backed; live deployment verification still required)`);
