"use client";

import { useEffect, useRef, useState } from "react";
import {
  triggerDesktopRelease,
  listDesktopReleaseJobs,
  cancelDesktopReleaseJob,
  SuperAdminApiError,
} from "@/modules/superadmin/services/superadminService";
import type { DesktopReleaseJob } from "@/modules/superadmin/types/superadmin-types";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";

// Only Windows ships today — keep in step with package-win.cjs / release.yml.
const SUPPORTED_TARGETS = [{ value: "win", label: "Windows" }];

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

type DesktopReleaseModalProps = {
  /* Present = single tenant; absent = every tenant ("content update" only offered then). */
  tenant?: { code: string; name: string };
  onClose: () => void;
  onDone?: () => void;
};

export function DesktopReleaseModal({ tenant, onClose, onDone }: DesktopReleaseModalProps) {
  const [version, setVersion] = useState("");
  const [buildType, setBuildType] = useState<"full" | "content">("full");
  const [targets, setTargets] = useState<string[]>(["win"]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [started, setStarted] = useState(false);
  const [jobs, setJobs] = useState<DesktopReleaseJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // "Content update" is shared by every tenant, so it's only offered when no single tenant is scoped.
  const canOfferContent = !tenant;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function toggleTarget(value: string) {
    setTargets((cur) => (cur.includes(value) ? cur.filter((t) => t !== value) : [...cur, value]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!version.trim()) {
      setError("Enter a version number.");
      return;
    }
    if (targets.length === 0) {
      setError("Pick at least one OS to build for.");
      return;
    }
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
      pollRef.current = setInterval(async () => {
        try {
          const refreshed = await listDesktopReleaseJobs(ids);
          setJobs(refreshed);
          if (refreshed.every((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled")) {
            if (pollRef.current) clearInterval(pollRef.current);
            onDone?.();
          }
        } catch {
          /* a transient poll failure isn't worth surfacing; the next tick retries */
        }
      }, 4000);
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not start the build.");
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
  const showingProgress = started;

  return (
    <div className="sa-modal-backdrop" role="dialog" aria-modal="true">
      <div className="sa-modal">
        <h2>{title}</h2>

        {!showingProgress && (
          <form onSubmit={submit}>
            <div className="sa-field">
              <label>New version</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.4.0"
                required
              />
              <span className="sa-hint">Must be higher than the current live version — checked on submit.</span>
            </div>

            <div className="sa-field">
              <label>Update type</label>
              <label className="sa-radio">
                <input
                  type="radio"
                  checked={buildType === "full"}
                  onChange={() => setBuildType("full")}
                />
                Full rebuild — native code changed
              </label>
              {canOfferContent && (
                <label className="sa-radio">
                  <input
                    type="radio"
                    checked={buildType === "content"}
                    onChange={() => setBuildType("content")}
                  />
                  Content update — fast, no reinstall
                </label>
              )}
            </div>

            {buildType === "full" && (
              <div className="sa-field">
                <label>Build for</label>
                {SUPPORTED_TARGETS.map((t) => (
                  <label key={t.value} className="sa-checkbox">
                    <input
                      type="checkbox"
                      checked={targets.includes(t.value)}
                      onChange={() => toggleTarget(t.value)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            )}

            <ReasonField value={reason} onChange={setReason} required={false} />
            {error && <p className="sa-error" role="alert">{error}</p>}

            <div className="sa-modal-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" disabled={submitting}>
                {submitting ? "Starting…" : "Confirm & start"}
              </button>
            </div>
          </form>
        )}

        {showingProgress && (
          <div className="sa-release-progress">
            {buildType === "content" ? (
              <p>Progress — content update</p>
            ) : (
              <p>Progress{tenant ? ` — ${tenant.name}` : " — all tenants"}</p>
            )}
            <ul>
              {jobs.map((job) => (
                <li key={job.id}>
                  <span>
                    {buildType === "content" ? "" : `${job.tenantCode} (${job.os}): `}
                    {STATUS_LABEL[job.status]}
                  </span>
                  {job.status !== "done" && job.status !== "failed" && job.status !== "cancelled" ? (
                    <button type="button" onClick={() => cancelJob(job.id)}>
                      Cancel
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="sa-modal-actions">
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
