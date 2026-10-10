"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import "@/common/styles/login.css";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { BRAND } from "@/common/config/brand";
import { useBranding } from "@/common/providers/BrandingProvider";
import BrandLogo from "@/common/components/BrandLogo";
import {
  activeBusinessSlug,
  appPath,
  businessSlugFromPath,
  isValidBusinessSlug,
  resolveActiveSlug,
} from "@/common/services/tenantSession";

function LoginPageInner() {
  const searchParams = useSearchParams();
  const { login, token, loading } = useAuth();
  // Every string on this page used to be the hardcoded platform BRAND,
  // regardless of which business's /<slug>/login or subdomain a visitor
  // actually reached — BrandLogo already reads the real business's logo via
  // this same provider, but nothing else here did. legalName/kmlRegNo/name
  // fall back to BRAND field by field, same convention as
  // Sidebar.common/components/BrandLogo.tsx, rather than all-or-nothing.
  const {
    name: businessName,
    shortName,
    legalName,
    kmlRegNo,
    loaded: brandingLoaded,
    cached: brandingCached,
  } = useBranding();
  /* known === "this panel may show a name". Until then it shows placeholder
   * bars, NOT the platform name: a business's sign-in page must never carry
   * anyone else's identity, the vendor's included, even for the frames before
   * its branding arrives. `cached` covers the common case — a reload on a
   * browser that already knows this business paints its real name on the
   * first frame with no placeholder at all. */
  const known = (brandingLoaded || brandingCached) && !!businessName;
  // The identity panel's big headline is the FULL business name, split
  // across two lines by word — NOT the short name. The reference this was
  // checked against never shows its short form ("CTFI") here at all, only
  // in tight spots (sidebar headline, browser tab, the "Staff access to X"
  // line below). A single-word name has no second line, so the first line
  // carries all of it rather than repeating the word or leaving the second
  // line dangling — same convention as Sidebar.tsx's own split.
  const nameParts = (businessName || "").trim().split(/\s+/);
  const nameTop = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0];
  const nameBottom = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
  const [passVisible, setPassVisible] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [pass, setPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  /* linkSlug is the business named by the URL (/<slug>/login), and null on a
   * bare /login. When it is set, the business is already established and no
   * field is shown; when it is null the form offers a business-code box,
   * because a bare /login must not dead-end.
   *
   * Read from the pathname rather than a route parameter: the frontend is a
   * static export, so /<slug>/login cannot be a prerendered dynamic route —
   * runtime-created tenants have no build-time slug list. One login page is
   * served for every slugged path instead (a Next rewrite in dev,
   * internal/webstatic's fallback in production), and it parses its own URL. */
  const [linkSlug, setLinkSlug] = useState<string | null>(null);
  const [businessCode, setBusinessCode] = useState("");

  useEffect(() => {
    // Read on mount: this page is prerendered at build
    // time, where there is no URL to read a slug from. Computing it during
    // render would make the prerendered HTML disagree with the first client
    // render — a hydration mismatch — so it is resolved after mount.
    setLinkSlug(businessSlugFromPath());
  }, []);

  useEffect(() => {
    if (searchParams.get("reset") === "success") {
      setMsg({ text: "Password reset! You can now log in with your new password.", ok: true });
    }
  }, [searchParams]);

  /* THE ONLY PLACE THIS PAGE LEAVES FOR THE CONSOLE.
   *
   * It covers both ways a token appears: already present on arrival (skip the
   * form entirely, keeping the slug so the app opens under the business the
   * link named) and set by handleSubmit a moment ago.
   *
   * handleSubmit used to navigate as well, on a 400ms timer, which made every
   * successful sign-in fire TWO navigations: this effect's replace() the
   * instant login() set the token, then an assign() 400ms later. The second
   * one lands mid-flight and aborts the first, and the browser is left on the
   * page it never finished leaving — the "login succeeds but stays on the
   * login page until I refresh" bug, intermittent because it depended on
   * whether the first load had committed inside those 400ms.
   *
   * navigatedRef makes it fire once even if a re-render would re-satisfy the
   * condition. A navigation is in flight from that moment; re-issuing it is
   * the same abort by another route.
   */
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (loading || !token || navigatedRef.current) return;
    navigatedRef.current = true;
    // Same host-vs-path distinction as everywhere else this page's business
    // feeds a URL: a host-resolved tenant never had the slug in its address
    // bar, so the console it lands on must not gain one. A path-resolved slug
    // (or the bare-install fallback to the last business used here, when
    // neither the path nor the host named one) still carries it forward.
    const { slug: resolvedSlug, fromPath } = resolveActiveSlug();
    const slug = resolvedSlug ?? activeBusinessSlug();
    const includeInUrl = resolvedSlug === null || fromPath;
    window.location.replace(appPath(slug, undefined, includeInUrl));
  }, [loading, token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedIdentifier = identifier.trim();
    setMsg(null);

    if (!trimmedIdentifier) {
      setMsg({ text: "Please enter your username or phone number.", ok: false });
      return;
    }
    if (!pass) {
      setMsg({ text: "Please enter your password.", ok: false });
      return;
    }

    /* The slug from the link wins over the typed field: if someone arrived
     * through their organisation's own link, that is the business they mean. */
    const typedCode = businessCode.trim().toLowerCase();
    if (!linkSlug && typedCode && !isValidBusinessSlug(typedCode)) {
      setMsg({ text: "That business code doesn't look right — letters, numbers and dashes only.", ok: false });
      return;
    }
    const code = linkSlug ?? typedCode;

    setSubmitting(true);
    try {
      await login(trimmedIdentifier, pass, code);
      /* No navigation here. login() has just set the token, and the effect
       * above owns the move to the console — see its comment for why having
       * both was self-defeating. `submitting` deliberately stays true: the
       * form must not become interactive again while the browser is leaving.
       *
       * (The navigation is still a real document load, not router.push — the
       * console is a separate document in the static export and the
       * business-first URL that reaches it exists only as a server-side
       * fallback, which Next's client router knows nothing about. That
       * reasoning now lives at the single call site.) */
      setMsg({ text: "Signed in. Taking you through…", ok: true });
    } catch (err) {
      let text: string;
      if (err instanceof ApiError) {
        // 5xx (incl. a proxy's 502/503/504 when the backend is down) is not a
        // credentials problem — don't let a statusText like "Bad Gateway" or a
        // raw server error reach the form.
        text =
          err.status >= 500
            ? "Something went wrong. Please try again."
            : err.message || "Invalid username/phone or password.";
      } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
        text = "No internet connection. Check your network and try again.";
      } else {
        // fetch() rejected while the browser thinks it's online: the backend
        // is unreachable (down, restarting, refused connection).
        text = "Something went wrong. Please try again.";
      }
      setMsg({ text, ok: false });
      setSubmitting(false);
    }
  }

  // linkSlug (not a direct businessSlugFromPath() call here) — it starts
  // null on the server AND on the client's first render alike, resolving to
  // the real slug only in the effect above, after mount. Gating on a value
  // that differs between server and client's FIRST render is exactly what
  // caused a hydration-mismatch crash: the prerendered HTML (built with no
  // URL to read) never showed this loading screen, so the client's first
  // paint must not either — only once linkSlug updates post-mount (an
  // ordinary re-render, not the hydration pass) is it safe to swap in.
  if (linkSlug !== null && !brandingLoaded) {
    return (
      <div className="shell-loading" aria-busy="true" aria-label="Loading">
        <div className="shell-loading-spinner" />
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="wrap">
        {/* Identity panel. Sits beside the form on a desktop and stacks
          * above it under 900px, where it collapses to the mark plus the
          * name — the registration number and phone numbers are reference
          * detail, not worth a third of a phone screen. */}
        <aside className="brand-panel">
          <BrandLogo size={168} className="bp-mark" scalable={false} />
          {known ? (
            <h1 className="bp-name">
              {nameTop}
              {nameBottom && <span>{nameBottom}</span>}
            </h1>
          ) : (
            <h1 className="bp-name" aria-hidden="true">
              <NamePlaceholder />
            </h1>
          )}
          <p className="bp-desc">{BRAND.descriptor}</p>
          {/* Gated on `known` for the same reason the name above it is: until
            * this business's own colours arrive, --brand-gradient still holds
            * the platform's default sweep, and a business must never be shown
            * anyone else's brand — not even for the few frames before the
            * response lands. Unknown gets the neutral placeholder bar. */}
          <span
            className={known ? "bp-rule" : "bp-rule bp-rule--loading"}
            aria-hidden="true"
          ></span>
          {/* The business's OWN registration number or nothing at all. It used
            * to fall back to the platform's, which printed CloudHouse's money-
            * lending registration on another company's sign-in page — wrong in
            * a way that matters legally, not just cosmetically. Same reason the
            * platform contact numbers that sat below it are gone: branding
            * carries no per-business phone numbers, so there is nothing
            * truthful to show in their place. */}
          {kmlRegNo && <p className="bp-reg">{`KML Reg. No: ${kmlRegNo}`}</p>}
        </aside>

        <main className="card">
          <div className="brand">
            <h2>Sign in</h2>
            <p>
              {known
                ? `Staff access to the ${shortName || businessName} lending console.`
                : "Staff access to your lending console."}
            </p>
          </div>

          <form id="loginForm" noValidate onSubmit={handleSubmit}>
            {/* The "Business code" box that used to sit here is hidden: this
              * deployment only ever has one business, and the backend
              * already resolves that single tenant on its own when no code
              * is given (see handleSubmit's `code` — an empty typedCode is
              * still a valid, if under-specified, login). The multi-tenant
              * slug plumbing (linkSlug, businessCode state, /<slug>/login
              * URLs) is left in place; only the input is no longer shown. */}

            <div className="field">
              <input
                type="text"
                id="identifier"
                placeholder=" "
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => {
                  // Enter here moves on to Password instead of submitting
                  // the form early with no password typed yet.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("pass")?.focus();
                  }
                }}
              />
              <label htmlFor="identifier">Username or Phone</label>
              <span className="icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
                </svg>
              </span>
              <span className="bar"></span>
            </div>

            <div className="field">
              <input
                type={passVisible ? "text" : "password"}
                id="pass"
                placeholder=" "
                autoComplete="current-password"
                required
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
              <label htmlFor="pass">Password</label>
              <button
                type="button"
                className="eye"
                id="eye"
                aria-label={passVisible ? "Hide password" : "Show password"}
                onClick={() => setPassVisible((v) => !v)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  style={{ display: passVisible ? "none" : "block" }}
                >
                  <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="2.8" />
                </svg>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  style={{ display: passVisible ? "block" : "none" }}
                >
                  <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                  <path d="M4 4l16 16" />
                </svg>
              </button>
              <span className="bar"></span>
            </div>

            <div className="aux">
              <span></span>
              {/* Carries the business across: a phone number is unique only
                * within a business now, so the reset flow cannot find the
                * employee without it. */}
              <a href={linkSlug ? `/forgot-password?b=${encodeURIComponent(linkSlug)}` : "/forgot-password"}>
                Forgot password?
              </a>
            </div>

            <button type="submit" className="btn" id="submitBtn" disabled={submitting}>
              {submitting ? "Verifying…" : "Sign In"}
            </button>
            <p className={`msg${msg ? " show" : ""}${msg?.ok ? " ok" : ""}`} id="msg" role="alert">
              {msg?.text ?? ""}
            </p>
          </form>

        </main>

        {known && <p className="copy">© 2026 {legalName || businessName}</p>}
        <p className="powered">
          Powered by{" "}
          <a href="https://cloudhousetechnologies.com" target="_blank" rel="noopener">
            CloudHouse
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

/* The name placeholder.
 *
 * Shown only on a browser that has never opened this business, and only until
 * the branding response lands. Two neutral bars rather than a spinner, because
 * they occupy the same two lines the real name will, so nothing on the panel
 * jumps when it arrives. */
function NamePlaceholder() {
  const bar: React.CSSProperties = {
    display: "block",
    height: "0.72em",
    borderRadius: 4,
    background: "currentColor",
    opacity: 0.16,
    /* Declared in login.css, not in an inline <style> here as it used to be:
     * .bp-rule--loading pulses with these bars and would otherwise depend on
     * this component happening to be mounted to get its keyframes at all. */
    animation: "loginBrandPulse 1.1s ease-in-out infinite",
  };
  return (
    <>
      <span style={{ ...bar, width: "9ch" }} />
      <span style={{ ...bar, width: "6ch", marginTop: "0.22em" }} />
    </>
  );
}
