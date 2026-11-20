"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/common/components/Icon";
import {
  appVersion,
  activeContentVersion,
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  onUpdateEvent,
  checkForContentUpdate,
  downloadContentUpdate,
  applyContentUpdate,
  onContentUpdateEvent,
} from "@/common/services/desktopBridge";

type FullState = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";
type ContentState = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";

// Desktop-only version section in Settings; surfaces both the full and content update independently.
export function DesktopVersionPanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [contentVersion, setContentVersion] = useState<string | null>(null);

  const [full, setFull] = useState<FullState>("idle");
  const [fullProgress, setFullProgress] = useState(0);
  const [fullError, setFullError] = useState("");

  const [content, setContent] = useState<ContentState>("idle");
  const [contentProgress, setContentProgress] = useState(0);
  const [contentError, setContentError] = useState("");

  useEffect(() => {
    void appVersion().then(setVersion);
    void activeContentVersion().then(setContentVersion);

    const unsubscribe = [
      onUpdateEvent("checking", () => setFull("checking")),
      onUpdateEvent("available", () => setFull("available")),
      onUpdateEvent("not-available", () => setFull("uptodate")),
      onUpdateEvent("progress", (p) => { setFull("downloading"); setFullProgress(p.percent ?? 0); }),
      onUpdateEvent("downloaded", () => setFull("ready")),
      onUpdateEvent("error", (p) => { setFullError(p.message ?? "Update failed"); setFull("error"); }),

      onContentUpdateEvent("checking", () => setContent("checking")),
      onContentUpdateEvent("available", () => setContent("available")),
      onContentUpdateEvent("not-available", () => setContent("uptodate")),
      onContentUpdateEvent("progress", (p) => { setContent("downloading"); setContentProgress(p.percent ?? 0); }),
      onContentUpdateEvent("downloaded", () => setContent("ready")),
      onContentUpdateEvent("error", (p) => { setContentError(p.message ?? "Update failed"); setContent("error"); }),
    ];
    void checkForUpdate();
    void checkForContentUpdate();
    return () => unsubscribe.forEach((off) => off());
  }, []);

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>App version</h4>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Running {version ?? "…"}</p>

      <section style={{ marginTop: 18 }}>
        <h5 style={{ margin: "0 0 6px" }}>Full update</h5>
        {full === "idle" || full === "checking" ? (
          <p className="sa-hint">Checking…</p>
        ) : full === "uptodate" ? (
          <p className="sa-hint"><Icon name="check" /> Up to date</p>
        ) : full === "available" ? (
          <button type="button" className="btn" onClick={() => void downloadUpdate()}>
            Download update
          </button>
        ) : full === "downloading" ? (
          <p className="sa-hint">Downloading… {Math.round(fullProgress)}%</p>
        ) : full === "ready" ? (
          <button type="button" className="btn" onClick={() => void installUpdate()}>
            Restart to install
          </button>
        ) : (
          <p className="sa-error">{fullError}</p>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h5 style={{ margin: "0 0 6px" }}>Content update</h5>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          {contentVersion ? `On content ${contentVersion}` : "On the version built into this installer"}
        </p>
        {content === "idle" || content === "checking" ? (
          <p className="sa-hint">Checking…</p>
        ) : content === "uptodate" ? (
          <p className="sa-hint"><Icon name="check" /> Up to date</p>
        ) : content === "available" ? (
          <button type="button" className="btn" onClick={() => void downloadContentUpdate()}>
            Download content update
          </button>
        ) : content === "downloading" ? (
          <p className="sa-hint">Downloading… {Math.round(contentProgress)}%</p>
        ) : content === "ready" ? (
          <button type="button" className="btn" onClick={() => void applyContentUpdate()}>
            Restart to apply
          </button>
        ) : (
          <p className="sa-error">{contentError}</p>
        )}
      </section>
    </div>
  );
}
