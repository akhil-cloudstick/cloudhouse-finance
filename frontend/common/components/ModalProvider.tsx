"use client";

import { cloneElement, createContext, isValidElement, useCallback, useContext, useMemo, useRef, useState } from "react";
import { makeEnterToSubmitHandler } from "@/common/utils/enterToSubmit";

type ModalContextValue = {
  openModal: (content: React.ReactNode, wide?: boolean) => void;
  closeModal: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

type ModalProviderProps = { children: React.ReactNode };

/**
 * Ported from legacy/app.js's `openModal(html, wide)` / `closeModal()` and
 * the generic `#modalBg`/`#modalBox` markup in app.html. Content is now a
 * React node (populated by Stage 2B's page components) instead of an HTML
 * string, but the open/close/click-outside/wide-variant behavior is the same.
 */
export function ModalProvider({ children }: ModalProviderProps) {
  const [content, setContent] = useState<React.ReactNode>(null);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(false);
  // Every openModal call gets a fresh key, forced onto the passed element
  // below — without this, opening the SAME modal component type twice in a
  // row (e.g. Edit Loan for one loan, close, Edit Loan for a different
  // loan) has React treat the second call as a prop UPDATE to the first
  // call's still-alive component instance rather than a new mount, since
  // they're the same component type at the same position in the tree.
  // That silently kept every useState(props.whatever) initializer at its
  // FIRST call's value — the modal visibly reopened with the previous
  // loan's data, ignoring the new `loan` prop entirely. A fresh key per
  // open forces React to unmount the old instance and mount a genuinely
  // new one every time, for every caller, without each one having to
  // remember to key its own modal content by hand.
  const keySeq = useRef(0);
  // Whether the current press began on the backdrop. A drag that starts inside the modal (selecting text in
  // a field, say) and is released over the backdrop fires a click on the backdrop; that must not close it.
  const pressStartedOnBackdrop = useRef(false);

  const openModal = useCallback((node: React.ReactNode, isWide = false) => {
    keySeq.current += 1;
    setContent(isValidElement(node) ? cloneElement(node, { key: keySeq.current }) : node);
    setWide(isWide);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => setOpen(false), []);

  // Enter submits the modal from any plain field, the same way it would in
  // a real <form> — none of these modals are actually wrapped in one (they
  // post via onClick handlers on their own footer buttons), so without
  // this Enter did nothing at all. Generic rather than per-modal: every
  // modal here already ends its `.ft` footer with exactly one non-ghost
  // primary action button (Save/Publish/Confirm/Record Payment/…), so
  // finding and clicking that is enough to cover all of them without each
  // one wiring up its own key handler. See enterToSubmit.ts for the same
  // pattern used OUTSIDE a modal (full-page forms, per-card forms, …).
  const onModalKeyDown = useMemo(() => makeEnterToSubmitHandler(".ft button.btn:not(.ghost):not(:disabled)"), []);

  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      <div
        id="modalBg"
        className={`modal-bg${open ? " open" : ""}`}
        onMouseDown={(e) => {
          pressStartedOnBackdrop.current = (e.target as HTMLElement).id === "modalBg";
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).id === "modalBg" && pressStartedOnBackdrop.current) closeModal();
          pressStartedOnBackdrop.current = false;
        }}
      >
        <div id="modalBox" className={`modal${wide ? " wide" : ""}`} onKeyDown={onModalKeyDown}>
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
