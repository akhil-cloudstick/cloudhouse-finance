"use client";

import { useEffect, useState } from "react";
import { listDesktopReleaseHistory } from "@/modules/superadmin/services/superadminService";
import type { DesktopReleaseHistoryEntry } from "@/modules/superadmin/types/superadmin-types";

type DesktopReleaseHistoryProps = { tenantCode: string; refreshKey?: number };

// Plain "versions currently kept in B2" list — no status/progress column.
export function DesktopReleaseHistory({ tenantCode, refreshKey }: DesktopReleaseHistoryProps) {
  const [entries, setEntries] = useState<DesktopReleaseHistoryEntry[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDesktopReleaseHistory(tenantCode).then(
      (res) => { if (live) setEntries(res); },
      () => { if (live) setEntries([]); },
    );
    return () => {
      live = false;
    };
  }, [tenantCode, refreshKey]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      /* clipboard access denied — the link is still visible to copy by hand */
    }
  }

  if (!entries) return null;
  if (entries.length === 0) return <p className="sa-empty">No past builds yet.</p>;

  return (
    <ul className="sa-release-history">
      {entries.map((e) => (
        <li key={`${e.os}-${e.version}`}>
          <span>
            {e.version} <span className="sa-chip">{e.os}</span>
          </span>
          <span className="sa-release-history-actions">
            <a className="sa-btn" href={e.downloadUrl} download>
              Download
            </a>
            <button type="button" className="sa-btn" onClick={() => copyLink(e.downloadUrl)}>
              {copied === e.downloadUrl ? "Copied" : "Copy link"}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
