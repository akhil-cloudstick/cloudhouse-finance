import type { KeyboardEvent } from "react";

/* Shared "Enter submits the form" behavior for pages/cards that aren't
 * wrapped in an actual <form> (this codebase posts via onClick handlers on
 * a footer button instead) — see common/components/ModalProvider.tsx's own
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
    // A plain BUTTON/A/SELECT already activates on Enter natively — EXCEPT
    // a button explicitly opted in as an Enter-flow waypoint via
    // `data-enter-waypoint` (e.g. Select.tsx's own trigger button, a
    // themed dropdown, not a native <select>): landing there via Enter is
    // meant to let the user then Arrow/Enter through ITS OWN options, not
    // just fall straight through — so this one Enter needs to move on to
    // the NEXT field instead of clicking/re-opening it. Deliberately a
    // separate marker from `tabindex` (which the focusable-list search
    // just below also keys off, to make the field reachable at all) — a
    // button can need to be reachable without ALSO wanting this pass-
    // through treatment: NewLoan.tsx's "+ Add Ornament" sets `tabindex`
    // only while there are zero ornaments (so it's reachable to create the
    // very first one) but must NOT get this treatment, since clicking it
    // (not passing through) is the entire point — it has no self-managed
    // "done" state the way an opened dropdown does, so pass-through
    // treatment there just re-triggers it forever without ever actually
    // clicking (see that component's own comment on this button).
    const isWaypointButton = target.tagName === "BUTTON" && target.hasAttribute("data-enter-waypoint");
    if ((target.tagName === "BUTTON" && !isWaypointButton) || target.tagName === "A" || target.tagName === "SELECT") return;
    const container = e.currentTarget;
    // Textarea: Shift+Enter still inserts a real newline (native default,
    // left alone below); plain Enter submits instead — same "Enter
    // submits, Shift+Enter for a newline" convention chat/comment boxes
    // already use elsewhere, rather than every Enter here always adding a
    // newline regardless of intent.
    if (target.tagName === "TEXTAREA") {
      if (e.shiftKey) return;
      const primary = container.querySelector<HTMLButtonElement>(primarySelector);
      if (!primary) return;
      e.preventDefault();
      primary.click();
      return;
    }
    // Plain text/number/date inputs (and opted-in waypoint buttons, see
    // above): Enter moves to the next field instead of submitting/
    // activating, mirroring what Tab already does — only the last field
    // in the container falls through to clicking the primary button below.
    // Shift+Enter is the reverse: back to the previous field (mirroring
    // Shift+Tab), for every plain input — textarea already claims
    // Shift+Enter for its own newline above, so this never reaches one.
    if (target.tagName === "INPUT" || isWaypointButton) {
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      const idx = focusable.indexOf(target);
      if (e.shiftKey) {
        const prev = idx > 0 ? focusable[idx - 1] : null;
        if (prev) {
          e.preventDefault();
          prev.focus();
          if (prev instanceof HTMLInputElement) prev.select();
        }
        return;
      }
      const next = focusable[idx + 1];
      if (next) {
        e.preventDefault();
        next.focus();
        if (next instanceof HTMLInputElement) next.select();
        return;
      }
    }
    const primary = container.querySelector<HTMLButtonElement>(primarySelector);
    if (!primary) return;
    e.preventDefault();
    primary.click();
  };
}
