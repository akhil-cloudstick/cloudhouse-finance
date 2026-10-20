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

  if (!entries) return <p className="sa-empty">Loading…</p>;
  if (entries.length === 0) return <p className="sa-empty">No past builds yet.</p>;

  return (
    <div className="sa-table-wrap">
      <table className="sa-table sa-table-compact">
        <thead>
          <tr>
            <th>Version</th>
            <th>OS</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.os}-${e.version}`}>
              <td>{e.version}</td>
              <td>
                <span className="sa-chip tag">{e.os}</span>
              </td>
              <td className="sa-actions">
                <a className="sa-btn" href={e.downloadUrl} download>
                  Download
                </a>
                <button type="button" className="sa-btn" onClick={() => copyLink(e.downloadUrl)}>
                  {copied === e.downloadUrl ? "Copied" : "Copy link"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
