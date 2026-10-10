"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { ConnectMobileModalContent } from "@/common/components/modals/ConnectMobileModalContent";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useBranchSwitch } from "@/common/hooks/use-branch-switch";
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  isDesktop,
  onUpdateEvent,
} from "@/common/services/desktopBridge";

type UpdateState = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";

const RING_C = 2 * Math.PI * 7;
const subscribeNever = () => () => {};

/* The header's name chip, opening a small dropdown that holds what used to
 * be three separate things: the Connect mobile app button, the sidebar's
 * update card (formerly layout/UpdateNotice.tsx) and the Sign out link.
 *
 * The "Check for updates" row exists only in the desktop app, where it drives
 * the native updater (see desktopBridge); the web build never shows it. Every
 * update state fits the same row height — the icon slot swaps for a spinner
 * or a progress ring.
 *
 * The update state lives here rather than in the dropdown, so closing the
 * menu (or moving between pages — Topbar stays mounted) doesn't stop a
 * download. A dot on the avatar shows when an update is waiting.
 *
 * Multi-branch Administrators/Management also get the global branch selector
 * here ("Branch: …" row expanding to the branch list) — see useBranchSwitch.
 * It scopes the whole app, so the chosen branch is echoed under the name. */
export function AccountMenu() {
  const { employee, logout } = useAuth();
  const { name: businessName } = useBranding();
  const { openModal } = useModal();
  const [open, setOpen] = useState(false);
  const [upd, setUpd] = useState<UpdateState>("idle");
  const [progress, setProgress] = useState(0);
  const [updError, setUpdError] = useState("");
  const branch = useBranchSwitch();
  const [branchOpen, setBranchOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeNever, isDesktop, () => false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!desktop) return;
    const unsubscribe = [
      onUpdateEvent("checking", () => setUpd("checking")),
      onUpdateEvent("available", () => setUpd("available")),
      onUpdateEvent("not-available", () => setUpd("uptodate")),
      onUpdateEvent("progress", (p) => { setUpd("downloading"); setProgress(p.percent ?? 0); }),
      onUpdateEvent("downloaded", () => setUpd("ready")),
      onUpdateEvent("error", (p) => { setUpdError(p.message ?? "Update failed"); setUpd("error"); }),
    ];
    return () => unsubscribe.forEach((off) => off());
  }, [desktop]);

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

  function onUpdateRow() {
    if (upd === "idle" || upd === "uptodate" || upd === "error") void checkForUpdate();
    else if (upd === "available") {
      setUpd("downloading");
      setProgress(0);
      void downloadUpdate();
    } else if (upd === "ready") void installUpdate();
  }

  function pickBranch(id: number | null) {
    setBranchOpen(false);
    setOpen(false);
    if (id !== branch.selectedBranchId) branch.select(id);
  }

  function connectMobile() {
    setOpen(false);
    openModal(<ConnectMobileModalContent />);
  }

  function signOut() {
    setOpen(false);
    /* Drop the session and stop. The navigation belongs to common/components/layout/AuthGuard.tsx,
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
  } else if (upd === "error") {
    updIcon = <Icon name="refresh" />;
    updLabel = "Update failed · Retry";
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
        onClick={() => { setOpen((o) => !o); setBranchOpen(false); }}
      >
        <span className="av">
          {initial}
          {desktop && waiting && <span className="acct-badge" aria-label="Update available" />}
        </span>
        <span className="nm">
          {employee?.name || "Not signed in"}
          {/* With a branch selector, the branch the whole app is scoped to is
            * kept in view (the role moves to the menu header); a branch-confined
            * employee sees their own branch; with no branches at all
            * (single-branch plan) — the role. */}
          {branch.visible
            ? <span className="acct-branch" title={`Viewing: ${branch.selectedName}`}>{branch.selectedName}</span>
            : branch.ownBranchName
            ? <span className="acct-branch" title={`Branch: ${branch.ownBranchName}`}>{branch.ownBranchName}</span>
            : <small>{employee?.role || "No user session"}</small>}
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
              {branch.visible && <span className="acct-branch">{branch.selectedName}</span>}
              {!branch.visible && branch.ownBranchName && <span className="acct-branch">{branch.ownBranchName}</span>}
            </div>
          </div>
          <div className="acct-sep" />
          {branch.visible && (
            <>
              <button
                type="button"
                role="menuitem"
                className="acct-item"
                aria-expanded={branchOpen}
                onClick={() => setBranchOpen((o) => !o)}
                title="Viewing scope — narrows every page to one branch"
              >
                <span className="i"><Icon name="home" /></span>
                <span className="lbl">Branch: {branch.selectedName}</span>
                <span className={`acct-chev${branchOpen ? " up" : ""}`}><Icon name="chevronDown" /></span>
              </button>
              {branchOpen && (
                <div className="acct-branches" role="group" aria-label="Branch">
                  {[{ id: null as number | null, name: "All branches" }, ...branch.branches].map((b) => {
                    const active = b.id === branch.selectedBranchId;
                    return (
                      <button
                        key={b.id ?? "all"}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={`acct-item sub${active ? " ok" : ""}`}
                        onClick={() => pickBranch(b.id)}
                      >
                        <span className="i">{active && <Icon name="check" />}</span>
                        <span className="lbl">{b.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="acct-sep" />
            </>
          )}
          <button type="button" role="menuitem" className="acct-item" onClick={connectMobile}>
            <span className="i"><Icon name="smartphone" /></span>
            <span className="lbl">Connect mobile app</span>
          </button>
          {desktop && (
            <button
              type="button"
              role="menuitem"
              className={`acct-item${busy ? " busy" : ""}${upd === "available" ? " new" : ""}${upd === "uptodate" || upd === "ready" ? " ok" : ""}`}
              onClick={onUpdateRow}
              disabled={busy}
              title={upd === "error" ? updError : undefined}
              aria-live="polite"
            >
              <span className="i">{updIcon}</span>
              <span className="lbl">{updLabel}</span>
              {updEnd}
            </button>
          )}
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
