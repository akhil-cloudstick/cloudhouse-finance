"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ModalContextValue = {
  openModal: (content: React.ReactNode, wide?: boolean) => void;
  closeModal: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

/**
 * Ported from legacy/app.js's `openModal(html, wide)` / `closeModal()` and
 * the generic `#modalBg`/`#modalBox` markup in app.html. Content is now a
 * React node (populated by Stage 2B's page components) instead of an HTML
 * string, but the open/close/click-outside/wide-variant behavior is the same.
 */
export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<React.ReactNode>(null);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(false);

  const openModal = useCallback((node: React.ReactNode, isWide = false) => {
    setContent(node);
    setWide(isWide);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => setOpen(false), []);

  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      <div
        id="modalBg"
        className={`modal-bg${open ? " open" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).id === "modalBg") closeModal();
        }}
      >
        <div id="modalBox" className={`modal${wide ? " wide" : ""}`}>
          {content}
        </div>
      </div>
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within a ModalProvider");
  return ctx;
}
