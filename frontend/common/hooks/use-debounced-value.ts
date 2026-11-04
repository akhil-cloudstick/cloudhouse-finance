import { useEffect, useState } from "react";

// The value after it has stopped changing for `delay` ms — a search box shows
// every keystroke at once but only asks the server once typing pauses.
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
