import { useState, type FormEvent, type ReactNode } from "react";

/* The create / edit business wizard's frame, shared by every product console.
 *
 * One modal for creating AND editing: the header (title and numbered steps)
 * and the footer (Cancel · Back · Next / Save) are pinned and only the step
 * body scrolls, so the actions are always reachable. In create mode a step not
 * reached yet is disabled: jumping past a required field would only fail
 * validation later. A product supplies its steps, what each one shows and
 * checks, and what saving does; the ERP's own "Customer & plan" step (create
 * only) is the same for every product. */

export type WizardStepDef<Id extends string = string> = { id: Id; label: string };

/* The ERP's own first step on CREATE: which ERP customer the business belongs
 * to and which ERP plan bills it. After the product has created the business,
 * onCreated links it in the ERP. When the chosen ERP plan maps to a product
 * tier / package, tierId locks that field. */
export type ErpWizardStep = {
  label: string;
  content: ReactNode;
  problem: () => string | null;
  review?: ReactNode;
  tierId?: number | null;
  onCreated: (created: { id: number; code: string; name: string }) => Promise<void>;
};

/** The step list with the ERP step first on create. */
export function withErpStep<Id extends string>(steps: WizardStepDef<Id>[], isCreate: boolean, erpStep?: ErpWizardStep): WizardStepDef<Id | "erp">[] {
  return isCreate && erpStep ? [{ id: "erp", label: erpStep.label }, ...steps] : steps;
}

/** Step position, the steps already reached, and the step's error. */
export function useWizardSteps<Id extends string>(steps: WizardStepDef<Id>[], openAt: string) {
  const [stepIdx, setStepIdx] = useState(() => {
    const i = steps.findIndex((s) => s.id === openAt);
    return i >= 0 ? i : 0;
  });
  // Which steps the operator has reached. In create mode this gates jumping
  // ahead; in edit mode every step is reachable, because nothing is required.
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0, stepIdx]));
  const [error, setError] = useState<string | null>(null);
  function goTo(i: number) {
    setStepIdx(i);
    setSeen((s) => new Set(s).add(i));
    setError(null);
  }
  /* Checks every step in order and opens the first with a problem; true when
   * the whole wizard is complete. */
  function checkAll(problemWith: (id: Id) => string | null): boolean {
    for (const s of steps) {
      const problem = problemWith(s.id);
      if (problem) {
        goTo(steps.indexOf(s));
        setError(problem);
        return false;
      }
    }
    return true;
  }
  /* Next: validation runs per step, so a missing field is caught on the step
   * that asked for it instead of on Review. */
  function next(problemWith: (id: Id) => string | null) {
    const problem = problemWith(steps[stepIdx].id);
    if (problem) {
      setError(problem);
      return;
    }
    goTo(stepIdx + 1);
  }
  return { step: steps[stepIdx], stepIdx, seen, goTo, next, checkAll, error, setError, isLast: stepIdx === steps.length - 1 };
}

type WizardFrameProps = {
  title: string;
  steps: WizardStepDef[];
  stepIdx: number;
  seen: Set<number>;
  isCreate: boolean;
  onGoTo: (i: number) => void;
  onClose: () => void;
  onNext: () => void;
  onSubmit: () => void;
  /** The Branding step lays out its own two scrolling panes edge to edge. */
  edgeToEdge?: boolean;
  error: string | null;
  submitting: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  /** While saving: no closing by clicking outside, and Cancel / Back are disabled (products that ask for it). */
  holdCloseWhileSaving?: boolean;
  children: ReactNode;
};

export function WizardFrame({
  title,
  steps,
  stepIdx,
  seen,
  isCreate,
  onGoTo,
  onClose,
  onNext,
  onSubmit,
  edgeToEdge,
  error,
  submitting,
  submitDisabled,
  submitLabel,
  holdCloseWhileSaving,
  children,
}: WizardFrameProps) {
  const isLast = stepIdx === steps.length - 1;
  return (
    <div className="sa-modal-backdrop" onClick={() => !(holdCloseWhileSaving && submitting) && onClose()}>
      <form
        className="sa-modal wide"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="sa-modal-head">
          <h2>{title}</h2>
          <div className="sa-steps">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                disabled={isCreate && !seen.has(i)}
                className={`sa-step${i === stepIdx ? " active" : ""}${i < stepIdx ? " done" : ""}`}
                onClick={() => onGoTo(i)}
              >
                <span className="sa-step-n">{i + 1}</span>
                <span className="sa-step-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`sa-modal-body${edgeToEdge ? " bs-host" : ""}`}>
          {children}
          {/* The body scrolls, so an error rendered down here can sit below
            * the fold — scroll it into view the moment it appears. */}
          {error && <p className="sa-error" ref={(el) => el?.scrollIntoView({ block: "nearest" })}>{error}</p>}
        </div>

        <div className="sa-modal-foot">
          <span className="sa-foot-step">
            Step {stepIdx + 1} of {steps.length}
          </span>
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose} disabled={holdCloseWhileSaving && submitting}>
            Cancel
          </button>
          {stepIdx > 0 && (
            <button type="button" className="sa-btn" onClick={() => onGoTo(stepIdx - 1)} disabled={holdCloseWhileSaving && submitting}>
              Back
            </button>
          )}
          {!isLast && (
            <button type="button" className="sa-btn primary" onClick={onNext}>
              Next
            </button>
          )}
          {isLast && (
            <button type="submit" className="sa-btn primary" disabled={submitting || submitDisabled}>
              {submitting ? "Saving…" : submitLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
