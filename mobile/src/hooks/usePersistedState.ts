import { useCallback, useState } from "react";

// A page's search / filter state that survives opening a detail screen and
// coming back (the list screen unmounts or its state is otherwise lost).
// Held in a module-level map — no AsyncStorage dependency in this app, so it
// does not survive a full app restart. Mirrors the web's usePersistedState.
const store = new Map<string, unknown>();

export function clearPersistedState() {
  store.clear();
}

export function usePersistedState<T>(key: string | null, initial: T): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => (key && store.has(key) ? (store.get(key) as T) : initial));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        if (key) store.set(key, next);
        return next;
      });
    },
    [key],
  );
  const reset = useCallback(() => {
    if (key) store.delete(key);
    setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, set, reset];
}

// Filters are kept while moving within one section (the first path segment
// after (tabs): loans -> a loan -> back, cash -> a party ledger -> a mode
// ledger) and dropped on entering a different section such as customers.
let lastSection: string | null = null;
export function syncPersistedSection(section: string) {
  if (!section || section === lastSection) return;
  if (lastSection !== null) store.clear();
  lastSection = section;
}
