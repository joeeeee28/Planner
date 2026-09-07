// ─────────────────────────────────────────────────────────────────────────────
// Growth OS — explicit runtime mode.
//
// PRODUCTION RULE (non-negotiable):
//   When real Supabase configuration exists, the app runs in
//   `cloud-authenticated` mode. There is NO silent fallback to a local /
//   default / guest account. No session → the LOGIN screen.
//
//   A local document is only ever authoritative in `development-local`
//   mode, which requires an explicit development condition (a dev build, or
//   the developer opting in). Production never converts an unauthenticated
//   visitor into a local account.
// ─────────────────────────────────────────────────────────────────────────────

import { isCloudConfigured } from './cloud';

export type RuntimeMode = 'cloud-authenticated' | 'development-local';

/** True for a Vite dev/test build (`import.meta.env.DEV`). Never true in `vite build`. */
export function isDevBuild(): boolean {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    // Non-Vite runtime (node test harnesses) → treated as dev.
    return true;
  }
}

/**
 * Explicit developer opt-in to run the legacy local-only document even when
 * Supabase credentials are present. Development builds only — deliberately
 * ignored in a production bundle so production can never be talked into
 * local mode from the browser.
 */
export function localModeOptIn(): boolean {
  if (!isDevBuild()) return false;
  try {
    return globalThis.localStorage?.getItem('growth-os.dev.localMode') === '1';
  } catch {
    return false;
  }
}

/**
 * The single source of truth for how the app boots.
 *
 *   Supabase configured  → 'cloud-authenticated'  (unless a dev opts out)
 *   Supabase absent      → 'development-local'    (V2 behavior, no network)
 */
export function runtimeMode(): RuntimeMode {
  if (!isCloudConfigured()) return 'development-local';
  if (localModeOptIn()) return 'development-local';
  return 'cloud-authenticated';
}

/**
 * True when an unauthenticated visitor MUST be shown the login screen rather
 * than being handed a local/default account.
 */
export function requiresAuthentication(): boolean {
  return runtimeMode() === 'cloud-authenticated';
}
