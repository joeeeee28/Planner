import { cloudConfig, getClient, type SupabaseLike } from '../cloud';
import { isHealthDate } from './domain';
import { todayStr } from '../dates';
import { PHOTO_CATEGORIES, type HealthPhoto, type HealthPhotoStatus, type PhotoCategory } from './types';

export const HEALTH_PHOTO_BUCKET = 'health-photos';
export const HEALTH_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const HEALTH_PHOTO_URL_SECONDS = 60;
export const HEALTH_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoProgress = { phase: 'validating' | 'uploading' | 'saving' | 'done'; percent?: number };
type Result<T> = { data: T; error: unknown | null };
type Query = PromiseLike<Result<unknown>> & {
  eq: (column: string, value: unknown) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  range: (from: number, to: number) => Query;
  single: () => PromiseLike<Result<unknown>>;
};
type Table = {
  select: (columns: string) => Query;
  insert: (row: Record<string, unknown>) => { select: (columns: string) => { single: () => PromiseLike<Result<unknown>> } };
  update: (row: Record<string, unknown>) => { eq: (column: string, value: unknown) => PromiseLike<Result<unknown>> };
  delete: () => { eq: (column: string, value: unknown) => PromiseLike<Result<unknown>> };
};
type Bucket = {
  upload: (key: string, file: File, options: { contentType: string; upsert: boolean; cacheControl: string }) => PromiseLike<Result<unknown>>;
  createSignedUrl: (key: string, seconds: number) => PromiseLike<Result<{ signedUrl: string } | null>>;
  remove: (keys: string[]) => PromiseLike<Result<unknown>>;
  list: (folder: string, options: { limit: number; offset: number }) => PromiseLike<Result<{ name: string }[] | null>>;
};
export type HealthPhotoClient = SupabaseLike & {
  auth: SupabaseLike['auth'] & { getUser: () => PromiseLike<Result<{ user: { id: string } | null }>> };
  storage: { from: (bucket: string) => Bucket };
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const table = (client: HealthPhotoClient) => client.from('health_photos') as unknown as Table;
const bucket = (client: HealthPhotoClient) => client.storage.from(HEALTH_PHOTO_BUCKET);
const safeError = (message: string) => new Error(message);

export async function validatePhotoFile(file: File, maxBytes = HEALTH_PHOTO_MAX_BYTES): Promise<string | null> {
  if (!Number.isFinite(file.size) || file.size <= 0) return 'This file is empty.';
  if (file.size > maxBytes) return `Each photo must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`;
  if (!(HEALTH_PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Use a JPEG, PNG or WebP photo.';
  try {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const png = [137,80,78,71,13,10,26,10].every((n,i) => b[i] === n);
    const webp = String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP';
    if ((file.type === 'image/jpeg' && jpeg) || (file.type === 'image/png' && png) || (file.type === 'image/webp' && webp)) return null;
    return 'The file contents do not match a supported image format.';
  } catch { return 'This photo could not be read. Please choose it again.'; }
}
function photoFromRow(row: unknown, userId: string): HealthPhoto | null {
  if (!record(row) || row.user_id !== userId || typeof row.id !== 'string' || typeof row.private_object_key !== 'string') return null;
  if (row.private_object_key.split('/')[0] !== userId || !(HEALTH_PHOTO_TYPES as readonly string[]).includes(String(row.mime_type))) return null;
  if (!isHealthDate(row.entry_date) || !PHOTO_CATEGORIES.includes(row.category as PhotoCategory) || typeof row.file_size !== 'number') return null;
  return { id: row.id, userId, entryDate: row.entry_date, category: row.category as PhotoCategory, privateObjectKey: row.private_object_key, mimeType: row.mime_type as HealthPhoto['mimeType'], fileSize: row.file_size, createdAt: String(row.created_at), deletionPending: row.deletion_pending === true };
}
export interface PhotoDeletionReport { deleted: string[]; failed: string[]; message?: string }

/** All ownership checks are repeated by server RLS; browser IDs are only filters. */
export function createHealthPhotoStore(client: HealthPhotoClient) {
  let ready = false;
  const user = async (): Promise<string> => {
    const result = await client.auth.getUser();
    const id = result.data?.user?.id;
    if (result.error || !id) throw safeError('Your secure session has expired. Sign in again to access photos.');
    return id;
  };
  const ensureReady = async () => {
    const result = await client.rpc('health_photo_storage_status');
    if (result.error || result.data !== true) throw safeError('Private photo storage is not configured yet. Uploads are blocked.');
    ready = true;
  };
  const owned = (photo: HealthPhoto, userId: string) => {
    if (photo.userId !== userId || photo.privateObjectKey.split('/')[0] !== userId || photo.privateObjectKey !== `${userId}/${photo.id}.${photo.mimeType === 'image/jpeg' ? 'jpg' : photo.mimeType === 'image/png' ? 'png' : 'webp'}`) throw safeError('This photo does not belong to your account.');
  };
  const list = async (): Promise<HealthPhoto[]> => {
    const userId = await user(); await ensureReady();
    const out: HealthPhoto[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await table(client).select('*').eq('user_id', userId).order('entry_date', { ascending: false }).range(offset, offset + 999);
      if (result.error) throw safeError('Private photos are unavailable right now. Please retry.');
      const rows = Array.isArray(result.data) ? result.data : [];
      out.push(...rows.map((r) => photoFromRow(r, userId)).filter((p): p is HealthPhoto => !!p));
      if (rows.length < 1000) break;
    }
    return out;
  };
  return {
    async probe(): Promise<HealthPhotoStatus> {
      try {
        const photos = await list(); ready = true;
        return { state: 'ready', photoCount: photos.length };
      } catch (e) { ready = false; return { state: 'unavailable', message: e instanceof Error ? e.message : 'Private photo storage is unavailable.' }; }
    },
    list,
    async upload(file: File, input: { entryDate: string; category: PhotoCategory }, onProgress: (p: PhotoProgress) => void = () => {}): Promise<HealthPhoto> {
      onProgress({ phase: 'validating' });
      const invalid = await validatePhotoFile(file); if (invalid) throw safeError(invalid);
      if (!isHealthDate(input.entryDate) || input.entryDate > todayStr()) throw safeError('Choose a valid photo date, today or in the past.');
      if (!PHOTO_CATEGORIES.includes(input.category)) throw safeError('Choose a photo category.');
      const userId = await user(); await ensureReady();
      if (typeof crypto === 'undefined' || !crypto.randomUUID) throw safeError('This browser cannot create a secure photo identifier. Use a current browser over HTTPS.');
      const id = crypto.randomUUID();
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const key = `${userId}/${id}.${ext}`;
      onProgress({ phase: 'uploading' });
      // The original File is sent unchanged. No canvas, crop, retouch or EXIF rewrite.
      const upload = await bucket(client).upload(key, file, { contentType: file.type, upsert: false, cacheControl: 'no-store' });
      if (upload.error) throw safeError('Upload failed. Your photo was not saved. Check your connection and retry.');
      onProgress({ phase: 'saving' });
      try {
        const inserted = await table(client).insert({ id, user_id: userId, entry_date: input.entryDate, category: input.category, private_object_key: key, mime_type: file.type, file_size: file.size, deletion_pending: false }).select('*').single();
        const photo = photoFromRow(inserted.data, userId);
        if (inserted.error || !photo) throw safeError('Photo metadata could not be saved.');
        onProgress({ phase: 'done', percent: 100 }); ready = true; return photo;
      } catch {
        const cleanup = await Promise.resolve(bucket(client).remove([key])).catch(() => ({ error: true, data: null }));
        throw safeError(cleanup.error ? 'Upload did not complete and private-file cleanup failed. Retry, then use Delete all photos in Privacy & Data if needed.' : 'Upload did not complete. The partial private file was removed; please retry.');
      }
    },
    async signedUrl(photo: HealthPhoto): Promise<{ url: string; expiresAt: number }> {
      const userId = await user(); owned(photo, userId); if (!ready) await ensureReady();
      const result = await bucket(client).createSignedUrl(photo.privateObjectKey, HEALTH_PHOTO_URL_SECONDS);
      if (result.error || !result.data?.signedUrl) throw safeError('This private photo link expired or is unavailable. Reload the photo to try again.');
      return { url: result.data.signedUrl, expiresAt: Date.now() + HEALTH_PHOTO_URL_SECONDS * 1000 };
    },
    async download(photo: HealthPhoto): Promise<Blob> {
      const { url } = await this.signedUrl(photo);
      const response = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (!response.ok) throw safeError('The private download link expired. Please try again.');
      return response.blob();
    },
    /** Object first, metadata second. A failed object delete keeps retry metadata. */
    async remove(photos: HealthPhoto[]): Promise<PhotoDeletionReport> {
      const userId = await user(); await ensureReady();
      const report: PhotoDeletionReport = { deleted: [], failed: [] };
      for (const photo of photos) {
        try {
          owned(photo, userId);
          const marked = await table(client).update({ deletion_pending: true }).eq('id', photo.id);
          if (marked.error) throw safeError('metadata');
          const removed = await bucket(client).remove([photo.privateObjectKey]);
          if (removed.error) throw safeError('object');
          const metadata = await table(client).delete().eq('id', photo.id);
          if (metadata.error) throw safeError('metadata');
          report.deleted.push(photo.id);
        } catch { report.failed.push(photo.id); }
      }
      if (report.failed.length) report.message = `${report.deleted.length} photo(s) deleted; ${report.failed.length} still need deletion. Nothing has been marked fully complete. Retry when storage is available.`;
      return report;
    },
    async removeAll(): Promise<PhotoDeletionReport> {
      const photos = await list();
      const report = await this.remove(photos);
      const userId = await user();
      // Also remove private orphan objects left by an interrupted upload.
      try {
        const keys: string[] = [];
        for (let offset = 0; ; offset += 1000) {
          const listed = await bucket(client).list(userId, { limit: 1000, offset });
          if (listed.error) throw safeError('list');
          const rows = listed.data ?? []; keys.push(...rows.map((r) => `${userId}/${r.name}`));
          if (rows.length < 1000) break;
        }
        if (keys.length) { const removed = await bucket(client).remove(keys); if (removed.error) throw safeError('remove'); }
      } catch { report.message = `${report.message ?? ''} Some private objects could not be verified as deleted. Retry Delete all photos.`.trim(); }
      return report;
    },
  };
}
export type HealthPhotoStore = ReturnType<typeof createHealthPhotoStore>;
let singleton: HealthPhotoStore | null = null;
/** Never construct a cloud client in development-local mode. */
export function healthPhotoStore(): HealthPhotoStore | null {
  if (!cloudConfig()) return null;
  if (!singleton) {
    const client = getClient() as unknown as HealthPhotoClient;
    if (!client.storage || !client.auth.getUser) return null;
    singleton = createHealthPhotoStore(client);
  }
  return singleton;
}
