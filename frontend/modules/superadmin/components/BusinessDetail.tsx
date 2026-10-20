"use client";

import { useEffect, useState } from "react";
import { DesktopReleaseModal } from "@/modules/superadmin/components/DesktopReleaseModal";
import { DesktopReleaseHistory } from "@/modules/superadmin/components/DesktopReleaseHistory";
import { createPortal } from "react-dom";
import { getBusinessOverview, PAYMENT_MODE_LABELS } from "@/modules/superadmin/services/superadminService";
import { type Business, type BusinessOverview, type SubscriptionPayment, type Tier } from "@/modules/superadmin/types/superadmin-types";
import { DEFAULT_BRAND_COLOR } from "@/modules/superadmin/config/theme";
import { SuperAdminIcon } from "@/modules/superadmin/components/SuperAdminIcon";
import { GrantChips } from "@/modules/superadmin/components/GrantChips";
import { Stat } from "@/modules/superadmin/components/Stat";
import { RecordPaymentModal } from "@/modules/superadmin/components/RecordPaymentModal";
import { RemovePaymentModal } from "@/modules/superadmin/components/RemovePaymentModal";
import { ExpiryModal } from "@/modules/superadmin/components/ExpiryModal";
import { formatDate, formatINR, quotaText, MODULE_LABELS, LANGUAGE_LABELS } from "@/modules/superadmin/utils/dashboardHelpers";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
/* ---------------------------------------------------------------------------
 * Business detail page — opened by clicking a row in the business list.
 *
 * One overview call (GET /superadmin/businesses/:id/overview) supplies the
 * whole page: the business's details, its plan and renewal, how much of the
 * product it is using, the hand-kept payment history and the most recent
 * superadmin actions taken on it. Every figure is for this one business —
 * the backend narrows each query to its id (superadmin/overview.go).
 * ------------------------------------------------------------------------- */

type ActKind = "suspend" | "reactivate" | "tier" | "delete";
type BusinessDetailProps = {
  id: number;
  version: number;
  tiers: Tier[];
  onBack: () => void;
  /* Where the back/actions toolbar renders (above the page's summary cards);
     null until that element mounts, when it renders inline instead. */
  toolbarSlot: HTMLElement | null;
  onEdit: (b: Business) => void;
  onAct: (b: Business, kind: ActKind, activeBranches?: number) => void;
  onChanged: () => void;
  signInLink: (b: Business) => string;
  onCopyLink: (b: Business) => void;
  /* Code of the business whose link was just copied, to flash "Copied". */
  copied: string | null;
};

export function BusinessDetail({
  id,
  version,
  tiers,
  onBack,
  toolbarSlot,
  onEdit,
  onAct,
  onChanged,
  signInLink,
  onCopyLink,
  copied,
}: BusinessDetailProps) {
  const [data, setData] = useState<BusinessOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [removing, setRemoving] = useState<SubscriptionPayment | null>(null);
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    getBusinessOverview(id)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Could not load this business.");
      });
    return () => {
      live = false;
    };
  }, [id, version]);

  const placeToolbar = (bar: React.ReactNode) => (toolbarSlot ? createPortal(bar, toolbarSlot) : bar);
  const backButton = (
    <button className="sa-btn" onClick={onBack}>
      ← All businesses
    </button>
  );

  if (error) {
    return (
      <>
        {placeToolbar(<div className="sa-toolbar sa-detail-toolbar">{backButton}</div>)}
        <p className="sa-error">{error}</p>
      </>
    );
  }
  if (!data)
    return (
      <>
        {placeToolbar(<div className="sa-toolbar sa-detail-toolbar">{backButton}</div>)}
        <p className="sa-empty">Loading…</p>
      </>
    );

  const { business: b, usage: u, payments } = data;
  const plan = tiers.find((t) => t.id === b.tierId) ?? b.tier;
  const atLimit = !u.unlimited && u.branches >= u.branchQuota;
  const expired = b.subscriptionExpiresAt ? new Date(b.subscriptionExpiresAt) < new Date() : false;

  return (
    <div className="sa-detail">
      {placeToolbar(
      <div className="sa-toolbar sa-detail-toolbar">
        {backButton}
        <span className="sa-foot-spacer" />
        <button className="sa-btn" onClick={() => onEdit(b)}>
          Edit details
        </button>
        <button className="sa-btn" onClick={() => onAct(b, "tier", u.branches)}>
          Change plan
        </button>
        <button
          className={`sa-btn${b.status === "suspended" ? " primary" : ""}`}
          onClick={() => onAct(b, b.status === "suspended" ? "reactivate" : "suspend")}
        >
          {b.status === "suspended" ? "Reactivate" : "Suspend"}
        </button>
        <button className="sa-btn danger" onClick={() => onAct(b, "delete")}>
          Delete
        </button>
        <button className="sa-btn" onClick={() => setRebuilding(true)}>
          Rebuild this app
        </button>
      </div>,
      )}

      {rebuilding && (
        <DesktopReleaseModal
          tenant={{ code: b.code, name: b.name }}
          onClose={() => setRebuilding(false)}
          onDone={() => setHistoryRefresh((n) => n + 1)}
        />
      )}

      <section className="sa-panel">
        <h3>Desktop app versions</h3>
        <DesktopReleaseHistory tenantCode={b.code} refreshKey={historyRefresh} />
      </section>

      <section className="sa-panel sa-detail-head">
        {b.logoUrl ? (
          <img className="sa-detail-logo" src={b.logoUrl} alt="" />
        ) : (
          <span className="sa-detail-logo sa-biz-swatch" style={{ background: b.brandColor || DEFAULT_BRAND_COLOR }} />
        )}
        <div className="sa-detail-title">
          <h2>{b.name}</h2>
          <p>
            <code>{b.code}</code> · <span className={`sa-chip ${b.status}`}>{b.status}</span> · created{" "}
            {formatDate(b.createdAt)}
          </p>
          <div className="sa-signin-row">
            <a className="sa-url" href={signInLink(b)} target="_blank" rel="noreferrer">
              {signInLink(b).replace(/^https?:\/\//, "")}
            </a>
            <button type="button" className="sa-btn" onClick={() => onCopyLink(b)} title={signInLink(b)}>
              <SuperAdminIcon name="copy" />
              {copied === b.code ? "Copied" : "Copy sign-in link"}
            </button>
            <a
              className="sa-btn"
              href={signInLink(b)}
              target="_blank"
              rel="noreferrer"
              title={`Open ${signInLink(b)} in a new tab`}
            >
              <SuperAdminIcon name="external" />
              Open in new tab
            </a>
          </div>
        </div>
      </section>

      <section className="sa-cards sa-detail-stats">
        <Stat
          label="Branches"
          value={u.unlimited ? `${u.branches}` : `${u.branches} / ${u.branchQuota}`}
          sub={u.unlimited ? "Unlimited plan" : atLimit ? "At plan limit" : `${u.branchQuota - u.branches} left on plan`}
          tone={atLimit ? "amber" : "violet"}
        />
        <Stat label="Staff" value={u.employees} />
        <Stat label="Customers" value={u.customers} />
        <Stat label="Gold loans" value={u.loansActive} sub={`open · ${u.loansTotal} total`} />
        <Stat label="Outstanding principal" value={formatINR(u.outstandingPrincipal)} sub="open gold loans" />
        <Stat label="Personal loans" value={u.personalLoansActive} sub="active" />
        <Stat label="Investments" value={u.investmentsActive} sub="active" />
        <Stat label="Files" value={u.files} sub={formatBytes(u.storageBytes)} />
      </section>

      <div className="sa-detail-grid">
        <section className="sa-panel">
          <h3>Current plan</h3>
          <dl className="sa-kv">
            <dt>Plan</dt>
            <dd>{plan ? plan.name : `#${b.tierId}`}</dd>
            <dt>Branch allowance</dt>
            <dd>{quotaText(u.branchQuota)}</dd>
            <dt>Branch setup</dt>
            <dd>{b.singleBranch ? "Single branch (Head Office only)" : "Multiple branches"}</dd>
            <dt>Plan price</dt>
            <dd>{plan && plan.priceInPaise > 0 ? `${formatINR(plan.priceInPaise / 100)} / month` : "Not billed"}</dd>
            <dt>Renews / expires</dt>
            <dd style={{ color: expired ? "var(--sa-red)" : undefined }}>
              {formatDate(b.subscriptionExpiresAt)}
              {expired && " (expired)"}{" "}
              <button type="button" className="sa-link-btn" onClick={() => setEditingExpiry(true)}>
                Change
              </button>
            </dd>
            {b.gracePeriodEndsAt && (
              <>
                <dt>Grace period ends</dt>
                <dd>{formatDate(b.gracePeriodEndsAt)}</dd>
              </>
            )}
            <dt>Total paid</dt>
            <dd>{formatINR(data.totalPaidInPaise / 100)}</dd>
            <dt>Last payment</dt>
            <dd>
              {data.lastPayment
                ? `${formatINR(data.lastPayment.amountInPaise / 100)} on ${formatDate(data.lastPayment.paidOn)}`
                : "—"}
            </dd>
            <dt>Last activity</dt>
            <dd>{u.lastActivityAt ? new Date(u.lastActivityAt).toLocaleString("en-IN") : "—"}</dd>
          </dl>
        </section>

        <section className="sa-panel">
          <h3>Business details</h3>
          <dl className="sa-kv">
            <dt>Legal name</dt>
            <dd>{b.legalName || "—"}</dd>
            <dt>Short name</dt>
            <dd>{b.shortName || "—"}</dd>
            <dt>Registered address</dt>
            <dd>{b.addressLine || "—"}</dd>
            <dt>Registration no.</dt>
            <dd>{b.kmlRegNo || "—"}</dd>
            <dt>Document policy</dt>
            <dd>{(b.policy || "kml").toUpperCase()}</dd>
            <dt>Deployment URL</dt>
            <dd>{b.appUrl || "—"}</dd>
            <dt>Modules</dt>
            <dd>
              <GrantChips values={b.modules} labels={MODULE_LABELS} emptyLabel="none" />
            </dd>
            <dt>Languages</dt>
            <dd>
              <GrantChips values={b.languages} labels={LANGUAGE_LABELS} emptyLabel="English" />
            </dd>
          </dl>
        </section>
      </div>

      <section className="sa-panel">
        <div className="sa-panel-head">
          <h3>Payment history</h3>
          <button className="sa-btn primary" onClick={() => setRecording(true)}>
            + Record payment
          </button>
        </div>
        <p className="sa-hint">
          For your records only — payments are not taken through this portal. Recording one does not change the
          business&rsquo;s plan, status or renewal date.
        </p>
        {payments.length === 0 ? (
          <p className="sa-empty">No payments recorded yet.</p>
        ) : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Paid on</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <th>Period</th>
                  <th>Plan</th>
                  <th>Note</th>
                  <th>Recorded by</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.paidOn)}</td>
                    <td>{formatINR(p.amountInPaise / 100)}</td>
                    <td>{PAYMENT_MODE_LABELS[p.mode] ?? p.mode}</td>
                    <td>{p.reference || "—"}</td>
                    <td>
                      {p.periodFrom || p.periodTo ? `${formatDate(p.periodFrom)} – ${formatDate(p.periodTo)}` : "—"}
                    </td>
                    <td>{p.planName || "—"}</td>
                    <td>{p.note || "—"}</td>
                    <td>{p.recordedByName}</td>
                    <td>
                      <button className="sa-btn danger" onClick={() => setRemoving(p)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sa-panel">
        <h3>Recent admin activity</h3>
        {data.recentActivity.length === 0 ? (
          <p className="sa-empty">Nothing recorded yet.</p>
        ) : (
          <ul className="sa-activity">
            {data.recentActivity.map((a) => (
              <li key={a.id}>
                <span className="sa-activity-when">{new Date(a.createdAt).toLocaleString("en-IN")}</span>
                <span>
                  <b>{a.actorName}</b> — {a.detail}
                  {a.reason && <span className="sa-biz-sub">Reason: {a.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recording && (
        <RecordPaymentModal
          business={b}
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            onChanged();
          }}
        />
      )}
      {removing && (
        <RemovePaymentModal
          business={b}
          payment={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            onChanged();
          }}
        />
      )}
      {editingExpiry && (
        <ExpiryModal
          business={b}
          onClose={() => setEditingExpiry(false)}
          onDone={() => {
            setEditingExpiry(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
