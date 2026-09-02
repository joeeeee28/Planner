// Growth OS V4 Slice 4 — command palette recents (local, per device).
// Only labels are stored (never user content), capped, most-recent first.
// Used by the Quick Add / command palette to show "recent commands".

const KEY = 'growth-os.cmd-recents.v1';
const MAX = 6;

export function recentCommands(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

/** Push a used command label (most recent first, deduplicated). */
export function pushCommand(label: string): string[] {
  const list = [label, ...recentCommands().filter((x) => x !== label)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable (private mode) — recents simply won't persist
  }
  return list;
}

export function clearCommands(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // noop
  }
}
