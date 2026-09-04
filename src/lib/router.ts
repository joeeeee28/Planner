// Tiny hash router. Routes look like:
//   #/today | #/calendar/month/2026-09 | #/journal/2026-09-01
//   #/reviews/week/2026-09-07 | #/career/skills | #/settings …

import { useEffect, useState } from 'react';

export function parseRoute(): string[] {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (!h) return [];
  return h.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#/${path}`;
}

export function useRoute(): string[] {
  const [route, setRoute] = useState<string[]>(() => parseRoute());
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
