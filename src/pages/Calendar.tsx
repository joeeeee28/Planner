import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatDateLong,
  formatDateMed,
  isToday,
  monthLabel,
  monthMatrix,
  monthKeyOf,
  todayStr,
  weekDates,
  weekStartOf,
  parseDateStr,
} from '../lib/dates';
import {
  dayStatus,
  dayHabitInfo,
  dayProgress,
  goalDeadlineMap,
  milestoneDates,
  windowCompletion,
} from '../lib/analytics';
import { ProgressBar, Pct } from '../components/ui';
import { IconChevronLeft, IconChevronRight } from '../components/icons';

type View = 'day' | 'week' | 'month' | 'year';

const isMonthKey = (s: string) => /^\d{4}-\d{2}$/.test(s);

export function CalendarPage() {
  const { data } = useApp();
  const [route] = useRoute();
  const [view, setView] = useState<View>(() => {
    const v = route[1] as View;
    return ['day', 'week', 'month', 'year'].includes(v) ? v : 'month';
  });
  const [cursor, setCursor] = useState(() => {
    const fromRoute = route[2];
    if (fromRoute) return fromRoute;
    return monthKeyOf(todayStr());
  });

  const today = todayStr();
  const weekStartsOn = data.settings.weekStartsOn;

  // cursor normalization per view
  const [curYear, curMonth] = cursor.split('-').map(Number);
  const curDate = view === 'month' ? `${cursor}-01` : cursor;

  const change = (dir: number) => {
    if (view === 'month') {
      setCursor(monthKeyOf(addMonths(`${cursor}-01`, dir)));
    } else if (view === 'year') {
      setCursor(`${curYear + dir}-01`);
    } else if (view === 'week') {
      const ws = weekStartOf(curDate, weekStartsOn);
      setCursor(addDays(ws, dir * 7));
    } else {
      setCursor(addDays(curDate, dir));
    }
  };

  const switchView = (v: View) => {
    setView(v);
    const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(cursor);
    const dayCursor = isMonthKey(cursor) ? `${cursor}-01` : isDateKey ? cursor : todayStr();
    if (v === 'month') {
      const m = isMonthKey(cursor) ? cursor : monthKeyOf(dayCursor);
      setCursor(m);
      navigate(`calendar/month/${m}`);
    } else if (v === 'year') {
      const y = Number(dayCursor.slice(0, 4)) || new Date().getFullYear();
      setCursor(`${y}-01`);
      navigate(`calendar/year/${y}`);
    } else if (v === 'week') {
      const ws = weekStartOf(dayCursor, weekStartsOn);
      setCursor(ws);
      navigate(`calendar/week/${ws}`);
    } else {
      setCursor(dayCursor);
      navigate(`calendar/day/${dayCursor}`);
    }
  };



  const label = (() => {
    if (view === 'month') return monthLabel(cursor);
    if (view === 'year') return String(curYear);
    if (view === 'week') {
      const ws = weekStartOf(curDate, weekStartsOn);
      return `Week of ${formatDateMed(ws)}`;
    }
    return formatDateLong(curDate);
  })();
  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Calendar</h1>
          <div className="topbar-sub">Any day, week, month or year — past, present or future.</div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 8 }}>
          <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
            {(['day', 'week', 'month', 'year'] as View[]).map((v) => (
              <button
                key={v}
                className={`tab ${view === v ? 'active' : ''}`}
                onClick={() => switchView(v)}
                style={{ borderBottom: '2px solid transparent' }}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '16px 20px' }}>
        <div className="flex mb-16">
          <button className="btn btn-icon" onClick={() => change(-1)} aria-label="Back">
            <IconChevronLeft />
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              setCursor(
                view === 'month'
                  ? monthKeyOf(today)
                  : view === 'week'
                    ? weekStartOf(today, weekStartsOn)
                    : view === 'year'
                      ? `${Number(today.slice(0, 4))}-01`
                      : today,
              )
            }
          >
            Today
          </button>
          <div className="bold grow" style={{ textAlign: 'center', fontSize: 16 }}>
            {label}
          </div>
          <button className="btn btn-icon" onClick={() => change(1)} aria-label="Forward">
            <IconChevronRight />
          </button>
        </div>

        {view === 'month' && <MonthView year={curYear} month={curMonth} weekStartsOn={weekStartsOn} onOpen={(d) => navigate(`today/${d}`)} />}
        {view === 'week' && <WeekView start={weekStartOf(curDate, weekStartsOn)} weekStartsOn={weekStartsOn} onOpen={(d) => navigate(`today/${d}`)} />}
        {view === 'day' && <DayView date={curDate} />}
        {view === 'year' && (
          <YearView year={curYear} onOpenMonth={(m) => { setView('month'); setCursor(m); }} onOpenDay={(d) => navigate(`today/${d}`)} />
        )}
      </div>

      <div className="flex flex-wrap mt-16" style={{ gap: 14 }}>
        <Legend color="green" label="All tasks completed" />
        <Legend color="amber" label="Partially completed" />
        <Legend color="red" label="Goal deadline" />
        <Legend color="teal" label="Milestone" />
        <Legend color="purple" label="Habit scheduled/completed" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex tiny muted" style={{ gap: 6 }}>
      <span className="cal-dot" style={{ background: color === 'green' ? 'var(--success)' : color === 'amber' ? 'var(--warning)' : color === 'red' ? 'var(--danger)' : color === 'teal' ? 'var(--accent)' : '#8b5cf6' }} />
      {label}
    </span>
  );
}

function MonthView({
  year,
  month,
  weekStartsOn,
  onOpen,
}: {
  year: number;
  month: number;
  weekStartsOn: 0 | 1;
  onOpen: (d: string) => void;
}) {
  const { data } = useApp();
  const weeks = monthMatrix(year, month, weekStartsOn);
  const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const labels = weekStartsOn === 1 ? [...dowLabels.slice(1), dowLabels[0]] : dowLabels;

  const deadlineMap = goalDeadlineMap(data.goals);
  const milestoneSet = new Set(milestoneDates(data.goals));
  const thisMonth = `${year}-${String(month).padStart(2, '0')}`;

  return (
    <div>
      <div className="cal-grid">
        {labels.map((l) => (
          <div className="cal-dow" key={l}>{l}</div>
        ))}
        {weeks.flat().map((d, i) => {
          if (!d) return <div key={`x${i}`} />;
          const inMonth = d.slice(0, 7) === thisMonth;
          const status = dayStatus(data.daily[d], data.growthAreas);
          const habit = dayHabitInfo(data, d);
          const cls = [
            'cal-cell',
            inMonth ? '' : 'other-month',
            isToday(d) ? 'today' : '',
            status === 'full' ? 'completed-day' : '',
            status === 'partial' ? 'partial-day' : '',
          ].join(' ');
          return (
            <button className={cls} key={d} onClick={() => onOpen(d)}>
              <span className="cal-day-num">{parseDateStr(d).getDate()}</span>
              <span className="cal-dots">
                {status === 'full' && <span className="cal-dot full" />}
                {status === 'partial' && <span className="cal-dot partial" />}
                {(deadlineMap.get(d) ?? 0) > 0 && <span className="cal-dot deadline" />}
                {milestoneSet.has(d) && <span className="cal-dot milestone" />}
                {habit.scheduled > 0 && <span className="cal-dot habit" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  start,
  weekStartsOn,
  onOpen,
}: {
  start: string;
  weekStartsOn: 0 | 1;
  onOpen: (d: string) => void;
}) {
  const { data } = useApp();
  const today = todayStr();
  const days = weekDates(start);

  const deadlineMap = goalDeadlineMap(data.goals);
  const milestoneSet = new Set(milestoneDates(data.goals));
  const weekP = windowCompletion(data, days[0], days[6] > today ? today : days[6]);
  void weekStartsOn;

  return (
    <div>
      <div className="flex mb-16" style={{ gap: 10 }}>
        <div className="grow" />
        <span className="tiny muted">Week completion</span>
        <ProgressBar pct={weekP.pct} color="teal" height={6} />
        <Pct value={weekP.pct} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 8 }}>
        {days.map((d) => {
          const status = dayStatus(data.daily[d], data.growthAreas);
          const p = dayProgress(data.daily[d], data.growthAreas);
          const habit = dayHabitInfo(data, d);
          return (
            <button
              key={d}
              className={['cal-cell', isToday(d) ? 'today' : '', status === 'full' ? 'completed-day' : '', status === 'partial' ? 'partial-day' : ''].join(' ')}
              onClick={() => onOpen(d)}
              style={{ minHeight: 120, flexDirection: 'column' }}
            >
              <span className="cal-day-num">
                {parseDateStr(d).toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                {parseDateStr(d).getDate()}
              </span>
              {p.total > 0 && (
                <span className="tiny muted" style={{ marginTop: 4 }}>
                  {p.done}/{p.total}
                </span>
              )}
              <span className="cal-dots">
                {status === 'full' && <span className="cal-dot full" />}
                {status === 'partial' && <span className="cal-dot partial" />}
                {(deadlineMap.get(d) ?? 0) > 0 && <span className="cal-dot deadline" />}
                {milestoneSet.has(d) && <span className="cal-dot milestone" />}
                {habit.scheduled > 0 && <span className="cal-dot habit" />}
              </span>
              {data.daily[d]?.journal?.learned && (
                <span className="tiny muted" style={{ marginTop: 6, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  💡 {data.daily[d].journal.learned}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ date }: { date: string }) {
  const { data } = useApp();
  const entry = data.daily[date];
  const p = dayProgress(entry, data.growthAreas);
  const habit = dayHabitInfo(data, date);
  const deadlines = goalDeadlineMap(data.goals).get(date) ?? 0;
  const milestones = milestoneDates(data.goals).filter((m) => m === date).length;

  return (
    <div>
      <div className="grid grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))' }}>
        <div className="stat">
          <div className="stat-label">Tasks</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{p.done}/{p.total}</div>
          <ProgressBar pct={p.pct} color="teal" height={6} />
        </div>
        <div className="stat">
          <div className="stat-label">Habits</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{habit.scheduled > 0 ? `${habit.done}/${habit.scheduled}` : '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Deadlines & milestones</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{deadlines + milestones}</div>
        </div>
      </div>
      <div className="mt-16">
        <button className="btn btn-primary" onClick={() => navigate(`today/${date}`)}>
          Open {formatDateMed(date)} in the planner →
        </button>
      </div>
    </div>
  );
}

function YearView({
  year,
  onOpenMonth,
  onOpenDay,
}: {
  year: number;
  onOpenMonth: (m: string) => void;
  onOpenDay: (d: string) => void;
}) {
  const { data } = useApp();
  const today = todayStr();
  return (
    <div className="grid grid-3">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const mk = `${year}-${String(m).padStart(2, '0')}`;
        const last = daysInMonth(year, m);
        const to = mk === monthKeyOf(today) ? today : `${mk}-${String(last).padStart(2, '0')}`;
        let done = 0;
        let total = 0;
        let d = `${mk}-01`;
        let guard = 0;
        while (d <= to && guard < 400) {
          const p = dayProgress(data.daily[d], data.growthAreas);
          done += p.done;
          total += p.total;
          d = addDays(d, 1);
          guard++;
        }
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);
        const mini = monthMatrix(year, m, data.settings.weekStartsOn);
        return (
          <div className="card" key={mk} style={{ padding: 14 }}>
            <button
              className="bold"
              style={{ background: 'none', border: 'none', fontSize: 13.5, padding: 0, color: 'var(--text)', display: 'block', marginBottom: 8 }}
              onClick={() => onOpenMonth(mk)}
            >
              {parseDateStr(`${mk}-01`).toLocaleDateString('en-US', { month: 'long' })}
            </button>
            <div className="flex mb-8" style={{ gap: 8 }}>
              <ProgressBar pct={pct} height={5} />
              <span className="tiny muted">{pct}%</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
              {mini.flat().map((day, i) => {
                if (!day) return <span key={i} />;
                const status = dayStatus(data.daily[day], data.growthAreas);
                return (
                  <button
                    key={day}
                    onClick={() => onOpenDay(day)}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 4,
                      border: 'none',
                      padding: 0,
                      background:
                        day.slice(0, 7) !== mk ? 'transparent' : status === 'full' ? 'var(--success-soft)' : status === 'partial' ? 'var(--warning-soft)' : 'var(--bg-subtle)',
                      fontSize: 9,
                      color: 'var(--text-2)',
                    }}
                    title={day}
                  >
                    {parseDateStr(day).getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
