"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import "../login.css";
import { resetPassword } from "@/lib/authApi";
import { ApiError } from "@/lib/api";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!phone.trim()) {
      setError("Please enter your phone number.");
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
      await resetPassword(phone.trim(), otp.trim(), password);
      router.push("/login?reset=success");
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
          <span className="stud tl"></span>
          <span className="stud tr"></span>
          <span className="stud bl"></span>
          <span className="stud br"></span>

          <div className="brand">
            <img src="/ambika-gold.jpeg" alt="Ambika Gold Finance logo" />
            <h1>
              Set a new <span className="gilt">password</span>
            </h1>
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
                type="password"
                id="password"
                placeholder=" "
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label htmlFor="password">New password</label>
              <span className="bar"></span>
            </div>

            <div className="field">
              <input
                type="password"
                id="confirm"
                placeholder=" "
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <label htmlFor="confirm">Confirm new password</label>
              <span className="bar"></span>
            </div>

            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Saving…" : "Reset password"}
              <span className="shine" aria-hidden="true"></span>
            </button>
            <p className={`msg${error ? " show" : ""}`} role="alert">
              {error ?? ""}
            </p>

            <div className="aux" style={{ justifyContent: "center" }}>
              <a href="/login">← Back to login</a>
            </div>
          </form>
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
