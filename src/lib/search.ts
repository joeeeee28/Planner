// ─────────────────────────────────────────────────────────────────────────────
// Global search — indexes journal entries, goals, habits, learning items,
// projects, achievements, skills and notes. Searching "IAM" finds every
// relevant record containing that term.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData } from './types';
import { formatDateMed, monthLabel } from './dates';

export type SearchKind =
  | 'journal'
  | 'goal'
  | 'task'
  | 'habit'
  | 'learning'
  | 'project'
  | 'achievement'
  | 'skill'
  | 'note'
  | 'transaction'
  | 'savings'
  | 'budget'
  | 'person'
  | 'source'
  | 'account'
  | 'obligation'
  | 'creditcard'
  | 'investment'
  | 'instrument'
  | 'holding';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  date?: string;
  route: string;
  score: number;
}

/** Result groups shown in the search popover (order matters). */
export type SearchGroup = 'goals' | 'tasks' | 'money' | 'growth' | 'journal';

export const SEARCH_GROUP_LABEL: Record<SearchGroup, string> = {
  goals: 'Goals',
  tasks: 'Tasks',
  money: 'Money',
  growth: 'Growth',
  journal: 'Journal',
};

export function searchGroupOf(kind: SearchKind): SearchGroup {
  switch (kind) {
    case 'goal':
      return 'goals';
    case 'task':
      return 'tasks';
    case 'transaction':
    case 'savings':
    case 'budget':
    case 'person':
    case 'source':
    case 'account':
    case 'obligation':
    case 'creditcard':
    case 'investment':
    case 'instrument':
    case 'holding':
      return 'money';
    case 'habit':
    case 'learning':
    case 'project':
    case 'achievement':
    case 'skill':
      return 'growth';
    default:
      return 'journal';
  }
}

const norm = (s: string) => s.toLowerCase();

export function searchAll(data: AppData, query: string): SearchResult[] {
  const q = norm(query.trim());
  if (q.length < 1) return [];
  const out: SearchResult[] = [];
  const push = (r: SearchResult) => out.push(r);

  const hits = (text: string, q: string): number => {
    const t = norm(text);
    if (!t.includes(q)) return 0;
    let count = 0;
    let idx = 0;
    while ((idx = t.indexOf(q, idx)) !== -1) {
      count++;
      idx += q.length;
    }
    return count;
  };

  const snippet = (text: string, q: string, len = 90): string => {
    const t = text.replace(/\s+/g, ' ').trim();
    const i = norm(t).indexOf(norm(q));
    if (i === -1) return t.slice(0, len);
    const start = Math.max(0, i - 30);
    return (start > 0 ? '…' : '') + t.slice(start, start + len) + (start + len < t.length ? '…' : '');
  };

  // Journal entries (reflection prompts + free-form)
  for (const [date, entry] of Object.entries(data.daily)) {
    const texts: string[] = [];
    if (entry.journal) {
      for (const v of Object.values(entry.journal)) if (v && v.trim()) texts.push(v);
    }
    for (const a of data.growthAreas) {
      const area = entry.areas[a.id];
      if (area?.notes?.trim()) texts.push(area.notes);
      for (const t of area?.tasks ?? []) texts.push(t.text);
    }
    for (const t of entry.priorities ?? []) texts.push(t.text);
    for (const text of texts) {
      const n = hits(text, q);
      if (n > 0) {
        push({
          kind: 'journal',
          id: `${date}-${text.slice(0, 24)}`,
          title: `Journal — ${formatDateMed(date)}`,
          snippet: snippet(text, q),
          date,
          route: `#/journal/${date}`,
          score: 10 + n,
        });
      }
    }
  }

  // Goals (title, description, notes, milestones)
  for (const g of data.goals) {
    const pool = [g.title, g.description, g.notes, ...g.milestones.map((m) => m.title)].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      const inTitle = hits(g.title, q) > 0;
      push({
        kind: 'goal',
        id: g.id,
        title: `Goal: ${g.title}`,
        snippet: snippet(inTitle ? g.description || g.notes || g.title : pool, q),
        route: `#/goals/${g.id}`,
        score: (inTitle ? 30 : 12) + n,
      });
    }
  }

  // Planned tasks (scheduled + inbox) — V4
  for (const task of data.tasks ?? []) {
    if (task.done) continue;
    const n = hits(task.text, q);
    if (n > 0) {
      push({
        kind: 'task',
        id: task.id,
        title: `Task: ${task.text}`,
        snippet: task.goalId
          ? `${data.goals.find((g) => g.id === task.goalId)?.title ?? 'Linked goal'} · ${task.date ? `planned ${formatDateMed(task.date)}` : 'in Inbox'}`
          : task.date ? `Planned ${formatDateMed(task.date)}` : 'In Inbox',
        date: task.date,
        route: task.date ? `#/plan/day/${task.date}` : '#/inbox',
        score: (task.date ? 22 : 18) + n,
      });
    }
  }

  // Habits
  for (const h of data.habits) {
    if (hits(h.name, q) > 0) {
      push({
        kind: 'habit',
        id: h.id,
        title: `Habit: ${h.name}`,
        snippet: `Daily habit — current streak tracked in Habits`,
        route: '#/habits',
        score: 20,
      });
    }
  }

  // Learning items (title, notes, whatILearned)
  for (const l of data.learning) {
    const pool = [l.title, l.notes, l.whatILearned].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      const inTitle = hits(l.title, q) > 0;
      push({
        kind: 'learning',
        id: l.id,
        title: `Learning: ${l.title}`,
        snippet: snippet(inTitle ? l.notes || l.whatILearned || l.title : pool, q),
        route: '#/learning',
        score: (inTitle ? 25 : 10) + n,
      });
    }
  }

  // Projects
  for (const p of data.projects) {
    const pool = [p.name, p.description, p.role, p.contributions, p.outcomes, p.achievements].join(
      ' · ',
    );
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'project',
        id: p.id,
        title: `Project: ${p.name}`,
        snippet: snippet(pool, q),
        route: '#/career/projects',
        score: 15 + n,
      });
    }
  }

  // Achievements
  for (const a of data.achievements) {
    const pool = [a.description, a.impact, a.notes].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'achievement',
        id: a.id,
        title: `Achievement — ${formatDateMed(a.date)}`,
        snippet: snippet(pool, q),
        date: a.date,
        route: '#/career/achievements',
        score: 15 + n,
      });
    }
  }

  // Skills
  for (const s of data.skills) {
    if (hits(s.name, q) > 0) {
      push({
        kind: 'skill',
        id: s.id,
        title: `Skill: ${s.name}`,
        snippet: snippet(s.notes || `Level ${s.currentLevel} / ${s.targetLevel}`, q),
        route: '#/career/skills',
        score: 18,
      });
    }
  }

  // Career roadmap
  const careerPool = [
    data.career.currentPosition,
    data.career.targetDirection,
    data.career.skillsRequired,
    data.career.experienceRequired,
    ...data.career.milestones.map((m) => m.title),
  ].join(' · ');
  if (hits(careerPool, q) > 0) {
    push({
      kind: 'note',
      id: 'career-roadmap',
      title: 'Career roadmap',
      snippet: snippet(careerPool, q),
      route: '#/career/roadmap',
      score: 12,
    });
  }

  // Monthly focus & review notes
  for (const [mk, m] of Object.entries(data.monthly)) {
    const pool = [m.focus, ...m.goals.map((g) => g.text), ...Object.values(m.review)].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'note',
        id: `month-${mk}`,
        title: `Monthly plan — ${monthLabel(mk)}`,
        snippet: snippet(pool, q),
        route: `#/reviews/month/${mk}`,
        score: 8 + n,
      });
    }
  }

  // Weekly reviews
  for (const [ws, w] of Object.entries(data.weekly)) {
    const pool = Object.values(w).join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'note',
        id: `week-${ws}`,
        title: `Weekly review — week of ${formatDateMed(ws)}`,
        snippet: snippet(pool, q),
        date: ws,
        route: `#/reviews/week/${ws}`,
        score: 8 + n,
      });
    }
  }

  // Cycle reviews
  for (const cr of Object.values(data.cycleReviews)) {
    const pool = [cr.achievements, cr.skillsDeveloped, cr.habitsMaintained, cr.learningCompleted, cr.lessons, cr.nextPriorities].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'note',
        id: `cycle-${cr.cycleId}`,
        title: 'Growth cycle review',
        snippet: snippet(pool, q),
        route: `#/reviews/cycle/${cr.cycleId}`,
        score: 8 + n,
      });
    }
  }

  // Transactions
  for (const tx of data.transactions) {
    const pool = [tx.description ?? '', tx.notes ?? '', tx.category].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'transaction',
        id: tx.id,
        title: `${tx.type === 'income' ? 'Income' : 'Expense'} — ${tx.category}`,
        snippet: snippet(pool, q),
        date: tx.date,
        route: '#/money/transactions',
        score: 12 + n,
      });
    }
  }

  // Savings goals
  for (const g of data.savingsGoals) {
    const pool = [g.name, ...(g.contributions ?? []).map((c) => c.note ?? '')].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'savings',
        id: g.id,
        title: `Savings goal: ${g.name}`,
        snippet: snippet(pool, q),
        route: '#/money/goals',
        score: 12 + n,
      });
    }
  }

  // Budgets
  for (const b of data.budgets) {
    const n = hits(b.category, q);
    if (n > 0) {
      push({
        kind: 'budget',
        id: `${b.id}`,
        title: `Budget: ${b.category}`,
        snippet: `${monthLabel(b.month)} — limit ${b.limit}`,
        route: '#/money/budgets',
        score: 10 + n,
      });
    }
  }

  // People (V4.2)
  for (const p of data.people ?? []) {
    if (p.active === false) continue;
    const pool = [p.name, p.nickname ?? '', p.relationship ?? '', p.notes ?? ''].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'person',
        id: p.id,
        title: `Person: ${p.name}`,
        snippet: snippet(pool, q),
        route: `#/money/people/${p.id}`,
        score: (hits(p.name, q) > 0 ? 30 : 15) + n,
      });
    }
  }

  // Money Sources / Funds (V4.3)
  for (const s of data.sources ?? []) {
    const pool = [s.name, s.purpose ?? '', s.notes ?? ''].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'source',
        id: s.id,
        title: `Money Source: ${s.name}`,
        snippet: snippet(pool, q),
        route: `#/money/sources/${s.id}`,
        score: (hits(s.name, q) > 0 ? 28 : 14) + n,
      });
    }
  }

  // Money Accounts (V4.4)
  for (const a of data.accounts ?? []) {
    if (a.archived) continue;
    const pool = [a.name, a.type, a.notes ?? ''].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'account',
        id: a.id,
        title: `Account: ${a.name}`,
        snippet: `${a.type} account`,
        route: `#/money/accounts/${a.id}`,
        score: (hits(a.name, q) > 0 ? 28 : 14) + n,
      });
    }
  }

  // Obligations — Borrowed / Lent (V4.5)
  for (const o of data.obligations ?? []) {
    if (o.status === 'archived') continue;
    const personName = (data.people ?? []).find((p) => p.id === o.personId)?.name ?? 'Contact';
    const pool = [o.name, personName, o.purpose ?? '', o.notes ?? ''].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      const isBorrow = o.direction === 'borrowed';
      push({
        kind: 'obligation',
        id: o.id,
        title: `${isBorrow ? 'Borrowed from' : 'Lent to'} ${personName}`,
        snippet: snippet(pool, q),
        route: `#/money/owed/${o.id}`,
        score: (hits(o.name, q) > 0 || hits(personName, q) > 0 ? 28 : 14) + n,
      });
    }
  }

  // Credit Cards (V4.1)
  for (const c of data.creditCards ?? []) {
    const pool = [c.name, c.issuer ?? '', c.last4].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'creditcard',
        id: c.id,
        title: `Credit Card: ${c.name}`,
        snippet: `••••${c.last4}`,
        route: '#/money/accounts',
        score: 25 + n,
      });
    }
  }

  // Investments & Instruments
  for (const inst of data.investmentInstruments ?? []) {
    const pool = [inst.symbol, inst.name, inst.exchange, inst.isin ?? '', inst.assetType].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'instrument',
        id: inst.id,
        title: `${inst.symbol} — ${inst.name}`,
        snippet: `${inst.exchange} · ${inst.assetType}${inst.isin ? ` · ${inst.isin}` : ''}`,
        route: '#/investments',
        score: (hits(inst.symbol, q) > 0 ? 35 : 18) + n,
      });
    }
  }

  // Holdings
  for (const h of data.investmentHoldings ?? []) {
    const inst = (data.investmentInstruments ?? []).find((i) => i.id === h.instrumentId);
    if (!inst) continue;
    const pool = [inst.symbol, inst.name, `holding ${h.quantity}`].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'holding',
        id: h.id,
        title: `Holding: ${inst.symbol}`,
        snippet: `${h.quantity} shares · avg cost ${h.averageCost}`,
        route: '#/investments',
        score: (hits(inst.symbol, q) > 0 ? 30 : 15) + n,
      });
    }
  }

  // Upcoming Investment Plans
  for (const plan of data.investmentPlans ?? []) {
    const inst = plan.instrumentId ? (data.investmentInstruments ?? []).find((i) => i.id === plan.instrumentId) : undefined;
    const pool = [inst?.symbol ?? '', inst?.name ?? '', plan.notes ?? '', plan.frequency ?? '', plan.status].join(' · ');
    const n = hits(pool, q);
    if (n > 0) {
      push({
        kind: 'investment',
        id: plan.id,
        title: `Investment Plan: ${inst?.symbol ?? 'Planned'} (${plan.amount})`,
        snippet: `${plan.status} · planned ${plan.plannedDate}${plan.frequency ? ` · ${plan.frequency}` : ''}`,
        route: '#/investments',
        score: 20 + n,
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 40);
}
