import type { ReactNode } from 'react';

// ── MetricCard ─────────────────────────────────────────────────────────────

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaLabel?: string;
  trend?: 'up' | 'down' | 'flat';
  semantic?: 'income' | 'expense' | 'savings' | 'positive' | 'negative' | 'neutral';
  icon?: ReactNode;
  subtext?: ReactNode;
  tooltip?: string;
  onClick?: () => void;
  className?: string;
}

export function MetricCard({
  label,
  value,
  delta,
  deltaLabel,
  trend,
  semantic = 'neutral',
  icon,
  subtext,
  tooltip,
  onClick,
  className = '',
}: MetricCardProps) {
  // Semantic trend coloring:
  // income/savings/positive: up = pos, down = neg
  // expense: up = warn, down = pos
  let trendClass = 'neutral';
  if (semantic === 'expense') {
    trendClass = trend === 'up' ? 'warn' : trend === 'down' ? 'pos' : 'neutral';
  } else if (semantic === 'income' || semantic === 'savings' || semantic === 'positive') {
    trendClass = trend === 'up' ? 'pos' : trend === 'down' ? 'neg' : 'neutral';
  } else if (semantic === 'negative') {
    trendClass = 'neg';
  } else {
    trendClass = trend === 'up' ? 'pos' : trend === 'down' ? 'neg' : 'neutral';
  }

  const isClickable = typeof onClick === 'function';

  return (
    <div
      className={`v5-metric-card semantic-${semantic} ${isClickable ? 'clickable' : ''} ${className}`}
      onClick={onClick}
      title={tooltip}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="v5-metric-head">
        <span className="v5-metric-label">{label}</span>
        {icon && <span className="v5-metric-icon">{icon}</span>}
      </div>

      <div className="v5-metric-value t-num">{value}</div>

      {(delta !== undefined || deltaLabel || subtext) && (
        <div className="v5-metric-footer">
          {delta !== undefined && (
            <span className={`v5-metric-delta ${trendClass}`}>
              {trend === 'up' ? '▲ ' : trend === 'down' ? '▼ ' : ''}
              {delta}
            </span>
          )}
          {deltaLabel && <span className="v5-metric-sub">{deltaLabel}</span>}
          {subtext && <span className="v5-metric-sub formula">{subtext}</span>}
        </div>
      )}
    </div>
  );
}

// ── DashboardSection ───────────────────────────────────────────────────────

export function DashboardSection({
  title,
  subtitle,
  actions,
  children,
  className = '',
  ariaLabel,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <section className={`v5-section section-gap ${className}`} aria-label={ariaLabel || title}>
      {(title || actions) && (
        <div className="v5-section-header">
          <div>
            {title && <h2 className="t-section" style={{ margin: 0 }}>{title}</h2>}
            {subtitle && <p className="v5-section-sub">{subtitle}</p>}
          </div>
          {actions && <div className="v5-section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ── SectionHeader ──────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  badge,
  subtitle,
  actions,
}: {
  title: string;
  badge?: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex mb-16 items-center justify-between" style={{ gap: 12 }}>
      <div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <h2 className="t-section" style={{ margin: 0 }}>{title}</h2>
          {badge && <span className="v5-badge">{badge}</span>}
        </div>
        {subtitle && <p className="tiny muted mt-2 mb-0">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-8">{actions}</div>}
    </div>
  );
}

// ── StatGrid ───────────────────────────────────────────────────────────────

export function StatGrid({
  children,
  cols = 3,
  className = '',
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return <div className={`v5-stat-grid cols-${cols} ${className}`}>{children}</div>;
}

// ── TrendIndicator ─────────────────────────────────────────────────────────

export function TrendIndicator({
  delta,
  label,
  trend = 'flat',
  semantic = 'neutral',
}: {
  delta: ReactNode;
  label?: string;
  trend?: 'up' | 'down' | 'flat';
  semantic?: 'income' | 'expense' | 'savings' | 'positive' | 'negative' | 'neutral';
}) {
  let trendClass = 'neutral';
  if (semantic === 'expense') {
    trendClass = trend === 'up' ? 'warn' : trend === 'down' ? 'pos' : 'neutral';
  } else if (semantic === 'income' || semantic === 'savings' || semantic === 'positive') {
    trendClass = trend === 'up' ? 'pos' : trend === 'down' ? 'neg' : 'neutral';
  } else {
    trendClass = trend === 'up' ? 'pos' : trend === 'down' ? 'neg' : 'neutral';
  }

  return (
    <span className={`v5-trend-indicator ${trendClass} v5-trend ${trend}`}>
      <span className="v5-trend-arrow">
        {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'}
      </span>
      <span className="v5-trend-val t-num">{delta}</span>
      {label && <span className="v5-trend-lbl">{label}</span>}
    </span>
  );
}

// ── StatusBadge ────────────────────────────────────────────────────────────

export function StatusBadge({
  status,
  label,
}: {
  status: 'Open' | 'Closed' | 'Delayed' | 'Unavailable' | 'BUY' | 'SELL' | 'planned' | 'completed' | 'cancelled' | string;
  label?: string;
}) {
  const norm = status.toLowerCase();
  let cls = 'badge-neutral';
  if (norm === 'open' || norm === 'buy' || norm === 'completed') cls = 'badge-pos';
  else if (norm === 'sell' || norm === 'cancelled') cls = 'badge-neg';
  else if (norm === 'delayed' || norm === 'planned') cls = 'badge-warn';
  else if (norm === 'closed' || norm === 'unavailable') cls = 'badge-neutral';

  return <span className={`v5-status-badge ${cls} status-${norm}`}>{label || status}</span>;
}

// ── EmptyState ─────────────────────────────────────────────────────────────

export function EmptyState({
  icon = '◍',
  title,
  description,
  action,
  actionLabel,
  onAction,
  secondaryAction,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="v5-empty-state">
      <div className="v5-empty-icon">{icon}</div>
      <h3 className="v5-empty-title">{title}</h3>
      {description && <p className="v5-empty-desc">{description}</p>}
      {(action || actionLabel || secondaryAction) && (
        <div className="v5-empty-actions">
          {action || (actionLabel && (
            <button className="btn btn-primary btn-sm" onClick={onAction}>
              {actionLabel}
            </button>
          ))}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

// ── LoadingSkeleton ────────────────────────────────────────────────────────

export function LoadingSkeleton({
  height = 80,
  rows = 1,
  className = '',
}: {
  height?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`v5-skeleton-wrap ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="v5-skeleton-shimmer" style={{ height }} />
      ))}
    </div>
  );
}

// ── ErrorState ─────────────────────────────────────────────────────────────

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="v5-error-state">
      <div className="v5-error-icon">⚠️</div>
      <h3 className="v5-error-title">{title}</h3>
      {message && <p className="v5-error-msg">{message}</p>}
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// ── TimelineItem ───────────────────────────────────────────────────────────

export function TimelineItem({
  date,
  title,
  subtitle,
  description,
  amount,
  badge,
  status,
  action,
  isLast = false,
}: {
  date: string;
  title: string;
  subtitle?: string;
  description?: string;
  amount?: string;
  badge?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
  isLast?: boolean;
}) {
  const sub = subtitle || description;
  const tag = badge || status;
  return (
    <div className={`v5-timeline-item ${isLast ? 'last' : ''}`}>
      <div className="v5-timeline-node">
        <span className="v5-timeline-dot" />
        {!isLast && <span className="v5-timeline-line" />}
      </div>
      <div className="v5-timeline-content">
        <div className="v5-timeline-date">{date}</div>
        <div className="v5-timeline-main">
          <div>
            <div className="v5-timeline-title">{title}</div>
            {sub && <div className="v5-timeline-sub">{sub}</div>}
          </div>
          <div className="v5-timeline-right">
            {amount && <span className="v5-timeline-amount t-num">{amount}</span>}
            {tag}
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PortfolioCard (Mobile and Desktop card) ────────────────────────────────

export function PortfolioCard({
  symbol,
  name,
  exchange,
  shares,
  avgCost,
  currentPrice,
  currentValue,
  pl,
  returnPct,
  dayChange,
  dayChangePct,
  quoteUnavailable,
  onClick,
}: {
  symbol: string;
  name: string;
  exchange: string;
  shares: number;
  avgCost: string;
  currentPrice: string;
  currentValue: string;
  pl: string;
  returnPct: string;
  dayChange?: string;
  dayChangePct?: string;
  quoteUnavailable?: boolean;
  onClick?: () => void;
}) {
  const isPos = !pl.startsWith('-');

  return (
    <div className="v5-portfolio-card" onClick={onClick}>
      <div className="v5-pcard-head">
        <div>
          <span className="v5-pcard-symbol">{symbol}</span>
          <span className="v5-pcard-exchange">{exchange}</span>
          <div className="v5-pcard-name">{name}</div>
        </div>
        <div className="v5-pcard-val-block text-right">
          <div className="v5-pcard-val t-num">{currentValue}</div>
          <div className="v5-pcard-shares tiny muted">{shares} shares · avg {avgCost}</div>
        </div>
      </div>

      <div className="v5-pcard-foot">
        <div className="tiny muted">
          LTP: <span className="t-num" style={{ color: 'var(--ink)' }}>{currentPrice}</span>
          {quoteUnavailable && <span className="text-warn ml-4">(Offline)</span>}
        </div>
        <div className="flex items-center gap-8">
          {dayChange && (
            <span className={`tiny t-num ${dayChange.startsWith('-') ? 'text-neg' : 'text-pos'}`}>
              Day: {dayChange} ({dayChangePct})
            </span>
          )}
          <span className={`v5-pcard-pl t-num ${isPos ? 'text-pos' : 'text-neg'}`}>
            {isPos ? '+' : ''}{pl} ({isPos ? '+' : ''}{returnPct})
          </span>
        </div>
      </div>
    </div>
  );
}

// ── ActivityList ───────────────────────────────────────────────────────────

export function ActivityList({ children }: { children: ReactNode }) {
  return <div className="v5-activity-list">{children}</div>;
}

// ── ChartCard ──────────────────────────────────────────────────────────────

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  textSummary,
  summaryText,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
  textSummary?: string;
  summaryText?: string;
}) {
  const summary = textSummary || summaryText;
  return (
    <div className="v5-chart-card">
      <div className="v5-chart-head">
        <div>
          <h3 className="v5-chart-title">{title}</h3>
          {subtitle && <p className="v5-chart-sub">{subtitle}</p>}
        </div>
        {actions && <div className="v5-chart-actions">{actions}</div>}
      </div>
      {children && <div className="v5-chart-body">{children}</div>}
      {summary && (
        <div className="v5-chart-summary tiny muted" aria-label="Chart summary">
          {summary}
        </div>
      )}
    </div>
  );
}

// ── ResponsiveTable ────────────────────────────────────────────────────────

export function ResponsiveTable({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`v5-table-wrap ${className}`}>
      <table className="v5-table">{children}</table>
    </div>
  );
}

// ── MobileList ─────────────────────────────────────────────────────────────

export function MobileList({ children }: { children: ReactNode }) {
  return <div className="v5-mobile-list">{children}</div>;
}

// ── InsightCard ────────────────────────────────────────────────────────────

export function InsightCard({
  icon = '💡',
  title,
  text,
  period,
  metric,
  route,
  onNavigate,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  period?: string;
  metric?: string;
  route?: string;
  onNavigate?: (route: string) => void;
}) {
  return (
    <div className="v5-insight-card">
      <div className="v5-insight-ic">{icon}</div>
      <div className="v5-insight-body">
        <div className="v5-insight-title">{title}</div>
        <div className="v5-insight-text">{text}</div>
        {(period || metric) && (
          <div className="v5-insight-meta">
            {period && <span>{period}</span>}
            {period && metric && <span> · </span>}
            {metric && <span className="bold">{metric}</span>}
          </div>
        )}
      </div>
      {route && onNavigate && (
        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate(route)}>
          Open
        </button>
      )}
    </div>
  );
}
