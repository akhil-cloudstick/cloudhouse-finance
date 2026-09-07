"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import "../login.css";
import { useAuth } from "@/common/auth-context";
import { ApiError } from "@/common/services/httpClient";
import {
  activeBusinessSlug,
  appPath,
  businessSlugFromPath,
  isValidBusinessSlug,
} from "@/common/services/tenantSession";

type DustParticle = {
  left: string;
  sway: string;
  size: string;
  duration: string;
  delay: string;
};

// Ported from the inline <script> in legacy/index.html — generates 18 dust
// particles with the same randomized left/sway/size/timing distribution.
function makeDustParticles(): DustParticle[] {
  return Array.from({ length: 18 }, () => {
    const sc = 0.5 + Math.random();
    return {
      left: `${Math.random() * 100}vw`,
      sway: `${Math.random() * 70 - 35}px`,
      size: `${4 * sc}px`,
      duration: `${9 + Math.random() * 10}s`,
      delay: `${-Math.random() * 16}s`,
    };
  });
}

function CornerOrnament({ className }: { className: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 150 150" fill="none" stroke="#c9971c" strokeWidth="1.4">
        <path d="M4 146 V30 Q4 4 30 4 H146" opacity=".8" />
        <path d="M14 146 V38 Q14 14 38 14 H146" opacity=".45" />
        <path d="M4 60 q14 6 14 22 M60 4 q6 14 22 14" opacity=".7" />
        <circle cx="30" cy="30" r="5" fill="#c9971c" stroke="none" opacity=".85" />
        <path
          d="M30 18 l3.5 8.5 L42 30 l-8.5 3.5 L30 42 l-3.5-8.5 L18 30 l8.5-3.5 Z"
          fill="#e7c257"
          stroke="none"
          opacity=".65"
        />
      </svg>
    </div>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, token, loading } = useAuth();
  const [dust, setDust] = useState<DustParticle[]>([]);
  const [passVisible, setPassVisible] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [pass, setPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  /* linkSlug is the business named by the URL (/login/<slug>), and null on a
   * bare /login. When it is set, the business is already established and no
   * field is shown; when it is null the form offers a business-code box,
   * because a bare /login must not dead-end.
   *
   * Read from the pathname rather than a route parameter: the frontend is a
   * static export, so /login/<slug> cannot be a prerendered dynamic route —
   * runtime-created tenants have no build-time slug list. One login page is
   * served for every slugged path instead (a Next rewrite in dev,
   * internal/webstatic's fallback in production), and it parses its own URL. */
  const [linkSlug, setLinkSlug] = useState<string | null>(null);
  const [businessCode, setBusinessCode] = useState("");

  useEffect(() => {
    // Generated client-side only, matching the legacy page's DOM-insertion
    // approach (random values must not be computed during SSR/prerender).
    setDust(makeDustParticles());
    // Read on mount for the same reason: this page is prerendered at build
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

  // Already signed in with a valid token — skip the form entirely. Keeps the
  // slug, so the app opens under the business the link named.
  useEffect(() => {
    if (!loading && token) {
      router.replace(appPath(businessSlugFromPath() ?? activeBusinessSlug()));
    }
  }, [loading, token, router]);

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
      setMsg({ text: "Welcome back! Opening your vault…", ok: true });
      setTimeout(() => {
        router.push(appPath(code || null));
      }, 400);
    } catch (err) {
      const text =
        err instanceof ApiError
          ? err.message || "Invalid username/phone or password."
          : "Invalid username/phone or password.";
      setMsg({ text, ok: false });
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <CornerOrnament className="corner tl" />
      <CornerOrnament className="corner tr" />
      <CornerOrnament className="corner bl" />
      <CornerOrnament className="corner br" />

      <div className="dust" aria-hidden="true">
        {dust.map((d, i) => (
          <span
            key={i}
            style={{
              left: d.left,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ["--sway" as any]: d.sway,
              width: d.size,
              height: d.size,
              animationDuration: d.duration,
              animationDelay: d.delay,
            }}
          />
        ))}
      </div>

      <div className="wrap">
        <main className="card">
          <span className="stud tl"></span>
          <span className="stud tr"></span>
          <span className="stud bl"></span>
          <span className="stud br"></span>

          <div className="brand">
            <img src="/ambika-gold.jpeg" alt="Ambika Gold Finance logo" />
            <h1>
              Welcome to <span className="gilt">Ambika</span>
            </h1>
          </div>

          <div className="motto">
            <b>Trust</b>
            <span className="dot">◆</span>
            <b>Value</b>
            <span className="dot">◆</span>
            <b>Growth</b>
          </div>

          <form id="loginForm" noValidate onSubmit={handleSubmit}>
            {/* Shown only on a bare /login. Someone who arrived through their
              * organisation's own link has already named their business and
              * must not be asked again — but a truncated or hand-typed URL
              * has to have a way through, or "the link stopped working"
              * becomes the commonest support call.
              *
              * Optional even here: with a single business the backend
              * resolves it on its own, so the field stays out of the way of
              * the installation that has one. */}
            {linkSlug === null && (
              <div className="field">
                <input
                  type="text"
                  id="businessCode"
                  placeholder=" "
                  autoComplete="organization"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={businessCode}
                  onChange={(e) => setBusinessCode(e.target.value)}
                />
                <label htmlFor="businessCode">Business code (if you have one)</label>
                <span className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 20V9l8-5 8 5v11" />
                    <path d="M9 20v-6h6v6" />
                  </svg>
                </span>
                <span className="bar"></span>
              </div>
            )}

            <div className="field">
              <input
                type="text"
                id="identifier"
                placeholder=" "
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
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
              {submitting ? "Verifying…" : "Unlock My Vault"}
              <span className="shine" aria-hidden="true"></span>
            </button>
            <p className={`msg${msg ? " show" : ""}${msg?.ok ? " ok" : ""}`} id="msg" role="alert">
              {msg?.text ?? ""}
            </p>
          </form>

        </main>

        <p className="copy">© 2026 Ambika Gold Finance · Trust · Value · Growth</p>
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
