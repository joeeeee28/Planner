import { useState } from 'react';
import { navigate } from '../../lib/router';
import { clearHealthData, healthExport, saveHealthProfile } from '../../lib/health/domain';
import type { MeasurementUnit, WaterUnit, WeightUnit } from '../../lib/health/types';
import { ConfirmHealthDialog, downloadBlob, HealthField, HealthStat, useHealth, useHealthPhotos } from './common';
import { PhotoStorageBlocked } from './HealthPhotos';

export function HealthPrivacy() {
  const { health, ownerId, save, saveAndSync, mode, sync, weightUnit, measurementUnit, waterUnit } = useHealth();
  const photos = useHealthPhotos();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<'photos' | 'health' | null>(null);
  const ready = photos.status.state === 'ready';
  const exportRecords = () => {
    const json = JSON.stringify(healthExport(health, ownerId), null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), `growth-os-health-${new Date().toISOString().slice(0,10)}.json`);
    setMessage('Health records exported. Photo files are downloaded separately from Progress Photos.');
  };
  const deletePhotos = async () => {
    if (!photos.store) return; setBusy(true);
    try { const report = await photos.store.removeAll(); setMessage(report.message ?? `${report.deleted.length} private photo(s) deleted, including any interrupted-upload files.`); await photos.refresh(); }
    catch { setMessage('Photo deletion could not be verified. Remote photos may remain; retry when private storage is available.'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const deleteHealth = async () => {
    setBusy(true);
    let photoWarning = '';
    if (photos.store && ready) {
      try { const report = await photos.store.removeAll(); if (report.message) photoWarning = ` Photo deletion incomplete: ${report.message}`; }
      catch { photoWarning = ' Photo deletion could not be verified; remote photos may remain.'; }
    } else if (mode === 'cloud') photoWarning = ' Private photo storage was unavailable, so remote photo deletion could not be verified.';
    const synced = await saveAndSync(() => clearHealthData(ownerId));
    setMessage(`Health check-ins, measurements, habits, notes and preferences cleared.${synced ? mode === 'cloud' ? ' Cloud records synced.' : ' Device records cleared.' : ' Cloud deletion is pending sync.'}${photoWarning}`);
    await photos.refresh(); setBusy(false); setConfirm(null);
  };
  return <div className="health-stack">
    <section className="panel health-panel"><div className="health-section-head"><div><span className="health-eyebrow">PRIVATE BY DESIGN</span><h2>Privacy & data</h2><p className="small muted">Understand where your information lives, and keep control of it.</p></div></div>
      <div className="health-stats-grid"><HealthStat label="Health records" value={health.dailyEntries.length + health.measurements.length + health.habits.length + health.notes.length} hint={`${health.dailyEntries.length} check-ins · ${health.measurements.length} measurements · ${health.habits.length} habits`} /><HealthStat label="Private photos" value={ready && photos.status.state === 'ready' ? photos.status.photoCount : 'Unavailable'} hint={ready ? 'Original files in a private bucket' : 'Not counted until secure storage is verified'} /><HealthStat label="Record storage" value={mode === 'cloud' ? 'Account' : 'Device'} hint={mode === 'cloud' ? sync.pending ? 'Cloud sync pending' : 'Supabase row-level security' : 'Local development mode only'} /></div>
      <div className="health-privacy-copy"><h3>How your data is stored</h3><p>Check-ins, measurements and habits use your existing Growth OS account document{mode === 'local' ? ' on this device' : ', protected by server-enforced row-level security'}. Photos never go into that document, localStorage, IndexedDB, GitHub or public assets.</p><p>Configured photo storage uses a private Supabase bucket, per-user folders, authenticated access and signed links that expire after 60 seconds. Original files are not retouched or analyzed. Deletion removes the private object and its metadata; partial failures are reported.</p><p className="small muted">The device passcode is a local screen lock, not cloud authentication. Health data is not sent to analytics services or external AI.</p></div>
    </section>
    {!ready && <PhotoStorageBlocked status={photos.status} onRetry={() => void photos.refresh()} />}
    <section className="panel health-panel"><h2>Preferences</h2><div className="health-form-grid"><HealthField id="pref-weight" label="Weight unit"><select id="pref-weight" value={weightUnit} onChange={(e) => save((d) => saveHealthProfile(d, ownerId, { preferredWeightUnit: e.target.value as WeightUnit }))}><option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option></select></HealthField><HealthField id="pref-measure" label="Measurement unit"><select id="pref-measure" value={measurementUnit} onChange={(e) => save((d) => saveHealthProfile(d, ownerId, { preferredMeasurementUnit: e.target.value as MeasurementUnit }))}><option value="cm">Centimetres (cm)</option><option value="in">Inches (in)</option></select></HealthField><HealthField id="pref-water" label="Water unit"><select id="pref-water" value={waterUnit} onChange={(e) => save((d) => saveHealthProfile(d, ownerId, { preferredWaterUnit: e.target.value as WaterUnit }))}><option value="litres">Litres</option><option value="glasses">Glasses (250 ml)</option></select></HealthField></div><p className="form-hint">Preferences change display only. Existing canonical values are never rewritten.</p></section>
    <section className="panel health-panel"><h2>Export & manage photos</h2><div className="health-actions"><button className="btn" onClick={exportRecords}>Export health records</button><button className="btn" onClick={() => navigate('health/photos')}>Select, download or delete photos</button><button className="btn btn-danger" disabled={!ready || busy} onClick={() => setConfirm('photos')}>Delete all health photos</button></div><p className="form-hint">Record exports contain observations, not image bytes or signed URLs. Download original photos separately.</p></section>
    <section className="panel health-panel health-danger-zone"><h2>Delete all Health data</h2><p className="small muted">Permanently clears Health check-ins, measurements, habits, notes and preferences, and attempts to delete all private Health photos. Money, plans, goals, learning, journals and your account are not touched.</p><button className="btn btn-danger mt-16" disabled={busy} onClick={() => setConfirm('health')}>Delete all Health data</button></section>
    <p className="health-message" role="status" aria-live="polite">{message}</p>
    {confirm && <ConfirmHealthDialog title={confirm === 'photos' ? 'Delete all health photos?' : 'Delete all Health data?'} description={confirm === 'photos' ? 'All original private photo files and metadata will be removed. This cannot be undone.' : 'All Health records and private photos will be removed. Other Growth OS modules and your account remain intact. If photo storage is unavailable, the result will explicitly report that remote deletion could not be verified.'} phrase={confirm === 'photos' ? 'DELETE PHOTOS' : 'DELETE HEALTH'} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => void (confirm === 'photos' ? deletePhotos() : deleteHealth())} />}
  </div>;
}
