"use client";

import { Suspense, useState } from "react";
import BrandLogo from "@/product/components/BrandLogo";
import { useRouter, useSearchParams } from "next/navigation";
import "@/product/styles/login.css";
import { forgotPassword } from "@/product/services/authService";
import { ApiError } from "@/product/services/httpClient";
import {
  businessCodeForRequest,
  isValidBusinessSlug,
  loginPath,
  resolveActiveSlug,
} from "@/product/services/tenantSession";

function ForgotPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
  const businessCode = isValidBusinessSlug(linkedCode)
    ? linkedCode
    : businessCodeForRequest();
  /* Whether the "Back to login" link below should write businessCode into the
   * URL: yes for an explicit ?b=<slug> link param (as deliberate as a typed
   * path segment) or the bare-install fallback with no path/host match at
   * all, but never for a slug that only came from a host-resolved tenant's
   * subdomain — its address bar never had it. */
  const { slug: resolvedSlug, fromPath } = resolveActiveSlug();
  const loginIncludesSlug =
    isValidBusinessSlug(linkedCode) || resolvedSlug === null || fromPath;

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
      await forgotPassword(trimmed, businessCode);
      router.push(resetHref(trimmed, "sent"));
    } catch (err) {
      // A number that isn't registered (404) or belongs to an employee with
      // no login (403) stays here so it can be corrected; any other failure
      // means the code didn't go out, which the code entry page reports
      // with a "Try again" option.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setError(
          err.message ||
            (err.status === 404
              ? "This phone number is not registered."
              : "This number has no login account."),
        );
        setSubmitting(false);
        return;
      }
      router.push(resetHref(trimmed, "failed"));
    }
  }

  /* The onward link keeps the business, or the reset step would have to ask
   * for a code the employee was never given. */
  function resetHref(number: string, status: "sent" | "failed") {
    const params = new URLSearchParams({ phone: number, sent: status });
    if (businessCode) params.set("b", businessCode);
    return `/reset-password?${params.toString()}`;
  }

  return (
    <div className="login-page">
      <div className="wrap">
        <main className="card">
          <div className="brand">
            <BrandLogo size={104} scalable={false} />
            <h1>Reset your password</h1>
          </div>

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
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
                </svg>
              </span>
              <span className="bar"></span>
            </div>

            <button
              type="submit"
              className="btn"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Sending code…
                </>
              ) : (
                "Send reset code"
              )}
            </button>
            <p className={`msg${error ? " show" : ""}`} role="alert">
              {error ?? ""}
            </p>

            <div className="aux" style={{ justifyContent: "center" }}>
              <a href={loginPath(businessCode || null, loginIncludesSlug)}>
                ← Back to login
              </a>
            </div>
          </form>
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
