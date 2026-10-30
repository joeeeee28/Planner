import { useMemo, useState } from 'react';
import { todayStr } from '../../lib/dates';
import { deleteMeasurement, measurementDifferences, measurementLabel, upsertMeasurement, validateMeasurement } from '../../lib/health/domain';
import { CM_PER_IN, MEASUREMENT_TYPES, type HealthMeasurement } from '../../lib/health/types';
import { ConfirmHealthDialog, dateLabel, fmt, HealthEmpty, HealthField, signed, useHealth } from './common';
import { HealthTrendChart } from './HealthCharts';

export function latestMeasurements(measurements: HealthMeasurement[]): HealthMeasurement[] {
  const map = new Map<string, HealthMeasurement>();
  for (const m of [...measurements].sort((a,b) => a.recordedAt.localeCompare(b.recordedAt))) map.set(measurementLabel(m).toLowerCase(), m);
  return [...map.values()];
}
export function HealthMeasurements() {
  const { health, ownerId, save, measurementUnit: unit } = useHealth();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [type, setType] = useState('waist');
  const [customName, setCustomName] = useState('');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<HealthMeasurement | null>(null);
  const dates = [...new Set(health.measurements.map((m) => m.recordedAt))].sort().reverse();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [chartType, setChartType] = useState('waist');
  const types = [...new Set(health.measurements.map((m) => measurementLabel(m)))];
  const chartPoints = useMemo(() => health.measurements.filter((m) => measurementLabel(m).toLowerCase() === chartType.toLowerCase()).map((m) => ({ date: m.recordedAt, value: m.value })), [health.measurements, chartType]);
  const differences = from && to ? measurementDifferences(health, from, to) : [];
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setMessage('');
    const cm = Number(value) * (unit === 'in' ? CM_PER_IN : 1);
    const input = { id: editing, recordedAt: date, measurementType: type, customName, value: cm };
    const invalid = validateMeasurement(input, today); if (invalid || !value.trim()) { setError(invalid ?? 'Enter a measurement.'); return; }
    try { save((d) => upsertMeasurement(d, ownerId, input, undefined, today)); setMessage(editing ? 'Measurement updated.' : 'Measurement saved.'); setValue(''); setEditing(undefined); }
    catch (e) { setError(e instanceof Error ? e.message : 'Measurement could not be saved.'); }
  };
  const edit = (m: HealthMeasurement) => { setEditing(m.id); setDate(m.recordedAt); setType(m.measurementType); setCustomName(m.customName ?? ''); setValue(String(Number((unit === 'in' ? m.value / CM_PER_IN : m.value).toFixed(2)))); setError(''); };
  return <div className="health-stack">
    <section className="panel health-panel"><div className="health-section-head"><div><span className="health-eyebrow">CHANGES, AT YOUR PACE</span><h2>Body measurements</h2><p className="small muted">Actual measurements only. No body-composition estimates or health assessments.</p></div></div>
      <form onSubmit={submit} noValidate><div className="health-form-grid">
        <HealthField id="measure-date" label="Date"><input id="measure-date" type="date" value={date} max={today} min="1900-01-01" onChange={(e) => setDate(e.target.value)} required /></HealthField>
        <HealthField id="measure-type" label="Measurement"><select id="measure-type" value={type} onChange={(e) => setType(e.target.value)}>{MEASUREMENT_TYPES.map((t) => <option key={t} value={t}>{t === 'custom' ? 'Custom measurement' : t.charAt(0).toUpperCase() + t.slice(1)}</option>)}</select></HealthField>
        {type === 'custom' && <HealthField id="measure-custom" label="Custom name"><input id="measure-custom" value={customName} maxLength={60} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Left calf" /></HealthField>}
        <HealthField id="measure-value" label={`Value (${unit})`} hint={`Stored internally in centimetres; displayed in ${unit}.`}><input id="measure-value" type="number" inputMode="decimal" step="0.1" min="0.1" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Not recorded" /></HealthField>
      </div>{error && <p className="health-error" role="alert">{error}</p>}<div className="health-actions"><button className="btn btn-primary" type="submit">{editing ? 'Update measurement' : 'Save measurement'}</button>{editing && <button type="button" className="btn" onClick={() => { setEditing(undefined); setValue(''); }}>Cancel edit</button>}<span role="status" className="health-success">{message}</span></div></form>
    </section>
    <section className="panel health-panel"><h2>Measurement trend</h2>{types.length === 0 ? <HealthEmpty title="No measurements yet" text="Add waist, hips, chest, arms, thighs, neck or your own measurement whenever it is useful." /> : <><HealthField id="measure-chart-type" label="Choose measurement"><select id="measure-chart-type" value={chartType} onChange={(e) => setChartType(e.target.value)}>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></HealthField><HealthTrendChart points={chartPoints} unit={unit} label={chartType} convert={(v) => unit === 'in' ? v / CM_PER_IN : v} /></>}</section>
    <section className="panel health-panel"><h2>Compare two dates</h2><div className="health-form-grid"><HealthField id="measure-from" label="Earlier date"><select id="measure-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose a date</option>{dates.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</select></HealthField><HealthField id="measure-to" label="Later date"><select id="measure-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a date</option>{dates.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</select></HealthField></div>{from && to && <div className="health-table-scroll"><table className="health-table"><thead><tr><th>Measurement</th><th>{dateLabel(from)}</th><th>{dateLabel(to)}</th><th>Change ({unit})</th></tr></thead><tbody>{differences.map((d) => <tr key={d.label}><td>{d.label}</td><td>{fmt(d.before === null ? null : unit === 'in' ? d.before / CM_PER_IN : d.before, 2)}</td><td>{fmt(d.after === null ? null : unit === 'in' ? d.after / CM_PER_IN : d.after, 2)}</td><td>{signed(d.difference === null ? null : unit === 'in' ? d.difference / CM_PER_IN : d.difference, 2)}</td></tr>)}</tbody></table></div>}</section>
    <section className="panel health-panel"><h2>Measurement history</h2>{health.measurements.length === 0 ? <p className="small muted">Your recorded measurements will appear here.</p> : <div className="health-table-scroll"><table className="health-table"><thead><tr><th>Date</th><th>Measurement</th><th>Value ({unit})</th><th>Actions</th></tr></thead><tbody>{[...health.measurements].reverse().map((m) => <tr key={m.id}><td>{dateLabel(m.recordedAt)}</td><td>{measurementLabel(m)}</td><td>{fmt(unit === 'in' ? m.value / CM_PER_IN : m.value, 2)}</td><td><div className="health-row-actions"><button className="btn btn-sm" onClick={() => edit(m)}>Edit</button><button className="btn btn-sm btn-ghost" onClick={() => setDeleting(m)}>Delete</button></div></td></tr>)}</tbody></table></div>}</section>
    {deleting && <ConfirmHealthDialog title="Delete measurement?" description={`${measurementLabel(deleting)} on ${dateLabel(deleting.recordedAt)} will be permanently removed.`} busy={false} onClose={() => setDeleting(null)} onConfirm={() => { save((d) => deleteMeasurement(d, deleting.id)); setDeleting(null); setMessage('Measurement deleted.'); }} />}
  </div>;
}
