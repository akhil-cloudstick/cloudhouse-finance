"use client";

import { Suspense, useState } from "react";
import BrandLogo from "@/common/components/BrandLogo";
import { useRouter, useSearchParams } from "next/navigation";
import "../login.css";
import { forgotPassword } from "@/common/services/authService";
import { businessCodeForRequest, isValidBusinessSlug, loginPath } from "@/common/services/tenantSession";

function ForgotPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The business comes from ?b=<slug> on the link the login page built,
   * falling back to the last business used on this browser.
   *
   * It has to be carried: a phone number is unique only WITHIN a business
   * now, so without it the backend cannot tell which employee is asking —
   * and with several businesses it cannot pick one without guessing. A query
   * parameter rather than a path segment because this is a step in a flow,
   * not a bookmarkable business identity. */
  const linkedCode = searchParams.get("b")?.trim().toLowerCase() ?? "";
  const businessCode = isValidBusinessSlug(linkedCode) ? linkedCode : businessCodeForRequest();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = phone.trim();
    if (!trimmed) {
      setError("Please enter your phone number.");
      return;
    }
    setSubmitting(true);
    try {
      // Ignore the actual outcome — the backend never reveals whether a
      // phone number is registered, and we don't want to either.
      await forgotPassword(trimmed, businessCode).catch(() => {});
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  /* Both onward links keep the business, or the reset step would have to ask
   * for a code the employee was never given. */
  function resetHref() {
    const params = new URLSearchParams({ phone: phone.trim() });
    if (businessCode) params.set("b", businessCode);
    return `/reset-password?${params.toString()}`;
  }

  return (
    <div className="login-page">
      <div className="wrap">
        <main className="card">

          <div className="brand">
            <BrandLogo size={104} scalable={false} />
            <h1>
              Reset your password
            </h1>
          </div>

          {sent ? (
            <>
              <p className="msg show ok" role="status" style={{ position: "static", textAlign: "center" }}>
                If that phone number is registered, a reset code has been sent by SMS.
              </p>
              <div className="aux" style={{ justifyContent: "center", marginTop: 18 }}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(resetHref());
                  }}
                >
                  Enter the code →
                </a>
              </div>
              <div className="aux" style={{ justifyContent: "center", marginTop: 8 }}>
                <a href={loginPath(businessCode || null)}>← Back to login</a>
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
                  onChange={(e) => setPhone(e.target.value)}
                />
                <label htmlFor="phone">Phone number</label>
                <span className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
                  </svg>
                </span>
                <span className="bar"></span>
              </div>

              <button type="submit" className="btn" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset code"}
              </button>
              <p className={`msg${error ? " show" : ""}`} role="alert">
                {error ?? ""}
              </p>

              <div className="aux" style={{ justifyContent: "center" }}>
                <a href={loginPath(businessCode || null)}>← Back to login</a>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordInner />
    </Suspense>
  );
}
