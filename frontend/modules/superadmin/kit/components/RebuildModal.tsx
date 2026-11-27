import { useEffect, useRef, useState, type ReactNode } from "react";
import { ReasonField } from "./ReasonField";
import { BuildProgress, type BuildCard } from "./BuildProgress";

/* "Rebuild" — the desktop app build, the same window in every console.
 *
 * First the form — Build for, Version, the product's own options, then the
 * reason — and then the started builds as progress cards (BuildProgress). A
 * product supplies how builds start, are followed, cancelled and retried, and
 * how its build jobs read as cards. With resumeKey set, closing the window while
 * builds run and opening it again picks the same builds up instead of a fresh form. */

export type RebuildJob = { id: number };

type RebuildModalProps<J extends RebuildJob> = {
  title: string;
  /** The form fields in order: BuildForField, VersionField, then the product's own options. */
  children: ReactNode;
  canStart: boolean;
  startLabel?: string | undefined;
  start: (reason: string) => Promise<J[]>;
  poll: (ids: number[]) => Promise<J[]>;
  /** Cancels one build job; returns its new state, or null when the next poll will show it. */
  cancel: (job: J) => Promise<J | null>;
  /** The product's build jobs as cards (a job may hold several systems). */
  toCards: (jobs: J[]) => BuildCard[];
  /** Starts a failed card again; the new jobs are followed too. Absent = no Retry. */
  retry?: ((card: BuildCard) => Promise<J[]>) | undefined;
  /** The version live before this build, for the "installed apps will update" note. */
  previousVersion?: string | null | undefined;
  /** A line under the title once builds have started. */
  subtitle?: ((jobs: J[]) => ReactNode) | undefined;
  pollMs?: number | undefined;
  resumeKey?: string | undefined;
  onClose: () => void;
  onDone?: (() => void) | undefined;
};

export function RebuildModal<J extends RebuildJob>({
  title,
  children,
  canStart,
  startLabel = "Start build",
  start,
  poll,
  cancel,
  toCards,
  retry,
  previousVersion,
  subtitle,
  pollMs = 4000,
  resumeKey,
  onClose,
  onDone,
}: RebuildModalProps<J>) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<J[] | null>(null);
  // Cards a retry has replaced: their job may still hold other systems' cards, so only the card hides.
  const [hidden, setHidden] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const idsRef = useRef<number[]>([]);
  const finished = (list: J[]) => toCards(list).every((c) => c.state !== "run");

  const store = {
    read: (): number[] | null => {
      if (!resumeKey) return null;
      try {
        return JSON.parse(localStorage.getItem(resumeKey) || "null");
      } catch {
        return null;
      }
    },
    write: (ids: number[]) => {
      try {
        if (resumeKey) localStorage.setItem(resumeKey, JSON.stringify(ids));
      } catch {
        /* storage blocked: the window simply cannot resume */
      }
    },
    clear: () => {
      try {
        if (resumeKey) localStorage.removeItem(resumeKey);
      } catch {
        /* ignore */
      }
    },
  };

  function follow(ids: number[]) {
    idsRef.current = ids;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const latest = await poll(idsRef.current);
        setJobs(latest);
        if (finished(latest)) {
          if (timer.current) clearInterval(timer.current);
          store.clear();
          onDone?.();
        }
      } catch {
        /* a missed poll is retried on the next tick */
      }
    }, pollMs);
  }

  // Resume builds still running for this scope.
  useEffect(() => {
    const ids = store.read();
    if (!ids || ids.length === 0) return;
    poll(ids).then(
      (latest) => {
        if (latest.length === 0 || finished(latest)) return store.clear();
        setJobs(latest);
        follow(ids);
      },
      () => store.clear(),
    );
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const started = await start(reason.trim());
      setJobs(started);
      const ids = started.map((j) => j.id);
      store.write(ids);
      if (!finished(started)) follow(ids);
      else onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the build.");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryCard(card: BuildCard) {
    if (!retry) return;
    setError(null);
    try {
      const next = await retry(card);
      setHidden((h) => [...h, card.key]);
      setJobs((cur) => [...(cur ?? []), ...next]);
      const ids = [...idsRef.current, ...next.map((j) => j.id)];
      store.write(ids);
      follow(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the retry.");
    }
  }

  async function cancelCard(card: BuildCard) {
    const job = (jobs ?? []).find((j) => j.id === card.jobId);
    if (!job) return;
    try {
      const updated = await cancel(job);
      if (updated) setJobs((cur) => (cur ?? []).map((j) => (j.id === job.id ? updated : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the build.");
    }
  }

  const cards = jobs ? toCards(jobs).filter((c) => !hidden.includes(c.key)) : [];

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form
        className="sa-modal wide"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="sa-modal-head">
          <h2>{title}</h2>
          {jobs && <p className="sa-rb-sub">{subtitle ? subtitle(jobs) : "You can close this window; the build keeps going."}</p>}
        </div>

        <div className="sa-modal-body">
          {jobs ? (
            <BuildProgress cards={cards} onCancel={(c) => void cancelCard(c)} onRetry={retry ? (c) => void retryCard(c) : undefined} previousVersion={previousVersion} error={error} />
          ) : (
            <>
              {children}
              <ReasonField value={reason} onChange={setReason} required={false} />
              {error && (
                <p className="sa-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          {!jobs ? (
            <>
              <button type="button" className="sa-btn" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="sa-btn primary" disabled={submitting || !canStart}>
                {submitting ? "Starting…" : startLabel}
              </button>
            </>
          ) : (
            <button type="button" className="sa-btn primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
