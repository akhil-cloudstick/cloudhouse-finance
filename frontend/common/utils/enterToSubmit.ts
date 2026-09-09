import type { KeyboardEvent } from "react";

/* Shared "Enter submits the form" behavior for pages/cards that aren't
 * wrapped in an actual <form> (this codebase posts via onClick handlers on
 * a footer button instead) — see common/components/Modal.tsx's own
 * onModalKeyDown, which this mirrors for use OUTSIDE a modal. Attach the
 * returned handler to onKeyDown on the container that holds both the
 * field(s) and the one primary action button; `primarySelector` finds
 * that button relative to the container Enter was pressed inside (never
 * document-wide, so two such containers on the same page — e.g. Settings'
 * per-card Save buttons — never cross-trigger each other).
 *
 * Clicking the real button (not calling its handler directly) means Enter
 * gets exactly the same validation/disabled-state behavior a manual click
 * would — an unfilled required field still shows its usual warning instead
 * of silently doing nothing.
 *
 * Deliberately does NOT special-case an open SearchableSelect dropdown: an
 * earlier version skipped Enter whenever one was open, but SearchableSelect
 * reopens its own dropdown on plain focus (see that component's onFocus) —
 * for a modal whose only/primary field IS a SearchableSelect (e.g. the Bank
 * Re-Pledge loan picker), that made Enter do nothing at all, the moment the
 * field had focus, whether or not anything had been picked yet. Submitting
 * with whatever's currently selected (or showing the usual "please pick
 * one first" warning if nothing is) is the correct behavior either way. */
export function makeEnterToSubmitHandler(primarySelector: string) {
  return function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    // Textareas need Enter for real newlines; buttons/links/selects
    // already activate on Enter natively.
    if (target.tagName === "TEXTAREA" || target.tagName === "BUTTON" || target.tagName === "A" || target.tagName === "SELECT") return;
    const container = e.currentTarget;
    const primary = container.querySelector<HTMLButtonElement>(primarySelector);
    if (!primary) return;
    e.preventDefault();
    primary.click();
  };
}
