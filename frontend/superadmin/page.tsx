"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import "@/superadmin/styles/superadmin.css";
import {
  listBusinesses,
  listTiers,
  listAuditLog,
  getCatalogue,
  createBusiness,
  suspendBusiness,
  reactivateBusiness,
  deleteBusiness,
  changeTier,
  setTierPrice,
  updateProfile,
  setBranding,
  setModules,
  setLanguages,
  uploadLogo,
  getAdminLogin,
  updateAdminLogin,
  adjustExpiry,
  getBusinessOverview,
  recordPayment,
  deletePayment,
  PAYMENT_MODE_LABELS,
  SuperAdminApiError,
  type Business,
  type BusinessOverview,
  type PaymentMode,
  type SubscriptionPayment,
  type Tier,
  type AuditLogEntry,
  type Catalogue,
} from "@/superadmin/services/superadminService";
import { clearSuperAdminSession, readSuperAdminToken, readSuperAdminUser } from "@/superadmin/services/superadminSession";
import { tenantLoginLink } from "@/superadmin/services/tenantLink";
import { VENDOR } from "@/superadmin/config/brand";
import { Select } from "@/superadmin/components/Select";
import {
  brandRampHex,
  DEFAULT_BRAND_COLOR,
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY,
  FONT_SCALES,
  DEFAULT_FONT_SCALE,
  LOGO_SCALES,
  DEFAULT_LOGO_SCALE,
  LOGO_DISPLAYS,
  DEFAULT_LOGO_DISPLAY,
} from "@/superadmin/config/theme";
import { extractPaletteFromImage } from "@/superadmin/services/dominantColor";

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

type IconName = "building" | "layers" | "clipboard" | "bell" | "sun" | "user" | "copy" | "external";

/* A plan's branch allowance in words. branchQuota 0 is the backend's
 * "unlimited" (tenant.UnlimitedBranches) — never render it as "0 branches". */
function quotaText(quota: number): string {
  if (quota === 0) return "Unlimited branches";
  return `${quota} branch${quota === 1 ? "" : "es"}`;
}

function planLabel(t: Tier): string {
  return `${t.name} (${quotaText(t.branchQuota)})`;
}

function planLabelFor(tiers: Tier[], id: number): string {
  const t = tiers.find((x) => x.id === id);
  return t ? planLabel(t) : `#${id}`;
}

function formatINR(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

/* Inline SVGs rather than an icon package. This console's dependencies are
 * next + react and nothing else, deliberately, and six glyphs do not justify
 * changing that. All are 24x24 stroke icons on currentColor so they take the
 * colour of whatever row they sit in. */
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    building: (
      <>
        <path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16M13 21V9h5a1 1 0 0 1 1 1v11" />
        <path d="M8 8h2M8 12h2M8 16h2M16 13h1M16 17h1" />
      </>
    ),
    layers: (
      <>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="m3 13 9 5 9-5M3 18l9 5 9-5" />
      </>
    ),
    clipboard: (
      <>
        <path d="M9 4h6v3H9zM9 5H7a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
        <path d="M9 12h6M9 16h4" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="1.5" />
        <path d="M6 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v1" />
      </>
    ),
    external: (
      <>
        <path d="M14 4h6v6M20 4 11 13" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </>
    ),
  };
  return (
    <svg
      className="sa-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

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
export default function SuperAdminDashboard() {
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
                  <Icon name={item.icon} />
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
              <Icon name="building" />
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
              <Icon name="bell" />
            </button>
            <button className="sa-icon-btn" type="button" disabled aria-hidden="true" tabIndex={-1}>
              <Icon name="sun" />
            </button>
            <div className="sa-topbar-user">
              <span className="sa-avatar">
                <Icon name="user" />
              </span>
              {user && <span className="sa-topbar-name">{user.name}</span>}
            </div>
            <button className="sa-btn" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>

        <div className="sa-cards">
          <div className="sa-card">
            <span className="sa-card-icon violet">
              <Icon name="building" />
            </span>
            <div>
              <div className="sa-card-value">{businesses?.length ?? "—"}</div>
              <div className="sa-card-label">Businesses</div>
            </div>
          </div>
          <div className="sa-card">
            <span className="sa-card-icon green">
              <Icon name="building" />
            </span>
            <div>
              <div className="sa-card-value">{businesses?.filter((b) => b.status === "active").length ?? "—"}</div>
              <div className="sa-card-label">Active</div>
            </div>
          </div>
          <div className="sa-card">
            <span className="sa-card-icon amber">
              <Icon name="building" />
            </span>
            <div>
              <div className="sa-card-value">{businesses?.filter((b) => b.status === "suspended").length ?? "—"}</div>
              <div className="sa-card-label">Suspended</div>
            </div>
          </div>
          <div className="sa-card">
            <span className="sa-card-icon blue">
              <Icon name="layers" />
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
                                <Icon name="copy" />
                                {copiedCode === b.code ? "Copied" : "Copy sign-in link"}
                              </button>
                              <a
                                className="sa-icon-btn"
                                href={businessSignInLink(b)}
                                target="_blank"
                                rel="noreferrer"
                                title={`Open ${businessSignInLink(b)} in a new tab`}
                              >
                                <Icon name="external" />
                              </a>
                            </div>
                          </td>
                          <td>
                            {b.tier?.name ?? tierName(b.tierId)}
                            <span className="sa-biz-sub">{quotaText(b.tier?.branchQuota ?? 1)}</span>
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

/* Human labels for the closed sets. The KEYS come from the backend
 * (/superadmin/catalogue → tenant.KnownModules/KnownLanguages) so the
 * console can never offer something the server would reject; only the
 * wording lives here. An unknown key falls back to the key itself rather
 * than rendering blank, so a backend that adds a module before this map
 * does still shows something usable. */
/* Keys must match tenant.KnownModules in backend/internal/tenant/branding.go
 * exactly — that slice is the closed set, and a key here with no counterpart
 * there is silently dropped on save. */
/* The theme presets are stored as lowercase keys ("compact", "light-pad") and
   shown title-cased. Was inline in four places before the dropdowns moved to
   the Select component, which takes a label rather than children. */
function titleCase(key: string) {
  return key[0].toUpperCase() + key.slice(1);
}

const MODULE_LABELS: Record<string, string> = {
  settings: "Settings",
  branches: "Branch Management",
  demo_reset: "Demo Reset",
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  ml: "Malayalam",
  gu: "Gujarati",
};

const MODULE_HINTS: Record<string, string> = {
  settings: "The Settings page (integration API keys).",
  branches: "The Branch Management page. Branches themselves keep working either way — only administering them is hidden.",
  demo_reset:
    "Lets this business wipe its own data back to the admin login, optionally reloading the demo dataset. Leave OFF for a live client — every other module hides a page, this one hands out a delete button.",
};

/* Modules whose grant is irreversible in effect rather than merely
 * revealing a page. Rendered with the danger styling so it does not read as
 * just another tickbox in a list of pages. */
const DESTRUCTIVE_MODULES = new Set(["demo_reset"]);

const LANGUAGE_HINTS: Record<string, string> = {
  en: "Always available; cannot be turned off.",
  ml: "Pledge agreement and release form in Malayalam.",
  gu: "Pledge agreement and release form in Gujarati. Note this is the Gujarat branch's own formal deed, not a translation of the English/Malayalam letter.",
};

function GrantChips({
  values,
  labels,
  emptyLabel,
}: {
  values: string[];
  labels: Record<string, string>;
  emptyLabel: string;
}) {
  if (!values?.length) return <span className="sa-chip off">{emptyLabel}</span>;
  return (
    <span className="sa-chips">
      {values.map((v) => (
        <span key={v} className="sa-chip tag">
          {labels[v] ?? v}
        </span>
      ))}
    </span>
  );
}

/* Shows the six steps deriveBrandRamp produces from one pick, so the
 * operator sees the whole palette before saving rather than only the
 * primary — the derived shades are what most of the app actually paints
 * with (fills, hovers, pale backgrounds). */
function RampPreview({ hex }: { hex: string }) {
  const ramp = brandRampHex(hex || DEFAULT_BRAND_COLOR);
  return (
    <div className="sa-ramp" title="The full palette derived from this colour">
      {Object.entries(ramp).map(([token, value]) => (
        <span key={token} style={{ background: value }} title={`${token} ${value}`} />
      ))}
    </div>
  );
}


function ReasonField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required: boolean;
}) {
  return (
    <div className="sa-field">
      <label>{required ? "Reason (required — recorded in the audit log)" : "Reason (optional)"}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} required={required} />
      <span className="sa-hint">
        {required
          ? "Creating, suspending or re-tiering a business always records why."
          : "This action is audited either way; a reason is recorded only if you give one."}
      </span>
    </div>
  );
}

/* The wizard's steps. `admin` sets the first login on create; on edit it is
 * how the vendor resets that login for an owner who has forgotten it. */
type StepId = "profile" | "branding" | "grants" | "admin" | "review";

type Step = { id: StepId; label: string };

function stepsFor(isCreate: boolean): Step[] {
  const steps: Step[] = [
    { id: "profile", label: "Business" },
    { id: "branding", label: "Branding" },
    { id: "grants", label: "Modules & languages" },
  ];
  steps.push({ id: "admin", label: isCreate ? "Administrator" : "Admin login" });
  steps.push({ id: "review", label: "Review" });
  return steps;
}

function toggle(list: string[], key: string): string[] {
  const set = new Set(list);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set];
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/* One modal for creating AND editing a business.
 *
 * It replaces three separate modals that each redeclared the same fields, and
 * a create form that ran well past the bottom of the viewport — so the Cancel
 * and Create buttons sat below the fold and you had to scroll to discover the
 * form could be submitted at all. Here the header and footer are pinned and
 * only the step body scrolls, so the actions are always reachable.
 *
 * Save semantics differ by mode, and the difference is the reason this is one
 * component rather than two:
 *
 *   CREATE — one POST. The business does not exist yet, so everything goes in
 *            a single atomic call (superadmin.Service.CreateBusiness is one
 *            transaction across four domains).
 *   EDIT   — one call PER CHANGED SECTION, run sequentially. Profile, colour,
 *            logo, modules and languages are separate audited endpoints, so an
 *            unchanged section is not written at all and the audit log records
 *            what actually changed instead of five identical rows every time.
 *            Sequential rather than parallel because they all read-modify-write
 *            the same tenant row.
 */
function BusinessWizard({
  business,
  openAt,
  tiers,
  catalogue,
  onClose,
  onDone,
}: {
  business: Business | null;
  openAt: StepId;
  tiers: Tier[];
  catalogue: Catalogue;
  onClose: () => void;
  onDone: () => void;
}) {
  const isCreate = business === null;
  const steps = stepsFor(isCreate);
  const [stepIdx, setStepIdx] = useState(() => {
    const i = steps.findIndex((s) => s.id === openAt);
    return i >= 0 ? i : 0;
  });
  // Which steps the operator has actually reached. In create mode this gates
  // jumping ahead; in edit mode every step is reachable from the start,
  // because the business already exists and nothing is required.
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0, stepIdx]));

  const [name, setName] = useState(business?.name ?? "");
  const [code, setCode] = useState("");
  const [tierId, setTierId] = useState(business?.tierId ?? tiers[0]?.id ?? 0);
  const [legalName, setLegalName] = useState(business?.legalName ?? "");
  const initialShortName = business?.shortName ?? "";
  const [shortName, setShortName] = useState(initialShortName);
  const initialTagline = business?.lockupTagline ?? "";
  const [tagline, setTagline] = useState(initialTagline);
  /* The tagline starts as a MIRROR of the business name — that is the right
   * answer for a business whose sidebar headline is a short code, which is
   * the case we most often type in — and stops mirroring the moment the
   * vendor edits it. Seeded true when editing an existing business so a saved
   * tagline is never silently overwritten by a rename. */
  const [taglineTouched, setTaglineTouched] = useState(!isCreate);
  const [addressLine, setAddressLine] = useState(business?.addressLine ?? "");
  const [kmlRegNo, setKmlRegNo] = useState(business?.kmlRegNo ?? "");
  /* The document policy — which FAMILY of customer-facing paperwork this
   * business issues. Chosen before languages, because it decides which
   * languages are offered at all (see policyLanguages below). Defaults to the
   * catalogue's first policy on create; an existing business with an empty
   * value predates the field and is on the backend's KML default. */
  const initialPolicy = business?.policy || catalogue.policies[0]?.code || "";
  const [policy, setPolicyState] = useState(initialPolicy);
  const [appUrl, setAppUrl] = useState(business?.appUrl ?? "");

  const initialColor = business?.brandColor || DEFAULT_BRAND_COLOR;
  const [color, setColor] = useState(initialColor);
  const initialSecondary = business?.secondaryColor || "";
  const [secondaryColor, setSecondaryColor] = useState(initialSecondary);
  // accentColor is DELIBERATELY always sent as "" now, same treatment as
  // sidebarColor below — it had exactly ONE visible use in the whole
  // product (a small login-panel divider's gradient stop), and asking every
  // business to pick a 3rd colour for that one line wasn't worth the
  // confusion. Sending "" clears any value a business set while this field
  // still existed.
  const accentColor = "";
  // sidebarColor is DELIBERATELY always sent as "" now, not carried through
  // from business.sidebarColor. It briefly had its own console field before
  // Secondary colour took over that job; a business that set one during
  // that window keeps a value in the database that no field here can show
  // or edit, and the frontend's theme derivation used to give it silent
  // priority over Secondary — a colour change that appeared to do nothing,
  // for a reason nobody editing the form could see. Sending "" on every
  // save clears it the first time any business is next edited, and the
  // frontend no longer reads this column at all regardless.
  const sidebarColor = "";
  const initialFontFamily = business?.fontFamily || DEFAULT_FONT_FAMILY;
  const [fontFamily, setFontFamily] = useState(initialFontFamily);
  const initialFontScale = business?.fontScale || DEFAULT_FONT_SCALE;
  const [fontScale, setFontScale] = useState(initialFontScale);
  const initialLogoScale = business?.logoScale || DEFAULT_LOGO_SCALE;
  const [logoScale, setLogoScale] = useState(initialLogoScale);
  const initialLogoDisplay = business?.logoDisplay || DEFAULT_LOGO_DISPLAY;
  const [logoDisplay, setLogoDisplay] = useState(initialLogoDisplay);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [suggestedPalette, setSuggestedPalette] = useState<string[]>([]);

  const [modules, setModulesState] = useState<string[]>(business?.modules ?? []);
  /* The module whose GRANT is awaiting confirmation, or null.
   *
   * Only ever set when ticking a DESTRUCTIVE_MODULES entry on. Revoking is
   * deliberately instant: taking a delete button away from a business is the
   * safe direction, and a confirmation there would train the operator to
   * click through the one that matters. */
  const [confirmGrant, setConfirmGrant] = useState<string | null>(null);
  const [languages, setLanguagesState] = useState<string[]>(business?.languages ?? ["en"]);

  /* The languages the chosen policy actually has templates for. Served in the
   * catalogue rather than hardcoded here, so this list can never offer a
   * combination the renderer cannot produce. Falls back to the full set if
   * the policy is unrecognised, which only happens if the catalogue and the
   * stored value have drifted. */
  const policyLanguages =
    catalogue.policies.find((p) => p.code === policy)?.languages ?? catalogue.languages;

  /* Changing policy PRUNES any language the new policy has no template for.
   * Done here rather than at submit so the operator sees the checkbox clear
   * when they switch — the backend rejects such a combination with a 400, and
   * a form that lets you tick something the save will refuse is worse than
   * one that shows you the constraint. */
  function setPolicy(next: string) {
    setPolicyState(next);
    const allowed = catalogue.policies.find((p) => p.code === next)?.languages ?? [];
    setLanguagesState((prev) => prev.filter((l) => allowed.includes(l)));
  }

  const [adminUsername, setAdminUsername] = useState(isCreate ? "admin" : "");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminName, setAdminName] = useState("");
  /* On edit, the admin login as it is saved now — the baseline "changed" is
   * measured against. null until loaded; adminLoadError when it cannot be
   * (e.g. the business has no Administrator left), which disables the step's
   * save rather than letting a blank username overwrite a real one. */
  const [adminInitial, setAdminInitial] = useState<{ name: string; username: string } | null>(null);
  const [adminLoadError, setAdminLoadError] = useState<string | null>(null);
  const businessId = business?.id;
  useEffect(() => {
    if (businessId === undefined) return;
    let cancelled = false;
    getAdminLogin(businessId)
      .then((a) => {
        if (cancelled) return;
        setAdminInitial({ name: a.name, username: a.username });
        setAdminName(a.name);
        setAdminUsername(a.username);
      })
      .catch((err) => {
        if (!cancelled) setAdminLoadError(err instanceof SuperAdminApiError ? err.message : "Could not load the admin login.");
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  // A reason is never mandatory in this wizard. It used to be required on
  // create, which is the one case where it earns nothing: a creation is
  // already self-describing in the audit log (the business, its code, who
  // made it, when), so the field only stood between an operator and the
  // button. Edits are the case where "why" carries information, and those
  // were already optional. The field stays on both paths and is still
  // recorded whenever it is filled in — it just no longer blocks.
  // A plan change is audited with a mandatory reason on the server
  // (superadmin.Service.ChangeTier), so the Review step asks for one then.
  const planChanged = !isCreate && tierId !== business.tierId;
  const reasonRequired = planChanged;

  function goTo(i: number) {
    setStepIdx(i);
    setSeen((s) => new Set(s).add(i));
    setError(null);
  }

  /* Validation runs per step rather than only at submit, so a missing
   * business name is caught on the step that asked for it instead of four
   * steps later on Review. Returns null when the step is complete. */
  function problemWith(id: StepId): string | null {
    if (id === "profile") {
      if (!name.trim()) return "A business name is required.";
      if (isCreate && !code.trim()) return "A sign-in code is required.";
      if (isCreate && !/^[a-z0-9][a-z0-9-]*$/.test(code.trim()))
        return "The sign-in code must be lowercase letters, numbers and dashes.";
      if (isCreate && !tiers.some((t) => t.id === tierId)) return "Choose a plan for this business.";
    }
    if (id === "branding" && color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return "The colour must be a hex value like #6054bf.";
    }
    if (id === "admin" && isCreate) {
      if (!adminUsername.trim()) return "An administrator username is required.";
      if (adminPassword.length < 8) return "The administrator password must be at least 8 characters.";
    }
    // On edit the password is optional (empty keeps the current one), and
    // nothing is checked until the saved login has loaded.
    if (id === "admin" && !isCreate && adminInitial) {
      if (!adminUsername.trim()) return "An administrator username is required.";
      if (adminPassword && adminPassword.length < 8)
        return "The new password must be at least 8 characters, or leave it empty to keep the current one.";
    }
    if (id === "review" && reasonRequired && !reason.trim()) return "A reason is required.";
    return null;
  }

  function next() {
    const problem = problemWith(step.id);
    if (problem) {
      setError(problem);
      return;
    }
    goTo(stepIdx + 1);
  }

  function pickLogo(file: File | null) {
    setLogoFile(file);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
    setSuggestedPalette([]);
    if (!file) return;
    void extractPaletteFromImage(file).then((p) => {
      setSuggestedPalette(p.colors);
      // Fill Primary/Secondary/Accent from the logo IMMEDIATELY, in that
      // order — not one click per field. Still never overwrites a colour
      // the operator already picked by hand: each only fills if it is
      // still at its untouched default, same guard the swatch buttons
      // below use for a manual re-pick. Every field stays editable
      // afterwards — see profile.go's SetTheme, which only ever writes
      // what the operator actually submits, never what a logo suggested.
      // BUG THIS FIXES: comparing against `initialColor` treated "matches
      // what's already saved for this business" as "still untouched" — but
      // on an EDIT, the already-saved value is the operator's real,
      // deliberate colour, not a placeholder. Re-uploading (or just
      // re-selecting) a logo on an existing business silently overwrote a
      // correct, already-set Primary colour with whatever the image
      // happened to extract. Only the true PLATFORM default may be
      // auto-filled — anything a business actually has set, ever, is left
      // alone.
      const [first, second] = p.colors;
      if (first && color === DEFAULT_BRAND_COLOR) setColor(first);
      if (second && !secondaryColor) setSecondaryColor(second);
    });
  }

  // What this save will actually write — drives the Review step's change
  // markers and, in edit mode, which endpoints get called at all.
  const changed = {
    plan: planChanged,
    profile:
      !isCreate &&
      (name !== business.name ||
        legalName !== (business.legalName ?? "") ||
        shortName !== initialShortName ||
        tagline !== initialTagline ||
        addressLine !== (business.addressLine ?? "") ||
        kmlRegNo !== (business.kmlRegNo ?? "") ||
        policy !== initialPolicy ||
        appUrl !== (business.appUrl ?? "")),
    theme:
      !isCreate &&
      (color !== initialColor ||
        secondaryColor !== initialSecondary ||
        fontFamily !== initialFontFamily ||
        fontScale !== initialFontScale ||
        logoScale !== initialLogoScale ||
        logoDisplay !== initialLogoDisplay),
    logo: logoFile !== null,
    modules: !isCreate && !sameSet(modules, business.modules ?? []),
    languages: !isCreate && !sameSet(languages, business.languages ?? ["en"]),
    admin:
      !isCreate &&
      adminInitial !== null &&
      (adminPassword !== "" ||
        adminUsername.trim() !== adminInitial.username ||
        (adminName.trim() !== "" && adminName.trim() !== adminInitial.name)),
  };
  const nothingToSave = !isCreate && !Object.values(changed).some(Boolean);

  // Whether the branding step holds anything beyond the platform default —
  // used on CREATE, where CreateBusiness only takes the primary colour (see
  // superadmin.CreateBusinessInput) and everything else rides a follow-up
  // SetTheme call, the same way the logo already rides a follow-up upload.
  const themeBeyondDefault =
    secondaryColor !== "" ||
    fontFamily !== DEFAULT_FONT_FAMILY ||
    fontScale !== DEFAULT_FONT_SCALE ||
    logoScale !== DEFAULT_LOGO_SCALE ||
    logoDisplay !== DEFAULT_LOGO_DISPLAY;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const s of steps) {
      const problem = problemWith(s.id);
      if (problem) {
        setError(problem);
        goTo(steps.indexOf(s));
        return;
      }
    }
    setSubmitting(true);
    try {
      if (isCreate) {
        const created = await createBusiness({
          name,
          code,
          tierId,
          adminUsername,
          adminPassword,
          adminName,
          legalName,
          addressLine,
          kmlRegNo,
          policy,
          appUrl,
          brandColor: color,
          modules,
          languages,
          reason,
        });
        // The logo needs an existing business to belong to, so it is the one
        // thing that cannot ride along with the create call. Same for every
        // theme field beyond the primary colour, which CreateBusinessInput
        // does not carry (see superadmin.CreateBusinessInput's own comment).
        // shortName rides the follow-up profile update for the same reason.
        if (logoFile) await uploadLogo(created.id, logoFile, reason);
        if (shortName || tagline) {
          await updateProfile(created.id, {
            name, legalName, shortName, lockupTagline: tagline, addressLine, kmlRegNo, policy, appUrl, reason,
          });
        }
        if (themeBeyondDefault) {
          await setBranding(created.id, {
            brandColor: color,
            secondaryColor,
            accentColor,
            sidebarColor,
            fontFamily,
            fontScale,
            logoScale,
            logoDisplay,
            reason,
          });
        }
      } else {
        if (changed.plan) await changeTier(business.id, tierId, reason);
        if (changed.profile) {
          await updateProfile(business.id, {
            name, legalName, shortName, lockupTagline: tagline, addressLine, kmlRegNo, policy, appUrl, reason,
          });
        }
        if (changed.theme) {
          await setBranding(business.id, {
            brandColor: color,
            secondaryColor,
            accentColor,
            sidebarColor,
            fontFamily,
            fontScale,
            logoScale,
            logoDisplay,
            reason,
          });
        }
        if (changed.logo && logoFile) await uploadLogo(business.id, logoFile, reason);
        if (changed.modules) await setModules(business.id, modules, reason);
        if (changed.languages) await setLanguages(business.id, languages, reason);
        if (changed.admin) {
          await updateAdminLogin(business.id, {
            name: adminName,
            username: adminUsername,
            password: adminPassword,
            reason,
          });
        }
      }
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
      <form className="sa-modal wide" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>{isCreate ? "New business" : `Edit — ${business.name}`}</h2>
          <div className="sa-steps">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                // In create mode an unreached step is disabled: jumping past a
                // required field would only fail validation later.
                disabled={isCreate && !seen.has(i)}
                className={`sa-step${i === stepIdx ? " active" : ""}${i < stepIdx ? " done" : ""}`}
                onClick={() => goTo(i)}
              >
                <span className="sa-step-n">{i + 1}</span>
                <span className="sa-step-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sa-modal-body">
          {step.id === "profile" && (
            <>
              <div className="sa-grid-2">
                <div className="sa-field">
                  <label>Business name</label>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!taglineTouched) setTagline(e.target.value);
                    }}
                    autoFocus
                  />
                  <span className="sa-hint">Shown in the app and in borrower messages.</span>
                </div>
                <div className="sa-field">
                  <label>Sign-in code</label>
                  {isCreate ? (
                    <>
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value.toLowerCase())}
                        placeholder="lowercase-letters-numbers-dashes"
                      />
                      <span className="sa-hint">Used in /login/&lt;code&gt;. Permanent once shared.</span>
                    </>
                  ) : (
                    <>
                      <input value={business.code} readOnly disabled />
                      <span className="sa-hint">Permanent — every staff bookmark depends on it.</span>
                    </>
                  )}
                </div>
              </div>

              <div className="sa-grid-2">
                <div className="sa-field">
                  <label>Legal name</label>
                  <input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                  <span className="sa-hint">Printed on the pledge agreement. Falls back to the business name.</span>
                </div>
                <div className="sa-field">
                  <label>Short name (optional)</label>
                  <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder={name || "e.g. CTFI"} />
                  <span className="sa-hint">Shown where the full name doesn&apos;t fit (sidebar, tab, login).</span>
                </div>
                <div className="sa-field">
                  <label>Sidebar subtitle (optional)</label>
                  {/* A textarea, not an input, because the break in a long
                    * subtitle is an editorial choice: CTFI's reads
                    * "CHITTILAPILLY / THOMMANA". Press Return where it should
                    * break — inside a textarea that inserts a newline rather
                    * than submitting the wizard. Two lines is the ceiling
                    * (see resolveLockup); a third would push the nav down. */}
                  <textarea
                    value={tagline}
                    onChange={(e) => { setTaglineTouched(true); setTagline(e.target.value); }}
                    placeholder={name || "e.g. Gold Finance"}
                    rows={2}
                  />
                  <span className="sa-hint">The small line under the sidebar headline. Press Return to split it over two lines.</span>
                </div>
                <div className="sa-field">
                  <label>Registration no.</label>
                  <input value={kmlRegNo} onChange={(e) => setKmlRegNo(e.target.value)} />
                  <span className="sa-hint">Printed on this business&rsquo;s lending documents.</span>
                </div>
              </div>

              <div className="sa-field">
                <label>Document policy</label>
                <Select
                  value={policy}
                  onChange={setPolicy}
                  ariaLabel="Document policy"
                  options={catalogue.policies.map((p) => ({ value: p.code, label: p.label }))}
                />
                <span className="sa-hint">Decides the pledge agreement and narrows document languages on the Grants step.</span>
              </div>

              <div className="sa-field">
                <label>Registered address</label>
                <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
                <span className="sa-hint">One line, as it should appear on customer documents.</span>
              </div>

              <div className="sa-field">
                <label>Plan</label>
                <Select
                  value={String(tierId)}
                  onChange={(v) => setTierId(Number(v))}
                  ariaLabel="Plan"
                  options={tiers.map((t) => ({ value: String(t.id), label: planLabel(t) }))}
                />
                <span className="sa-hint">
                  {isCreate
                    ? "Decides how many active branches this business may run. Enforced by the server."
                    : "Takes effect on save and asks for a reason. Existing branches are never removed — a business above the new limit just cannot add or reactivate branches."}
                </span>
              </div>

              {/* Deployment URL is optional, so it lives behind a disclosure — but
                * it is not decorative: when set, a session issued for this
                * business is refused on any other business's host
                * (platform.RequireHostMatchesTenant). */}
              <details className="sa-advanced" open={!!appUrl}>
                <summary>Advanced (optional)</summary>
                <div className="sa-field">
                  <label>Deployment URL</label>
                  <input
                    value={appUrl}
                    onChange={(e) => setAppUrl(e.target.value)}
                    placeholder="https://acme.cloudhousefinance.com"
                  />
                  <span className="sa-hint">
                    Only if this business has its own web address. Sign-in still uses the code above; when set, this
                    business&rsquo;s sessions are refused on any other business&rsquo;s address.
                  </span>
                </div>
              </details>
            </>
          )}

          {step.id === "branding" && (
            <>
              <div className="sa-field">
                <label>Primary colour</label>
                <div className="sa-color-row">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_BRAND_COLOR}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder={DEFAULT_BRAND_COLOR}
                  />
                  <RampPreview hex={color} />
                </div>
                <span className="sa-hint">Every other shade (hovers, fills, print header) is derived from this.</span>
              </div>

              <div className="sa-field">
                <label>Logo</label>
                <div className="sa-logo-row">
                  {(logoPreview || business?.logoUrl) && (
                    <img className="sa-logo-preview" src={logoPreview || business?.logoUrl} alt="" />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => pickLogo(e.target.files?.[0] ?? null)}
                  />
                </div>
                <span className="sa-hint">
                  PNG, JPEG or WebP (no SVG).{isCreate && " Uploaded once the business has been created."}
                </span>
              </div>

              {suggestedPalette.length > 0 && (
                <div className="sa-field">
                  <label>Suggested from this logo</label>
                  <div className="sa-color-row">
                    {suggestedPalette.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className="sa-swatch-btn"
                        style={{ background: hex }}
                        title={`Use ${hex}`}
                        onClick={() => {
                          // First click fills the primary (only while it's
                          // still the untouched PLATFORM default — matching
                          // `initialColor` here was the same bug fixed in
                          // pickLogo's auto-fill just above: an existing
                          // business's already-saved colour is a real,
                          // deliberate choice, not a placeholder), the
                          // second click the secondary.
                          if (color === DEFAULT_BRAND_COLOR) setColor(hex);
                          else if (!secondaryColor) setSecondaryColor(hex);
                        }}
                      />
                    ))}
                  </div>
                  <span className="sa-hint">Click a swatch to fill the next empty colour field.</span>
                </div>
              )}

              <div className="sa-field">
                <label>Secondary colour (optional)</label>
                <div className="sa-color-row">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(secondaryColor) ? secondaryColor : "#ffffff"}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                  />
                  <input
                    type="text"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    placeholder="unset"
                  />
                  {secondaryColor && (
                    <button type="button" className="sa-link-btn" onClick={() => setSecondaryColor("")}>
                      Clear
                    </button>
                  )}
                  {secondaryColor && <RampPreview hex={secondaryColor} />}
                </div>
                <span className="sa-hint">Also sets the sidebar/login background. Leave empty to derive it automatically.</span>
              </div>

              <div className="sa-field">
                <label>Font</label>
                <Select
                  value={fontFamily}
                  onChange={setFontFamily}
                  ariaLabel="Font"
                  options={Object.keys(FONT_FAMILIES).map((key) => ({ value: key, label: titleCase(key) }))}
                />
                <span className="sa-hint">Applies to running text; headings and the sidebar wordmark are unaffected.</span>
              </div>

              <div className="sa-field">
                <label>Text size</label>
                <Select
                  value={fontScale}
                  onChange={setFontScale}
                  ariaLabel="Text size"
                  options={Object.keys(FONT_SCALES).map((key) => ({ value: key, label: titleCase(key) }))}
                />
              </div>

              <div className="sa-field">
                <label>Logo size in the sidebar/header</label>
                <Select
                  value={logoScale}
                  onChange={setLogoScale}
                  ariaLabel="Logo size in the sidebar/header"
                  options={Object.keys(LOGO_SCALES).map((key) => ({ value: key, label: titleCase(key) }))}
                />
                <span className="sa-hint">Only affects the sidebar/header, not the login page logo.</span>
              </div>

              <div className="sa-field">
                <label>Logo backing</label>
                <Select
                  value={logoDisplay}
                  onChange={setLogoDisplay}
                  ariaLabel="Logo backing"
                  options={LOGO_DISPLAYS.map((key) => ({
                    value: key,
                    label:
                      key === "transparent"
                        ? "None (transparent)"
                        : key === "light-pad"
                          ? "Light backing"
                          : "Dark backing",
                  }))}
                />
                <span className="sa-hint">
                  Use a backing swatch for a logo that only reads clearly against one background colour.
                </span>
              </div>
            </>
          )}

          {step.id === "grants" && (
            <>
              <div className="sa-field">
                <label>Optional modules</label>
                <span className="sa-hint" style={{ marginBottom: 6 }}>
                  Off by default. A module left unticked is hidden from the app and refused by the API, not merely
                  hidden from the menu.
                </span>
                {catalogue.modules.map((m) => {
                  const destructive = DESTRUCTIVE_MODULES.has(m);
                  const on = modules.includes(m);
                  return (
                    <div key={m}>
                      <label className={`sa-check${destructive ? " danger" : ""}${confirmGrant === m ? " confirming" : ""}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            // Confirm the GRANT of a destructive module, never
                            // the revoke. Turning it back off is the safe
                            // direction and stays one click.
                            if (destructive && !on) {
                              setConfirmGrant(m);
                              return;
                            }
                            setConfirmGrant(null);
                            setModulesState(toggle(modules, m));
                          }}
                        />
                        <span>
                          {MODULE_LABELS[m] ?? m}
                          {/* Only on the destructive ones. A badge on every row
                              is wallpaper; on one row it is a stop sign. */}
                          {destructive && <span className="sa-check-flag">irreversible</span>}
                          <span className="sa-check-sub">{MODULE_HINTS[m] ?? ""}</span>
                        </span>
                      </label>

                      {confirmGrant === m && (
                        /* Inline rather than a second modal: the wizard is
                           already one, and a dialog over a dialog is both
                           awkward to dismiss and easy to confirm blindly.
                           Sitting directly under the row keeps the thing
                           being granted on screen while it is confirmed. */
                        <div className="sa-grant-confirm" role="alertdialog" aria-label={`Confirm granting ${MODULE_LABELS[m] ?? m}`}>
                          <p className="sa-grant-confirm-title">
                            Give {name || "this business"} a delete button?
                          </p>
                          <p className="sa-grant-confirm-body">
                            Any Administrator of this business will be able to wipe it back to its
                            admin login, whenever they like, without asking you. Grant it only
                            while this is still a demo.
                          </p>
                          <div className="sa-grant-confirm-actions">
                            <button
                              type="button"
                              className="sa-btn"
                              autoFocus
                              onClick={() => setConfirmGrant(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="sa-btn danger"
                              onClick={() => {
                                setModulesState(toggle(modules, m));
                                setConfirmGrant(null);
                              }}
                            >
                              Grant Demo Reset
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="sa-field">
                <label>Document languages</label>
                <span className="sa-hint">
                  Limited to templates for the {catalogue.policies.find((p) => p.code === policy)?.label ?? "selected"} policy.
                </span>
                {policyLanguages.map((l) => {
                  const locked = l === "en";
                  return (
                    <label key={l} className={`sa-check${locked ? " locked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={locked || languages.includes(l)}
                        disabled={locked}
                        onChange={() => setLanguagesState(toggle(languages, l))}
                      />
                      <span>
                        {LANGUAGE_LABELS[l] ?? l}
                        <span className="sa-check-sub">{LANGUAGE_HINTS[l] ?? ""}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {step.id === "admin" && !isCreate && !adminInitial && (
            <p className={adminLoadError ? "sa-error" : "sa-modal-note"}>
              {adminLoadError ?? "Loading the administrator login…"}
            </p>
          )}

          {step.id === "admin" && (isCreate || adminInitial) && (
            <>
              <p className="sa-modal-note">
                {isCreate
                  ? "The first login for this business\u2019s own owner. They can create the rest of their staff themselves once signed in."
                  : "The owner\u2019s Administrator login. Change the username, or set a new password if they have forgotten it, then send it to them."}
              </p>
              <div className="sa-field">
                <label>Administrator name</label>
                <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Administrator" />
              </div>
              <div className="sa-grid-2">
                <div className="sa-field">
                  <label>Username</label>
                  <input value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} />
                </div>
                <div className="sa-field">
                  <label>{isCreate ? "Password" : "New password"}</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    placeholder={isCreate ? undefined : "Leave empty to keep the current one"}
                  />
                  <span className="sa-hint">
                    At least 8 characters.{!isCreate && " Takes effect at their next sign-in."}
                  </span>
                </div>
              </div>
            </>
          )}

          {step.id === "review" && (
            <>
              <p className="sa-modal-note">
                {isCreate
                  ? "Creating the business also seeds its roles, its first branch and the administrator login above — all in one transaction."
                  : nothingToSave
                    ? "Nothing has been changed yet. Go back to a step to make an edit."
                    : "Only the marked rows will be written. Each is a separately audited action."}
              </p>
              <dl className="sa-review">
                <ReviewRow label="Business name" value={name} changed={changed.profile} />
                <ReviewRow label="Sign-in code" value={isCreate ? code : business.code} />
                <ReviewRow label="Plan" value={planLabelFor(tiers, tierId)} changed={changed.plan} />
                <ReviewRow label="Legal name" value={legalName} changed={changed.profile} />
                <ReviewRow label="Short name" value={shortName || "(falls back to business name)"} changed={changed.profile} />
                <ReviewRow label="Address" value={addressLine} changed={changed.profile} />
                <ReviewRow label="Registration no." value={kmlRegNo} changed={changed.profile} />
                <ReviewRow
                  label="Document policy"
                  value={catalogue.policies.find((p) => p.code === policy)?.label ?? policy}
                  changed={changed.profile}
                />
                <ReviewRow label="Deployment URL" value={appUrl} changed={changed.profile} />
                <ReviewRow label="Primary colour" value={color} changed={changed.theme} />
                <ReviewRow label="Secondary colour" value={secondaryColor || "unset"} changed={changed.theme} />
                <ReviewRow label="Font" value={fontFamily} changed={changed.theme} />
                <ReviewRow label="Text size" value={fontScale} changed={changed.theme} />
                <ReviewRow label="Logo size" value={logoScale} changed={changed.theme} />
                <ReviewRow label="Logo backing" value={logoDisplay} changed={changed.theme} />
                <ReviewRow
                  label="Logo"
                  value={logoFile ? logoFile.name : business?.logoUrl ? "already set" : ""}
                  changed={changed.logo}
                />
                <ReviewRow
                  label="Modules"
                  value={modules.map((m) => MODULE_LABELS[m] ?? m).join(", ")}
                  changed={changed.modules}
                  emptyText="none"
                />
                <ReviewRow
                  label="Languages"
                  value={languages.map((l) => LANGUAGE_LABELS[l] ?? l).join(", ")}
                  changed={changed.languages}
                />
                {isCreate ? (
                  <ReviewRow label="Administrator" value={adminUsername} />
                ) : (
                  <>
                    <ReviewRow label="Admin username" value={adminUsername} changed={changed.admin} />
                    <ReviewRow
                      label="Admin password"
                      value={adminPassword ? "will be reset" : "unchanged"}
                      changed={changed.admin}
                    />
                  </>
                )}
              </dl>
              <div style={{ marginTop: 14 }}>
                <ReasonField value={reason} onChange={setReason} required={reasonRequired} />
              </div>
            </>
          )}

          {error && <p className="sa-error">{error}</p>}
        </div>

        <div className="sa-modal-foot">
          <span className="sa-foot-step">
            Step {stepIdx + 1} of {steps.length}
          </span>
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          {stepIdx > 0 && (
            <button type="button" className="sa-btn" onClick={() => goTo(stepIdx - 1)}>
              Back
            </button>
          )}
          {!isLast && (
            <button type="button" className="sa-btn primary" onClick={next}>
              Next
            </button>
          )}
          {isLast && (
            <button type="submit" className="sa-btn primary" disabled={submitting || nothingToSave}>
              {submitting ? "Saving…" : isCreate ? "Create business" : "Save changes"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  changed,
  emptyText = "not set",
}: {
  label: string;
  value: string;
  changed?: boolean;
  emptyText?: string;
}) {
  return (
    <div className={`sa-review-row${changed ? " changed" : ""}`}>
      <dt>{label}</dt>
      <dd className={value ? "" : "empty"}>{value || emptyText}</dd>
    </div>
  );
}
function BusinessActionModal({
  business,
  kind,
  tiers,
  activeBranches,
  onClose,
  onDone,
}: {
  business: Business;
  kind: "suspend" | "reactivate" | "tier" | "delete";
  tiers: Tier[];
  /* Known when opened from the detail page — lets the plan change warn that
   * the business is already above the new plan's branch limit. */
  activeBranches?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [tierId, setTierId] = useState(business.tierId);
  const [confirmCode, setConfirmCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    kind === "suspend"
      ? "Suspend business"
      : kind === "reactivate"
        ? "Reactivate business"
        : kind === "delete"
          ? "Delete business permanently"
          : "Change plan";
  const newTier = tiers.find((t) => t.id === tierId);
  const overNewLimit =
    kind === "tier" &&
    activeBranches !== undefined &&
    newTier !== undefined &&
    newTier.branchQuota !== 0 &&
    activeBranches > newTier.branchQuota;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (kind === "delete" && confirmCode.trim() !== business.code) {
      setError(`Type ${business.code} exactly to confirm.`);
      return;
    }
    setSubmitting(true);
    try {
      if (kind === "suspend") await suspendBusiness(business.id, reason);
      else if (kind === "reactivate") await reactivateBusiness(business.id, reason);
      else if (kind === "delete") await deleteBusiness(business.id, reason);
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
        <div className="sa-modal-head">
          <h2>
            {title} — {business.name}
          </h2>
        </div>
        <div className="sa-modal-body">
          {kind === "suspend" && (
            <p className="sa-modal-note">
              Restricts new lending and administration only. Never blocks a borrower repaying or collecting gold they
              have already paid for.
            </p>
          )}
          {kind === "delete" && (
            <>
              <p className="sa-modal-note danger">
                This permanently deletes {business.name} — every branch, customer, loan, staff login and its logo
                file. This cannot be undone.
              </p>
              <div className="sa-field">
                <label>
                  Type <b>{business.code}</b> to confirm
                </label>
                <input value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} autoComplete="off" />
              </div>
            </>
          )}
          {kind === "tier" && (
            <>
              <div className="sa-field">
                <label>New plan</label>
                <Select
                  value={String(tierId)}
                  onChange={(v) => setTierId(Number(v))}
                  ariaLabel="New plan"
                  options={tiers.map((t) => ({ value: String(t.id), label: planLabel(t) }))}
                />
                <span className="sa-hint">
                  Takes effect immediately. Existing branches are never removed — a business above its plan&rsquo;s
                  limit simply cannot add or reactivate branches until it is within it.
                </span>
              </div>
              {overNewLimit && newTier && (
                <p className="sa-modal-note danger">
                  {business.name} already has {activeBranches} active branches, more than {newTier.name} allows (
                  {newTier.branchQuota}). They keep working, but no new branch can be added until the business is
                  within the limit.
                </p>
              )}
            </>
          )}
          <ReasonField value={reason} onChange={setReason} required />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={`sa-btn ${kind === "suspend" || kind === "delete" ? "danger" : "primary"}`}
            disabled={submitting}
          >
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
function TierPriceModal({ tier, onClose, onDone }: { tier: Tier; onClose: () => void; onDone: () => void }) {
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
        <div className="sa-modal-head">
          <h2>Set price — {tier.name}</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note">
            Existing subscribers keep billing at their current price until they resubscribe or renew — this only
            affects the NEXT subscription created against this tier.
          </p>
          <div className="sa-field">
            <label>Monthly price (₹)</label>
            <input type="number" min={0} step="1" value={rupees} onChange={(e) => setRupees(e.target.value)} required />
          </div>
          <ReasonField value={reason} onChange={setReason} required />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
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

function BusinessDetail({
  id,
  version,
  tiers,
  onBack,
  onEdit,
  onAct,
  onChanged,
  signInLink,
  onCopyLink,
  copied,
}: {
  id: number;
  version: number;
  tiers: Tier[];
  onBack: () => void;
  onEdit: (b: Business) => void;
  onAct: (b: Business, kind: ActKind, activeBranches?: number) => void;
  onChanged: () => void;
  signInLink: (b: Business) => string;
  onCopyLink: (b: Business) => void;
  /* Code of the business whose link was just copied, to flash "Copied". */
  copied: string | null;
}) {
  const [data, setData] = useState<BusinessOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [removing, setRemoving] = useState<SubscriptionPayment | null>(null);
  const [editingExpiry, setEditingExpiry] = useState(false);

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

  if (error) {
    return (
      <>
        <div className="sa-toolbar">
          <button className="sa-btn" onClick={onBack}>
            ← All businesses
          </button>
        </div>
        <p className="sa-error">{error}</p>
      </>
    );
  }
  if (!data) return <p className="sa-empty">Loading…</p>;

  const { business: b, usage: u, payments } = data;
  const plan = tiers.find((t) => t.id === b.tierId) ?? b.tier;
  const atLimit = !u.unlimited && u.branches >= u.branchQuota;
  const expired = b.subscriptionExpiresAt ? new Date(b.subscriptionExpiresAt) < new Date() : false;

  return (
    <div className="sa-detail">
      <div className="sa-toolbar sa-detail-toolbar">
        <button className="sa-btn" onClick={onBack}>
          ← All businesses
        </button>
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
      </div>

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
              <Icon name="copy" />
              {copied === b.code ? "Copied" : "Copy sign-in link"}
            </button>
            <a
              className="sa-btn"
              href={signInLink(b)}
              target="_blank"
              rel="noreferrer"
              title={`Open ${signInLink(b)} in a new tab`}
            >
              <Icon name="external" />
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

function Stat({
  label,
  value,
  sub,
  tone = "violet",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "violet" | "amber";
}) {
  return (
    <div className={`sa-card sa-stat ${tone}`}>
      <div>
        <div className="sa-card-value">{value}</div>
        <div className="sa-card-label">{label}</div>
        {sub && <div className="sa-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RecordPaymentModal({
  business,
  onClose,
  onDone,
}: {
  business: Business;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [mode, setMode] = useState<PaymentMode>("bank_transfer");
  const [reference, setReference] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!paidOn) {
      setError("Enter the date the payment was made.");
      return;
    }
    setSubmitting(true);
    try {
      await recordPayment(business.id, {
        amountInPaise: Math.round(rupees * 100),
        paidOn,
        mode,
        reference,
        note,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not record the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>Record payment — {business.name}</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note">
            For your records only. Nothing is charged, and the plan, status and renewal date stay as they are.
          </p>
          <div className="sa-grid-2">
            <div className="sa-field">
              <label>Amount (₹)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="sa-field">
              <label>Paid on</label>
              <input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="sa-field">
              <label>Mode</label>
              <Select
                value={mode}
                onChange={(v) => setMode(v as PaymentMode)}
                ariaLabel="Payment mode"
                options={(Object.keys(PAYMENT_MODE_LABELS) as PaymentMode[]).map((m) => ({
                  value: m,
                  label: PAYMENT_MODE_LABELS[m],
                }))}
              />
            </div>
            <div className="sa-field">
              <label>Reference (optional)</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
            </div>
            <div className="sa-field">
              <label>Period from (optional)</label>
              <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
            </div>
            <div className="sa-field">
              <label>Period to (optional)</label>
              <input
                type="date"
                value={periodTo}
                min={periodFrom || undefined}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </div>
          </div>
          <div className="sa-field">
            <label>Note (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn primary" disabled={submitting}>
            {submitting ? "Saving…" : "Record payment"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RemovePaymentModal({
  business,
  payment,
  onClose,
  onDone,
}: {
  business: Business;
  payment: SubscriptionPayment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await deletePayment(business.id, payment.id, reason);
      onDone();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not remove the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>Remove payment record</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note danger">
            Removes the {formatINR(payment.amountInPaise / 100)} payment of {formatDate(payment.paidOn)} from{" "}
            {business.name}&rsquo;s history. The audit log keeps a record that it existed.
          </p>
          <ReasonField value={reason} onChange={setReason} required />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn danger" disabled={submitting}>
            {submitting ? "Removing…" : "Remove"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* Sets (or clears) the renewal/expiry date by hand — the existing
 * PUT /superadmin/businesses/:id/expiry, which had no screen until now. */
function ExpiryModal({ business, onClose, onDone }: { business: Business; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(business.subscriptionExpiresAt ? business.subscriptionExpiresAt.slice(0, 10) : "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      // End of the chosen day, so "expires 30 Sep" is still usable all of 30 Sep.
      await adjustExpiry(business.id, date ? new Date(`${date}T23:59:59`).toISOString() : null, reason);
      onDone();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not change the renewal date.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>Renewal date — {business.name}</h2>
        </div>
        <div className="sa-modal-body">
          <div className="sa-field">
            <label>Renews / expires on</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <span className="sa-hint">Leave empty to clear it (no expiry).</span>
          </div>
          <ReasonField value={reason} onChange={setReason} required />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
