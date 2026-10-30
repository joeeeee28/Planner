import { useEffect, useMemo, useRef, useState } from 'react';
import { todayStr } from '../../lib/dates';
import { HEALTH_PHOTO_MAX_BYTES, HEALTH_PHOTO_TYPES, type HealthPhotoStore } from '../../lib/health/photoStorage';
import { PHOTO_CATEGORIES, type HealthPhoto, type PhotoCategory } from '../../lib/health/types';
import { Modal } from '../ui';
import { IconCamera, IconUpload } from '../icons';
import { ConfirmHealthDialog, dateLabel, downloadBlob, HealthEmpty, HealthField, useHealthPhotos } from './common';

function PrivateImage({ photo, store, large = false }: { photo: HealthPhoto; store: HealthPhotoStore; large?: boolean }) {
  const [url, setUrl] = useState(''); const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false; let timer: ReturnType<typeof setTimeout> | undefined;
    setUrl(''); setError('');
    void store.signedUrl(photo).then((signed) => {
      if (cancelled) return;
      setUrl(signed.url);
      timer = setTimeout(() => setAttempt((n) => n + 1), Math.max(1000, signed.expiresAt - Date.now() - 10000));
    }).catch(() => { if (!cancelled) setError('Private link unavailable or expired.'); });
    return () => { cancelled = true; if (timer) clearTimeout(timer); setUrl(''); };
  }, [photo.id, photo.privateObjectKey, store, attempt]);
  if (error) return <div className="health-photo-error"><p>{error}</p><button className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>Retry secure link</button></div>;
  if (!url) return <div className="health-photo-loading" role="status">Opening private photo…</div>;
  return <img className={large ? 'health-photo-full' : 'health-photo-img'} src={url} alt={`${photo.category} progress photo, ${dateLabel(photo.entryDate)}`} loading={large ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => { setError('This private link expired.'); setUrl(''); }} />;
}
interface UploadItem { id: string; file: File; phase: string; error?: string }
export function PhotoStorageBlocked({ status, onRetry }: { status: ReturnType<typeof useHealthPhotos>['status']; onRetry: () => void }) {
  const local = status.state === 'local-only' || status.state === 'signed-out';
  return <section className="panel health-panel health-blocked"><span className="health-badge blocked">PHOTO UPLOADS BLOCKED</span><h2>{local ? 'Private cloud account required' : 'Private storage needs configuration'}</h2><p>{local ? 'Photos are never saved to device-local app storage or public repository assets. Sign in to a configured Growth OS cloud account to use private photo storage.' : status.state === 'unavailable' ? status.message : 'Checking private storage…'}</p><p className="small muted">The owner must apply the Phase 30 Supabase migration, keep the health-photos bucket private, and verify authenticated upload/download and cross-user denial. No local or public fallback is used.</p><button className="btn btn-sm" onClick={onRetry}>Check storage again</button></section>;
}
export function HealthPhotos() {
  const { store, status, photos, refresh, setPhotos } = useHealthPhotos();
  const today = todayStr();
  const [date, setDate] = useState(today); const [category, setCategory] = useState<PhotoCategory>('front');
  const [month, setMonth] = useState(''); const [filterCategory, setFilterCategory] = useState('all');
  const [uploads, setUploads] = useState<UploadItem[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<HealthPhoto | null>(null);
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null);
  const [leftDate, setLeftDate] = useState(''); const [rightDate, setRightDate] = useState(''); const [compareCategory, setCompareCategory] = useState<PhotoCategory>('front');
  const fileRef = useRef<HTMLInputElement>(null); const cameraRef = useRef<HTMLInputElement>(null);
  const ready = status.state === 'ready' && !!store;
  const dates = [...new Set(photos.map((p) => p.entryDate))].sort().reverse();
  const filtered = useMemo(() => photos.filter((p) => (!month || p.entryDate.startsWith(month)) && (filterCategory === 'all' || p.category === filterCategory)).sort((a,b) => b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt)), [photos, month, filterCategory]);
  const groups = useMemo(() => { const map = new Map<string, HealthPhoto[]>(); for (const p of filtered) map.set(p.entryDate, [...(map.get(p.entryDate) ?? []), p]); return [...map.entries()]; }, [filtered]);
  const uploadOne = async (item: UploadItem) => {
    if (!store || !ready) return;
    setUploads((list) => list.map((u) => u.id === item.id ? { ...u, phase: 'validating', error: undefined } : u));
    try {
      const photo = await store.upload(item.file, { entryDate: date, category }, (p) => setUploads((list) => list.map((u) => u.id === item.id ? { ...u, phase: p.phase } : u)));
      setPhotos((list) => [photo, ...list.filter((p) => p.id !== photo.id)]);
      setUploads((list) => list.map((u) => u.id === item.id ? { ...u, phase: 'done' } : u));
    } catch (e) { setUploads((list) => list.map((u) => u.id === item.id ? { ...u, phase: 'failed', error: e instanceof Error ? e.message : 'Upload failed. Please retry.' } : u)); }
  };
  const choose = async (files: FileList | null) => {
    if (!files || !ready) return;
    const items = Array.from(files).map((file, i) => ({ id: `${Date.now()}-${i}-${file.name}`, file, phase: 'queued' }));
    setUploads((list) => [...list, ...items]); setBusy(true);
    for (const item of items) await uploadOne(item);
    setBusy(false); await refresh();
    if (fileRef.current) fileRef.current.value = ''; if (cameraRef.current) cameraRef.current.value = '';
  };
  const removeAll = async () => {
    if (!store) return; setBusy(true);
    try { const report = await store.removeAll(); setMessage(report.message ?? 'All private photos and interrupted-upload files were deleted.'); setSelected(new Set()); setDetail(null); await refresh(); }
    catch { setMessage('Photo deletion could not be verified. Remote photos may remain; retry when private storage is available.'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const remove = async (targets: HealthPhoto[]) => {
    if (!store) return; setBusy(true);
    try { const report = await store.remove(targets); setMessage(report.message ?? `${report.deleted.length} photo(s) permanently deleted.`); setSelected(new Set()); setDetail(null); await refresh(); }
    catch { setMessage('Deletion could not be completed. Your photos have not been marked fully deleted; please retry.'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const download = async (targets: HealthPhoto[]) => {
    if (!store) return; setBusy(true); let count = 0;
    for (const p of targets) { try { const blob = await store.download(p); downloadBlob(blob, `health-${p.entryDate}-${p.category}-${p.id.slice(0,8)}.${p.mimeType === 'image/jpeg' ? 'jpg' : p.mimeType === 'image/png' ? 'png' : 'webp'}`); count++; } catch { /* report below */ } }
    setMessage(`${count} of ${targets.length} photo(s) downloaded.${count < targets.length ? ' Some secure links failed; retry the remaining photos.' : ''}`); setBusy(false);
  };
  const compareOptions = (d: string) => photos.filter((p) => p.entryDate === d && p.category === compareCategory);
  const left = compareOptions(leftDate)[0], right = compareOptions(rightDate)[0];
  return <div className="health-stack">
    <section className="panel health-panel"><div className="health-section-head"><div><span className="health-eyebrow">YOUR PRIVATE TIMELINE</span><h2>Progress photos</h2><p className="small muted">Original photos, stored privately. No retouching, body scoring or public links.</p></div><span className={`health-badge ${ready ? 'private' : 'blocked'}`}>{ready ? 'PRIVATE STORAGE' : status.state === 'checking' ? 'CHECKING…' : 'UPLOADS BLOCKED'}</span></div>
      {!ready ? <PhotoStorageBlocked status={status} onRetry={() => void refresh()} /> : <>
        <div className="health-form-grid"><HealthField id="photo-date" label="Photo date"><input id="photo-date" type="date" value={date} max={today} min="1900-01-01" onChange={(e) => setDate(e.target.value)} /></HealthField><HealthField id="photo-category" label="Category"><select id="photo-category" value={category} onChange={(e) => setCategory(e.target.value as PhotoCategory)}>{PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}</select></HealthField></div>
        <div className="health-upload-zone"><IconUpload size={26} /><p>Choose photos for {dateLabel(date)}</p><p className="small muted">JPEG, PNG or WebP · up to {HEALTH_PHOTO_MAX_BYTES / 1024 / 1024} MB each · multiple files welcome</p><div className="health-actions"><button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>Choose photos</button><button className="btn" disabled={busy} onClick={() => cameraRef.current?.click()}><IconCamera size={16} />Take photo</button></div><input ref={fileRef} className="sr-only" type="file" accept={HEALTH_PHOTO_TYPES.join(',')} multiple aria-label="Choose progress photos" onChange={(e) => void choose(e.target.files)} /><input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Take a progress photo" onChange={(e) => void choose(e.target.files)} /></div>
        <div aria-live="polite" className="health-upload-list">{uploads.map((u) => <div key={u.id} className={`health-upload-item ${u.error ? 'failed' : ''}`}><span>{u.file.name}</span><span role="status">{u.phase === 'done' ? 'Uploaded privately' : u.phase === 'uploading' ? 'Uploading original file…' : u.phase === 'saving' ? 'Saving private metadata…' : u.phase === 'validating' ? 'Checking file…' : u.phase === 'failed' ? 'Upload failed' : 'Queued'}</span>{u.phase !== 'done' && u.phase !== 'failed' && <progress aria-label={`Upload progress for ${u.file.name}`} />}{u.error && <><p className="health-error">{u.error}</p><button className="btn btn-sm" disabled={busy} onClick={async () => { setBusy(true); await uploadOne(u); setBusy(false); await refresh(); }}>Retry</button></>}</div>)}</div>
      </>}
    </section>
    <section className="panel health-panel"><div className="health-section-head"><h2>Photo timeline</h2>{ready && <span className="small muted">{photos.length} private photo{photos.length === 1 ? '' : 's'}</span>}</div><div className="health-form-grid"><HealthField id="photo-month" label="Month"><input id="photo-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></HealthField><HealthField id="photo-filter" label="Category"><select id="photo-filter" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}><option value="all">All categories</option>{PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></HealthField></div>
      {ready && selected.size > 0 && <div className="health-actions mb-16"><span className="small">{selected.size} selected</span><button className="btn btn-sm" disabled={busy} onClick={() => void download(photos.filter((p) => selected.has(p.id)))}>Download selected</button><button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirm('selected')}>Delete selected</button></div>}
      {!ready ? <HealthEmpty title="Photo gallery unavailable" text="The gallery stays empty until private storage is configured. No sample or public photos are shown." /> : groups.length === 0 ? <HealthEmpty title="No photos for this view" text="Upload a photo when you want a visual checkpoint. Each date can hold multiple angles." /> : groups.map(([d, list]) => <div className="health-photo-group" key={d}><h3>{dateLabel(d)} <span className="tiny muted">{d}</span></h3><div className="health-photo-grid">{list.map((p) => <article className="health-photo-card" key={p.id}><label className="health-photo-select"><input type="checkbox" checked={selected.has(p.id)} onChange={(e) => setSelected((s) => { const next = new Set(s); if (e.target.checked) next.add(p.id); else next.delete(p.id); return next; })} aria-label={`Select ${p.category} photo from ${d}`} /></label><button className="health-photo-open" onClick={() => setDetail(p)} aria-label={`View ${p.category} photo from ${d}`}><PrivateImage photo={p} store={store!} /></button><div className="health-photo-caption"><span>{p.category}</span><span>{(p.fileSize / 1024 / 1024).toFixed(1)} MB</span></div>{p.deletionPending && <p className="health-error">Deletion pending — retry in Privacy & Data.</p>}</article>)}</div></div>)}
      {ready && photos.length > 0 && <button className="btn btn-danger btn-sm mt-16" disabled={busy} onClick={() => setConfirm('all')}>Delete all health photos</button>}
      <p className="health-success" role="status">{message}</p>
    </section>
    <section className="panel health-panel"><h2>Compare two dates</h2><p className="small muted mb-16">Same angle, two moments. Originals are shown side by side without cropping or alteration.</p><div className="health-form-grid"><HealthField id="compare-left" label="First date"><select id="compare-left" value={leftDate} onChange={(e) => setLeftDate(e.target.value)}><option value="">Choose a date</option>{dates.map((d) => <option key={d} value={d}>{d}</option>)}</select></HealthField><HealthField id="compare-right" label="Second date"><select id="compare-right" value={rightDate} onChange={(e) => setRightDate(e.target.value)}><option value="">Choose a date</option>{dates.map((d) => <option key={d} value={d}>{d}</option>)}</select></HealthField><HealthField id="compare-category" label="Angle"><select id="compare-category" value={compareCategory} onChange={(e) => setCompareCategory(e.target.value as PhotoCategory)}>{PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></HealthField></div>{left && right && store ? <div className="health-compare">{[left,right].map((p, i) => <figure key={`${i}-${p.id}`}><PrivateImage photo={p} store={store} large /><figcaption>{dateLabel(p.entryDate)} · {p.category}</figcaption></figure>)}</div> : <p className="small muted">Choose two dates with photos to compare.</p>}</section>
    {detail && store && <Modal title={`${dateLabel(detail.entryDate)} · ${detail.category}`} onClose={() => setDetail(null)} wide><PrivateImage photo={detail} store={store} large /><p className="small muted mt-16">{detail.mimeType} · {(detail.fileSize / 1024 / 1024).toFixed(2)} MB · private original</p><div className="health-actions"><button className="btn" disabled={busy} onClick={() => void download([detail])}>Download original</button><button className="btn btn-danger" disabled={busy} onClick={() => { setSelected(new Set([detail.id])); setDetail(null); setConfirm('selected'); }}>Delete photo</button></div></Modal>}
    {confirm && <ConfirmHealthDialog title={confirm === 'all' ? 'Delete all health photos?' : 'Delete selected photos?'} description="Original private files and their metadata will be permanently removed. This cannot be undone. Failed deletions will be reported so you can retry." phrase={confirm === 'all' ? 'DELETE PHOTOS' : undefined} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => void (confirm === 'all' ? removeAll() : remove(photos.filter((p) => selected.has(p.id))))} />}
  </div>;
}
