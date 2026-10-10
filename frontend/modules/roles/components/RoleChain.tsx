"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChainRole } from "@/common/types/approval-workflow-types";

/* One approval chain, edited in place, drawn as a simple stepper:
 * numbered steps joined by a line, ending in what the last approver does.
 *   - "Add approver" opens a list of roles; picking one appends it and
 *     closes the list (picking a role already in the chain removes it).
 *     With maxSteps 1 it picks the single decider instead.
 *   - Steps reorder by dragging (pointer events — mouse and touch) or with
 *     Alt+←/→ on a focused step; × or Delete removes one.
 * Purely controlled — the parent owns `steps` and saves them. */

type Props = {
  steps: ChainRole[];
  roles: ChainRole[];
  onChange: (steps: ChainRole[]) => void;
  readOnly?: boolean;
  finalAction: string;
  offBehavior: string;
  minEnabled: number;
  maxSteps: number;
};

function move<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const GripIcon = () => (
  <svg viewBox="0 0 10 16" width="7" height="12" aria-hidden="true">
    {[3, 8, 13].map((y) => [2.5, 7.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
    <path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PICKER_W = 240;

export function RoleChain({ steps, roles, onChange, readOnly, finalAction, offBehavior, minEnabled, maxSteps }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // The list is position:fixed (placed from the button's rect) so the
  // scrolling panel around it can never clip it.
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Drag state: the dragged step's original index and where it would land;
  // every slot's centre is measured when the drag begins so the live
  // reorder doesn't move the targets out from under the pointer.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const centres = useRef<{ x: number; y: number }[]>([]);
  // Smooth motion (FLIP): each link's on-screen box is recorded just before
  // the order changes, and after the re-render every link that moved is
  // slid from its old box to its new one. The dragged badge instead follows
  // the pointer exactly (see applyDrag).
  const linkEls = useRef(new Map<number | string, HTMLElement>());
  const stepEls = useRef(new Map<number, HTMLDivElement>());
  const before = useRef<Map<number | string, DOMRect> | null>(null);
  const grab = useRef<{ roleId: number; px: number; py: number; x0: number; y0: number; l0: number; t0: number } | null>(null);

  function snapshot() {
    const m = new Map<number | string, DOMRect>();
    linkEls.current.forEach((el, k) => m.set(k, el.getBoundingClientRect()));
    before.current = m;
  }

  // Order changes from outside a drag (keyboard, add, remove) animate too.
  function change(next: ChainRole[]) {
    snapshot();
    onChange(next);
  }

  // Keeps the dragged badge under the pointer: its offset from where the
  // drag began, minus however far its slot has since moved in the layout.
  function applyDrag() {
    const g = grab.current;
    const el = g && stepEls.current.get(g.roleId);
    if (!g || !el) return;
    const dx = g.px - g.x0 - (el.offsetLeft - g.l0);
    const dy = g.py - g.y0 - (el.offsetTop - g.t0);
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
  }

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (prev) {
      linkEls.current.forEach((el, k) => {
        if (grab.current && k === grab.current.roleId) return;
        const was = prev.get(k);
        if (!was) return;
        const now = el.getBoundingClientRect();
        const dx = was.left - now.left;
        const dy = was.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetWidth; // commit the start position before animating
        el.style.transition = "transform .24s cubic-bezier(.2, .8, .2, 1)";
        el.style.transform = "";
      });
    }
    applyDrag();
  });

  useLayoutEffect(() => {
    if (!pickerOpen || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 300 && r.top > 300;
    const left = Math.max(16, Math.min(r.right - PICKER_W, window.innerWidth - PICKER_W - 16));
    setPickerPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = () => setPickerOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pickerRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    // Any scroll outside the list itself would leave it floating off its button.
    const onScroll = (e: Event) => { if (!pickerRef.current?.contains(e.target as Node)) close(); };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [pickerOpen]);

  const shown = drag ? move(steps, drag.from, drag.to) : steps;
  const single = maxSteps === 1;
  const full = maxSteps > 0 && steps.length >= maxSteps;
  const tooFew = steps.length < minEnabled;
  const canDrag = !readOnly && steps.length > 1;

  function startDrag(e: React.PointerEvent, index: number) {
    if (!canDrag || e.button !== 0) return;
    const el = e.currentTarget as HTMLDivElement;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    centres.current = steps.map((s) => {
      const r = stepEls.current.get(s.roleId)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 };
    });
    el.style.transition = "none";
    grab.current = {
      roleId: steps[index].roleId, px: e.clientX, py: e.clientY,
      x0: e.clientX, y0: e.clientY, l0: el.offsetLeft, t0: el.offsetTop,
    };
    setDrag({ from: index, to: index });
  }

  function onDragMove(e: React.PointerEvent) {
    if (!drag || !grab.current) return;
    grab.current.px = e.clientX;
    grab.current.py = e.clientY;
    applyDrag();
    let best = drag.to;
    let bestDist = Infinity;
    centres.current.forEach((c, i) => {
      // Rows weigh more than columns so a wrapped chain picks the right line.
      const d = Math.hypot(e.clientX - c.x, (e.clientY - c.y) * 2);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== drag.to) {
      snapshot();
      setDrag({ ...drag, to: best });
    }
  }

  // Drop: the badge glides from under the pointer into its slot.
  function endDrag() {
    if (!drag) return;
    const id = grab.current?.roleId;
    const el = id === undefined ? undefined : stepEls.current.get(id);
    grab.current = null;
    if (el) {
      el.style.transition = "transform .22s cubic-bezier(.2, .8, .2, 1)";
      el.style.transform = "";
      el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
    }
    if (drag.from !== drag.to) onChange(move(steps, drag.from, drag.to));
    setDrag(null);
  }

  function onStepKey(e: React.KeyboardEvent, index: number) {
    if (readOnly) return;
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const to = index + (e.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= steps.length) return;
      e.preventDefault();
      const id = steps[index].roleId;
      change(move(steps, index, to));
      requestAnimationFrame(() => stepEls.current.get(id)?.focus());
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      change(steps.filter((_, i) => i !== index));
    }
  }

  function pick(r: ChainRole) {
    const inChain = steps.some((s) => s.roleId === r.roleId);
    if (inChain) change(steps.filter((s) => s.roleId !== r.roleId));
    else if (single) change([r]);
    else if (!full) change([...steps, r]);
    setPickerOpen(false);
  }

  return (
    <div className="wf-chain-row">
      <div className="wf-chain" onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {shown.length === 0 ? (
          <div className={`wf-empty${tooFew ? " bad" : ""}`}>
            {tooFew ? `Add at least ${minEnabled} approver — ${offBehavior}` : `No approval needed. ${offBehavior}`}
          </div>
        ) : (
          <>
            {shown.map((s, i) => {
              const dragging = !!drag && steps[drag.from]?.roleId === s.roleId;
              return (
                <div key={s.roleId} ref={(el) => { if (el) linkEls.current.set(s.roleId, el); else linkEls.current.delete(s.roleId); }} className="wf-link">
                  {i > 0 && <span className="wf-line" />}
                  <div
                    ref={(el) => {
                      if (el) stepEls.current.set(s.roleId, el);
                      else stepEls.current.delete(s.roleId);
                    }}
                    className={`wf-step${dragging ? " dragging" : ""}${s.active ? "" : " inactive"}${canDrag ? " movable" : ""}`}
                    tabIndex={readOnly ? -1 : 0}
                    title={s.active ? (canDrag ? "Drag to reorder" : s.name) : "Role inactive — will be skipped"}
                    onKeyDown={(e) => onStepKey(e, i)}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest(".wf-x")) return;
                      startDrag(e, steps.findIndex((x) => x.roleId === s.roleId));
                    }}
                    aria-label={`Step ${i + 1}: ${s.name}`}
                  >
                    {canDrag && <span className="wf-grip"><GripIcon /></span>}
                    <span className="wf-num">{i + 1}</span>
                    <span className="wf-name">{s.name}</span>
                    {!readOnly && (
                      <button
                        type="button"
                        className="wf-x"
                        aria-label={`Remove ${s.name}`}
                        onClick={() => change(steps.filter((x) => x.roleId !== s.roleId))}
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <span ref={(el) => { if (el) linkEls.current.set("end", el); else linkEls.current.delete("end"); }} className="wf-link">
              <span className="wf-line" />
              <span className="wf-end"><CheckIcon /> {finalAction}</span>
            </span>
          </>
        )}
      </div>

      {!readOnly && (
        <button
          ref={btnRef}
          type="button"
          className={`wf-add${pickerOpen ? " on" : ""}`}
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
        >
          {single ? (steps.length ? "Change role" : "Choose role") : "Add approver"}
        </button>
      )}

      {pickerOpen && pickerPos && (
        <div
          ref={pickerRef}
          className="wf-picker"
          role="listbox"
          style={{ top: pickerPos.top, left: pickerPos.left, width: PICKER_W, transform: pickerPos.up ? "translateY(-100%)" : undefined }}
        >
          {roles.length === 0 && <div className="wf-picker-empty">No active roles yet.</div>}
          {roles.map((r) => {
            const idx = steps.findIndex((s) => s.roleId === r.roleId);
            const inChain = idx >= 0;
            const disabled = !inChain && full && !single;
            return (
              <button
                key={r.roleId}
                type="button"
                role="option"
                aria-selected={inChain}
                className={`wf-option${inChain ? " sel" : ""}`}
                disabled={disabled}
                onClick={() => pick(r)}
              >
                <span className="wf-option-name">{r.name}</span>
                {inChain && <span className="wf-option-tag">{single ? <CheckIcon /> : `Step ${idx + 1}`}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
