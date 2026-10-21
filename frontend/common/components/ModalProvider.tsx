"use client";

import { cloneElement, createContext, isValidElement, useCallback, useContext, useMemo, useRef, useState } from "react";
import { makeEnterToSubmitHandler } from "@/common/utils/enterToSubmit";

type ModalContextValue = {
  openModal: (content: React.ReactNode, wide?: boolean) => void;
  closeModal: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

type ModalProviderProps = { children: React.ReactNode };

export function ModalProvider({ children }: ModalProviderProps) {
  const [content, setContent] = useState<React.ReactNode>(null);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(false);
  // Fresh key per open forces React to remount instead of reusing a same-type instance with stale props.
  const keySeq = useRef(0);
  // A drag starting inside the modal but released over the backdrop fires a click there; must not close it.
  const pressStartedOnBackdrop = useRef(false);

  const openModal = useCallback((node: React.ReactNode, isWide = false) => {
    keySeq.current += 1;
    setContent(isValidElement(node) ? cloneElement(node, { key: keySeq.current }) : node);
    setWide(isWide);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => setOpen(false), []);

  // Modals aren't real <form>s; this clicks each one's single non-ghost `.ft` button on Enter instead.
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
