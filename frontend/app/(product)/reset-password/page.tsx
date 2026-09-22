"use client";

import { Suspense, useState } from "react";
import BrandLogo from "@/product/components/BrandLogo";
import { useSearchParams } from "next/navigation";
import "@/product/styles/login.css";
import { resetPassword } from "@/product/services/authService";
import { ApiError } from "@/product/services/httpClient";
import {
  businessCodeForRequest,
  isValidBusinessSlug,
  loginPath,
  resolveActiveSlug,
} from "@/product/services/tenantSession";

function ResetPasswordForm() {
  const searchParams = useSearchParams();

  // The phone number is fixed to whatever "Forgot password" requested a code
  // for — it must NOT be re-typable here. Previously this field was
  // pre-filled from the query param but still a free-text input, so anyone
  // could request a code for one number, then swap in a *different* target
  // phone number on this page and submit an OTP against that account
  // instead — turning "forgot my own password" into "reset anyone's
  // password, given their phone number and a leaked/guessed code". Locking
  // it read-only means this page can only ever act on the number the user
  // actually requested a code for.
  const phone = searchParams.get("phone") || "";

  /* The business is carried through the whole reset flow, because a phone
   * number is unique only WITHIN a business — see the forgot-password page. */
  const linkedCode = searchParams.get("b")?.trim().toLowerCase() ?? "";
  const businessCode = isValidBusinessSlug(linkedCode) ? linkedCode : businessCodeForRequest();
  /* Same reasoning as forgot-password/page.tsx: keep the slug in the "Back to
   * login" / post-reset links for an explicit ?b= param or the bare-install
   * fallback, but not for one that only came from a host-resolved subdomain. */
  const { slug: resolvedSlug, fromPath } = resolveActiveSlug();
  const loginIncludesSlug = isValidBusinessSlug(linkedCode) || resolvedSlug === null || fromPath;
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passVisible, setPassVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!phone.trim()) {
      setError("No phone number to reset — go back and request a code first.");
      return;
    }
    if (!otp.trim()) {
      setError("Please enter the code sent by SMS.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(phone.trim(), otp.trim(), password, businessCode);
      /* A real navigation, not router.push: the console is a separate
       * document in the static export and the business-first URL that
       * reaches it exists only as a server-side fallback, which Next's
       * client router knows nothing about. See app/page.tsx's header. */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${loginPath(businessCode || null, loginIncludesSlug)}?reset=success`);
    } catch (err) {
      const text =
        err instanceof ApiError
          ? err.message || "This code is invalid or has expired."
          : "This code is invalid or has expired.";
      setError(text);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="wrap">
        <main className="card">

          <div className="brand">
            <BrandLogo size={104} scalable={false} />
            <h1>
              Set a new password
            </h1>
          </div>

          {!phone.trim() ? (
            <>
              <p className="msg show" role="alert" style={{ position: "static", textAlign: "center" }}>
                No phone number to reset — request a code first.
              </p>
              <div className="aux" style={{ justifyContent: "center", marginTop: 18 }}>
                <a href={businessCode ? `/forgot-password?b=${encodeURIComponent(businessCode)}` : "/forgot-password"}>← Request a reset code</a>
              </div>
            </>
          ) : (
          <form noValidate onSubmit={handleSubmit}>
            <div className="field">
              <input
                type="tel"
                id="phone"
                placeholder=" "
                autoComplete="tel"
                required
                value={phone}
                disabled
                readOnly
                title="This is the number the code was sent to and can't be changed here — go back to request a code for a different number."
              />
              <label htmlFor="phone">Phone number</label>
              <span className="bar"></span>
            </div>

            <div className="field">
              <input
                type="text"
                id="otp"
                placeholder=" "
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              <label htmlFor="otp">6-digit code</label>
              <span className="bar"></span>
            </div>

            <div className="field">
              <input
                type={passVisible ? "text" : "password"}
                id="password"
                placeholder=" "
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label htmlFor="password">New password</label>
              <button
                type="button"
                className="eye"
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

            <div className="field">
              <input
                type={confirmVisible ? "text" : "password"}
                id="confirm"
                placeholder=" "
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <label htmlFor="confirm">Confirm new password</label>
              <button
                type="button"
                className="eye"
                aria-label={confirmVisible ? "Hide password" : "Show password"}
                onClick={() => setConfirmVisible((v) => !v)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  style={{ display: confirmVisible ? "none" : "block" }}
                >
                  <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="2.8" />
                </svg>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  style={{ display: confirmVisible ? "block" : "none" }}
                >
                  <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                  <path d="M4 4l16 16" />
                </svg>
              </button>
              <span className="bar"></span>
            </div>

            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Saving…" : "Reset password"}
            </button>
            <p className={`msg${error ? " show" : ""}`} role="alert">
              {error ?? ""}
            </p>

            <div className="aux" style={{ justifyContent: "center" }}>
              <a href={loginPath(businessCode || null, loginIncludesSlug)}>← Back to login</a>
            </div>
          </form>
          )}
        </main>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
