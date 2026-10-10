"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import "@/modules/superadmin/styles/superadmin.css";
import { listBusinesses, listTiers, listAuditLog, getCatalogue, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Business, type Tier, type AuditLogEntry, type Catalogue } from "@/modules/superadmin/types/superadmin-types";
import { clearSuperAdminSession, readSuperAdminToken, readSuperAdminUser } from "@/modules/superadmin/services/superadminSession";
import { tenantLoginLink } from "@/modules/superadmin/services/tenantLink";
import { VENDOR } from "@/modules/superadmin/config/brand";
import { DEFAULT_BRAND_COLOR } from "@/modules/superadmin/config/theme";
import { SuperAdminIcon } from "@/modules/superadmin/components/SuperAdminIcon";
import { GrantChips } from "@/modules/superadmin/components/GrantChips";
import { BusinessActionModal } from "@/modules/superadmin/components/BusinessActionModal";
import { TierPriceModal } from "@/modules/superadmin/components/TierPriceModal";
import { BusinessDetail } from "@/modules/superadmin/components/BusinessDetail";
import { BusinessWizard } from "@/modules/superadmin/components/BusinessWizard";
import type { IconName, StepId } from "@/modules/superadmin/types/dashboard-types";
import { formatDate, quotaText, MODULE_LABELS, LANGUAGE_LABELS } from "@/modules/superadmin/utils/dashboardHelpers";

type Tab = "businesses" | "tiers" | "audit";

/* The sidebar's nav model, grouped the way the ERP staff panel groups its
 * own: a short uppercase section label over a handful of icon-led rows.
 *
 * These are VIEWS, not routes — selecting one sets the `tab` state the
 * console already used for its tab strip. Kept as state rather than promoted
 * to real routes because the auth guard, the data loads and the modals all
 * hang off this single page; turning them into routes is a separate change
 * with no visible benefit here.
 *
 * `title`/`subtitle` feed the topbar, so each view names itself in one place
 * instead of the heading drifting from the content under it. */
const NAV: { group: string; items: { id: Tab; label: string; icon: IconName; title: string; subtitle: string }[] }[] = [
  {
    group: "Main Navigation",
    items: [
      {
        id: "businesses",
        label: "Businesses",
        icon: "building",
        title: "Businesses",
        subtitle: "Every tenancy on the platform, and what each is entitled to.",
      },
      {
        id: "tiers",
        label: "Plans & Tiers",
        icon: "layers",
        title: "Plans & Tiers",
        subtitle: "Subscription tiers and the price each one bills at.",
      },
    ],
  },
  {
    group: "Platform",
    items: [
      {
        id: "audit",
        label: "Audit Log",
        icon: "clipboard",
        title: "Audit Log",
        subtitle: "Every vendor action, who took it and why.",
      },
    ],
  },
];

/* The console described in the multi-tenancy plan's Step 7/Section 5:
 * analytics header, tabs, cards and modals rather than deep navigation.
 *
 * Scope now covers Businesses + Tiers + quota + Audit, plus each business's
 * BRANDING and ENTITLEMENTS — its logo, primary colour, legal particulars,
 * deployment URL, optional modules and document languages. Deliberately
 * still nothing from Sessions/force-logout, which remains its own step.
 *
 * The Tiers tab's "Set price" (Step 10) is the one piece of billing that
 * lives here: pricing is the vendor's decision, not a tenant's — everything
 * else about a business's own subscription lives on that business's own
 * Billing screen (modules/billing). */
export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("businesses");
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[] | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* One piece of state for the create/edit wizard. `business: null` means
   * create; `openAt` is the step to land on, so "Branding" on a row opens
   * the wizard already on that step instead of making the operator page
   * through the profile fields first. */
  const [wizard, setWizard] = useState<{ business: Business | null; openAt: StepId } | null>(null);
  // Which business's sign-in link was just copied, to flash "Copied" on that
  // row's button only — briefly, and reset by itself so a stale "Copied"
  // never survives past the next click elsewhere.
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<{
    business: Business;
    kind: "suspend" | "reactivate" | "tier" | "delete";
  } | null>(
    null
  );
  const [pricingTier, setPricingTier] = useState<Tier | null>(null);
  const [user, setUser] = useState<ReturnType<typeof readSuperAdminUser>>(null);
  /* The business whose detail page is open, or null for the list. Bumping
   * detailVersion makes the open detail page refetch after any action. */
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailBar, setDetailBar] = useState<HTMLDivElement | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [detailBranches, setDetailBranches] = useState<number | undefined>(undefined);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const [b, t, a, c] = await Promise.all([listBusinesses(), listTiers(), listAuditLog(), getCatalogue()]);
      setBusinesses(b);
      setTiers(t);
      setAuditLog(a);
      setCatalogue(c);
    } catch (err) {
      if (err instanceof SuperAdminApiError && err.status === 401) {
        clearSuperAdminSession();
        router.replace("/superadmin/login");
        return;
      }
      setLoadError(err instanceof Error ? err.message : "Could not load the console.");
    }
  }, [router]);

  // Every modal's onDone: refresh the list AND any open detail page.
  const afterAction = useCallback(() => {
    void reload();
    setDetailVersion((v) => v + 1);
  }, [reload]);

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

  // The link an operator hands a business. Built from where this console is
  // running (see tenantLoginLink), NOT from the saved appUrl — that value
  // pins the link to one old domain and breaks locally or after a move.
  const businessSignInLink = (b: Business) => tenantLoginLink(b.code);

  async function copySignInLink(b: Business) {
    const link = businessSignInLink(b);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard access can be denied (insecure context, blocked
      // permission) — fall back to a manual-copy prompt rather than leaving
      // the operator thinking the click did nothing.
      window.prompt("Copy this link:", link);
      return;
    }
    setCopiedCode(b.code);
    setTimeout(() => setCopiedCode((c) => (c === b.code ? null : c)), 1500);
  }

  /* The nav entry for the open view, which supplies the topbar's title and
   * subtitle. Falls back to the first entry so the header is never blank. */
  const current = NAV.flatMap((g) => g.items).find((i) => i.id === tab) ?? NAV[0].items[0];

  return (
    <div className="sa-shell">
      <aside className="sa-side">
        <div className="sa-side-brand">
          {/* The vendor's own mark. Never BrandLogo — that resolves the
            * signed-in TENANT's logo, and this console must look the same
            * whichever businesses it is managing. */}
          <img src={VENDOR.markSrc} alt="" />
          <span className="sa-wordmark">
            <b>{VENDOR.shortName}</b>
            <span>{VENDOR.product}</span>
          </span>
        </div>

        <nav className="sa-nav">
          {NAV.map((group) => (
            <div className="sa-nav-group" key={group.group}>
              <p className="sa-nav-label">{group.group}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`sa-nav-item${tab === item.id ? " active" : ""}`}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <SuperAdminIcon name={item.icon} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}

          <div className="sa-nav-group">
            <p className="sa-nav-label">Quick Actions</p>
            <button
              type="button"
              className="sa-nav-item"
              onClick={() => setWizard({ business: null, openAt: "profile" })}
            >
              <SuperAdminIcon name="building" />
              New Business
            </button>
          </div>
        </nav>

        <div className="sa-side-foot">{VENDOR.name}</div>
      </aside>

      <div className="sa-main">
        <header className="sa-topbar">
          <div className="sa-topbar-head">
            <h1>{current.title}</h1>
            <p>{current.subtitle}</p>
          </div>
          <div className="sa-topbar-right">
            {/* Presentational only, and deliberately so: the console has no
              * notification feed and no dark theme to switch to. They are
              * here because the ERP shell this matches has them in the same
              * slot, and leaving the corner empty made the two products look
              * unrelated. Disabled rather than clickable-but-inert, so the
              * chrome never promises something it cannot do. */}
            <button className="sa-icon-btn" type="button" disabled aria-hidden="true" tabIndex={-1}>
              <SuperAdminIcon name="bell" />
            </button>
            <button className="sa-icon-btn" type="button" disabled aria-hidden="true" tabIndex={-1}>
              <SuperAdminIcon name="sun" />
            </button>
            <div className="sa-topbar-user">
              <span className="sa-avatar">
                <SuperAdminIcon name="user" />
              </span>
              {user && <span className="sa-topbar-name">{user.name}</span>}
            </div>
            <button className="sa-btn" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>

        {/* A business's detail toolbar (back + actions) is portaled here, so it
            sits above the summary cards rather than under them. */}
        {tab === "businesses" && detailId !== null && <div ref={setDetailBar} className="sa-detail-bar" />}

        <div className="sa-cards">
          <div className="sa-card">
            <span className="sa-card-icon violet">
              <SuperAdminIcon name="building" />
            </span>
            <div>
              <div className="sa-card-value">{businesses?.length ?? "—"}</div>
              <div className="sa-card-label">Businesses</div>
            </div>
          </div>
          <div className="sa-card">
            <span className="sa-card-icon green">
              <SuperAdminIcon name="building" />
            </span>
            <div>
              <div className="sa-card-value">{businesses?.filter((b) => b.status === "active").length ?? "—"}</div>
              <div className="sa-card-label">Active</div>
            </div>
          </div>
          <div className="sa-card">
            <span className="sa-card-icon amber">
              <SuperAdminIcon name="building" />
            </span>
            <div>
              <div className="sa-card-value">{businesses?.filter((b) => b.status === "suspended").length ?? "—"}</div>
              <div className="sa-card-label">Suspended</div>
            </div>
          </div>
          <div className="sa-card">
            <span className="sa-card-icon blue">
              <SuperAdminIcon name="layers" />
            </span>
            <div>
              <div className="sa-card-value">{tiers?.length ?? "—"}</div>
              <div className="sa-card-label">Plans</div>
            </div>
          </div>
        </div>

        <div className="sa-content">
          {loadError && <p className="sa-error">{loadError}</p>}

          {tab === "businesses" && detailId !== null && tiers && (
            <BusinessDetail
              id={detailId}
              version={detailVersion}
              tiers={tiers}
              onBack={() => setDetailId(null)}
              toolbarSlot={detailBar}
              onEdit={(b) => setWizard({ business: b, openAt: "profile" })}
              onAct={(b, kind, activeBranches) => {
                setDetailBranches(activeBranches);
                setActingOn({ business: b, kind });
              }}
              onChanged={afterAction}
              signInLink={businessSignInLink}
              onCopyLink={copySignInLink}
              copied={copiedCode}
            />
          )}

          {tab === "businesses" && detailId === null && (
            <>
              <div className="sa-toolbar">
                <button className="sa-btn primary" onClick={() => setWizard({ business: null, openAt: "profile" })}>
                  + New business
                </button>
              </div>
              {businesses === null ? (
                <p className="sa-empty">Loading…</p>
              ) : businesses.length === 0 ? (
                <p className="sa-empty">No businesses yet.</p>
              ) : (
                <div className="sa-table-wrap sa-table-wrap-fit">
                  <table className="sa-table sa-table-biz">
                    <thead>
                      <tr>
                        <th>Business</th>
                        <th className="sa-col-code">Code</th>
                        <th>URL</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th>Modules</th>
                        <th>Languages</th>
                        <th>Renewal</th>
                        <th>Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {businesses.map((b) => (
                        <tr
                          key={b.id}
                          className="sa-row-link"
                          title={`Open ${b.name}`}
                          onClick={(e) => {
                            // The row opens the detail page, but its own
                            // buttons, links and toggle keep doing their job.
                            if ((e.target as HTMLElement).closest("button, a, label, input")) return;
                            setDetailId(b.id);
                          }}
                        >
                          <td>
                            <div className="sa-biz">
                              {/* The business's own identity as its staff see
                                * it — a logo when set, otherwise a swatch of
                                * its colour, so a row is recognisable at a
                                * glance even before a logo is uploaded. */}
                              {b.logoUrl ? (
                                <img className="sa-biz-logo" src={b.logoUrl} alt="" />
                              ) : (
                                <span
                                  className="sa-biz-swatch"
                                  style={{ background: b.brandColor || DEFAULT_BRAND_COLOR }}
                                />
                              )}
                              <span>
                                <span className="sa-biz-name">{b.name}</span>
                                {b.legalName && b.legalName !== b.name && (
                                  <span className="sa-biz-sub">{b.legalName}</span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="sa-col-code">
                            <code>{b.code}</code>
                          </td>
                          <td>
                            <a className="sa-url" href={businessSignInLink(b)} target="_blank" rel="noreferrer">
                              {businessSignInLink(b).replace(/^https?:\/\//, "")}
                            </a>
                            <div className="sa-signin-row">
                              <button
                                type="button"
                                className="sa-btn"
                                onClick={() => copySignInLink(b)}
                                title={businessSignInLink(b)}
                              >
                                <SuperAdminIcon name="copy" />
                                {copiedCode === b.code ? "Copied" : "Copy sign-in link"}
                              </button>
                              <a
                                className="sa-icon-btn"
                                href={businessSignInLink(b)}
                                target="_blank"
                                rel="noreferrer"
                                title={`Open ${businessSignInLink(b)} in a new tab`}
                              >
                                <SuperAdminIcon name="external" />
                              </a>
                            </div>
                          </td>
                          <td>
                            {b.tier?.name ?? tierName(b.tierId)}
                            <span className="sa-biz-sub">
                              {b.singleBranch ? "Single branch" : quotaText(b.tier?.branchQuota ?? 1)}
                            </span>
                          </td>
                          <td>
                            <span className={`sa-chip ${b.status}`}>{b.status}</span>
                          </td>
                          <td>
                            <GrantChips values={b.modules} labels={MODULE_LABELS} emptyLabel="none" />
                          </td>
                          <td>
                            <GrantChips values={b.languages} labels={LANGUAGE_LABELS} emptyLabel="English" />
                          </td>
                          <td>
                            {b.subscriptionExpiresAt ? (
                              <span
                                style={{
                                  color:
                                    new Date(b.subscriptionExpiresAt) < new Date() ? "var(--sa-red)" : undefined,
                                }}
                              >
                                {formatDate(b.subscriptionExpiresAt)}
                              </span>
                            ) : (
                              "—"
                            )}
                            {b.gracePeriodEndsAt && (
                              <span className="sa-chip grace" style={{ marginLeft: 6 }}>
                                grace ends {formatDate(b.gracePeriodEndsAt)}
                              </span>
                            )}
                          </td>
                          {/* View, Edit and Delete live on the detail page — the
                            * row itself opens it. Only the quick on/off switch
                            * stays here. */}
                          <td className="sa-actions">
                            <label
                              className="sa-toggle"
                              title={b.status === "suspended" ? "Reactivate business" : "Suspend business"}
                            >
                              <input
                                type="checkbox"
                                checked={b.status !== "suspended"}
                                onChange={() =>
                                  setActingOn({
                                    business: b,
                                    kind: b.status === "suspended" ? "reactivate" : "suspend",
                                  })
                                }
                              />
                              <span className="sa-toggle-track">
                                <span className="sa-toggle-thumb" />
                              </span>
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === "tiers" && (
            <div className="sa-table-wrap">
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
                      <td>{quotaText(t.branchQuota)}</td>
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
            </div>
          )}

          {tab === "audit" && (
            <div className="sa-table-wrap">
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
            </div>
          )}
        </div>
      </div>

      {/* ONE wizard for both creating and editing. It used to be three
        * separate modals (create / edit profile / branding), which meant the
        * same fields were declared three times and the create form was a
        * single scroll far longer than the viewport. `business` null means
        * create; otherwise it edits that business, opened at the step the
        * operator clicked. */}
      {wizard && tiers && catalogue && (
        <BusinessWizard
          business={wizard.business}
          openAt={wizard.openAt}
          tiers={tiers}
          catalogue={catalogue}
          onClose={() => setWizard(null)}
          onDone={afterAction}
        />
      )}
      {actingOn && (
        <BusinessActionModal
          business={actingOn.business}
          kind={actingOn.kind}
          tiers={tiers ?? []}
          activeBranches={detailBranches}
          onClose={() => {
            setActingOn(null);
            setDetailBranches(undefined);
          }}
          onDone={() => {
            // A deleted business has no detail page left to show.
            if (actingOn.kind === "delete") setDetailId(null);
            afterAction();
          }}
        />
      )}
      {pricingTier && <TierPriceModal tier={pricingTier} onClose={() => setPricingTier(null)} onDone={afterAction} />}
    </div>
  );
}
