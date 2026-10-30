// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — UI & Dashboard Redesign Verification Suite
// Verifies 21st.dev inspired components, dark warm surfaces, responsive states,
// and ensures "What Changed This Week" does NOT render browser-default white boxes.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
(globalThis as any).React = React;
import { renderToString } from 'react-dom/server';
import {
  MetricCard,
  DashboardSection,
  SectionHeader,
  StatGrid,
  TrendIndicator,
  StatusBadge,
  EmptyState,
  LoadingSkeleton,
  ErrorState,
  TimelineItem,
  ActivityList,
  ChartCard,
  ResponsiveTable,
  MobileList,
  InsightCard,
} from '../src/components/v5/index';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('\n==================================================');
console.log('GROWTH OS V5 — UI & DASHBOARD REDESIGN TEST SUITE');
console.log('==================================================\n');

// 1. MetricCard Verification
console.log('1. MetricCard Rendering & Semantics');
const htmlMetricIncome = renderToString(
  React.createElement(MetricCard, {
    label: 'INCOME',
    value: '₹50,000',
    delta: '+₹10,000',
    deltaLabel: 'vs last week',
    trend: 'up',
    semantic: 'income',
  })
);
assert(htmlMetricIncome.includes('v5-metric-card'), 'MetricCard renders v5-metric-card CSS class');
assert(htmlMetricIncome.includes('INCOME'), 'MetricCard renders uppercase label');
assert(htmlMetricIncome.includes('₹50,000'), 'MetricCard renders tabular metric value');
assert(htmlMetricIncome.includes('semantic-income'), 'Income card has positive semantic treatment');

const htmlMetricExpenses = renderToString(
  React.createElement(MetricCard, {
    label: 'EXPENSES',
    value: '₹12,000',
    delta: '+₹2,000',
    deltaLabel: 'vs last week',
    trend: 'up',
    semantic: 'expense',
  })
);
assert(htmlMetricExpenses.includes('semantic-expense'), 'Expense increase uses semantic-expense (caution, not positive)');

// 2. What Changed This Week — NO Browser-Default White Rectangles
console.log('\n2. "What Changed This Week" Redesign Verification');
const htmlWhatChanged = renderToString(
  React.createElement(
    DashboardSection,
    {
      title: 'What changed this week',
      action: React.createElement('span', { className: 'tiny muted' }, 'VS LAST WEEK'),
    },
    React.createElement(
      StatGrid,
      { cols: 3 },
      React.createElement(MetricCard, {
        label: 'INCOME',
        value: '₹39,360',
        delta: '+₹39,360',
        deltaLabel: 'vs last week',
        trend: 'up',
        semantic: 'income',
      }),
      React.createElement(MetricCard, {
        label: 'NET SAVED',
        value: '₹29,162',
        delta: '+₹29,162',
        deltaLabel: 'vs last week',
        trend: 'up',
        semantic: 'savings',
        subtext: 'Income − Expenses',
      }),
      React.createElement(MetricCard, {
        label: 'EXPENSES',
        value: '₹10,198',
        delta: '+₹10,198',
        deltaLabel: 'vs last week',
        trend: 'up',
        semantic: 'expense',
      })
    )
  )
);

// Invariant: NEVER render white/gray browser-default rectangles (#ffffff, bg-white, unstyled table)
assert(!htmlWhatChanged.includes('background:#ffffff'), 'Does NOT render browser-default white background');
assert(!htmlWhatChanged.includes('background: #fff'), 'Does NOT render white box styling');
assert(!htmlWhatChanged.includes('bg-white'), 'Does NOT use plain white utility classes');
assert(htmlWhatChanged.includes('v5-metric-card'), 'Renders polished dark paper metric cards');
assert(htmlWhatChanged.includes('NET SAVED'), 'Uses "Net Saved" instead of old "Saved (income − expenses)"');
assert(htmlWhatChanged.includes('Income − Expenses'), 'Formula shown as subtle helper text');
assert(htmlWhatChanged.includes('v5-stat-grid cols-3'), 'Uses responsive 3-column StatGrid layout');

// 3. StatGrid & Responsive Breakpoints
console.log('\n3. StatGrid Responsive Layout');
const htmlGrid2 = renderToString(React.createElement(StatGrid, { cols: 2 }, 'Content'));
assert(htmlGrid2.includes('v5-stat-grid cols-2'), 'StatGrid generates 2-column class');
const htmlGrid4 = renderToString(React.createElement(StatGrid, { cols: 4 }, 'Content'));
assert(htmlGrid4.includes('v5-stat-grid cols-4'), 'StatGrid generates 4-column class');

// 4. TrendIndicator
console.log('\n4. TrendIndicator Behavior');
const htmlTrendUp = renderToString(React.createElement(TrendIndicator, { trend: 'up', text: '+12%' }));
assert(htmlTrendUp.includes('v5-trend up'), 'TrendIndicator up renders with arrow and up class');
const htmlTrendDown = renderToString(React.createElement(TrendIndicator, { trend: 'down', text: '-5%' }));
assert(htmlTrendDown.includes('v5-trend down'), 'TrendIndicator down renders with down class');

// 6. TimelineItem & ActivityList
console.log('\n6. TimelineItem & ActivityList');
const htmlTimeline = renderToString(
  React.createElement(TimelineItem, {
    date: 'Oct 15, 2026',
    title: 'Monthly learning review',
    description: 'Review notes and plan the next chapter',
    status: React.createElement(StatusBadge, { status: 'planned', label: 'Planned' }),
    amount: '₹5,000',
  })
);
assert(htmlTimeline.includes('v5-timeline-item'), 'TimelineItem renders dot and timeline rail');
assert(htmlTimeline.includes('v5-status-badge') && htmlTimeline.includes('status-planned'), 'StatusBadge rendered with status-planned class');
assert(htmlTimeline.includes('Monthly learning review'), 'Timeline title present');

const htmlActivity = renderToString(
  React.createElement(ActivityList, null, React.createElement('div', null, 'Activity 1'))
);
assert(htmlActivity.includes('v5-activity-list'), 'ActivityList renders v5-activity-list container');

// 7. EmptyState, LoadingSkeleton, ErrorState
console.log('\n7. EmptyState, LoadingSkeleton & ErrorState');
const htmlEmpty = renderToString(
  React.createElement(EmptyState, {
    title: 'No learning records yet.',
    description: 'Add a course, book or skill to begin.',
    actionLabel: 'Add learning',
  })
);
assert(htmlEmpty.includes('v5-empty-state'), 'EmptyState renders v5-empty-state container');
assert(htmlEmpty.includes('Add learning'), 'EmptyState action button present');

const htmlSkeleton = renderToString(
  React.createElement(LoadingSkeleton, { count: 3, height: 48 })
);
assert(htmlSkeleton.includes('v5-skeleton'), 'LoadingSkeleton renders shimmer effect elements');

const htmlError = renderToString(
  React.createElement(ErrorState, {
    title: 'Sync unavailable',
    message: 'Your saved records remain available on this device.',
    retryLabel: 'Retry sync',
  })
);
assert(htmlError.includes('v5-error-state'), 'ErrorState renders calm error container');
assert(htmlError.includes('Your saved records remain available on this device.'), 'Truthful non-panicking error message');

// 8. ResponsiveTable & ChartCard
console.log('\n8. ResponsiveTable & ChartCard');
const htmlTable = renderToString(
  React.createElement(
    ResponsiveTable,
    null,
    React.createElement(
      'thead',
      null,
      React.createElement('tr', null, React.createElement('th', null, 'Record'), React.createElement('th', null, 'Value'))
    )
  )
);
assert(htmlTable.includes('v5-table-wrap'), 'ResponsiveTable provides horizontal scroll wrapper');
assert(htmlTable.includes('v5-table'), 'ResponsiveTable applies v5-table styles');

const htmlChart = renderToString(
  React.createElement(ChartCard, {
    title: 'Wellbeing rhythm',
    subtitle: 'Recorded health check-ins this week',
    summaryText: 'Sleep recorded: 6 nights · Water recorded: 5 days',
  })
);
assert(htmlChart.includes('v5-chart-card'), 'ChartCard provides accessible text summary container');
assert(htmlChart.includes('Sleep recorded: 6 nights · Water recorded: 5 days'), 'Accessible chart summary text present');

// 9. InsightCard
console.log('\n9. InsightCard');
const htmlInsight = renderToString(
  React.createElement(InsightCard, {
    title: 'Weekly check-in rhythm',
    text: 'You recorded five check-ins this week. Missing days remain blank.',
    period: 'This Week',
    metric: '+2 more than last week',
  })
);
assert(htmlInsight.includes('v5-insight-card'), 'InsightCard renders v5-insight-card container');
assert(htmlInsight.includes('Weekly check-in rhythm'), 'Insight title present');

// 10. MobileList (generic responsive coverage formerly in retired global suite)
console.log('\n10. MobileList');
const htmlMobileList = renderToString(
  React.createElement(MobileList, null,
    React.createElement('article', { className: 'v5-mobile-card' }, 'Recorded check-in')
  )
);
assert(htmlMobileList.includes('v5-mobile-list'), 'MobileList renders the mobile card-stack container');
assert(htmlMobileList.includes('Recorded check-in'), 'MobileList preserves child record content');

console.log('\n==================================================');
console.log(`UI REDESIGN TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('==================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
