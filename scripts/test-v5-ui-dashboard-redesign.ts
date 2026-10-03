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
  PortfolioCard,
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

// 5. PortfolioCard & MobileList
console.log('\n5. PortfolioCard & MobileList for Mobile QA');
const htmlPortfolio = renderToString(
  React.createElement(PortfolioCard, {
    symbol: 'RELIANCE',
    name: 'Reliance Industries Ltd',
    quantity: 10,
    averageCost: '₹2,400',
    currentPrice: '₹2,500',
    currentValue: '₹25,000',
    pl: '+₹1,000',
    returnPct: '+4.17%',
    dayChange: '+₹250',
    isPositive: true,
  })
);
assert(htmlPortfolio.includes('v5-portfolio-card'), 'PortfolioCard renders specialized portfolio layout');
assert(htmlPortfolio.includes('RELIANCE'), 'PortfolioCard includes ticker symbol');
assert(htmlPortfolio.includes('text-pos'), 'Positive holding styled with text-pos');

const htmlMobileList = renderToString(
  React.createElement(MobileList, null, React.createElement('div', null, 'Holding Item'))
);
assert(htmlMobileList.includes('v5-mobile-list'), 'MobileList renders v5-mobile-list container');

// 6. TimelineItem & ActivityList
console.log('\n6. TimelineItem & ActivityList');
const htmlTimeline = renderToString(
  React.createElement(TimelineItem, {
    date: 'Oct 15, 2026',
    title: 'Monthly SIP: NIFTYBEES',
    description: 'Planned execution: 10 units at market price',
    status: React.createElement(StatusBadge, { status: 'planned', label: 'Planned' }),
    amount: '₹5,000',
  })
);
assert(htmlTimeline.includes('v5-timeline-item'), 'TimelineItem renders dot and timeline rail');
assert(htmlTimeline.includes('v5-status-badge') && htmlTimeline.includes('status-planned'), 'StatusBadge rendered with status-planned class');
assert(htmlTimeline.includes('Monthly SIP: NIFTYBEES'), 'Timeline title present');

const htmlActivity = renderToString(
  React.createElement(ActivityList, null, React.createElement('div', null, 'Activity 1'))
);
assert(htmlActivity.includes('v5-activity-list'), 'ActivityList renders v5-activity-list container');

// 7. EmptyState, LoadingSkeleton, ErrorState
console.log('\n7. EmptyState, LoadingSkeleton & ErrorState');
const htmlEmpty = renderToString(
  React.createElement(EmptyState, {
    title: 'No investments yet.',
    description: 'Import your current holdings from Zerodha, Groww or add a trade manually.',
    actionLabel: 'Import Holdings',
  })
);
assert(htmlEmpty.includes('v5-empty-state'), 'EmptyState renders v5-empty-state container');
assert(htmlEmpty.includes('Import Holdings'), 'EmptyState action button present');

const htmlSkeleton = renderToString(
  React.createElement(LoadingSkeleton, { count: 3, height: 48 })
);
assert(htmlSkeleton.includes('v5-skeleton'), 'LoadingSkeleton renders shimmer effect elements');

const htmlError = renderToString(
  React.createElement(ErrorState, {
    title: 'Market data unavailable',
    message: 'Your portfolio remains available using the last known market prices.',
    retryLabel: 'Retry Market Sync',
  })
);
assert(htmlError.includes('v5-error-state'), 'ErrorState renders calm error container');
assert(htmlError.includes('Your portfolio remains available using the last known market prices.'), 'Truthful non-panicking error message');

// 8. ResponsiveTable & ChartCard
console.log('\n8. ResponsiveTable & ChartCard');
const htmlTable = renderToString(
  React.createElement(
    ResponsiveTable,
    null,
    React.createElement(
      'thead',
      null,
      React.createElement('tr', null, React.createElement('th', null, 'Asset'), React.createElement('th', null, 'Value'))
    )
  )
);
assert(htmlTable.includes('v5-table-wrap'), 'ResponsiveTable provides horizontal scroll wrapper');
assert(htmlTable.includes('v5-table'), 'ResponsiveTable applies v5-table styles');

const htmlChart = renderToString(
  React.createElement(ChartCard, {
    title: 'Portfolio Allocation',
    subtitle: 'Current market value distribution across instruments',
    summaryText: 'Equities: 75% · Cash: 25%',
  })
);
assert(htmlChart.includes('v5-chart-card'), 'ChartCard provides accessible text summary container');
assert(htmlChart.includes('Equities: 75% · Cash: 25%'), 'Accessible chart summary text present');

// 9. InsightCard
console.log('\n9. InsightCard');
const htmlInsight = renderToString(
  React.createElement(InsightCard, {
    title: 'Asset Allocation Shift',
    text: 'Your equity exposure increased by 4.2% following recent purchases.',
    period: 'This Month',
    metric: '+₹47,500 invested',
  })
);
assert(htmlInsight.includes('v5-insight-card'), 'InsightCard renders v5-insight-card container');
assert(htmlInsight.includes('Asset Allocation Shift'), 'Insight title present');

console.log('\n==================================================');
console.log(`UI REDESIGN TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('==================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
