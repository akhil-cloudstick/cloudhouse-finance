"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import "./superadmin.css";
import {
  listBusinesses,
  listTiers,
  listAuditLog,
  createBusiness,
  suspendBusiness,
  reactivateBusiness,
  changeTier,
  setTierPrice,
  SuperAdminApiError,
  type Business,
  type Tier,
  type AuditLogEntry,
  type CreateBusinessInput,
} from "@/common/services/superadminService";
import { clearSuperAdminSession, readSuperAdminToken, readSuperAdminUser } from "@/common/services/superadminSession";
import { loginPath } from "@/common/services/tenantSession";

type Tab = "businesses" | "tiers" | "audit";

/* The console described in the multi-tenancy plan's Step 7/Section 5:
 * analytics header, tabs, cards and modals rather than deep navigation. This
 * first pass covers exactly the scope decided on — Businesses + Tiers +
 * quota + Audit — and deliberately nothing from Sessions/force-logout, which
 * remains its own step. The Tiers tab's "Set price" (Step 10) is the one
 * piece of billing that lives here: pricing is the vendor's decision, not a
 * tenant's — everything else about a business's own subscription lives on
 * that business's own Billing screen (modules/billing). */
export default function SuperAdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("businesses");
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actingOn, setActingOn] = useState<{ business: Business; kind: "suspend" | "reactivate" | "tier" } | null>(
    null
  );
  const [pricingTier, setPricingTier] = useState<Tier | null>(null);
  const [user, setUser] = useState<ReturnType<typeof readSuperAdminUser>>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const [b, t, a] = await Promise.all([listBusinesses(), listTiers(), listAuditLog()]);
      setBusinesses(b);
      setTiers(t);
      setAuditLog(a);
    } catch (err) {
      if (err instanceof SuperAdminApiError && err.status === 401) {
        clearSuperAdminSession();
        router.replace("/superadmin/login");
        return;
      }
      setLoadError(err instanceof Error ? err.message : "Could not load the console.");
    }
  }, [router]);

  useEffect(() => {
    if (!readSuperAdminToken()) {
      router.replace("/superadmin/login");
      return;
    }
    setUser(readSuperAdminUser());
    void reload();
  }, [reload, router]);

  function handleLogout() {
    clearSuperAdminSession();
    router.replace("/superadmin/login");
  }

  const tierName = (id: number) => tiers?.find((t) => t.id === id)?.name ?? `#${id}`;

  return (
    <div className="sa-shell">
      <header className="sa-topbar">
        <h1>Superadmin console</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {user && <span style={{ fontSize: 13, color: "#8b909c" }}>{user.name}</span>}
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div className="sa-cards">
        <div className="sa-card">
          <div className="sa-card-label">Businesses</div>
          <div className="sa-card-value">{businesses?.length ?? "—"}</div>
        </div>
        <div className="sa-card">
          <div className="sa-card-label">Active</div>
          <div className="sa-card-value">{businesses?.filter((b) => b.status === "active").length ?? "—"}</div>
        </div>
        <div className="sa-card">
          <div className="sa-card-label">Suspended</div>
          <div className="sa-card-value">{businesses?.filter((b) => b.status === "suspended").length ?? "—"}</div>
        </div>
        <div className="sa-card">
          <div className="sa-card-label">Plans</div>
          <div className="sa-card-value">{tiers?.length ?? "—"}</div>
        </div>
      </div>

      <nav className="sa-tabs">
        {(["businesses", "tiers", "audit"] as Tab[]).map((t) => (
          <button key={t} className={`sa-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "businesses" ? "Businesses" : t === "tiers" ? "Tiers" : "Audit log"}
          </button>
        ))}
      </nav>

      <div className="sa-content">
        {loadError && <p className="sa-error">{loadError}</p>}

        {tab === "businesses" && (
          <>
            <div className="sa-toolbar">
              <button className="sa-btn primary" onClick={() => setShowCreate(true)}>
                + New business
              </button>
            </div>
            {businesses === null ? (
              <p className="sa-empty">Loading…</p>
            ) : businesses.length === 0 ? (
              <p className="sa-empty">No businesses yet.</p>
            ) : (
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Link</th>
                    <th>Tier</th>
                    <th>Status</th>
                    <th>Renewal</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {businesses.map((b) => (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td>
                        <code>{b.code}</code>
                      </td>
                      <td>
                        <button
                          className="sa-btn"
                          onClick={() => {
                            const link = `${window.location.origin}${loginPath(b.code)}`;
                            navigator.clipboard.writeText(link);
                          }}
                          title={`${window.location.origin}${loginPath(b.code)}`}
                        >
                          Copy link
                        </button>
                      </td>
                      <td>{b.tier?.name ?? tierName(b.tierId)}</td>
                      <td>
                        <span className={`sa-chip ${b.status}`}>{b.status}</span>
                      </td>
                      <td>
                        {b.subscriptionExpiresAt ? (
                          <span style={{ color: new Date(b.subscriptionExpiresAt) < new Date() ? "#c0392b" : undefined }}>
                            {new Date(b.subscriptionExpiresAt).toLocaleDateString()}
                          </span>
                        ) : (
                          "—"
                        )}
                        {b.gracePeriodEndsAt && (
                          <span className="sa-chip grace" style={{ marginLeft: 6 }}>
                            grace ends {new Date(b.gracePeriodEndsAt).toLocaleDateString()}
                          </span>
                        )}
                      </td>
                      <td>{new Date(b.createdAt).toLocaleDateString()}</td>
                      <td className="sa-actions">
                        {b.status === "suspended" ? (
                          <button className="sa-btn" onClick={() => setActingOn({ business: b, kind: "reactivate" })}>
                            Reactivate
                          </button>
                        ) : (
                          <button
                            className="sa-btn danger"
                            onClick={() => setActingOn({ business: b, kind: "suspend" })}
                          >
                            Suspend
                          </button>
                        )}
                        <button className="sa-btn" onClick={() => setActingOn({ business: b, kind: "tier" })}>
                          Change tier
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "tiers" && (
          <table className="sa-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Branch quota</th>
                <th>Monthly price</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(tiers ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.branchQuota}</td>
                  <td>{t.priceInPaise > 0 ? `₹${(t.priceInPaise / 100).toLocaleString("en-IN")}` : "Not billed"}</td>
                  <td>{t.isActive ? "Yes" : "No"}</td>
                  <td>
                    <button className="sa-btn" onClick={() => setPricingTier(t)}>
                      Set price
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "audit" && (
          <table className="sa-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Business</th>
                <th>Detail</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {(auditLog ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.actorName}</td>
                  <td>{e.action}</td>
                  <td>{e.tenantName || "—"}</td>
                  <td>{e.detail}</td>
                  <td>{e.reason}</td>
                </tr>
              ))}
              {(auditLog ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="sa-empty">
                    No actions logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && tiers && (
        <CreateBusinessModal tiers={tiers} onClose={() => setShowCreate(false)} onCreated={reload} />
      )}
      {actingOn && (
        <BusinessActionModal
          business={actingOn.business}
          kind={actingOn.kind}
          tiers={tiers ?? []}
          onClose={() => setActingOn(null)}
          onDone={reload}
        />
      )}
      {pricingTier && (
        <TierPriceModal tier={pricingTier} onClose={() => setPricingTier(null)} onDone={reload} />
      )}
    </div>
  );
}

function CreateBusinessModal({
  tiers,
  onClose,
  onCreated,
}: {
  tiers: Tier[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateBusinessInput>({
    name: "",
    code: "",
    tierId: tiers[0]?.id ?? 0,
    adminUsername: "admin",
    adminPassword: "",
    adminName: "",
    reason: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createBusiness(form);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not create the business.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New business</h2>
        <div className="sa-field">
          <label>Business name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="sa-field">
          <label>
            Sign-in code (used in /login/&lt;code&gt; — treat as permanent once shared)
          </label>
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
            placeholder="lowercase-letters-numbers-dashes"
            required
          />
        </div>
        <div className="sa-field">
          <label>Tier</label>
          <select
            value={form.tierId}
            onChange={(e) => setForm({ ...form, tierId: Number(e.target.value) })}
          >
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.branchQuota} branch{t.branchQuota === 1 ? "" : "es"})
              </option>
            ))}
          </select>
        </div>
        <div className="sa-field">
          <label>Initial admin username</label>
          <input
            value={form.adminUsername}
            onChange={(e) => setForm({ ...form, adminUsername: e.target.value })}
            required
          />
        </div>
        <div className="sa-field">
          <label>Initial admin password (at least 8 characters)</label>
          <input
            type="password"
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
            required
            minLength={8}
          />
        </div>
        <div className="sa-field">
          <label>Reason (required — recorded in the audit log)</label>
          <textarea
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            rows={2}
            required
          />
        </div>
        {error && <p className="sa-error">{error}</p>}
        <div className="sa-modal-actions">
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create business"}
          </button>
        </div>
      </form>
    </div>
  );
}

function BusinessActionModal({
  business,
  kind,
  tiers,
  onClose,
  onDone,
}: {
  business: Business;
  kind: "suspend" | "reactivate" | "tier";
  tiers: Tier[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [tierId, setTierId] = useState(business.tierId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    kind === "suspend" ? "Suspend business" : kind === "reactivate" ? "Reactivate business" : "Change tier";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      if (kind === "suspend") await suspendBusiness(business.id, reason);
      else if (kind === "reactivate") await reactivateBusiness(business.id, reason);
      else await changeTier(business.id, tierId, reason);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "The action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>
          {title} — {business.name}
        </h2>
        {kind === "suspend" && (
          <p style={{ fontSize: 13, color: "#6b7080", marginTop: -8, marginBottom: 14 }}>
            Restricts new lending and administration only. Never blocks a borrower repaying or collecting gold they
            have already paid for.
          </p>
        )}
        {kind === "tier" && (
          <div className="sa-field">
            <label>New tier</label>
            <select value={tierId} onChange={(e) => setTierId(Number(e.target.value))}>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.branchQuota} branch{t.branchQuota === 1 ? "" : "es"})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="sa-field">
          <label>Reason (required — recorded in the audit log)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required />
        </div>
        {error && <p className="sa-error">{error}</p>}
        <div className="sa-modal-actions">
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`sa-btn ${kind === "suspend" ? "danger" : "primary"}`} disabled={submitting}>
            {submitting ? "Working…" : title}
          </button>
        </div>
      </form>
    </div>
  );
}

/* Sets a tier's monthly Razorpay subscription price (plan Step 10).
 * Vendor-only pricing lever — deliberately absent from anything a tenant's
 * own admin can reach; see superadmin.Service.SetTierPrice's doc comment
 * for why changing it never mutates an in-flight subscription's price. */
function TierPriceModal({
  tier,
  onClose,
  onDone,
}: {
  tier: Tier;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rupees, setRupees] = useState(String(tier.priceInPaise / 100));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(rupees);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a valid, non-negative amount.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await setTierPrice(tier.id, Math.round(value * 100), reason);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "The action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Set price — {tier.name}</h2>
        <p style={{ fontSize: 13, color: "#6b7080", marginTop: -8, marginBottom: 14 }}>
          Existing subscribers keep billing at their current price until they resubscribe or renew — this only
          affects the NEXT subscription created against this tier.
        </p>
        <div className="sa-field">
          <label>Monthly price (₹)</label>
          <input type="number" min={0} step="1" value={rupees} onChange={(e) => setRupees(e.target.value)} required />
        </div>
        <div className="sa-field">
          <label>Reason (required — recorded in the audit log)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required />
        </div>
        {error && <p className="sa-error">{error}</p>}
        <div className="sa-modal-actions">
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn primary" disabled={submitting}>
            {submitting ? "Working…" : "Set price"}
          </button>
        </div>
      </form>
    </div>
  );
}
