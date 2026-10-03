"use client";

import { Suspense, useState } from "react";
import BrandLogo from "@/product/components/BrandLogo";
import { useSearchParams } from "next/navigation";
import "@/product/styles/login.css";
import { forgotPassword, resetPassword, verifyResetCode } from "@/product/services/authService";
import { ApiError } from "@/product/services/httpClient";
import {
  businessCodeForRequest,
  isValidBusinessSlug,
  loginPath,
  resolveActiveSlug,
} from "@/product/services/tenantSession";

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      {visible ? <path d="M4 4l16 16" /> : <circle cx="12" cy="12" r="2.8" />}
    </svg>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();

  // The username and phone number are fixed to whatever "Forgot password"
  // requested a code for — they must NOT be re-typable here. A free-text
  // field would let anyone request a code for one account, then swap in a
  // *different* target before submitting an OTP against it — turning
  // "forgot my own password" into "reset anyone's password, given their
  // details and a leaked/guessed code".
  const username = searchParams.get("u") || "";
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
  const forgotHref = businessCode ? `/forgot-password?b=${encodeURIComponent(businessCode)}` : "/forgot-password";

  /* Two steps on one route: the code is verified first, then the new password
   * gets a screen of its own. The code lives only in component state — never
   * in the URL — so a refresh on the password step returns to the code step. */
  const [step, setStep] = useState<"code" | "password">("code");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passVisible, setPassVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The forgot-password page only navigates here once a code has gone out,
   * so this starts "sent"; it turns "failed" only if a Resend fails. */
  const [sendStatus, setSendStatus] = useState<"sent" | "failed">("sent");
  const [sendError, setSendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  async function handleResend() {
    setResending(true);
    setSendError(null);
    setError(null);
    try {
      await forgotPassword(username, phone, businessCode);
      setSendStatus("sent");
      setOtp("");
    } catch (err) {
      setSendStatus("failed");
      setSendError(err instanceof ApiError && err.message ? err.message : null);
    } finally {
      setResending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otp.trim())) {
      setError("Please enter the 6-digit code sent by SMS.");
      return;
    }
    setSubmitting(true);
    try {
      await verifyResetCode(username, phone, otp.trim(), businessCode);
      setStep("password");
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : "This code is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      await resetPassword(username, phone, otp.trim(), password, businessCode);
      /* A real navigation, not router.push: the console is a separate
       * document in the static export and the business-first URL that
       * reaches it exists only as a server-side fallback, which Next's
       * client router knows nothing about. See app/page.tsx's header. */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${loginPath(businessCode || null, loginIncludesSlug)}?reset=success`);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : "This code is invalid or has expired.");
      setSubmitting(false);
    }
  }

  const backToLogin = (
    <div className="aux" style={{ justifyContent: "center" }}>
      <a href={loginPath(businessCode || null, loginIncludesSlug)}>← Back to login</a>
    </div>
  );

  return (
    <div className="login-page">
      <div className="wrap">
        <main className="card">
          <div className="brand">
            <BrandLogo size={104} scalable={false} />
            <h1>{step === "code" ? "Enter the code" : "Set a new password"}</h1>
          </div>

          {!username.trim() || !phone.trim() ? (
            <>
              <p className="msg show" role="alert" style={{ position: "static", textAlign: "center" }}>
                Nothing to reset — request a code first.
              </p>
              <div className="aux" style={{ justifyContent: "center", marginTop: 18 }}>
                <a href={forgotHref}>← Request a reset code</a>
              </div>
            </>
          ) : step === "code" ? (
            <form noValidate onSubmit={handleVerify}>
              <div className={`status-box ${sendStatus === "sent" ? "ok" : "fail"}`} role="status" aria-live="polite">
                {resending ? (
                  <div>
                    <span className="spinner" aria-hidden="true" />
                    Sending code…
                  </div>
                ) : sendStatus === "sent" ? (
                  <div>A 6-digit code has been sent by SMS to {phone}.</div>
                ) : (
                  <div>{sendError ?? "Sending failed"}</div>
                )}
                <button type="button" onClick={handleResend} disabled={resending}>
                  {sendStatus === "sent" ? "Resend code" : "Try again"}
                </button>
              </div>

              <div className="field">
                <input
                  type="text"
                  id="otp"
                  placeholder=" "
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                />
                <label htmlFor="otp">6-digit code</label>
                <span className="bar"></span>
              </div>

              <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
                {submitting ? "Verifying…" : "Verify code"}
              </button>
              <p className={`msg${error ? " show" : ""}`} role="alert">
                {error ?? ""}
              </p>

              <div className="aux" style={{ justifyContent: "center" }}>
                <a href={forgotHref}>Use a different account</a>
              </div>
            </form>
          ) : (
            <form noValidate onSubmit={handleReset}>
              <div className="field">
                <input
                  type={passVisible ? "text" : "password"}
                  id="password"
                  placeholder=" "
                  autoComplete="new-password"
                  required
                  autoFocus
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
                  <EyeIcon visible={passVisible} />
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
                  <EyeIcon visible={confirmVisible} />
                </button>
                <span className="bar"></span>
              </div>

              <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
                {submitting ? "Saving…" : "Reset password"}
              </button>
              <p className={`msg${error ? " show" : ""}`} role="alert">
                {error ?? ""}
              </p>

              {backToLogin}
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
