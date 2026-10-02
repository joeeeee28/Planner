// ─────────────────────────────────────────────────────────────────────────────
// RecordToolbar — the one shared filter / sort experience (V4.1)
//
// Three levels, always in the same order and the same place:
//
//   LEVEL 1  [ Search… ]  [ All ][ Quick ][ filters ]        [ Filter ] [ Sort ]
//   LEVEL 2  Filter drawer / bottom sheet (draft → Apply)
//   LEVEL 3  “More options” inside the drawer, only when relevant
//
// Everything is contextual: a module passes only the quick filters, filter
// fields and sort options that make sense for it. Screens cannot render an
// unlimited wall of controls — the toolbar itself caps quick filters at five.
//
// Accessible by construction: role="dialog" drawer with an accessible title,
// role="menu" sort menu with radio items, visible focus, Esc to close,
// Enter to apply, “/” to focus search (never while typing).
// ─────────────────────────────────────────────────────────────────────────────

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  activeChips,
  activeFilterCount,
  isFilterValueSet,
  runQuery,
  optionsFor,
  removeChip,
  resetView,
  setFilterValue,
  viewIsActive,
  type ActiveChip,
  type FilterField,
  type FilterOption,
  type FilterValue,
  type QuickFilter,
  type RecordQuery,
  type RecordQueryResult,
  type RecordViewSpec,
  type SortOption,
} from '../lib/recordQuery';
import { EmptyState } from './ui';
import { IconClose, IconSearch, IconSort } from './icons';

const MAX_QUICK_FILTERS = 5;

// Only the primary toolbar on a page answers the “/” shortcut.
let toolbarInstances = 0;
let shortcutOwner: number | null = null;
let nextToolbarId = 1;

// ── Small building blocks ────────────────────────────────────────────────────

function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);
  return ref;
}

export function QuickFilterPills<T>({
  quickFilters,
  active,
  onSelect,
  label,
}: {
  quickFilters: QuickFilter<T>[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  if (quickFilters.length === 0) return null;
  return (
    <div className="rt-quick" role="group" aria-label={label}>
      <button
        type="button"
        className={`rt-pill ${active === 'all' ? 'active' : ''}`}
        aria-pressed={active === 'all'}
        onClick={() => onSelect('all')}
      >
        All
      </button>
      {quickFilters.slice(0, MAX_QUICK_FILTERS).map((f) => (
        <button
          key={f.id}
          type="button"
          className={`rt-pill ${active === f.id ? 'active' : ''}`}
          aria-pressed={active === f.id}
          onClick={() => onSelect(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Single-select view switcher for the rare screen where the whole list is one
 * of a few states (Automation: Active / Paused). A radio group is the correct
 * pattern for “exactly one of these views” — and it keeps the switcher out of
 * the way of the actions inside the list.
 */
export function QuickViews({
  views,
  active,
  onSelect,
  label,
}: {
  views: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const items = [{ id: 'all', label: 'All' }, ...views];
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const move = (from: number, dir: 1 | -1) => {
    const next = (from + dir + items.length) % items.length;
    refs.current[next]?.focus();
  };
  return (
    <div className="rt-quick rt-views" role="radiogroup" aria-label={label}>
      {items.map((v, i) => (
        <span
          key={v.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="radio"
          aria-checked={active === v.id}
          tabIndex={active === v.id ? 0 : -1}
          className={`rt-pill ${active === v.id ? 'active' : ''}`}
          onClick={() => onSelect(v.id)}
          onKeyDown={(e: ReactKeyboardEvent<HTMLSpanElement>) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              onSelect(v.id);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              move(i, -1);
            }
          }}
        >
          {v.label}
        </span>
      ))}
    </div>
  );
}

// ── Sort menu ────────────────────────────────────────────────────────────────

export function SortMenu<T>({
  open,
  options,
  active,
  onSelect,
  onClose,
  label,
}: {
  open: boolean;
  options: SortOption<T>[];
  active: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  label: string;
}) {
  const ref = useOutsideClose(open, onClose);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.findIndex((o) => o.id === active));
    itemRefs.current[idx]?.focus();
  }, [open, active, options]);

  if (!open) return null;

  const move = (from: number, dir: 1 | -1) => {
    const next = (from + dir + options.length) % options.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <div className="rt-menu" role="menu" aria-label={label} ref={ref}>
      <div className="rt-menu-title">Sort by</div>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="menuitemradio"
          aria-checked={o.id === active}
          className={`rt-menu-item ${o.id === active ? 'active' : ''}`}
          onClick={() => {
            onSelect(o.id);
            onClose();
          }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              move(i, -1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              itemRefs.current[0]?.focus();
            } else if (e.key === 'End') {
              e.preventDefault();
              itemRefs.current[options.length - 1]?.focus();
            }
          }}
        >
          <span className="rt-radio" aria-hidden="true">{o.id === active ? '●' : '○'}</span>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Filter drawer ────────────────────────────────────────────────────────────

function FilterControl<T>({
  field,
  value,
  records,
  onChange,
}: {
  field: FilterField<T>;
  value: FilterValue;
  records: readonly T[];
  onChange: (value: FilterValue) => void;
}) {
  const fsId = useId();
  const options: FilterOption[] = optionsFor(field, records);

  if (field.type === 'radio') {
    return (
      <fieldset className="rt-field" role="group" aria-labelledby={fsId}>
        <legend className="rt-field-label" id={fsId}>
          {field.label}
        </legend>
        <div className="rt-options">
          <label className={`rt-option ${!isFilterValueSet(value) ? 'active' : ''}`}>
            <input type="radio" name={`${fsId}-${field.id}`} checked={!isFilterValueSet(value)} onChange={() => onChange(undefined)} />
            <span>All</span>
          </label>
          {options.map((o) => (
            <label key={o.value} className={`rt-option ${value === o.value ? 'active' : ''}`}>
              <input
                type="radio"
                name={`${fsId}-${field.id}`}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (field.type === 'amount') {
    const range = (value && typeof value === 'object' ? value : {}) as { min?: number; max?: number };
    return (
      <div className="rt-field">
        <label className="rt-field-label" htmlFor={`${fsId}-min`}>
          {field.label}
        </label>
        <div className="rt-range">
          <input
            id={`${fsId}-min`}
            type="number"
            inputMode="decimal"
            min="0"
            placeholder={field.placeholder ?? 'Min'}
            value={range.min ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const min = raw === '' ? undefined : Math.max(0, Number(raw));
              const next: FilterValue = min === undefined && range.max === undefined ? undefined : { min, max: range.max };
              onChange(next);
            }}
          />
          <span className="rt-range-sep" aria-hidden="true">
            –
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            aria-label={`${field.label} max`}
            placeholder={field.placeholder ? `Max ${field.placeholder}` : 'Max'}
            value={range.max ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const max = raw === '' ? undefined : Math.max(0, Number(raw));
              const next: FilterValue = max === undefined && range.min === undefined ? undefined : { min: range.min, max };
              onChange(next);
            }}
          />
        </div>
      </div>
    );
  }

  const selectId = `${fsId}-select`;
  return (
    <div className="rt-field">
      <label className="rt-field-label" htmlFor={selectId}>
        {field.label}
      </label>
      <select
        id={selectId}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{field.placeholder ?? 'Any'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterDrawer<T>({
  open,
  title,
  fields,
  draft,
  records,
  onDraft,
  onApply,
  onClearFilters,
  onResetView,
  onClose,
}: {
  open: boolean;
  title: string;
  fields: FilterField<T>[];
  draft: RecordQuery;
  records: readonly T[];
  onDraft: (next: RecordQuery) => void;
  onApply: () => void;
  onClearFilters: () => void;
  onResetView: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<Element | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('input, select, button, [tabindex]')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      (restoreRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const basic = fields.filter((f) => !f.advanced);
  const advanced = fields.filter((f) => f.advanced);
  const draftFilterCount = Object.values(draft.filters).filter(isFilterValueSet).length;

  return (
    <div className="rt-drawer-backdrop" onMouseDown={onClose}>
      <div
        className="rt-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault();
            onApply();
          }
        }}
      >
        <div className="rt-drawer-head">
          <h3 className="rt-drawer-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close filter panel">
            <IconClose />
          </button>
        </div>

        <div className="rt-drawer-body">
          {fields.length === 0 ? (
            <p className="small muted">This list has no extra filters — the quick filters above cover the useful cases.</p>
          ) : (
            basic.map((f) => (
              <FilterControl
                key={f.id}
                field={f}
                value={draft.filters[f.id]}
                records={records}
                onChange={(v) => onDraft({ ...draft, filters: setFilterValue(draft.filters, f.id, v) })}
              />
            ))
          )}

          {advanced.length > 0 && (
            <div className="rt-advanced">
              <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide more options' : `More options (${advanced.length})`}
              </button>
              {showAdvanced &&
                advanced.map((f) => (
                  <FilterControl
                    key={f.id}
                    field={f}
                    value={draft.filters[f.id]}
                    records={records}
                    onChange={(v) => onDraft({ ...draft, filters: setFilterValue(draft.filters, f.id, v) })}
                  />
                ))}
            </div>
          )}
        </div>

        <div className="rt-drawer-foot">
          <button
            type="button"
            className="btn"
            onClick={() => {
              onClearFilters();
              onDraft({ ...draft, filters: {} });
            }}
            disabled={draftFilterCount === 0}
          >
            Clear filters
          </button>
          <span className="spacer" />
          {(draftFilterCount > 0 || draft.q.trim() !== '' || draft.quick !== 'all') && (
            <button type="button" className="btn btn-ghost" onClick={onResetView}>
              Reset view
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onApply}>
            Apply filters
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Chips ────────────────────────────────────────────────────────────────────

export function ActiveFilterChips({
  chips,
  onRemove,
  onClearAll,
  showClearAll,
}: {
  chips: ActiveChip[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  showClearAll: boolean;
}) {
  if (chips.length === 0 && !showClearAll) return null;
  return (
    <div className="rt-chips" aria-label="Active filters">
      {chips.map((c) => (
        <span className="rt-chip" key={c.id}>
          {c.label}
          <button type="button" className="rt-chip-x" aria-label={`Remove filter ${c.label}`} onClick={() => onRemove(c.id)}>
            ×
          </button>
        </span>
      ))}
      {showClearAll && (
        <button type="button" className="rt-clear" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}

// ── Filtered empty state ─────────────────────────────────────────────────────

export function FilteredEmptyState({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <EmptyState
      icon="⌕"
      title={`No ${noun} match these filters`}
      text="Nothing was deleted — clear the filters to see everything again."
      action={
        <button className="btn btn-primary btn-sm" onClick={onClear}>
          Clear filters
        </button>
      }
    />
  );
}

// ── The toolbar ──────────────────────────────────────────────────────────────

export interface RecordToolbarProps<T> extends Omit<RecordViewSpec<T>, 'key'> {
  query: RecordQuery;
  onChange: (patch: Partial<RecordQuery>) => void;
  /** Replace wholesale — used by Clear all / Reset view. */
  onReplace?: (next: RecordQuery) => void;
  records: readonly T[];
  searchPlaceholder?: string;
  label: string;
  /** 'field' (desktop search box, default) or 'icon' (Today, quiet screens). */
  searchStyle?: 'field' | 'icon';
  /** Opt out of the global “/” shortcut (secondary toolbars). */
  searchShortcut?: boolean;
  /** Show “N of M things” when the list is filtered. */
  resultLabel?: (shown: number, total: number) => ReactNode;
  /** Rendered under the toolbar (active chips are always shown). */
  children?: ReactNode;
  /** Extra controls kept on the same calm row (e.g. a month picker). */
  leading?: ReactNode;
  /** Optional precomputed result — pages already run the query to render rows. */
  result?: RecordQueryResult<T>;
  /** A quick filter that is the module default — shown as a pill, never as a chip. */
  defaultQuick?: string;
}

export function RecordToolbar<T>({
  query,
  onChange,
  onReplace,
  records,
  searchPlaceholder,
  label,
  searchKeys,
  quickFilters = [],
  filters = [],
  sortOptions = [],
  defaultSort,
  searchStyle = 'field',
  searchShortcut = true,
  resultLabel,
  children,
  leading,
  result: providedResult,
  defaultQuick,
}: RecordToolbarProps<T>) {
  const spec: RecordViewSpec<T> = useMemo(
    () => ({ key: label, searchKeys, quickFilters, filters, sortOptions, defaultSort }),
    [label, searchKeys, quickFilters, filters, sortOptions, defaultSort],
  );

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [draft, setDraft] = useState<RecordQuery>(query);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchRef = useRef<HTMLInputElement | null>(null);
  const [toolbarId] = useState(() => nextToolbarId++);

  // “/” focuses search — never while the user is typing, and only for the
  // primary toolbar on the current page.
  useEffect(() => {
    if (!searchShortcut) return;
    toolbarInstances += 1;
    if (shortcutOwner === null) shortcutOwner = toolbarId;
    return () => {
      toolbarInstances -= 1;
      if (toolbarInstances === 0) shortcutOwner = null;
    };
  }, [searchShortcut, searchStyle, toolbarId]);

  useEffect(() => {
    if (!searchShortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      if (shortcutOwner !== toolbarId) return;
      e.preventDefault();
      if (searchStyle === 'icon') {
        // Icon-only search expands before it can take focus (Today and other
        // calm screens): open the field, then focus it once it has mounted.
        setMobileSearchOpen(true);
        requestAnimationFrame(() => mobileSearchRef.current?.focus());
      } else {
        (searchRef.current ?? mobileSearchRef.current)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchShortcut, searchStyle, toolbarId]);

  const fieldCount = activeFilterCount(spec, query);
  const chips = activeChips(spec, query).filter((c) => c.id !== `quick:${defaultQuick}`);
  const active = viewIsActive(query);
  const computed = useMemo(() => providedResult ?? runQuery(records, spec, query), [providedResult, records, spec, query]);
  const result = providedResult ?? computed;
  const sortLabel = sortOptions.find((s) => s.id === query.sort)?.label ?? '';

  const openFilter = () => {
    setDraft(query);
    setFilterOpen(true);
  };

  const applyFilters = useCallback(() => {
    onChange({ filters: draft.filters });
    setFilterOpen(false);
  }, [draft.filters, onChange]);

  const resetEverything = () => {
    const next = resetView(spec, query);
    if (onReplace) onReplace(next);
    else onChange(next);
  };

  const hasQuick = quickFilters.length > 0;
  const hasSort = sortOptions.length > 0;

  return (
    <div className={`rt ${searchStyle === 'icon' ? 'rt-icon-search' : ''}`} data-record-toolbar={label}>
      <div className="rt-row">
        {leading && <div className="rt-leading">{leading}</div>}

        {searchStyle === 'field' ? (
          <div className="rt-search">
            <IconSearch size={14} />
            <input
              ref={searchRef}
              type="search"
              className="rt-search-input"
              placeholder={searchPlaceholder ?? `Search ${label}…`}
              aria-label={searchPlaceholder ?? `Search ${label}`}
              value={query.q}
              onChange={(e) => onChange({ q: e.target.value })}
            />
            {query.q !== '' && (
              <button className="rt-search-clear" aria-label="Clear search" onClick={() => onChange({ q: '' })}>
                ×
              </button>
            )}
          </div>
        ) : (
          <>
            {!mobileSearchOpen && (
              <button className="rt-icon-btn" aria-label={`Search ${label}`} onClick={() => setMobileSearchOpen(true)}>
                <IconSearch size={15} />
              </button>
            )}
            {mobileSearchOpen && (
              <div className="rt-search rt-search-mobile">
                <IconSearch size={14} />
                <input
                  ref={mobileSearchRef}
                  type="search"
                  className="rt-search-input"
                  placeholder={searchPlaceholder ?? `Search ${label}…`}
                  aria-label={`Search ${label}`}
                  value={query.q}
                  onChange={(e) => onChange({ q: e.target.value })}
                  autoFocus
                />
                <button
                  className="rt-search-clear"
                  aria-label="Close search"
                  onClick={() => {
                    setMobileSearchOpen(false);
                    onChange({ q: '' });
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </>
        )}

        {hasQuick && (
          <QuickFilterPills
            quickFilters={quickFilters}
            active={query.quick}
            onSelect={(id) => onChange({ quick: id })}
            label={`${label} quick filters`}
          />
        )}

        <div className="rt-actions">
          {filters.length > 0 && (
            <button
              type="button"
              className={`btn btn-sm rt-filter-btn ${fieldCount > 0 ? 'btn-accent' : ''}`}
              onClick={openFilter}
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
            >
              Filter{fieldCount > 0 ? ` • ${fieldCount}` : ''}
            </button>
          )}
          {hasSort && (
            <div className="rt-sort-wrap">
              <button
                type="button"
                className="btn btn-sm rt-sort-btn"
                onClick={() => setSortOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={sortOpen}
              >
                <IconSort size={13} />
                {sortLabel ? `Sort: ${sortLabel}` : 'Sort'}
              </button>
              <SortMenu
                open={sortOpen}
                options={sortOptions}
                active={query.sort}
                onSelect={(id) => onChange({ sort: id })}
                onClose={() => setSortOpen(false)}
                label={`Sort ${label}`}
              />
            </div>
          )}
        </div>
      </div>

      <ActiveFilterChips
        chips={chips}
        onRemove={(id) => {
          const next = removeChip(query, id);
          if (onReplace) onReplace(next);
          else onChange(next);
        }}
        onClearAll={resetEverything}
        showClearAll={active}
      />

      {resultLabel && result.filtered && <p className="rt-count">{resultLabel(result.shown, result.total)}</p>}

      <FilterDrawer
        open={filterOpen}
        title={`Filter ${label}`}
        fields={filters}
        draft={draft}
        records={records}
        onDraft={setDraft}
        onApply={applyFilters}
        onClearFilters={() => {
          const next = { ...query, filters: {} };
          if (onReplace) onReplace(next);
          else onChange({ filters: {} });
        }}
        onResetView={resetEverything}
        onClose={() => setFilterOpen(false)}
      />

      {children}
    </div>
  );
}
