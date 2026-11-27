import { useState } from "react";
import { OS_ICON, OS_NAME, OS_ORDER, compareVersions, toDesktopOs, type DesktopOs } from "../common/desktopOs";
import "../styles/desktop.css";

/* A business's "Desktop app" card, the same in every console: the latest
 * installer per operating system with Download and Copy link; "View all
 * versions" opens one tab per system listing every version, newest first. */

export type DesktopVersion = {
  /** Any common name for the system: win / windows / mac / macos / darwin / linux. */
  os: string;
  version: string;
  url: string;
  releasedAt?: string | null | undefined;
  /** Size in bytes, when known. */
  size?: number | null | undefined;
};

type DesktopVersionsProps = {
  /** null while loading. */
  versions: DesktopVersion[] | null;
  error?: string | null | undefined;
};

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function meta(v: DesktopVersion) {
  return [formatDate(v.releasedAt), formatSize(v.size)].filter(Boolean).join(" · ");
}

export function DesktopVersions({ versions, error }: DesktopVersionsProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DesktopOs | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Every version per system, newest first.
  const bySystem = new Map<DesktopOs, DesktopVersion[]>();
  for (const v of versions ?? []) {
    const os = toDesktopOs(v.os);
    if (os === "content" || !v.url) continue;
    // A Mac download is always the installer disk image, never an updater .zip.
    if (os === "mac" && !/\.dmg(\?|$)/i.test(v.url)) continue;
    const list = bySystem.get(os) ?? [];
    if (!list.some((x) => x.version === v.version)) list.push(v);
    bySystem.set(os, list);
  }
  for (const list of bySystem.values()) list.sort((a, b) => compareVersions(b.version, a.version));
  const systems = OS_ORDER.filter((os) => bySystem.has(os));
  const total = systems.reduce((n, os) => n + (bySystem.get(os)?.length ?? 0), 0);
  const activeTab = tab && bySystem.has(tab) ? tab : systems[0];

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      /* clipboard blocked: the link can still be opened and copied by hand */
    }
  }

  const actions = (v: DesktopVersion, primary: boolean) => (
    <div className="sa-dv-actions">
      <a className={`sa-btn${primary ? " primary" : ""}`} href={v.url} target="_blank" rel="noopener noreferrer" download>
        Download
      </a>
      <button type="button" className="sa-btn" onClick={() => void copy(v.url)}>
        {copied === v.url ? "Copied" : "Copy link"}
      </button>
    </div>
  );

  return (
    <section className="sa-dv">
      <div className="sa-dv-head">
        <h3>Desktop app</h3>
        {total > systems.length && (
          <button type="button" className="sa-dv-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide versions" : `View all versions (${total})`}
          </button>
        )}
      </div>

      {error ? (
        <p className="sa-error">{error}</p>
      ) : versions === null ? (
        <p className="sa-dv-empty">Loading…</p>
      ) : systems.length === 0 ? (
        <p className="sa-dv-empty">No desktop app built yet. Use Rebuild to build one.</p>
      ) : (
        <>
          {systems.map((os) => {
            const latest = bySystem.get(os)![0];
            return (
              <div key={os} className="sa-dv-row">
                <div className="sa-rb-os">{OS_ICON[os]}</div>
                <div className="sa-dv-name">
                  <b>
                    {OS_NAME[os]} <span className="sa-dv-ver">v{latest.version}</span>
                  </b>
                  <span>{meta(latest) || "Latest version"}</span>
                </div>
                {actions(latest, true)}
              </div>
            );
          })}

          {open && activeTab && (
            <div className="sa-dv-all">
              <div className="sa-dv-tabs" role="tablist" aria-label="Versions by system">
                {systems.map((os) => (
                  <button key={os} type="button" role="tab" aria-selected={os === activeTab} onClick={() => setTab(os)}>
                    {OS_NAME[os]} ({bySystem.get(os)!.length})
                  </button>
                ))}
              </div>
              <ul className="sa-dv-list" role="tabpanel">
                {bySystem.get(activeTab)!.map((v, i) => (
                  <li key={v.version}>
                    <div className="sa-dv-name">
                      <b>
                        <span className="sa-dv-ver">v{v.version}</span> {i === 0 && <span className="sa-dv-latest">Latest</span>}
                      </b>
                      {meta(v) && <span>{meta(v)}</span>}
                    </div>
                    {actions(v, false)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
