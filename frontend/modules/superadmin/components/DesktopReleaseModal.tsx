"use client";

import { useEffect, useRef, useState } from "react";
import {
  triggerDesktopRelease,
  listDesktopReleaseJobs,
  cancelDesktopReleaseJob,
  getCurrentDesktopVersion,
  SuperAdminApiError,
} from "@/modules/superadmin/services/superadminService";
import type { DesktopReleaseJob } from "@/modules/superadmin/types/superadmin-types";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";

// Keep in step with package-win.cjs/package-mac.cjs/package-linux.cjs and release.yml's job matrix.
const SUPPORTED_TARGETS = [
  { value: "win", label: "Windows" },
  { value: "mac", label: "macOS" },
  { value: "linux", label: "Linux" },
];

const STATUS_LABEL: Record<DesktopReleaseJob["status"], string> = {
  queued: "Queued…",
  preparing: "Preparing…",
  building: "Building…",
  uploading: "Uploading…",
  verifying: "Verifying…",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_CHIP: Record<DesktopReleaseJob["status"], string> = {
  queued: "trial",
  preparing: "trial",
  building: "trial",
  uploading: "trial",
  verifying: "trial",
  done: "active",
  failed: "suspended",
  cancelled: "off",
};

function isTerminal(status: DesktopReleaseJob["status"]) {
  return status === "done" || status === "failed" || status === "cancelled";
}

function isHigherVersion(a: string, b: string): boolean {
  const parts = (v: string) => v.trim().replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parts(a);
  const [b1, b2, b3] = parts(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

type DesktopReleaseModalProps = {
  /* Present = single tenant; absent = every tenant ("content update" only offered then). */
  tenant?: { code: string; name: string };
  onClose: () => void;
  onDone?: () => void;
};

// Persisted so closing the modal (or reopening "Rebuild all") while a batch is still
// running resumes its progress instead of offering a fresh form — you can't start a
// second rebuild for the same scope until the first finishes or fails.
function storageKey(tenant?: { code: string }): string {
  return `desktop-release-active:${tenant ? tenant.code : "all"}`;
}

export function DesktopReleaseModal({ tenant, onClose, onDone }: DesktopReleaseModalProps) {
  const [version, setVersion] = useState("");
  const [buildType, setBuildType] = useState<"full" | "content">("full");
  const [targets, setTargets] = useState<string[]>(["win"]);
  const [reason, setReason] = useState("");
  const [versionError, setVersionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [started, setStarted] = useState(false);
  const [jobs, setJobs] = useState<DesktopReleaseJob[]>([]);
  // Only well-defined for a single tenant — "all tenants" can each be on a different version.
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // "Content update" is shared by every tenant, so it's only offered when no single tenant is scoped.
  const canOfferContent = !tenant;

  function pollJobs(ids: number[]) {
    pollRef.current = setInterval(async () => {
      try {
        const refreshed = await listDesktopReleaseJobs(ids);
        setJobs(refreshed);
        if (refreshed.every((j) => isTerminal(j.status))) {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(storageKey(tenant));
          onDone?.();
        }
      } catch {
        /* a transient poll failure isn't worth surfacing; the next tick retries */
      }
    }, 4000);
  }

  // Resume an already-running batch for this scope instead of showing the form again.
  useEffect(() => {
    const raw = localStorage.getItem(storageKey(tenant));
    if (!raw) return;
    let ids: number[];
    try {
      ids = JSON.parse(raw);
    } catch {
      localStorage.removeItem(storageKey(tenant));
      return;
    }
    listDesktopReleaseJobs(ids).then(
      (refreshed) => {
        if (refreshed.length === 0 || refreshed.every((j) => isTerminal(j.status))) {
          localStorage.removeItem(storageKey(tenant));
          return;
        }
        setJobs(refreshed);
        setStarted(true);
        pollJobs(ids);
      },
      () => localStorage.removeItem(storageKey(tenant)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!tenant) return;
    let live = true;
    getCurrentDesktopVersion(tenant.code, "full").then(
      (res) => { if (live) setCurrentVersion(res.version); },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [tenant]);

  function toggleTarget(value: string) {
    setTargets((cur) => (cur.includes(value) ? cur.filter((t) => t !== value) : [...cur, value]));
  }

  const canSubmit = version.trim() !== "" && (buildType !== "full" || targets.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setVersionError(null);
    setSubmitting(true);
    try {
      const res = await triggerDesktopRelease({
        tenantCode: tenant ? tenant.code : "all",
        version: version.trim(),
        buildType,
        targets,
        reason,
      });
      setStarted(true);
      setJobs(res.jobs);
      const ids = res.jobs.map((j) => j.id);
      localStorage.setItem(storageKey(tenant), JSON.stringify(ids));
      pollJobs(ids);
    } catch (err) {
      setVersionError(err instanceof SuperAdminApiError ? err.message : "Could not start the build.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob(id: number) {
    setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j)));
    try {
      await cancelDesktopReleaseJob(id);
    } catch {
      /* the next poll tick will reconcile the real state either way */
    }
  }

  const title = tenant ? `Rebuild — ${tenant.name}` : "Rebuild — all tenants";

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal wide" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>{title}</h2>
        </div>

        <div className="sa-modal-body">
          {!started ? (
            <>
              <div className={versionError ? "sa-field has-err" : "sa-field"}>
                <label>
                  New version
                  {tenant && <span className="sa-hint"> — current: {currentVersion ?? "none yet"}</span>}
                </label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => { setVersion(e.target.value); setVersionError(null); }}
                  placeholder={currentVersion ?? "1.4.0"}
                  autoFocus
                  required
                />
                {versionError ? (
                  <span className="sa-error" role="alert">{versionError}</span>
                ) : version.trim() && currentVersion && !isHigherVersion(version, currentVersion) ? (
                  <span className="sa-error" role="alert">Must be higher than {currentVersion}.</span>
                ) : (
                  <span className="sa-hint">Must be higher than the current live version.</span>
                )}
              </div>

              <div className="sa-field">
                <label>Update type</label>
                <div className="sa-seg" role="group" aria-label="Update type">
                  <button type="button" aria-pressed={buildType === "full"} onClick={() => setBuildType("full")}>
                    Full rebuild
                  </button>
                  {canOfferContent && (
                    <button
                      type="button"
                      aria-pressed={buildType === "content"}
                      onClick={() => setBuildType("content")}
                    >
                      Content update
                    </button>
                  )}
                </div>
                <span className="sa-hint">
                  {buildType === "full"
                    ? "Native code changed — produces a real installer, per OS checked below."
                    : "Fast, shared package — every tenant's app updates in place, no reinstall."}
                </span>
              </div>

              {buildType === "full" && (
                <div className="sa-field">
                  <label>Build for</label>
                  <div className="sa-toggle-group" role="group" aria-label="Build for">
                    {SUPPORTED_TARGETS.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        aria-pressed={targets.includes(t.value)}
                        onClick={() => toggleTarget(t.value)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <span className="sa-hint">
                    {targets.length === 0 ? "Pick at least one — required to start." : ""}
                  </span>
                </div>
              )}

              <ReasonField value={reason} onChange={setReason} required={false} />
            </>
          ) : (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead>
                  <tr>
                    {buildType === "full" && <th>Tenant</th>}
                    {buildType === "full" && <th>OS</th>}
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      {buildType === "full" && <td>{job.tenantCode}</td>}
                      {buildType === "full" && <td>{job.os}</td>}
                      <td>
                        {!isTerminal(job.status) && <span className="sa-spin" aria-hidden="true" />}
                        <span className={`sa-chip ${STATUS_CHIP[job.status]}`}>{STATUS_LABEL[job.status]}</span>
                      </td>
                      <td>
                        {!isTerminal(job.status) && (
                          <button type="button" className="sa-btn danger" onClick={() => cancelJob(job.id)}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          {!started ? (
            <>
              <button type="button" className="sa-btn" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="sa-btn primary" disabled={submitting || !canSubmit}>
                {submitting ? "Starting…" : "Confirm & start"}
              </button>
            </>
          ) : (
            <button type="button" className="sa-btn" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
