"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { readSuperAdminToken, writeSuperAdminSession } from "@/modules/superadmin/services/superadminSession";
import { VENDOR } from "@/modules/superadmin/config/brand";
import "@/modules/superadmin/styles/superadmin.css";

/* Separate from the tenant login page (app/(product)/login/page.tsx): a different
 * audience (our own team), a different JWT scheme, no business slug, no
 * OTP flow. It shares the CloudHouse sign-in LOOK — centred card, mark,
 * "Welcome back", filled icon-led fields, one solid dark action — while
 * staying its own page, so it still cannot be mistaken for a tenant's
 * sign-in link: the mark is the vendor's and the card names this console.
 *
 * Two controls from that design are deliberately ABSENT rather than drawn
 * inert: "Forgot password?" and "Sign up". This console has no password
 * reset flow and no self-registration — superadmin accounts are seeded or
 * created by hand (see superadmin.SeedBootstrapUser). A link that looks
 * like a way in and does nothing is worse than no link, most of all on the
 * one page where someone is already stuck. */

/* Inline SVGs, matching modules/superadmin/components/SuperAdminIcon.tsx: this app's dependencies are
 * next + react and nothing else, and three glyphs do not justify changing
 * that. */
function UserIcon() {
  return (
    <svg
      className="sa-input-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      className="sa-input-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

type EyeIconProps = { off: boolean };

function EyeIcon({ off }: EyeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readSuperAdminToken()) router.replace("/superadmin");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter both a username and a password.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await login(username.trim(), password);
      writeSuperAdminSession(res.token, res.superAdminUser);
      router.push("/superadmin");
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-login">
      <form className="sa-login-card" onSubmit={handleSubmit}>
        <div className="sa-login-head">
          {/* The VENDOR's mark, never a tenant's — this page belongs to us and
            * must not re-brand to whichever business was last signed in. Plain
            * <img> rather than BrandLogo for exactly that reason: BrandLogo
            * resolves the tenant's logo through BrandingProvider. */}
          <img src={VENDOR.markSrc} alt="" />
          <h1>Welcome back</h1>
          <p>Sign in to the {VENDOR.product} to continue</p>
        </div>

        <label className="sa-login-field">
          <span>Username</span>
          <div className="sa-input-wrap">
            <UserIcon />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="superadmin"
              autoFocus
            />
          </div>
        </label>

        <label className="sa-login-field">
          <span>Password</span>
          <div className="sa-input-wrap has-toggle">
            <LockIcon />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
            />
            <button
              type="button"
              className="sa-eye"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              /* Not focusable: it sits between the password field and the
               * submit button, and tabbing into a reveal toggle on the way to
               * signing in is friction for every user to serve a mouse one. */
              tabIndex={-1}
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </label>

        {error && <p className="sa-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <p className="sa-login-foot">
        {VENDOR.name} · {VENDOR.product}
      </p>
    </div>
  );
}
