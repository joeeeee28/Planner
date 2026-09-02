// Growth OS V4 Slice 4 — Insights V2.
// Insights are organised around calm QUESTIONS, not a wall of charts.
// Every statement carries a supporting metric, a time period and (where
// useful) a drill-down route. All statements come from the deterministic
// intel engine (insights2) — derived from the user's own records.

import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { intelStatements, INTEL_SECTION_ORDER, INTEL_SECTION_TITLES } from '../lib/insights2';

export function InsightsPage() {
  const { data } = useApp();

  const sections = useMemo(() => {
    const stmts = intelStatements(data);
    const map = new Map<string, typeof stmts>();
    for (const s of stmts) {
      const list = map.get(s.section) ?? [];
      list.push(s);
      map.set(s.section, list);
    }
    return INTEL_SECTION_ORDER.map((id) => ({ id, items: map.get(id) ?? [] })).filter((x) => x.items.length > 0);
  }, [data]);

  const total = sections.reduce((a, x) => a + x.items.length, 0);

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Insights</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            A calm, evidence-based read — every statement comes with its reason and period.
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="panel">
          <p className="small muted" style={{ margin: 0 }}>
            Insights appear as you use the system — add a task, complete a habit, record a transaction.
          </p>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 18 }}>
          {sections.map((sec) => (
            <section className="panel" key={sec.id} aria-label={INTEL_SECTION_TITLES[sec.id]}>
              <h2 className="panel-title">{INTEL_SECTION_TITLES[sec.id]}</h2>
              <div className="flex flex-col mt-8">
                {sec.items.map((ins) => (
                  <div className="insight" key={ins.key}>
                    <span className="ic">{ins.icon}</span>
                    <span className="grow">
                      <span className="small">{ins.text}</span>
                      <span className="tiny muted insight-meta">
                        {ins.period}
                        {ins.metric ? ` · ${ins.metric}` : ''}
                      </span>
                    </span>
                    {ins.route && (
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(ins.route!)}>
                        Open
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="tiny muted mt-24" style={{ maxWidth: 560 }}>
        Insights are generated from your own data to help you understand patterns. They are not financial advice;
        projections are estimates, never guarantees. Journal content stays private — only day counts are ever used.
      </p>
    </div>
  );
}
