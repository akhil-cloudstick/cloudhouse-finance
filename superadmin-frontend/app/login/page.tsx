"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login, SuperAdminApiError } from "@/common/services/superadminService";
import { readSuperAdminToken, writeSuperAdminSession } from "@/common/services/superadminSession";
import { VENDOR } from "@/common/config/brand";
import "../superadmin.css";

/* Deliberately plain and separate from the tenant login page's styling
 * (app/login/page.tsx) — a different audience (our own team), a different
 * JWT scheme, no business slug, no "forgot password"/OTP flow. Keeping it
 * visually distinct is itself a small safety feature: nobody should be able
 * to mistake this page for a tenant's own sign-in link. */
export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readSuperAdminToken()) router.replace("/");
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
      router.push("/");
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-login">
      <form className="sa-login-card" onSubmit={handleSubmit}>
        {/* The VENDOR's mark, never a tenant's — this page belongs to us and
          * must not re-brand to whichever business was last signed in. Plain
          * <img> rather than BrandLogo for exactly that reason: BrandLogo
          * resolves the tenant's logo through BrandingProvider. */}
        <div className="sa-login-brand">
          <img src={VENDOR.markSrc} alt="" />
          <span className="sa-wordmark">
            <b>{VENDOR.name}</b>
            <span>{VENDOR.product}</span>
          </span>
        </div>
        <h1>Sign in</h1>
        <p className="sa-muted">Manage every business on this deployment.</p>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="sa-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
