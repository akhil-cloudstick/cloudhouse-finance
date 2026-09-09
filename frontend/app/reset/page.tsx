"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/common/auth-context";
import {
  activeBusinessSlug,
  clearSession,
  loginPath,
  appPath,
} from "@/common/services/tenantSession";
import { resetDemoData, type ResetProgress } from "@/modules/demo/services/demoService";
import BrandLogo from "@/common/components/BrandLogo";

/* /reset — wipe this demo and restore the scripted dataset.
 *
 * Reached by typing the URL. Deliberately not linked from anywhere in the
 * console: it is an operator tool used between client meetings, and a menu
 * item labelled "delete everything" is not something to have on screen while
 * a prospect is watching.
 *
 * This page lives OUTSIDE app/app/, which has two consequences it has to
 * handle itself. It gets no auth guard from app/app/layout.tsx, so it does
 * its own. And ModalProvider/ToastProvider are only mounted inside the
 * console, so ConfirmModalContent and useToast are unavailable here — the
 * confirmation is the page itself, and errors render inline.
 */

export default function ResetPage() {
  const { token, loading, isAdmin, permissionsLoaded } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ResetProgress | null>(null);

  // Own guard: not signed in, go and sign in.
  useEffect(() => {
    if (!loading && !token) window.location.replace(loginPath());
  }, [loading, token]);

  if (loading || !token) {
    return <Centered>Checking your session…</Centered>;
  }

  // Wait for the permission fetch before judging the role: isAdmin is
  // derived from the employee record, which is still loading on a cold open.
  if (!permissionsLoaded) {
    return <Centered>Loading your account…</Centered>;
  }

  // Administrator only, matching the backend gate. This is presentation, not
  // enforcement — internal/demoreset refuses anyone else regardless of what
  // this page renders.
  if (!isAdmin) {
    return (
      <Centered>
        <p style={{ marginBottom: 14 }}>
          Only an Administrator can reset the demo data.
        </p>
        <a className="btn" href={appPath()}>
          Back to the app
        </a>
      </Centered>
    );
  }

  async function handleReset() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const report = await resetDemoData(setProgress);

      // The order below matters and each step has a reason.

      // 1. Capture the business slug BEFORE anything touches storage —
      //    clearing the session is what makes it unresolvable.
      const slug = activeBusinessSlug();

      // 2. The client-side mock store. A PREFIX SCAN, not a hardcoded list:
      //    common/utils/data.ts writes eight agf_* keys holding loans,
      //    schemes, lockers, ornaments and employees, and more may be added.
      //    Left behind, DataProvider rehydrates records the server just
      //    deleted and the reset looks like it silently failed.
      try {
        for (const key of Object.keys(window.localStorage)) {
          if (key.startsWith("agf_")) window.localStorage.removeItem(key);
        }
      } catch {
        /* private mode or blocked site data — nothing cached to clear */
      }

      // 3. sessionStorage holds the cached permission map and the selected
      //    branch id. That branch no longer exists, and a stale X-Branch-Id
      //    header filters every list on every screen down to empty.
      try {
        window.sessionStorage.clear();
      } catch {
        /* as above */
      }

      // 4. The JWT and the cached employee record.
      clearSession(slug);

      // 5. Straight to the login page, as a FULL document load rather than a
      //    client-side navigation: it discards every provider, store and
      //    in-memory cache in one go, where router.push would keep the
      //    customer and loan providers alive holding deleted data.
      //
      //    No summary screen in between. The progress bar has already shown
      //    the work happening, so a "done, here is what changed" step would
      //    be one more click between the operator and the next client — and
      //    the report is logged server-side for anyone who wants the counts.
      //    void marks the value as deliberately unused.
      void report;
      window.location.replace(loginPath(slug));
    } catch (err) {
      // Deliberately do NOT clear the session on failure: the operator has to
      // stay signed in to read this and try again.
      setError(err instanceof Error ? err.message : "The reset failed.");
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <BrandLogo size={44} />
          <div>
            <h1 style={{ fontSize: 20, margin: 0 }}>Reset the demo</h1>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Restores the scripted dataset for the next client.
            </p>
          </div>
        </div>

        <section style={panelStyle("var(--red)", "var(--red-bg)")}>
          <h2 style={panelHeading}>This permanently deletes</h2>
          <ul style={listStyle}>
            <li>Every customer, gold loan, ornament, payment and packet</li>
            <li>Every scheme, locker, bank, gold rate and ornament type</li>
            <li>Every auction, bank re-pledge, extension and release request</li>
            <li>Every personal loan, investment, plan and payout</li>
            <li>Every expense, cash movement, reminder, message and audit entry</li>
            <li>Every employee except <b>admin</b>, and every branch except Head Office</li>
            <li>Every uploaded photo and document, from the disk as well</li>
          </ul>
        </section>

        <section style={panelStyle("var(--green)", "var(--green-bg)")}>
          <h2 style={panelHeading}>This is kept</h2>
          <ul style={listStyle}>
            <li>
              Your <b>admin</b> login — same username, same password
            </li>
            <li>Head Office and the nine standard roles</li>
            <li>Your integration keys (WhatsApp, Setu, Razorpay)</li>
            <li>Your business and subscription record</li>
          </ul>
        </section>

        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}

        {busy ? (
          <ResetProgressBar progress={progress} />
        ) : (
          <>
            <button
              className="btn danger"
              onClick={handleReset}
              style={{ width: "100%", marginTop: 6 }}
            >
              Reset demo data
            </button>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0", textAlign: "center" }}>
              Takes a few seconds. You will be signed out and returned to the
              login page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* The progress bar.
 *
 * Driven by real phases streamed from the server, not a timer: a bar that
 * animates on its own is a lie that gets caught the moment the work takes
 * longer than the animation. Before the first phase arrives it shows an
 * indeterminate state rather than 0%, because "0%" on a stalled bar is the
 * same "it is broken" impression this exists to prevent.
 */
function ResetProgressBar({ progress }: { progress: ResetProgress | null }) {
  const pct = progress ? Math.round((progress.index / progress.total) * 100) : 0;
  const label = progress ? progress.step : "starting…";

  return (
    <div style={{ marginTop: 6 }} aria-live="polite">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ? pct : undefined}
        aria-label="Resetting the demo data"
        style={{
          height: 8,
          borderRadius: 999,
          background: "var(--brand-pale)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: progress ? `${pct}%` : "35%",
            borderRadius: 999,
            background: "var(--brand-gradient)",
            // Only transition a real measurement. The indeterminate bar
            // slides instead, so the two never look like the same thing.
            transition: progress ? "width .28s ease" : undefined,
            animation: progress ? undefined : "resetIndeterminate 1.1s ease-in-out infinite",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          margin: "10px 0 0",
          fontSize: 12.5,
          color: "var(--muted)",
        }}
      >
        <span>
          {label}
          {progress ? ` · step ${progress.index} of ${progress.total}` : ""}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)", fontWeight: 600 }}>
          {progress ? `${pct}%` : ""}
        </span>
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0", textAlign: "center" }}>
        Do not close this tab. You will be signed out when it finishes.
      </p>

      <style>{`@keyframes resetIndeterminate {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(285%); }
      }`}</style>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, textAlign: "center" }}>{children}</div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg)",
  color: "var(--ink)",
  padding: "32px 16px",
  fontFamily: "var(--font-sans), Inter, sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 540,
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: 28,
  boxShadow: "0 24px 60px -28px rgba(43, 26, 94, .28)",
};

const panelStyle = (border: string, bg: string): React.CSSProperties => ({
  borderLeft: `3px solid ${border}`,
  background: bg,
  borderRadius: 8,
  padding: "12px 14px",
  marginBottom: 14,
});

const panelHeading: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  margin: "0 0 8px",
};

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 13,
  lineHeight: 1.65,
};

const errorStyle: React.CSSProperties = {
  background: "var(--red-bg)",
  color: "var(--red)",
  border: "1px solid var(--red)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 13,
  margin: "0 0 12px",
};
