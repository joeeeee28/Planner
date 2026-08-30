import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { addYears, cycleProgressPct, cycleTotalDays, formatDateMed, todayStr } from '../lib/dates';
import { defaultCycleEnd, cycleNameFromStart } from '../lib/defaults';
import { cycleSummary, dayStreak } from '../lib/analytics';
import { Modal, ProgressBar, Pct } from '../components/ui';
import { IconPlus } from '../components/icons';
import { uid } from '../lib/uid';
import type { GrowthCycle } from '../lib/types';

export function CyclesPage() {
  const { data, update } = useApp();
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => {
    // default: the next September after the latest cycle, or Sep 1 of this year if none
    const last = data.cycles[data.cycles.length - 1];
    if (last) {
      const d = new Date(last.startDate);
      return `${d.getFullYear() + 1}-09-01`;
    }
    const t = todayStr();
    const y = Number(t.slice(0, 4));
    return `${y}-09-01`;
  });

  const t = todayStr();
  const streak = dayStreak(data);

  const createCycle = () => {
    const start = startDate || '2026-09-01';
    const end = defaultCycleEnd(start);
    const autoName = name.trim() || cycleNameFromStart(start);
    update((d) => {
      d.cycles.push({
        id: uid('cycle'),
        name: autoName,
        startDate: start,
        endDate: end,
        createdAt: t,
      } as GrowthCycle);
      d.cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));
      return { ...d };
    });
    setModal(false);
    setName('');
  };

  const createNext = () => {
    const last = data.cycles[data.cycles.length - 1];
    const start = last ? addYears(last.startDate, 1) : '2027-09-01';
    const end = defaultCycleEnd(start);
    update((d) => {
      d.cycles.push({
        id: uid('cycle'),
        name: cycleNameFromStart(start),
        startDate: start,
        endDate: end,
        createdAt: t,
      } as GrowthCycle);
      d.cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));
      return { ...d };
    });
  };

  const removeCycle = (id: string) => {
    if (!confirm('Remove this cycle? All its days, goals and reviews stay in the system — only the cycle definition is removed.')) return;
    update((d) => {
      d.cycles = d.cycles.filter((c) => c.id !== id);
      return { ...d };
    });
  };

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Growth Cycles</h1>
          <div className="topbar-sub">
            Each cycle is a full year of growth. Past cycles stay as historical data — start a new one anytime.
          </div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn" onClick={createNext} disabled={data.cycles.length === 0}>
            + Start next cycle
          </button>
          <button className="btn btn-primary" onClick={() => setModal(true)}>
            <IconPlus size={15} /> New cycle
          </button>
        </div>
      </div>

      {data.cycles.length === 0 && (
        <div className="card mb-16">
          <div className="empty-state">
            <div className="empty-icon">🔄</div>
            <h3>No growth cycle yet</h3>
            <p>
              Your first cycle is planned for <b>September 1, 2026 → August 31, 2027</b>, but you can start any day you like — and
              add more cycles later without losing anything.
            </p>
            <button className="btn btn-primary" onClick={() => { setStartDate('2026-09-01'); setModal(true); }}>
              Start cycle September 1, 2026
            </button>
          </div>
        </div>
      )}

      <div className="grid" style={{ gap: 12 }}>
        {[...data.cycles]
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
          .map((c) => {
            const isCurrent = t >= c.startDate && t <= c.endDate;
            const ended = t > c.endDate;
            const upcoming = t < c.startDate;
            const pct = cycleProgressPct(c, t);
            const daysTotal = cycleTotalDays(c);
            const s = cycleSummary(data, c.id);
            const review = data.cycleReviews[c.id];
            return (
              <div className="card" key={c.id}>
                <div className="flex flex-wrap" style={{ gap: 12 }}>
                  <div className="grow" style={{ minWidth: 240 }}>
                    <div className="flex flex-wrap" style={{ gap: 8 }}>
                      <span className="bold" style={{ fontSize: 16 }}>{c.name}</span>
                      {isCurrent && <span className="badge badge-accent">Current</span>}
                      {ended && <span className="badge">Completed</span>}
                      {upcoming && <span className="badge badge-warning">Upcoming</span>}
                      {review && <span className="badge badge-success">✓ Reviewed</span>}
                    </div>
                    <div className="tiny muted">
                      {formatDateMed(c.startDate)} → {formatDateMed(c.endDate)} · {daysTotal} days
                    </div>
                    <div className="flex mt-8" style={{ gap: 10 }}>
                      <ProgressBar pct={isCurrent || ended ? pct : 0} color={ended ? 'green' : 'teal'} />
                      <Pct value={isCurrent || ended ? pct : 0} />
                    </div>
                  </div>
                  <div className="flex flex-wrap" style={{ gap: 14, alignItems: 'center' }}>
                    {s && (
                      <>
                        <div className="tiny">
                          <div className="muted bold">Active days</div>
                          <div className="bold">{s.activeDays}</div>
                        </div>
                        <div className="tiny">
                          <div className="muted bold">Goals done</div>
                          <div className="bold">{s.goalsCompleted}</div>
                        </div>
                        <div className="tiny">
                          <div className="muted bold">Habits</div>
                          <div className="bold">{s.habitConsistency}%</div>
                        </div>
                        <div className="tiny">
                          <div className="muted bold">Learned</div>
                          <div className="bold">{s.learningCompleted}</div>
                        </div>
                      </>
                    )}
                    <div className="flex" style={{ gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => navigate(`reviews/cycle/${c.id}`)}>
                        {review ? 'Review' : 'End-of-cycle review'}
                      </button>
                      <button className="btn btn-sm" onClick={() => navigate(`calendar/month/${c.startDate.slice(0, 7)}`)}>
                        Calendar
                      </button>
                      <button className="btn btn-icon btn-sm btn-danger" onClick={() => removeCycle(c.id)} aria-label="Remove cycle">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div className="card mt-16">
        <h2 className="card-title">💡 How cycles work</h2>
        <p className="small muted" style={{ margin: 0 }}>
          A growth cycle is just a labeled year of dates. Days, journal entries, goals, habits, learning and achievements are all
          stored independently of cycles — so when a cycle ends, nothing is deleted. A new cycle simply gives you a fresh frame:
          “Day 1 of 365”, a new end-of-cycle review, and continued momentum with all history intact. You can customize the cycle
          start (e.g. January 1 or your birthday) whenever you like. Current day streak: <b>🔥 {streak}</b>.
        </p>
      </div>

      {modal && (
        <Modal title="New growth cycle" onClose={() => setModal(false)}>
          <div className="form-row">
            <label className="form-label">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sep 2027 → Aug 2028" />
            <div className="form-hint">Leave empty to auto-name from the start date.</div>
          </div>
          <div className="form-row">
            <label className="form-label">Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <div className="form-hint">
              A cycle lasts one year: {startDate ? cycleNameFromStart(startDate) : ''}
            </div>
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={createCycle}>
              Create cycle
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
