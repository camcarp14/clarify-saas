import { useState } from 'react';

// Tiny persisted-preference hook: view toggles survive reloads without any backend.
export function usePref(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem('clarify:' + key);
      return s === null ? initial : JSON.parse(s);
    } catch { return initial; }
  });
  const set = (next) => {
    setV(next);
    try { localStorage.setItem('clarify:' + key, JSON.stringify(next)); } catch { /* private mode */ }
  };
  return [v, set];
}
