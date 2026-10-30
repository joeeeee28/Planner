import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { diffDays } from '../../lib/dates';
import { rangeStart, weightEntries, weightStats, WEIGHT_RANGES, type WeightRange } from '../../lib/health/domain';
import type { HealthData } from '../../lib/health/types';
import { dateLabel, displayWeight, fmt, HealthEmpty, HealthStat, signed } from './common';

export interface TrendPoint { date: string; value: number }
export function HealthTrendChart({ points, unit, label, convert = (v) => v }: { points: TrendPoint[]; unit: string; label: string; convert?: (v: number) => number }) {
  const { rows, segments } = useMemo(() => {
    const sorted = [...points].sort((a,b) => a.date.localeCompare(b.date));
    const rows: Record<string, string | number | null>[] = []; let segment = 0;
    sorted.forEach((p, i) => {
      if (i && diffDays(sorted[i - 1].date, p.date) > 7) segment++;
      rows.push({ date: p.date, time: Date.parse(`${p.date}T00:00:00Z`), [`s${segment}`]: convert(p.value) });
    });
    return { rows, segments: sorted.length ? segment + 1 : 0 };
  }, [points, convert]);
  if (!points.length) return <HealthEmpty title="Your trend starts with one entry" text="Record an observation when you want to. Missing days are left blank, never filled with zero." />;
  return <div className="health-chart">
    <div className="health-chart-canvas" role="img" aria-label={`${label}: ${points.length} recorded entries. Values in ${unit}. Exact values are listed below.`}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 12, right: 14, bottom: 4, left: 0 }} accessibilityLayer>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(v) => new Date(Number(v)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} tick={{ fill: 'var(--ink-2)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={32} />
          <YAxis domain={['auto', 'auto']} width={48} tick={{ fill: 'var(--ink-2)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(Number(v), 1)} />
          <Tooltip labelFormatter={(v) => dateLabel(new Date(Number(v)).toISOString().slice(0,10))} formatter={(v) => [`${fmt(Number(v), 2)} ${unit}`, label]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--ink)', fontSize: 12 }} />
          {Array.from({ length: segments }, (_, i) => <Line key={i} type="linear" dataKey={`s${i}`} name={label} stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3.5, fill: 'var(--accent)', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <p className="form-hint">Only recorded values are plotted. Gaps longer than seven days are not connected.</p>
    <details className="health-chart-table"><summary>View exact values</summary><div className="health-table-scroll"><table className="health-table"><caption className="sr-only">{label} recorded values</caption><thead><tr><th>Date</th><th>{label} ({unit})</th></tr></thead><tbody>{[...points].sort((a,b) => b.date.localeCompare(a.date)).map((p) => <tr key={p.date}><td>{dateLabel(p.date)}</td><td>{fmt(convert(p.value), 2)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
export function WeightPanel({ health, unit }: { health: HealthData; unit: 'kg' | 'lb' }) {
  const [range, setRange] = useState<WeightRange>('30d');
  const stats = weightStats(health);
  const entries = weightEntries(health, rangeStart(range));
  const points = entries.map((e) => ({ date: e.entryDate, value: e.weightKg! }));
  const convert = (v: number) => displayWeight(v, unit);
  return <section className="panel health-panel" aria-labelledby="weight-title">
    <div className="health-section-head"><div><span className="health-eyebrow">YOUR RHYTHM</span><h2 id="weight-title">Weight over time</h2><p className="small muted">A record of change, not a judgement. Normal fluctuations are expected.</p></div></div>
    <div className="health-range" role="group" aria-label="Weight chart range">{WEIGHT_RANGES.map((r) => <button key={r.value} className={`btn btn-sm ${range === r.value ? 'btn-primary' : ''}`} aria-pressed={range === r.value} onClick={() => setRange(r.value)}>{r.label}</button>)}</div>
    <div className="health-stats-grid">
      <HealthStat label="Latest weight" value={fmt(stats.latest ? convert(stats.latest.weightKg!) : null)} unit={stats.latest ? unit : undefined} hint={stats.latest ? dateLabel(stats.latest.entryDate) : 'No weight recorded'} />
      <HealthStat label="Previous entry" value={signed(stats.previousChange === null ? null : convert(stats.previousChange))} unit={stats.previousChange === null ? undefined : unit} hint="Change from the previous record" />
      <HealthStat label="7-day average" value={fmt(stats.weekly === null ? null : convert(stats.weekly))} unit={stats.weekly === null ? undefined : unit} hint="Recorded weights in the last 7 days" />
      <HealthStat label="30-day average" value={fmt(stats.monthly === null ? null : convert(stats.monthly))} unit={stats.monthly === null ? undefined : unit} hint="Recorded weights in the last 30 days" />
    </div>
    <HealthTrendChart points={points} unit={unit} label="Weight" convert={convert} />
    <p className="small muted mt-16">Earliest-to-latest change: <strong>{signed(stats.totalChange === null ? null : convert(stats.totalChange))} {stats.totalChange === null ? '' : unit}</strong> · {stats.count} weight {stats.count === 1 ? 'entry' : 'entries'}.</p>
  </section>;
}
