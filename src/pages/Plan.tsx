import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import {
  addDays,
  daysInMonth,
  formatDateLong,
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
import { formatMoney, monthTotals, totalSaved, nextOccurrence } from '../lib/finance';
import { isOccurrenceOn as recOccurrenceOn } from '../lib/automation/recur';
import type { Transaction } from '../lib/types';
import { IconChevronLeft, IconChevronRight } from '../components/icons';
import { MonthReviewPage } from './Reviews';
import { DayWorkspace, WeekWorkspace, AgendaDay } from './PlanWorkspace';
import { currentCycle } from '../lib/dates';
type View = 'agenda' | 'calendar' | 'year' | 'quarter' | 'month' | 'week' | 'day';

function quarterOf(date: string): string {
  return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}
function quarterKeyOfDate(date: string): string {
  return quarterOf(date);
}
function quarterMonths(qk: string): [number, number, number] {
  const q = Number(qk.split('-Q')[1]);
  return [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3] as [number, number, number];
}

const isMonthKey = (s: string) => /^\d{4}-\d{2}$/.test(s);

/** True when a recurring transaction has an occurrence exactly on `date`. */
function occursOnDate(tx: Transaction, date: string): boolean {
  if (!tx.recurrence) return false;
  const last = tx.lastGenerated ?? tx.date;
  if (date < last) return false;
  let cur = last;
  let guard = 0;
  while (cur < date && guard < 2000) {
    cur = nextOccurrence(cur, tx.recurrence);
    guard++;
  }
  return cur === date;
}

export function PlanPage() {
  const { data } = useApp();
  const route = useRoute();
  const today = todayStr();
  const [view, setView] = useState<View>(() => {
    const v = route[1] as View;
    return ['agenda', 'calendar', 'year', 'quarter', 'month', 'week', 'day'].includes(v) ? v : 'day';
  });
  const [cursor, setCursor] = useState(() => {
    const r2 = route[2];
    if (r2) return r2;
    return view === 'agenda' || view === 'day' || view === 'week' ? todayStr() : monthKeyOf(todayStr());
  });

  // Adopt view + cursor when the URL changes while this page stays mounted
  // (deep links from other pages, browser back/forward). Guards keep state and
  // route always in the same shape.
  useEffect(() => {
    if (route[0] !== 'plan') return;
    const v = route[1] as View;
    const valid = ['agenda', 'calendar', 'year', 'quarter', 'month', 'week', 'day'].includes(v);
    if (!valid) return;
    const r2 = route[2];
    const shapeOk =
      (v === 'agenda' || v === 'day' || v === 'week') ? !!r2 && /^\d{4}-\d{2}-\d{2}$/.test(r2)
      : (v === 'calendar' || v === 'month') ? !!r2 && /^\d{4}-\d{2}$/.test(r2)
      : v === 'quarter' ? !!r2 && /^\d{4}-Q[1-4]$/.test(r2)
      : v === 'year' ? !!r2 && /^\d{4}/.test(r2)
      : false;
    if (!shapeOk) return;
    setView((prev) => (prev === v ? prev : v));
    const want = v === 'year' ? r2!.slice(0, 4) + '-01' : r2!;
    setCursor((c) => (c === want ? c : want));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.join('/')]);

  const weekStartsOn = data.settings.weekStartsOn;
  const [curYear, curMonth] = (isMonthKey(cursor) ? cursor : `${cursor.slice(0, 4)}-01`).split('-').map(Number);
  const curDate = isMonthKey(cursor) ? `${cursor}-01` : cursor;

  const change = (dir: number) => {
    if (view === 'calendar') setCursor(monthKeyOf(addMonths(`${cursor}-01`, dir)));
    else if (view === 'year') setCursor(`${curYear + dir}-01`);
    else if (view === 'quarter') {
      const [y, q] = cursor.split('-Q').map(Number);
      const ny = q === 1 ? y - 1 : y;
      const nq = q === 1 ? 4 : q - 1;
      setCursor(`${ny}-Q${nq}`);
    } else if (view === 'week') setCursor(addDays(weekStartOf(curDate, weekStartsOn), dir * 7));
    else setCursor(addDays(curDate, dir));
  };

  const switchView = (v: View) => {
    setView(v);
    const dayCursor = isMonthKey(cursor) ? `${cursor}-01` : cursor;
    if (v === 'day') {
      const base = isMonthKey(cursor) ? todayStr() : cursor;
      setCursor(base);
      navigate(`plan/day/${base}`);
    } else if (v === 'calendar') {
      const m = isMonthKey(cursor) ? cursor : monthKeyOf(dayCursor);
      setCursor(m);
      navigate(`plan/calendar/${m}`);
    } else if (v === 'year') {
      setCursor(`${dayCursor.slice(0, 4)}-01`);
      navigate(`plan/year/${dayCursor.slice(0, 4)}`);
    } else if (v === 'quarter') {
      const qk = quarterKeyOfDate(dayCursor);
      setCursor(qk);
      navigate(`plan/quarter/${qk}`);
    } else if (v === 'week') {
      setCursor(weekStartOf(dayCursor, weekStartsOn));
      navigate(`plan/week/${weekStartOf(dayCursor, weekStartsOn)}`);
    } else if (v === 'agenda') {
      const base = isMonthKey(cursor) ? todayStr() : cursor;
      setCursor(base);
      navigate(`plan/agenda/${base}`);
    } else {
      setCursor(monthKeyOf(dayCursor));
      navigate(`plan/month/${monthKeyOf(dayCursor)}`);
    }
  };

  const label = (() => {
    if (view === 'agenda' || view === 'day') return formatDateLong(curDate);
    if (view === 'calendar') return monthLabel(cursor);
    if (view === 'year') return String(curYear);
    if (view === 'quarter') return `Quarter ${cursor.replace('-Q', ' Q')}`;
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
            One planning workspace — tasks, goals, habits and money across Day, Week, Month, Quarter or Year.
          </div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-icon" onClick={() => change(-1)} aria-label="Back"><IconChevronLeft size={15} /></button>
          <button
            className="btn btn-sm"
            onClick={() =>
              setCursor(
                view === 'calendar' ? monthKeyOf(today) : view === 'week' ? weekStartOf(today, weekStartsOn) : view === 'year' ? `${today.slice(0, 4)}-01` : view === 'quarter' ? quarterOf(today) : today,
              )
            }
          >
            Today
          </button>
          <button className="btn btn-icon" onClick={() => change(1)} aria-label="Forward"><IconChevronRight size={15} /></button>
        </div>
      </div>

      <div className="tabs">
        {(
          [
            { id: 'day', label: 'Day' },
            { id: 'agenda', label: 'Agenda' },
            { id: 'week', label: 'Week' },
            { id: 'calendar', label: 'Month' },
            { id: 'quarter', label: 'Quarter' },
            { id: 'year', label: 'Year' },
          ] as { id: View; label: string }[]
        ).map((v) => (
          <button key={v.id} className={`tab ${view === v.id ? 'active' : ''}`} onClick={() => switchView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex mb-16" style={{ justifyContent: 'center' }}>
        <span className="bold" style={{ fontSize: 15 }}>{label}</span>
      </div>

      {view === 'day' && <DayWorkspace date={curDate} />}
      {view === 'agenda' && <AgendaDay date={curDate} />}
      {view === 'calendar' && (
        <MonthGrid year={curYear} month={curMonth} weekStartsOn={weekStartsOn} deadlines={deadlines} milestones={milestones} />
      )}
      {view === 'week' && <WeekWorkspace weekStart={curDate} weekStartsOn={weekStartsOn} />}
      {view === 'year' && <YearAtGlance year={curYear} />}
      {view === 'quarter' && <QuarterView qk={cursor.includes('-Q') ? cursor : quarterOf(`${cursor}-01`)} />}
      {view === 'month' && <MonthReviewPage mk={isMonthKey(cursor) ? cursor : monthKeyOf(cursor)} />}
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
          const j = data.daily[d]?.journal;
          const hasJournal = !!(j && (j.wentWell || j.learned || j.accomplished || j.freeform || j.grateful));
          const recurring = data.transactions.some((tx) => tx.recurrence && !tx.recurrencePaused && occursOnDate(tx, d));
          const moneyDay = data.transactions.some((tx) => tx.date === d) || recurring;
          const t = todayStr();
          const recTaskDay = d >= t && (data.recurringTasks ?? []).some(
            (def) => def.active && (!def.endDate || d <= def.endDate) && recOccurrenceOn(def.rule, d, def.startDate),
          );
          const savingsDay = data.savingsGoals.some((g) => (g.contributions ?? []).some((c) => c.date === d));
          const plannedTasks = (data.tasks ?? []).filter((x) => !x.done && x.date === d).length;
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
                {plannedTasks > 0 && <span className="cal-dot task" />}
                {recTaskDay && <span className="cal-dot rec" title="Recurring task occurrence" />}
                {habit.scheduled > 0 && <span className="cal-dot habit" />}
                {hasJournal && <span className="cal-dot journal" />}
                {moneyDay && <span className="cal-dot money" />}
                {savingsDay && <span className="cal-dot savings" />}
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
        <Legend color="task" label="Planned task" />
        <Legend color="rec" label="Recurring task" />
        <Legend color="muted" label="Habit day" />
        <Legend color="warn" label="Journal entry" />
        <Legend color="pos" label="Money — income, expense or recurring date" />
        <Legend color="savings" label="Savings contribution" />
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
    task: 'var(--accent-strong)',
    money: 'var(--pos)',
    savings: 'var(--accent-strong)',
    rec: 'var(--accent-strong)',
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
          const past = mk <= monthKeyOf(t);
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

// ── Quarter view ─────────────────────────────────────────────────────────────

function QuarterView({ qk }: { qk: string }) {
  const { data } = useApp();
  const currency = data.settings.finance.currency;
  const [y, q] = qk.split('-Q').map(Number);
  const [m1, m2, m3] = quarterMonths(qk);
  const months = [m1, m2, m3];
  const from = `${y}-${String(m1).padStart(2, '0')}-01`;
  const to = `${y}-${String(m3).padStart(2, '0')}-${String(daysInMonth(y, m3)).padStart(2, '0')}`;

  const qMoney = (() => {
    let income = 0;
    let expense = 0;
    for (const tx of data.transactions) {
      if (tx.date >= from && tx.date <= to) {
        if (tx.type === 'income') income += tx.amount;
        else expense += tx.amount;
      }
    }
    return { income, expense, saved: income - expense };
  })();

  let habitScheduled = 0;
  let habitDone = 0;
  let d = from;
  let guard = 0;
  while (d <= to && guard < 1200) {
    const info = dayHabitInfo(data, d);
    habitScheduled += info.scheduled;
    habitDone += info.done;
    d = addDays(d, 1);
    guard++;
  }
  const habitPct = habitScheduled === 0 ? 0 : Math.round((habitDone / habitScheduled) * 100);

  const goalsDone = data.goals.filter((g) => g.status === 'completed' && g.completedDate && g.completedDate >= from && g.completedDate <= to).length;
  const deadlines = goalDeadlineMap(data.goals);
  const milestones = new Set(milestoneDates(data.goals));

  return (
    <div>
      <div className="grid grid-4 mb-24">
        <div className="panel-flat">
          <div className="stat-label">Q{q} {y} · income</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(qMoney.income, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Expenses</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(qMoney.expense, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Saved</div>
          <div className="stat-value" style={{ fontSize: 20, color: qMoney.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(qMoney.saved, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Habits · goals</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{habitPct}%<small> · {goalsDone}✓</small></div>
        </div>
      </div>

      <div className="grid grid-3" style={{ alignItems: 'start' }}>
        {months.map((m) => {
          const mk = `${y}-${String(m).padStart(2, '0')}`;
          return <MonthGrid key={mk} year={y} month={m} weekStartsOn={data.settings.weekStartsOn} deadlines={deadlines} milestones={milestones} />;
        })}
      </div>
    </div>
  );
}
