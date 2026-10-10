import { useEffect, useRef, useState } from "react";

// Shared behavior for the little "docs-dd" action dropdowns (Customer
// Actions, Loan Actions, Documents, Pledge Agreement, …): click-outside to
// close, plus arrow-key navigation through the menu's <a>/<button> items —
// ArrowDown/ArrowUp move focus, Home/End jump to the ends, Escape closes and
// returns focus to the trigger button.
export function useDropdownMenu<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<T>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  // Focus the first item as soon as the menu opens, so arrow keys work
  // immediately without an extra Tab/click.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>("a, button");
    items?.[0]?.focus();
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("a, button") || []);
    if (!items.length) return;
    const current = document.activeElement as HTMLElement | null;
    const idx = items.indexOf(current!);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        items[(idx + 1 + items.length) % items.length].focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
        break;
      case "Home":
        e.preventDefault();
        items[0].focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return { open, setOpen, menuRef, triggerRef, onKeyDown };
}
