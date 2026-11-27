"use client";

import { useEffect, useState } from "react";
import {
  triggerDesktopRelease,
  listDesktopReleaseJobs,
  cancelDesktopReleaseJob,
  getCurrentDesktopVersion,
  listBusinesses,
} from "@/modules/superadmin/services/superadminService";
import type { DesktopReleaseJob } from "@/modules/superadmin/types/superadmin-types";
import { RebuildModal } from "@/modules/superadmin/kit/components/RebuildModal";
import type { BuildCard, BuildState } from "@/modules/superadmin/kit/components/BuildProgress";
import { BuildForField, VersionField, versionReady } from "@/modules/superadmin/kit/components/BuildFields";
import { compareVersions, nextVersion, toDesktopOs, type DesktopOs } from "@/modules/superadmin/kit/common/desktopOs";

/* Gold Finance's Rebuild, in the shared window: Build for, Version (the next
 * one, raise only), Full rebuild or Content update, then the progress cards. */

// Keep in step with package-win.cjs/package-mac.cjs/package-linux.cjs and release.yml's job matrix.
const GOLD_SYSTEMS: DesktopOs[] = ["win", "mac", "linux"];

const STAGE: Partial<Record<DesktopReleaseJob["status"], number>> = { queued: 0, preparing: 1, building: 2, uploading: 3, verifying: 4, done: 5 };

function stateOf(status: DesktopReleaseJob["status"]): BuildState {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "run";
}

/** Gold build jobs as the shared progress cards: one job is one system. */
function toCards(jobs: DesktopReleaseJob[]): BuildCard[] {
  return jobs.map((j) => {
    const state = stateOf(j.status);
    return {
      key: String(j.id),
      jobId: j.id,
      os: j.buildType === "content" ? "content" : toDesktopOs(j.os),
      business: j.buildType === "content" ? "every business" : j.tenantCode,
      version: j.version,
      state,
      stage: STAGE[j.status],
      startedAt: j.createdAt,
      endedAt: state === "run" ? undefined : j.updatedAt,
      logUrl: j.runUrl || undefined,
      downloadUrl: j.downloadUrl || undefined,
    };
  });
}

type DesktopReleaseModalProps = {
  /* Present = one business; absent = every business ("Content update" only offered then). */
  tenant?: { code: string; name: string };
  onClose: () => void;
  onDone?: () => void;
};

// Persisted so closing the window (or reopening "Rebuild all") while builds run resumes their progress.
function storageKey(tenant?: { code: string }): string {
  return `desktop-release-active:${tenant ? tenant.code : "all"}`;
}

export function DesktopReleaseModal({ tenant, onClose, onDone }: DesktopReleaseModalProps) {
  const [buildType, setBuildType] = useState<"full" | "content">("full");
  const [targets, setTargets] = useState<DesktopOs[]>(["win"]);
  // The live version as read for one scope (business + update type); null when nothing is built yet.
  const scope = `${tenant ? tenant.code : "all"}:${buildType}`;
  const [loaded, setLoaded] = useState<{ scope: string; current: string | null } | null>(null);
  // undefined while the version for this scope is still being read.
  const current = loaded && loaded.scope === scope ? loaded.current : undefined;
  const [version, setVersion] = useState("");

  // The live version from the release storage — this business's (one business), the highest across every
  // business (rebuild all: one version for all), or the shared content package's (content update).
  useEffect(() => {
    let live = true;
    const load = async (): Promise<string | null> => {
      if (buildType === "content") return (await getCurrentDesktopVersion("common", "content")).version;
      if (tenant) return (await getCurrentDesktopVersion(tenant.code, "full")).version;
      const all = await listBusinesses();
      const versions = await Promise.all(all.map((b) => getCurrentDesktopVersion(b.code, "full").then((r) => r.version, () => null)));
      return versions.filter((v): v is string => !!v).reduce<string | null>((max, v) => (!max || compareVersions(v, max) > 0 ? v : max), null);
    };
    load().then(
      (v) => {
        if (!live) return;
        setLoaded({ scope, current: v });
        setVersion(nextVersion(v));
      },
      () => {
        if (!live) return;
        setLoaded({ scope, current: null });
        setVersion(nextVersion(null));
      },
    );
    return () => {
      live = false;
    };
  }, [tenant, buildType, scope]);

  const canStart = versionReady(version, current) && (buildType !== "full" || targets.length > 0);

  return (
    <RebuildModal<DesktopReleaseJob>
      title={tenant ? `Rebuild — ${tenant.name}` : "Rebuild — all businesses"}
      canStart={canStart}
      start={async (reason) =>
        (await triggerDesktopRelease({ tenantCode: tenant ? tenant.code : "all", version, buildType, targets, reason })).jobs
      }
      poll={listDesktopReleaseJobs}
      cancel={async (job) => {
        await cancelDesktopReleaseJob(job.id);
        return { ...job, status: "cancelled", updatedAt: new Date().toISOString() };
      }}
      toCards={toCards}
      retry={async (card) =>
        (
          await triggerDesktopRelease({
            tenantCode: card.os === "content" ? "all" : card.business,
            version: card.version,
            buildType: card.os === "content" ? "content" : "full",
            targets: card.os === "content" ? [] : [card.os],
            reason: `Retry of a failed build`,
          })
        ).jobs
      }
      previousVersion={current}
      resumeKey={storageKey(tenant)}
      onClose={onClose}
      onDone={onDone}
    >
      {buildType === "full" && <BuildForField options={GOLD_SYSTEMS} value={targets} onChange={setTargets} />}

      <VersionField
        value={version}
        onChange={setVersion}
        current={current}
        note={!tenant && buildType === "full" ? "Every business gets this version (the highest live one is shown)." : undefined}
      />

      {!tenant && (
        <div className="sa-field">
          <label>Update type</label>
          <div className="sa-seg" role="group" aria-label="Update type">
            <button type="button" aria-pressed={buildType === "full"} onClick={() => setBuildType("full")}>
              Full rebuild
            </button>
            <button type="button" aria-pressed={buildType === "content"} onClick={() => setBuildType("content")}>
              Content update
            </button>
          </div>
          <span className="sa-hint">
            {buildType === "full"
              ? "A new installer for each system picked above."
              : "A fast shared update — every business's app updates in place, no reinstall."}
          </span>
        </div>
      )}
    </RebuildModal>
  );
}
