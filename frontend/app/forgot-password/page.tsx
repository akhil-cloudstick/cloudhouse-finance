"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "../login.css";
import { forgotPassword } from "@/lib/authApi";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await forgotPassword(trimmed).catch(() => {});
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  return (
    <div className="login-page">
      <div className="wrap">
        <main className="card">
          <span className="stud tl"></span>
          <span className="stud tr"></span>
          <span className="stud bl"></span>
          <span className="stud br"></span>

          <div className="brand">
            <img src="/ambika-gold.jpeg" alt="Ambika Gold Finance logo" />
            <h1>
              Reset your <span className="gilt">password</span>
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
                    router.push(`/reset-password?phone=${encodeURIComponent(phone.trim())}`);
                  }}
                >
                  Enter the code →
                </a>
              </div>
              <div className="aux" style={{ justifyContent: "center", marginTop: 8 }}>
                <a href="/login">← Back to login</a>
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
                <span className="shine" aria-hidden="true"></span>
              </button>
              <p className={`msg${error ? " show" : ""}`} role="alert">
                {error ?? ""}
              </p>

              <div className="aux" style={{ justifyContent: "center" }}>
                <a href="/login">← Back to login</a>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
