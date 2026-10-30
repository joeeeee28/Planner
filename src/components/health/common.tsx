import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { healthForOwner } from '../../lib/health/domain';
import { LOCAL_OWNER, KG_PER_LB, CM_PER_IN, GLASS_LITRES, type HealthData, type HealthPhoto, type HealthPhotoStatus } from '../../lib/health/types';
import { healthPhotoStore } from '../../lib/health/photoStorage';
import { Modal } from '../ui';
import { IconLock } from '../icons';
import { formatDateMed } from '../../lib/dates';

export function useHealth() {
  const app = useApp();
  const auth = useAuth();
  const ownerId = auth.status === 'authed' && auth.user ? auth.user.id : LOCAL_OWNER;
  const health = useMemo(() => healthForOwner(app.data.health, ownerId), [app.data.health, ownerId]);
  const save = useCallback((fn: (data: HealthData) => HealthData) => {
    app.update((d) => ({ ...d, health: fn(healthForOwner(d.health, ownerId)), updatedAt: new Date().toISOString() }));
  }, [app.update, ownerId]);
  const saveAndSync = useCallback(async (fn: (data: HealthData) => HealthData) => {
    save(fn);
    return app.flushSync();
  }, [save, app.flushSync]);
  const profile = health.profile;
  return { ...app, auth, ownerId, health, save, saveAndSync,
    weightUnit: profile?.preferredWeightUnit ?? 'kg', measurementUnit: profile?.preferredMeasurementUnit ?? 'cm', waterUnit: profile?.preferredWaterUnit ?? 'litres' };
}
export const displayWeight = (kg: number, unit: 'kg' | 'lb') => unit === 'lb' ? kg / KG_PER_LB : kg;
export const displayMeasurement = (cm: number, unit: 'cm' | 'in') => unit === 'in' ? cm / CM_PER_IN : cm;
export const displayWater = (litres: number, unit: 'litres' | 'glasses') => unit === 'glasses' ? litres / GLASS_LITRES : litres;
export const fmt = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
export const signed = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${fmt(value, digits)}`;
export const dateLabel = (date: string) => formatDateMed(date);
export const sleepLabel = (minutes?: number) => minutes === undefined ? '—' : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export function HealthField({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className="form-row health-field"><label className="form-label" htmlFor={id}>{label}</label>{children}{hint && <p className="form-hint" id={`${id}-hint`}>{hint}</p>}{error && <p className="health-error" id={`${id}-error`} role="alert">{error}</p>}</div>;
}
export function HealthStat({ label, value, hint, unit }: { label: string; value: ReactNode; hint?: string; unit?: string }) {
  return <div className="health-stat"><span className="stat-label">{label}</span><div className="health-stat-value">{value}{unit && <small>{unit}</small>}</div><p className="health-stat-hint">{hint ?? 'Not recorded'}</p></div>;
}
export function StorageNotice({ mode, pending }: { mode: 'local' | 'cloud'; pending?: boolean }) {
  return <span className="health-storage"><IconLock size={13} />{mode === 'cloud' ? pending ? 'Saved on device · sync pending' : 'Private account · cloud sync' : 'Device-local · not cloud backed up'}</span>;
}
export function HealthEmpty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="health-empty"><span className="health-empty-mark" aria-hidden="true">◌</span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function ConfirmHealthDialog({ title, description, phrase, busy, onClose, onConfirm }: { title: string; description: string; phrase?: string; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState('');
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}><p className="small muted mb-16">{description}</p>{phrase && <HealthField id="health-confirm-phrase" label={`Type ${phrase} to confirm`}><input id="health-confirm-phrase" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></HealthField>}<div className="health-actions"><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-danger" disabled={busy || (!!phrase && typed !== phrase)} onClick={onConfirm}>{busy ? 'Working…' : 'Delete permanently'}</button></div></Modal>;
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useHealthPhotos() {
  const auth = useAuth();
  const store = useMemo(() => { try { return auth.status === 'authed' ? healthPhotoStore() : null; } catch { return null; } }, [auth.status]);
  const [status, setStatus] = useState<HealthPhotoStatus>({ state: 'checking' });
  const [photos, setPhotos] = useState<HealthPhoto[]>([]);
  const userId = auth.user?.id;
  const refresh = useCallback(async () => {
    if (auth.status === 'local') { setPhotos([]); setStatus({ state: 'local-only' }); return; }
    if (auth.status !== 'authed' || !store) { setPhotos([]); setStatus({ state: 'signed-out' }); return; }
    setStatus({ state: 'checking' });
    try { const rows = await store.list(); setPhotos(rows); setStatus({ state: 'ready', photoCount: rows.length }); }
    catch (e) { setPhotos([]); setStatus({ state: 'unavailable', message: e instanceof Error ? e.message : 'Private photo storage is unavailable.' }); }
  }, [auth.status, store, userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { store, status, photos, refresh, setPhotos };
}
