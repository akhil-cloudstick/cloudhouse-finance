"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { FORBIDDEN_EVENT } from "@/common/services/httpClient";

const ToastContext = createContext<((msg: string) => void) | null>(null);

type ToastProviderProps = { children: React.ReactNode };

/**
 * Ported from legacy/app.js's `toast(msg)` — shows the message in the fixed
 * bottom-center toast, auto-hiding after the same 2.6s as before.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((text: string) => {
    setMsg(text);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  }, []);

  // Every 403 from the API surfaces here (httpClient dispatches the event).
  useEffect(() => {
    const onForbidden = () => toast("You don't have access to do that — ask your administrator.");
    window.addEventListener(FORBIDDEN_EVENT, onForbidden);
    return () => window.removeEventListener(FORBIDDEN_EVENT, onForbidden);
  }, [toast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="toast" className={show ? "show" : ""}>
        {msg}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
