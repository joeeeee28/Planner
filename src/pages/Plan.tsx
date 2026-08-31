import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import {
  addDays,
  daysInMonth,
  formatDateMed,
  isToday,
  monthLabel,
  monthMatrix,
  monthKeyOf,
  todayStr,
  weekStartOf,
  parseDateStr,
  addMonths,
} from '../lib/dates';
import {
  dayStatus,
  dayHabitInfo,
  goalDeadlineMap,
  milestoneDates,
  monthKeyCompletion,
  cycleSummary,
} from '../lib/analytics';
import { formatMoney, monthTotals, totalSaved } from '../lib/finance';
import { IconChevronLeft, IconChevronRight } from '../components/icons';
import { MonthReviewPage, WeekReviewPage } from './Reviews';
import { currentCycle } from '../lib/dates';
type View = 'calendar' | 'year' | 'month' | 'week';

const isMonthKey = (s: string) => /^\d{4}-\d{2}$/.test(s);

export function PlanPage() {
  const { data } = useApp();
  const route = useRoute();
  const today = todayStr();
  const [view, setView] = useState<View>(() => {
    const v = route[1] as View;
    return ['calendar', 'year', 'month', 'week'].includes(v) ? v : 'calendar';
  });
  const [cursor, setCursor] = useState(() => route[2] ?? monthKeyOf(todayStr()));

  const weekStartsOn = data.settings.weekStartsOn;
  const [curYear, curMonth] = (isMonthKey(cursor) ? cursor : `${cursor.slice(0, 4)}-01`).split('-').map(Number);
  const curDate = isMonthKey(cursor) ? `${cursor}-01` : cursor;

  const change = (dir: number) => {
    if (view === 'calendar') setCursor(monthKeyOf(addMonths(`${cursor}-01`, dir)));
    else if (view === 'year') setCursor(`${curYear + dir}-01`);
    else if (view === 'week') setCursor(addDays(weekStartOf(curDate, weekStartsOn), dir * 7));
    else setCursor(addDays(curDate, dir));
  };

  const switchView = (v: View) => {
    setView(v);
    const dayCursor = isMonthKey(cursor) ? `${cursor}-01` : cursor;
    if (v === 'calendar') {
      const m = isMonthKey(cursor) ? cursor : monthKeyOf(dayCursor);
      setCursor(m);
      navigate(`plan/calendar/${m}`);
    } else if (v === 'year') {
      setCursor(`${dayCursor.slice(0, 4)}-01`);
      navigate(`plan/year/${dayCursor.slice(0, 4)}`);
    } else if (v === 'week') {
      setCursor(weekStartOf(dayCursor, weekStartsOn));
      navigate(`plan/week/${weekStartOf(dayCursor, weekStartsOn)}`);
    } else {
      setCursor(monthKeyOf(dayCursor));
      navigate(`plan/month/${monthKeyOf(dayCursor)}`);
    }
  };

  const label = (() => {
    if (view === 'calendar') return monthLabel(cursor);
    if (view === 'year') return String(curYear);
    if (view === 'month') return `Monthly workspace — ${monthLabel(cursor)}`;
    if (view === 'week') return `Week of ${formatDateMed(weekStartOf(curDate, weekStartsOn))}`;
    return '';
  })();

  const deadlines = goalDeadlineMap(data.goals);
  const milestones = new Set(milestoneDates(data.goals));

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Plan</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Any day, week, month or year — past, present or future.
          </div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-icon" onClick={() => change(-1)} aria-label="Back"><IconChevronLeft size={15} /></button>
          <button
            className="btn btn-sm"
            onClick={() =>
              setCursor(
                view === 'calendar' ? monthKeyOf(today) : view === 'week' ? weekStartOf(today, weekStartsOn) : view === 'year' ? `${today.slice(0, 4)}-01` : today,
              )
            }
          >
            Today
          </button>
          <button className="btn btn-icon" onClick={() => change(1)} aria-label="Forward"><IconChevronRight size={15} /></button>
        </div>
      </div>

      <div className="tabs">
        {(['calendar', 'year', 'month', 'week'] as View[]).map((v) => (
          <button key={v} className={`tab ${view === v ? 'active' : ''}`} onClick={() => switchView(v)}>
            {v === 'calendar' ? 'Calendar' : v === 'year' ? 'Year at a glance' : v === 'month' ? 'This month' : 'This week'}
          </button>
        ))}
      </div>

      <div className="flex mb-16" style={{ justifyContent: 'center' }}>
        <span className="bold" style={{ fontSize: 15 }}>{label}</span>
      </div>

      {view === 'calendar' && (
        <MonthGrid year={curYear} month={curMonth} weekStartsOn={weekStartsOn} deadlines={deadlines} milestones={milestones} />
      )}
      {view === 'year' && <YearAtGlance year={curYear} />}
      {view === 'month' && <MonthReviewPage mk={isMonthKey(cursor) ? cursor : monthKeyOf(cursor)} />}
      {view === 'week' && <WeekReviewPage weekStart={curDate} />}
    </div>
  );
}

// ── Month grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  year,
  month,
  weekStartsOn,
  deadlines,
  milestones,
}: {
  year: number;
  month: number;
  weekStartsOn: 0 | 1;
  deadlines: Map<string, number>;
  milestones: Set<string>;
}) {
  const { data } = useApp();
  const weeks = monthMatrix(year, month, weekStartsOn);
  const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const labels = weekStartsOn === 1 ? [...dowLabels.slice(1), dowLabels[0]] : dowLabels;
  const thisMonth = `${year}-${String(month).padStart(2, '0')}`;

  return (
    <div className="panel" style={{ padding: '18px 20px' }}>
      <div className="cal-grid">
        {labels.map((l) => (
          <div className="cal-dow" key={l}>{l}</div>
        ))}
        {weeks.flat().map((d, i) => {
          if (!d) return <div key={`x${i}`} />;
          const inMonth = d.slice(0, 7) === thisMonth;
          const status = dayStatus(data.daily[d], data.growthAreas);
          const habit = dayHabitInfo(data, d);
          return (
            <button
              className={[
                'cal-cell',
                inMonth ? '' : 'other-month',
                isToday(d) ? 'today' : '',
                status === 'full' ? 'completed-day' : '',
                status === 'partial' ? 'partial-day' : '',
              ].join(' ')}
              key={d}
              onClick={() => navigate(`today/${d}`)}
            >
              <span className="cal-day-num">{parseDateStr(d).getDate()}</span>
              <span className="cal-dots">
                {status === 'full' && <span className="cal-dot full" />}
                {status === 'partial' && <span className="cal-dot partial" />}
                {(deadlines.get(d) ?? 0) > 0 && <span className="cal-dot deadline" />}
                {milestones.has(d) && <span className="cal-dot milestone" />}
                {habit.scheduled > 0 && <span className="cal-dot habit" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap mt-16" style={{ gap: 16 }}>
        <Legend color="accent" label="All tasks completed" />
        <Legend color="warn" label="Partially completed" />
        <Legend color="neg" label="Goal deadline" />
        <Legend color="ink" label="Milestone" />
        <Legend color="muted" label="Habit day" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const map: Record<string, string> = {
    accent: 'var(--accent)',
    warn: 'var(--warn)',
    neg: 'var(--neg)',
    ink: 'var(--ink-3)',
    muted: 'var(--ink-2)',
  };
  return (
    <span className="flex tiny muted" style={{ gap: 6 }}>
      <span className="cal-dot" style={{ background: map[color], opacity: color === 'muted' ? 0.6 : 1 }} />
      {label}
    </span>
  );
}

// ── Year at a glance ─────────────────────────────────────────────────────────

function YearAtGlance({ year }: { year: number }) {
  const { data } = useApp();
  const t = todayStr();
  const currency = data.settings.finance.currency;
  const cycle = currentCycle(data.cycles);
  const csum = cycle ? cycleSummary(data, cycle.id) : undefined;

  const yearMoney = (() => {
    const txs = data.transactions.filter((x) => x.date.slice(0, 4) === String(year));
    let income = 0;
    let expense = 0;
    for (const tx of txs) tx.type === 'income' ? (income += tx.amount) : (expense += tx.amount);
    return { income, expense, saved: income - expense };
  })();

  return (
    <div>
      <div className="grid grid-4 mb-24">
        <div className="panel-flat">
          <div className="stat-label">{year} · income</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(yearMoney.income, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">{year} · expenses</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(yearMoney.expense, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">{year} · saved</div>
          <div className="stat-value" style={{ fontSize: 20, color: yearMoney.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {formatMoney(yearMoney.saved, currency)}
          </div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Total saved</div>
          <div className="stat-value" style={{ fontSize: 20, color: 'var(--pos)' }}>{formatMoney(totalSaved(data), currency)}</div>
        </div>
      </div>

      <div className="grid grid-3">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const mk = `${year}-${String(m).padStart(2, '0')}`;
          const last = daysInMonth(year, m);
          const to = mk === monthKeyOf(t) ? t : `${mk}-${String(last).padStart(2, '0')}`;
          const comp = monthKeyCompletion(data, mk, to);
          // habit pct
          let hs = 0;
          let hd = 0;
          let d = `${mk}-01`;
          let guard = 0;
          while (d <= to && guard < 400) {
            const info = dayHabitInfo(data, d);
            hs += info.scheduled;
            hd += info.done;
            d = addDays(d, 1);
            guard++;
          }
          const habitPct = hs === 0 ? 0 : Math.round((hd / hs) * 100);
          const mm = monthTotals(data.transactions, mk);
          const goalsDone = data.goals.filter((g) => g.status === 'completed' && g.completedDate?.slice(0, 7) === mk).length;
          const quintile = Math.round(comp.pct / 20);
          const past = mk < monthKeyOf(t);
          return (
            <button
              key={mk}
              className="year-month"
              onClick={() => navigate(`plan/calendar/${mk}`)}
              style={{ textAlign: 'left', cursor: 'pointer' }}
            >
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="bold" style={{ fontSize: 13 }}>{parseDateStr(`${mk}-01`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
                <span className="tiny muted t-num">{comp.pct}%</span>
              </div>
              <div className="year-dots">
                {[1, 2, 3, 4, 5].map((q) => (
                  <span key={q} className={`d ${past ? (q <= quintile ? 'on' : '') : q <= 0 ? '' : ''} ${!past && q <= 0 ? '' : ''}`} style={past ? undefined : { background: 'var(--surface-3)' }} />
                ))}
              </div>
              <div className="tiny muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Habits {habitPct}%</span>
                {mm.saved !== 0 && <span className={mm.saved >= 0 ? '' : ''}>{formatMoney(mm.saved, currency, true)}</span>}
              </div>
              {goalsDone > 0 && <div className="tiny muted">✓ {goalsDone} goal{goalsDone > 1 ? 's' : ''}</div>}
            </button>
          );
        })}
      </div>

      {csum && (
        <div className="panel mt-24">
          <h2 className="panel-title">Current cycle</h2>
          <p className="panel-sub">{cycle?.name} · Day {csum.daysElapsed} of {csum.daysTotal}</p>
          <div className="grid grid-4 mt-16">
            <div>
              <div className="stat-label">Active days</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{csum.activeDays}</div>
            </div>
            <div>
              <div className="stat-label">Goals completed</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{csum.goalsCompleted}</div>
            </div>
            <div>
              <div className="stat-label">Habit consistency</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{csum.habitConsistency}%</div>
            </div>
            <div>
              <div className="stat-label">Learning completed</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{csum.learningCompleted}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
