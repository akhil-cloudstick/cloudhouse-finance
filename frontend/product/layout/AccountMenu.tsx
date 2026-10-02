"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { ConnectMobileModalContent } from "@/product/components/modals/ConnectMobileModal";
import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { useBranding } from "@/product/providers/BrandingProvider";
import { FEATURES } from "@/product/config/features";

type UpdateState = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready";

const RING_C = 2 * Math.PI * 7;
const storageKey = () => `cloudhouse.updateNotice.${FEATURES.updateId}`;

function updateSeen(): boolean {
  try { return localStorage.getItem(storageKey()) === "1"; } catch { return false; }
}

/* The header's name chip, opening a small dropdown that holds what used to
 * be three separate things: the Connect mobile app button, the sidebar's
 * update card (formerly layout/UpdateNotice.tsx) and the Sign out link.
 *
 * Updates stay UI-only, as before: "Check for updates" finds one only when
 * NEXT_PUBLIC_ENABLE_UPDATE_NOTICE is on and this update (keyed by its notes
 * text) hasn't been installed yet; the download is a progress animation and
 * "Restart" remembers the update and reloads. Every update state fits the
 * same row height — the icon slot swaps for a spinner or a progress ring.
 *
 * The update state lives here rather than in the dropdown, so closing the
 * menu (or moving between pages — Topbar stays mounted) doesn't stop a
 * download. A dot on the avatar shows when an update is waiting. */
export function AccountMenu() {
  const { employee, logout } = useAuth();
  const { name: businessName } = useBranding();
  const { openModal } = useModal();
  const [open, setOpen] = useState(false);
  const [upd, setUpd] = useState<UpdateState>("idle");
  const [progress, setProgress] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const tick = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
  }, []);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function check() {
    setUpd("checking");
    timers.current.push(window.setTimeout(() => {
      setUpd(FEATURES.updateNotice && !updateSeen() ? "available" : "uptodate");
    }, 1200));
  }

  function download() {
    setUpd("downloading");
    setProgress(0);
    const id = window.setInterval(() => {
      setProgress((p) => Math.min(100, p + 1 + Math.random() * 2.4));
    }, 110);
    tick.current = id;
    timers.current.push(id);
  }

  // Completion lives here rather than inside the setProgress updater, which
  // must stay pure (Strict Mode runs updaters twice).
  useEffect(() => {
    if (upd !== "downloading" || progress < 100) return;
    window.clearInterval(tick.current);
    const t = window.setTimeout(() => setUpd("ready"), 350);
    return () => window.clearTimeout(t);
  }, [upd, progress]);

  function restart() {
    try { localStorage.setItem(storageKey(), "1"); } catch { /* not persisted; offered again next load */ }
    window.location.reload();
  }

  function onUpdateRow() {
    if (upd === "idle" || upd === "uptodate") check();
    else if (upd === "available") download();
    else if (upd === "ready") restart();
  }

  function connectMobile() {
    setOpen(false);
    openModal(<ConnectMobileModalContent />);
  }

  function signOut() {
    setOpen(false);
    /* Drop the session and stop. The navigation belongs to app/app/layout.tsx,
     * whose guard already watches for exactly this ("no token in the app
     * shell → go to the sign-in page") and does it as a full document load,
     * which is required: the console and the sign-in page are separate
     * documents in the static export, and the business-first URL that reaches
     * the latter (/ctfi/login) exists only as a dev rewrite and a server-side
     * fallback that Next's client router knows nothing about. */
    logout();
  }

  const initial = employee?.name ? employee.name.charAt(0).toUpperCase() : "—";
  const waiting = upd === "available" || upd === "ready";
  const busy = upd === "checking" || upd === "downloading";

  let updIcon: React.ReactNode;
  let updLabel: string;
  let updEnd: React.ReactNode = null;
  if (upd === "checking") {
    updIcon = <span className="acct-spin" />;
    updLabel = "Checking for updates…";
  } else if (upd === "uptodate") {
    updIcon = <Icon name="check" />;
    updLabel = "Up to date";
  } else if (upd === "available") {
    updIcon = <Icon name="arrowUp" />;
    updLabel = "Update available";
    updEnd = <span className="acct-ibtn" title="Download update"><Icon name="download" /></span>;
  } else if (upd === "downloading") {
    updIcon = (
      <svg className="acct-ring" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="trk" cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" />
        <circle className="val" cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress / 100)} />
      </svg>
    );
    updLabel = `Downloading… ${Math.round(progress)}%`;
  } else if (upd === "ready") {
    updIcon = <Icon name="check" />;
    updLabel = "Update ready · Restart";
    updEnd = <span className="acct-ibtn" title="Restart to install"><Icon name="refresh" /></span>;
  } else {
    updIcon = <Icon name="refresh" />;
    updLabel = "Check for updates";
  }

  return (
    <div className="acct" ref={root}>
      <button
        type="button"
        className="user"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="av">
          {initial}
          {waiting && <span className="acct-badge" aria-label="Update available" />}
        </span>
        <span className="nm">
          {employee?.name || "Not signed in"}
          <small>{employee?.role || "No user session"}</small>
        </span>
        <svg className="acct-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-who">
            <span className="av">{initial}</span>
            <div>
              <b>{employee?.name || "Not signed in"}</b>
              <span>{[employee?.role, businessName].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <div className="acct-sep" />
          <button type="button" role="menuitem" className="acct-item" onClick={connectMobile}>
            <span className="i"><Icon name="smartphone" /></span>
            <span className="lbl">Connect mobile app</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={`acct-item${busy ? " busy" : ""}${upd === "available" ? " new" : ""}${upd === "uptodate" || upd === "ready" ? " ok" : ""}`}
            onClick={onUpdateRow}
            disabled={busy}
            aria-live="polite"
          >
            <span className="i">{updIcon}</span>
            <span className="lbl">{updLabel}</span>
            {updEnd}
          </button>
          <div className="acct-sep" />
          <button type="button" role="menuitem" className="acct-item danger" onClick={signOut}>
            <span className="i"><Icon name="logout" /></span>
            <span className="lbl">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
