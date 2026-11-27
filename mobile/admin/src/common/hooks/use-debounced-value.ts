import { useEffect, useState } from "react";

// Used by every search box that hits a server-side `q`/`search` param —
// debounces keystrokes so we don't fire an API call per character, while
// still never filtering the result set on-device.
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
