import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import {
  addDays,
  formatDateLong,
  isToday,
  monthLabel,
  monthMatrix,
  monthKeyOf,
  parseDateStr,
  todayStr,
  weekdayName,
} from '../lib/dates';
import { dayActive } from '../lib/analytics';
import { Stars } from '../components/ui';
import { FilteredEmptyState, RecordToolbar } from '../components/RecordToolbar';
import { useRecordViewFor } from '../lib/recordView';
import { clearFilters, makeQuery, runQuery, type RecordViewSpec } from '../lib/recordQuery';
import { IconChevronLeft, IconChevronRight } from '../components/icons';

const PROMPTS: { key: keyof import('../lib/types').DayJournal; label: string; placeholder: string }[] = [
  { key: 'wentWell', label: 'What went well?', placeholder: 'Wins, big or small…' },
  { key: 'accomplished', label: 'What did I accomplish?', placeholder: 'Things you got done…' },
  { key: 'learned', label: 'What did I learn?', placeholder: 'A lesson, an insight, a fact…' },
  { key: 'challenged', label: 'What challenged me?', placeholder: 'Hard moments and frictions…' },
  { key: 'improve', label: 'What could I improve?', placeholder: 'One small thing…' },
  { key: 'grateful', label: 'What am I grateful for?', placeholder: 'Three things…' },
  { key: 'focusNext', label: 'What should I focus on next?', placeholder: 'Tomorrow’s direction…' },
];

export function JournalPage() {
  const { data, update } = useApp();
  const route = useRoute();
  const date = route[1] ?? todayStr();
  const t = todayStr();
  const [monthOffset, setMonthOffset] = useState(0);

  const entry = data.daily[date];
  const journal = entry?.journal ?? {
    wentWell: '',
    accomplished: '',
    learned: '',
    challenged: '',
    improve: '',
    grateful: '',
    focusNext: '',
    freeform: '',
  };
  const rating = entry?.rating ?? 0;

  const setJournal = (patch: Partial<typeof journal>) =>
    update((d) => {
      const cur = d.daily[date] ?? {
        priorities: [],
        areas: {},
        journal: {
          wentWell: '',
          accomplished: '',
          learned: '',
          challenged: '',
          improve: '',
          grateful: '',
          focusNext: '',
          freeform: '',
        },
        updatedAt: '',
      };
      d.daily[date] = { ...cur, journal: { ...cur.journal, ...patch }, updatedAt: new Date().toISOString() };
      return { ...d };
    });

  // month overview
  const baseMonth = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, 1);
  baseMonth.setMonth(baseMonth.getMonth() + monthOffset);
  const mk = monthKeyOf(`${baseMonth.getFullYear()}-${String(baseMonth.getMonth() + 1).padStart(2, '0')}-01`);
  const [cy, cm] = mk.split('-').map(Number);
  const weeks = monthMatrix(cy, cm, data.settings.weekStartsOn);

  const activeCount = Object.values(data.daily).filter(
    (e) => e.journal && Object.values(e.journal).some((v) => v?.trim()),
  ).length;

  // V4.1 — a calm entry list for the visible month. Search touches tags only:
  // journal body text is deliberately never indexed by the filter engine.
  interface JournalRow {
    date: string;
    rating: number;
    tags: string[];
    hasEntry: boolean;
  }
  const entries: JournalRow[] = useMemo(
    () =>
      Object.keys(data.daily)
        .filter((d) => d.slice(0, 7) === mk)
        .sort((a, b) => b.localeCompare(a))
        .map((d) => {
          const e = data.daily[d];
          return {
            date: d,
            rating: e.rating ?? 0,
            tags: e.tags ?? [],
            hasEntry: !!e.journal && Object.values(e.journal).some((v) => v?.trim()),
          };
        }),
    [data.daily, mk],
  );

  const view = useRecordViewFor('journal', makeQuery({ defaultSort: 'newest' }));
  const query = view.query;
  const spec = useMemo<RecordViewSpec<JournalRow>>(
    () => ({
      key: 'journal',
      // tags only — never the journal body
      searchKeys: (r) => [...r.tags, r.date],
      quickFilters: [
        { id: 'written', label: 'Has entry', test: (r) => r.hasEntry },
        { id: 'rated', label: 'Rated', test: (r) => r.rating > 0 },
      ],
      filters: [
        {
          id: 'rating',
          label: 'Rating',
          type: 'radio',
          options: [
            { value: '5', label: '★ 5' },
            { value: '4', label: '★ 4' },
            { value: '3', label: '★ 3' },
            { value: 'low', label: '★ 1–2' },
          ],
          match: (r, v) => (v === 'low' ? r.rating > 0 && r.rating <= 2 : r.rating === Number(v)),
        },
        {
          id: 'tag',
          label: 'Tag',
          type: 'select',
          placeholder: 'Any tag',
          optionsFrom: (records) => {
            const tags = new Set<string>();
            for (const r of records) for (const tag of r.tags) tags.add(tag);
            return [...tags].sort().map((tag) => ({ value: tag, label: tag }));
          },
          match: (r, v) => r.tags.includes(String(v)),
        },
        {
          id: 'entry',
          label: 'Entry',
          type: 'radio',
          options: [
            { value: 'with', label: 'Has an entry' },
            { value: 'without', label: 'Empty day' },
          ],
          advanced: true,
          match: (r, v) => (v === 'with' ? r.hasEntry : !r.hasEntry),
        },
      ],
      sortOptions: [
        { id: 'newest', label: 'Newest', compare: (a, b) => b.date.localeCompare(a.date) },
        { id: 'oldest', label: 'Oldest', compare: (a, b) => a.date.localeCompare(b.date) },
        { id: 'rating', label: 'Rating', compare: (a, b) => b.rating - a.rating || b.date.localeCompare(a.date) },
      ],
      defaultSort: 'newest',
    }),
    [],
  );
  const result = useMemo(() => runQuery(entries, spec, query), [entries, spec, query]);

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Journal</h1>
          <div className="topbar-sub">Private reflections, searchable forever. {activeCount} days with entries.</div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* day editor */}
        <div className="card">
          <div className="flex flex-wrap mb-8" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="bold" style={{ fontSize: 16 }}>
                {isToday(date) ? 'Today' : weekdayName(date)} — {formatDateLong(date)}
              </div>
            </div>
            <div className="flex" style={{ gap: 6 }}>
              <button className="btn btn-icon btn-sm" onClick={() => navigate(`journal/${addDays(date, -1)}`)} aria-label="Previous day">
                <IconChevronLeft size={14} />
              </button>
              {!isToday(date) && (
                <button className="btn btn-sm" onClick={() => navigate(`journal/${t}`)}>
                  Today
                </button>
              )}
              <button className="btn btn-icon btn-sm" onClick={() => navigate(`journal/${addDays(date, 1)}`)} aria-label="Next day">
                <IconChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="flex mb-16" style={{ gap: 10, alignItems: 'center' }}>
            <span className="tiny muted bold">How was your day?</span>
            <Stars
              value={rating}
              onChange={(v) =>
                update((d) => {
                  const cur = d.daily[date] ?? {
                    priorities: [],
                    areas: {},
                    journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
                    updatedAt: '',
                  };
                  d.daily[date] = { ...cur, rating: v, updatedAt: new Date().toISOString() };
                  return { ...d };
                })
              }
            />
          </div>

          {PROMPTS.map((p) => (
            <div className="form-row" key={p.key}>
              <label className="form-label">{p.label}</label>
              <textarea
                rows={2}
                value={(journal[p.key] as string) ?? ''}
                placeholder={p.placeholder}
                onChange={(e) => setJournal({ [p.key]: e.target.value } as Partial<typeof journal>)}
              />
            </div>
          ))}
          <div className="form-row">
            <label className="form-label">Free-form journal</label>
            <textarea
              rows={5}
              value={journal.freeform}
              placeholder="Write freely — thoughts, ideas, feelings, plans…"
              onChange={(e) => setJournal({ freeform: e.target.value })}
            />
          </div>
        </div>

        {/* month overview */}
        <div>
          <div className="card mb-16">
            <div className="flex mb-8" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-icon btn-sm" onClick={() => setMonthOffset(monthOffset - 1)} aria-label="Previous month">
                <IconChevronLeft size={14} />
              </button>
              <div className="bold">{monthLabel(mk)}</div>
              <button className="btn btn-icon btn-sm" onClick={() => setMonthOffset(monthOffset + 1)} aria-label="Next month">
                <IconChevronRight size={14} />
              </button>
            </div>
            <div className="cal-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div className="cal-dow" key={d}>
                  {d}
                </div>
              ))}
              {weeks.flat().map((d, i) => {
                if (!d) return <div key={`x${i}`} />;
                const hasEntry = dayActive(data.daily[d], data.growthAreas) && !!data.daily[d]?.journal;
                const learned = data.daily[d]?.journal?.learned?.trim();
                return (
                  <button
                    key={d}
                    className={`cal-cell ${d === t ? 'today' : ''} ${d.slice(0, 7) !== mk ? 'other-month' : ''}`}
                    style={{ minHeight: 64 }}
                    onClick={() => navigate(`journal/${d}`)}
                  >
                    <span className="cal-day-num">{parseDateStr(d).getDate()}</span>
                    {hasEntry && <span style={{ color: 'var(--accent)', fontSize: 12 }}>✍️</span>}
                    {learned && (
                      <span
                        className="tiny muted"
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', marginTop: 2 }}
                      >
                        {learned}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card mb-16">
            <RecordToolbar<JournalRow>
              label="journal"
              query={query}
              onChange={(patch) => view.patch(patch)}
              onReplace={(next) => view.replace(next)}
              records={entries}
              result={result}
              searchStyle="icon"
              searchPlaceholder="Search tags…"
              quickFilters={spec.quickFilters}
              filters={spec.filters}
              sortOptions={spec.sortOptions}
              defaultSort="newest"
              resultLabel={(shown, total) => `${shown} of ${total} days`}
            />
            {result.rows.length === 0 ? (
              result.emptyByFilter ? (
                <FilteredEmptyState noun="journal days" onClear={() => view.replace(clearFilters(query))} />
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  No entries in {monthLabel(mk)} yet — write one on the left, or move to another month.
                </p>
              )
            ) : (
              <div className="flex flex-col" style={{ gap: 2 }}>
                {result.rows.map((r) => (
                  <button key={r.date} className="recent-row" onClick={() => navigate(`journal/${r.date}`)}>
                    <span className="grow small">{formatDateLong(r.date)}</span>
                    {r.rating > 0 && <span className="tiny muted t-num">{'★'.repeat(r.rating)}</span>}
                    {r.tags.slice(0, 3).map((tag) => (
                      <span className="badge tiny" key={tag}>#{tag}</span>
                    ))}
                    {!r.hasEntry && <span className="tiny muted">empty</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">📖 Reflections & reviews</h2>
            <p className="card-sub">Step back regularly — weekly, monthly, quarterly, yearly and per growth cycle.</p>
            <div className="flex flex-wrap" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => navigate(`reviews/week/${todayStr()}`)}>
                This week's review
              </button>
              <button className="btn btn-sm" onClick={() => navigate(`reviews/month/${t.slice(0, 7)}`)}>
                This month's review
              </button>
              <button className="btn btn-sm" onClick={() => navigate(`reviews/quarter/${t.slice(0, 4)}-Q${Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1}`)}>
                This quarter's review
              </button>
              <button className="btn btn-sm" onClick={() => navigate(`reviews/year/${t.slice(0, 4)}`)}>
                This year's review
              </button>
              <button className="btn btn-sm" onClick={() => navigate('reviews')}>
                All reviews
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
