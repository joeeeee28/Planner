import { useState } from 'react';
import { navigate, useRoute } from '../lib/router';
import { addDays, todayStr } from '../lib/dates';
import { habitConsistency, healthSummary, weightStats } from '../lib/health/domain';
import { CM_PER_IN, GLASS_LITRES, KG_PER_LB } from '../lib/health/types';
import { IconArrowRight, IconLock } from '../components/icons';
import { dateLabel, fmt, fmt as numberLabel, HealthEmpty, HealthStat, signed, sleepLabel, StorageNotice, useHealth, useHealthPhotos } from '../components/health/common';
import { WeightPanel } from '../components/health/HealthCharts';
import { HealthCheckIn } from '../components/health/HealthCheckIn';
import { HealthMeasurements, latestMeasurements } from '../components/health/HealthMeasurements';
import { HealthHabits } from '../components/health/HealthHabits';
import { HealthPhotos } from '../components/health/HealthPhotos';
import { HealthHistory } from '../components/health/HealthHistory';
import { HealthPrivacy } from '../components/health/HealthPrivacy';

const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'check-in', label: 'Daily Check-in' }, { id: 'weight', label: 'Weight' },
  { id: 'photos', label: 'Progress Photos' }, { id: 'measurements', label: 'Measurements' }, { id: 'habits', label: 'Habits' },
  { id: 'history', label: 'History' }, { id: 'privacy', label: 'Privacy & Data' },
];
function HealthOverview() {
  const { health, mode, sync, weightUnit, measurementUnit, waterUnit } = useHealth();
  const photos = useHealthPhotos();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const today = todayStr();
  const entry = health.dailyEntries.find((e) => e.entryDate === today);
  const stats = weightStats(health);
  const photoCount = photos.status.state === 'ready' ? photos.photos.filter((p) => p.entryDate === today).length : null;
  const summary = healthSummary(health, addDays(today, period === 'week' ? -6 : -29), today, photos.status.state === 'ready' ? photos.photos.filter((p) => p.entryDate >= addDays(today, period === 'week' ? -6 : -29)).length : null);
  const habits = health.habits.filter((h) => h.active);
  const done = habits.filter((h) => health.habitLogs.some((l) => l.habitId === h.id && l.entryDate === today && l.completed)).length;
  const latest = latestMeasurements(health.measurements);
  const weight = (kg?: number | null) => kg === undefined || kg === null ? null : weightUnit === 'lb' ? kg / KG_PER_LB : kg;
  return <div className="health-stack">
    <section className="health-welcome panel"><div><span className="health-eyebrow">A LITTLE CARE, EVERY DAY</span><h2>Your wellbeing, in your own words.</h2><p>Notice what is here today. Leave the rest blank. This is a journal of your progress, not a scorecard.</p><div className="health-actions"><button className="btn btn-primary" onClick={() => navigate('health/check-in')}>{entry ? 'Review today’s check-in' : 'Start today’s check-in'}<IconArrowRight size={15} /></button><button className="btn" onClick={() => navigate('health/photos')}>Progress photos</button></div></div><div className="health-welcome-mark" aria-hidden="true">◍</div></section>
    <section aria-labelledby="today-overview"><div className="health-section-head"><h2 id="today-overview">Today’s overview</h2><span className={`health-badge ${entry ? 'private' : ''}`}>{entry ? 'CHECK-IN RECORDED' : 'NO ENTRY TODAY'}</span></div><div className="health-stats-grid">
      <HealthStat label="Today’s weight" value={fmt(weight(entry?.weightKg))} unit={entry?.weightKg !== undefined ? weightUnit : undefined} hint={entry?.weightKg !== undefined ? 'Recorded today' : entry ? 'Weight not recorded today' : 'No check-in today'} />
      <HealthStat label="Last recorded weight" value={fmt(weight(stats.latest?.weightKg))} unit={stats.latest ? weightUnit : undefined} hint={stats.latest ? `${dateLabel(stats.latest.entryDate)} · historical record` : 'No weight history yet'} />
      <HealthStat label="Sleep" value={entry?.sleepMinutes === undefined ? '—' : sleepLabel(entry.sleepMinutes)} hint={entry?.sleepMinutes === undefined ? 'Not recorded today' : 'Last night’s rest'} />
      <HealthStat label="Water" value={fmt(entry?.waterLitres === undefined ? null : waterUnit === 'glasses' ? entry.waterLitres / GLASS_LITRES : entry.waterLitres)} unit={entry?.waterLitres !== undefined ? waterUnit : undefined} hint={entry?.waterLitres === undefined ? 'Not recorded today' : waterUnit === 'glasses' ? '250 ml glasses' : 'Litres today'} />
      <HealthStat label="Activity" value={entry?.exerciseMinutes === undefined ? '—' : entry.exerciseMinutes} unit={entry?.exerciseMinutes !== undefined ? 'min' : undefined} hint={entry?.exerciseMinutes === undefined ? 'Not recorded today' : 'Exercise today'} />
      <HealthStat label="Daily habits" value={habits.length ? `${done}/${habits.length}` : '—'} hint={habits.length ? 'Completed today' : 'No active habits chosen'} />
    </div></section>
    <WeightPanel health={health} unit={weightUnit} />
    <div className="health-two-col"><section className="panel health-panel"><div className="health-section-head"><h2>Latest measurements</h2><button className="btn btn-ghost btn-sm" onClick={() => navigate('health/measurements')}>View all</button></div>{latest.length === 0 ? <HealthEmpty title="No measurements yet" text="Add a measurement when it feels useful. Nothing is inferred." /> : <div className="health-stat-rows">{latest.map((m) => <div className="stat-row" key={m.id}><span className="k">{m.measurementType === 'custom' ? m.customName : m.measurementType}</span><span className="v">{numberLabel(measurementUnit === 'in' ? m.value / CM_PER_IN : m.value, 1)} {measurementUnit} <small className="muted">· {dateLabel(m.recordedAt)}</small></span></div>)}</div>}</section>
      <section className="panel health-panel"><div className="health-section-head"><h2>Habit consistency</h2><button className="btn btn-ghost btn-sm" onClick={() => navigate('health/habits')}>Manage</button></div>{habits.length === 0 ? <HealthEmpty title="Choose your own rhythm" text="Add a habit that fits your life. No targets are imposed." /> : <div className="health-stat-rows">{habits.map((h) => { const c = habitConsistency(health, h, addDays(today,-29), today); return <div className="stat-row" key={h.id}><span className="k">{h.name}</span><span className="v">{c.percent === null ? '—' : `${c.percent}%`} <small className="muted">30 days</small></span></div>; })}</div>}</section></div>
    <section className="panel health-panel"><div className="health-section-head"><div><h2>{period === 'week' ? 'This week' : 'This month'}, so far</h2><p className="small muted">Calculated only from your recorded entries.</p></div><div className="health-range" role="group" aria-label="Summary period"><button className={`btn btn-sm ${period === 'week' ? 'btn-primary' : ''}`} aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>Weekly</button><button className={`btn btn-sm ${period === 'month' ? 'btn-primary' : ''}`} aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Monthly</button></div></div><div className="health-stats-grid"><HealthStat label="Check-in days" value={summary.checkInDays} hint={`${summary.weightRecords} weight records`} /><HealthStat label="Weight change" value={signed(weight(summary.weightChange))} unit={summary.weightChange === null ? undefined : weightUnit} hint="First to last recorded weight" /><HealthStat label="Habit completion" value={summary.habitPercent === null ? '—' : `${summary.habitPercent}%`} hint={`${summary.habitCompleted} of ${summary.habitPossible} eligible habit days`} /><HealthStat label="Photo entries" value={summary.photoCount === null ? 'Unavailable' : summary.photoCount} hint={summary.photoCount === null ? 'Private storage not verified' : 'Photos in this period'} /></div><p className="small muted mt-16">{summary.measurementCount} measurement entries · {summary.noteCount} additional notes. Missing data is never shown as zero.</p></section>
    <section className="panel health-panel"><div className="health-section-head"><h2>Photo progress</h2><button className="btn btn-ghost btn-sm" onClick={() => navigate('health/photos')}>Open timeline</button></div>{photos.status.state === 'ready' ? <p className="small muted">{photoCount ? `${photoCount} private photo${photoCount === 1 ? '' : 's'} added today.` : 'No photos today.'} {photos.photos.length} photos in your private timeline.</p> : <p className="small muted">Photo storage is not verified. Uploads remain blocked until private cloud storage is configured.</p>}</section>
    <div className="health-footnote"><IconLock size={14} /><StorageNotice mode={mode} pending={sync.pending} /><span>Health is personal. No diagnosis, body scoring or external image analysis.</span></div>
  </div>;
}
export function HealthPage() {
  const route = useRoute();
  const requested = route[1] ?? 'overview';
  const tab = TABS.some((t) => t.id === requested) ? requested : 'overview';
  return <div className="page health-page"><header className="health-page-head"><div><span className="health-eyebrow">GROWTH OS · HEALTH</span><h1>Feel more like yourself.</h1><p>A calm, private record of your everyday wellbeing.</p></div><span className="health-badge private"><IconLock size={12} />PRIVATE HEALTH JOURNAL</span></header><nav className="health-subnav" aria-label="Health sections">{TABS.map((t) => <button key={t.id} className={`health-subnav-item ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => navigate(t.id === 'overview' ? 'health' : `health/${t.id}`)}>{t.label}</button>)}</nav><div className="health-content">{tab === 'overview' && <HealthOverview />}{tab === 'check-in' && <HealthCheckIn />}{tab === 'weight' && <WeightTab />}{tab === 'photos' && <HealthPhotos />}{tab === 'measurements' && <HealthMeasurements />}{tab === 'habits' && <HealthHabits />}{tab === 'history' && <HealthHistory />}{tab === 'privacy' && <HealthPrivacy />}</div></div>;
}
function WeightTab() { const { health, weightUnit } = useHealth(); return <WeightPanel health={health} unit={weightUnit} />; }
