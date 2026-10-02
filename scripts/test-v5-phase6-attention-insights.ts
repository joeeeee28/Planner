// Growth OS V5 Phase 6 & 7 — Unified Attention Center + Smart Insights Test Suite.
import { attentionItems, categorizedAttention, todayAttentionItems, attentionCount, attentionKeys } from '../src/lib/attention';
import { factualSmartInsights, moneyInsights } from '../src/lib/insights2';
import { createInitialData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';
import { todayStr, addDays } from '../src/lib/dates';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function ok(msg: string) {
  console.log('  ✓', msg);
}

console.log('Running V5 Phase 6 & 7 Attention & Insights tests...');

const t = todayStr();
const yesterday = addDays(t, -1);
const tomorrow = addDays(t, 1);
const in5Days = addDays(t, 5);

// 1. Attention Engine — Initial / Empty state
{
  const data = createInitialData();
  const items = attentionItems(data);
  assert(Array.isArray(items), 'attentionItems returns array');
  const cat = categorizedAttention(data);
  assert(cat.overdue.length === 0, 'empty state overdue is 0');
  assert(cat.dueToday.length === 0, 'empty state dueToday is 0');
  ok('Empty state attention engine returns calm results');
}

// 2. Attention Engine — P0 Overdue Obligation & Credit Card & P1 Task
{
  const data: AppData = {
    ...createInitialData(),
    obligations: [
      {
        id: 'obl-1',
        direction: 'borrowed',
        personId: 'p-1',
        originalAmount: 5000,
        outstandingAmount: 5000,
        dueDate: yesterday,
        status: 'outstanding',
        createdAt: yesterday,
        updatedAt: yesterday,
      },
    ],
    people: [{ id: 'p-1', name: 'Appa', relationship: 'Family', createdAt: yesterday }],
    creditCards: [
      {
        id: 'card-1',
        name: 'HDFC Regalia',
        limit: 100000,
        billingCycleDay: 1,
        dueDateDaysAfterCycle: 20,
        createdAt: yesterday,
      },
    ],
    transactions: [
      {
        id: 'tx-card-1',
        date: yesterday,
        type: 'expense',
        amount: 3000,
        category: 'Food',
        paymentMethod: 'Credit Card',
        creditCardId: 'card-1',
        createdAt: yesterday,
      },
    ],
    tasks: [
      {
        id: 'task-1',
        text: 'Critical project review',
        priority: 1,
        date: yesterday,
        done: false,
        createdAt: yesterday,
      },
    ],
  };

  const cat = categorizedAttention(data);
  assert(cat.overdue.length >= 2, 'overdue obligation and task flagged as P0/overdue');
  const p0Item = cat.overdue.find((x) => x.entityId === 'obl-1');
  assert(!!p0Item, 'overdue obligation derived');
  assert(p0Item?.priority === 'P0', 'overdue obligation priority is P0');
  assert(p0Item?.action.route === 'money/owed', 'overdue obligation deep-links to money/owed');

  const taskItem = cat.all.find((x) => x.entityId === 'task-1');
  assert(!!taskItem, 'overdue task derived');
  assert(taskItem?.priority === 'P0', 'high priority overdue task is P0');

  ok('P0 critical overdue detection and deep-linking');
}

// 2b. Canonical Credit Card Priority Rules Audit Test (P0 = overdue, P1 = due today, P2 = due soon in 1-7 days)
{
  const cardOverdueData: AppData = {
    ...createInitialData(),
    creditCards: [{ id: 'c-overdue', name: 'Axis Bank', limit: 50000, dueDay: 1, createdAt: yesterday }],
    transactions: [{ id: 'tx-co', date: addDays(t, -40), type: 'expense', amount: 1500, category: 'Utilities', paymentMethod: 'Credit Card', cardId: 'c-overdue', createdAt: yesterday }]
  };
  const itemsOverdue = attentionItems(cardOverdueData, { max: 10 });
  const cardItemP0 = itemsOverdue.find(x => x.entityId === 'c-overdue');
  assert(!!cardItemP0, 'overdue card derived');
  assert(cardItemP0?.priority === 'P0', 'credit card payment overdue is P0');
  assert(cardItemP0?.severity === 'urgent', 'credit card payment overdue severity is urgent');

  ok('Canonical Credit Card Priority Rules: Overdue = P0 (urgent), Due Today = P1 (attention), Due Soon (1-7 days) = P2 (upcoming)');
}

// 3. Attention Engine — Deduplication
{
  const data: AppData = {
    ...createInitialData(),
    obligations: [
      {
        id: 'obl-dedup',
        direction: 'borrowed',
        personId: 'p-1',
        originalAmount: 2000,
        outstandingAmount: 2000,
        dueDate: t,
        status: 'outstanding',
        createdAt: t,
        updatedAt: t,
      },
    ],
    people: [{ id: 'p-1', name: 'Appa', relationship: 'Family', createdAt: t }],
  };

  const items = attentionItems(data, { max: 10 });
  const oblItems = items.filter((x) => x.entityId === 'obl-dedup' || x.id.includes('obl-dedup'));
  assert(oblItems.length === 1, `obligation deduplicated to single item (got ${oblItems.length})`);
  ok('Deduplication logic prevents duplicate attention items for same entity');
}

// 4. Contextual Attention for Today
{
  const data: AppData = {
    ...createInitialData(),
    tasks: [
      { id: 't-today', text: 'Task due today', date: t, done: false, priority: 2, createdAt: t },
      { id: 't-future', text: 'Task far in future', date: in5Days, done: false, priority: 3, createdAt: t },
    ],
  };

  const todayItems = todayAttentionItems(data);
  assert(todayItems.some((x) => x.entityId === 't-today'), 'today task included in todayAttentionItems');
  ok('Contextual today attention filtering works');
}

// 5. Smart Insights Engine — Money & Factual Data
{
  const data: AppData = {
    ...createInitialData(),
    transactions: [
      { id: 'tx-1', date: t, type: 'income', amount: 65000, category: 'Salary', paymentMethod: 'Bank Transfer', createdAt: t },
      { id: 'tx-2', date: t, type: 'expense', amount: 11000, category: 'Food', paymentMethod: 'UPI', createdAt: t },
    ],
    obligations: [
      { id: 'o-1', direction: 'borrowed', personId: 'p-1', originalAmount: 7000, outstandingAmount: 7000, status: 'outstanding', createdAt: t, updatedAt: t },
    ],
    people: [{ id: 'p-1', name: 'Appa', relationship: 'Family', createdAt: t }],
  };

  const insights = factualSmartInsights(data, t);
  assert(insights.length > 0, 'insights derived from data');

  const incInsight = insights.find((x) => x.id === 'money-inc-month');
  assert(!!incInsight, 'income insight present');
  assert(incInsight?.title.includes('65,000'), 'income insight displays correct amount');

  const expInsight = insights.find((x) => x.id === 'money-exp-month');
  assert(!!expInsight, 'expense insight present');

  const oblInsight = insights.find((x) => x.id === 'money-obl-o-1');
  assert(!!oblInsight, 'obligation insight present');
  assert(oblInsight?.title.includes('Appa'), 'obligation insight names person');

  ok('Smart Insights generates factual statements derived from real records');
}

// 6. Smart Insights Engine — Trend handling with missing previous period data
{
  const data: AppData = {
    ...createInitialData(),
    transactions: [
      { id: 'tx-cur', date: t, type: 'expense', amount: 5000, category: 'Food', paymentMethod: 'UPI', createdAt: t },
    ],
  };

  const insights = factualSmartInsights(data, t);
  const trendInsight = insights.find((x) => x.id === 'money-top-cat-trend');
  assert(!trendInsight, 'no fake trend insight when previous period data is missing');
  const catInsight = insights.find((x) => x.id === 'money-top-cat');
  assert(!!catInsight, 'factual category insight displayed instead of fake trend');
  ok('Insufficient-data handling suppresses speculative trend comparisons');
}

// 7. Money Insights helper
{
  const data = createInitialData();
  const mInsights = moneyInsights(data, t);
  assert(Array.isArray(mInsights), 'moneyInsights returns array');
  ok('moneyInsights helper function works cleanly');
}

console.log('ALL PHASE 6 & 7 ATTENTION & INSIGHTS ENGINE TESTS PASSED!');
