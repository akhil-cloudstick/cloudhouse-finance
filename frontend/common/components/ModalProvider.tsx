"use client";

import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { makeEnterToSubmitHandler } from "@/common/utils/enterToSubmit";

type ModalContextValue = {
	openModal: (content: React.ReactNode, wide?: boolean) => void;
	// Opens a modal on top of the current one: closing it brings the current one back.
	openChildModal: (content: React.ReactNode, wide?: boolean) => void;
	// Closes the modal, or, for a child modal, returns to the one that opened it.
	closeModal: () => void;
	// Closes every modal, parents included (after a change is saved, so nothing stale is shown again).
	closeAllModals: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

// Length of the close animation (app.css `.modal-bg.closing`) — keep the two in step.
const CLOSE_MS = 200;

type ModalProviderProps = { children: React.ReactNode };

// Keys that scroll a page, and how far (a fraction of the visible height, or a line).
const SCROLL_KEYS: Record<string, { lines?: number; pages?: number; to?: "start" | "end" }> = {
	ArrowDown: { lines: 1 }, ArrowUp: { lines: -1 },
	PageDown: { pages: 1 }, PageUp: { pages: -1 },
	Home: { to: "start" }, End: { to: "end" },
};

// The element of the open modal that actually scrolls: the body, else the box itself.
function modalScroller(): HTMLElement | null {
	const box = document.getElementById("modalBox");
	if (!box) return null;
	const candidates = [...box.querySelectorAll<HTMLElement>(".bd-scroll, .bd"), box];
	return candidates.find((el) => el.scrollHeight > el.clientHeight + 1) ?? null;
}

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

	// The modals a child modal was opened over, nearest last.
	const stack = useRef<{ content: React.ReactNode; wide: boolean }[]>([]);
	const current = useRef<{ content: React.ReactNode; wide: boolean }>({ content: null, wide: false });

  // A closing modal fades/slides out for CLOSE_MS before it is actually removed (or swapped for the modal
  // beneath it) instead of vanishing the instant it is dismissed.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setClosing(false);
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

	const show = useCallback((node: React.ReactNode, isWide: boolean) => {
    // A modal opened while another is mid-fade (close, then straight away open) must not be closed by the pending timer.
    cancelClose();
		keySeq.current += 1;
		const keyed = isValidElement(node) ? cloneElement(node, { key: keySeq.current }) : node;
		current.current = { content: keyed, wide: isWide };
		setContent(keyed);
		setWide(isWide);
		setOpen(true);
	}, [cancelClose]);

	const openModal = useCallback((node: React.ReactNode, isWide = false) => {
		stack.current = [];
		show(node, isWide);
	}, [show]);

	const openChildModal = useCallback((node: React.ReactNode, isWide = false) => {
		stack.current.push(current.current);
		show(node, isWide);
	}, [show]);

	const closeModal = useCallback(() => {
    if (closeTimer.current) return; // already fading out
		const parent = stack.current.pop();
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
  		if (parent) {
  			current.current = parent;
  			setContent(parent.content);
  			setWide(parent.wide);
  			return;
  		}
  		setOpen(false);
    }, CLOSE_MS);
	}, []);

	const closeAllModals = useCallback(() => {
		stack.current = [];
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
  		setOpen(false);
    }, CLOSE_MS);
	}, []);

	// Enter submits the modal from any plain field, the same way it would in
	// a real <form> — none of these modals are actually wrapped in one (they
	// post via onClick handlers on their own footer buttons), so without
	// this Enter did nothing at all. Generic rather than per-modal: every
	// modal here already ends its `.ft` footer with exactly one non-ghost
	// primary action button (Save/Publish/Confirm/Record Payment/…), so
	// finding and clicking that is enough to cover all of them without each
	// one wiring up its own key handler. See enterToSubmit.ts for the same
	// pattern used OUTSIDE a modal (full-page forms, per-card forms, …).
	// While a modal is open the arrow / page keys scroll the modal's own body
	// rather than the page behind it. Keys meant for a field (typing, a number
	// spinner, a dropdown, a calendar) are left alone.
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			const move = SCROLL_KEYS[e.key];
			if (!move || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
			const t = e.target as HTMLElement | null;
			if (t?.closest("input, textarea, select, [contenteditable='true'], [role='listbox'], [role='menu'], [role='grid'], .dp-pop")) return;
			const el = modalScroller();
			if (!el) { e.preventDefault(); return; }
			e.preventDefault();
			if (move.to) el.scrollTo({ top: move.to === "start" ? 0 : el.scrollHeight });
			else el.scrollBy({ top: move.lines ? move.lines * 48 : (move.pages ?? 0) * el.clientHeight * 0.9 });
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	const onModalKeyDown = useMemo(() => makeEnterToSubmitHandler(".ft button.btn:not(.ghost):not(.plain):not(:disabled)"), []);

	return (
		<ModalContext.Provider value={{ openModal, openChildModal, closeModal, closeAllModals }}>
			{children}
			<div
				id="modalBg"
				className={`modal-bg${open ? " open" : ""}${closing ? " closing" : ""}`}
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
