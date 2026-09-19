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
  changeTier,
  setTierPrice,
  updateProfile,
  setBranding,
  setModules,
  setLanguages,
  uploadLogo,
  SuperAdminApiError,
  type Business,
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

type IconName = "building" | "layers" | "clipboard" | "bell" | "sun" | "user";

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
  const [actingOn, setActingOn] = useState<{ business: Business; kind: "suspend" | "reactivate" | "tier" } | null>(
    null
  );
  const [pricingTier, setPricingTier] = useState<Tier | null>(null);
  const [user, setUser] = useState<ReturnType<typeof readSuperAdminUser>>(null);

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
        router.replace("/login");
        return;
      }
      setLoadError(err instanceof Error ? err.message : "Could not load the console.");
    }
  }, [router]);

  useEffect(() => {
    if (!readSuperAdminToken()) {
      router.replace("/login");
      return;
    }
    setUser(readSuperAdminUser());
    void reload();
  }, [reload, router]);

  function handleLogout() {
    clearSuperAdminSession();
    router.replace("/login");
  }

  const tierName = (id: number) => tiers?.find((t) => t.id === id)?.name ?? `#${id}`;

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

          {tab === "businesses" && (
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
                <div className="sa-table-wrap">
                  <table className="sa-table">
                    <thead>
                      <tr>
                        <th>Business</th>
                        <th>Code</th>
                        <th>URL</th>
                        <th>Tier</th>
                        <th>Status</th>
                        <th>Modules</th>
                        <th>Languages</th>
                        <th>Renewal</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {businesses.map((b) => (
                        <tr key={b.id}>
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
                          <td>
                            <code>{b.code}</code>
                          </td>
                          <td>
                            {b.appUrl ? (
                              <a className="sa-url" href={b.appUrl} target="_blank" rel="noreferrer">
                                {b.appUrl.replace(/^https?:\/\//, "")}
                              </a>
                            ) : (
                              <span className="sa-biz-sub">not set</span>
                            )}
                            <br />
                            <button
                              className="sa-btn"
                              style={{ marginTop: 4 }}
                              onClick={() => {
                                const link = tenantLoginLink(b.code);
                                navigator.clipboard.writeText(link);
                              }}
                              title={tenantLoginLink(b.code)}
                            >
                              Copy sign-in link
                            </button>
                          </td>
                          <td>{b.tier?.name ?? tierName(b.tierId)}</td>
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
                          <td className="sa-actions">
                            <button className="sa-btn" onClick={() => setWizard({ business: b, openAt: "profile" })}>
                              Edit
                            </button>
                            <button className="sa-btn" onClick={() => setWizard({ business: b, openAt: "branding" })}>
                              Branding
                            </button>
                            <button className="sa-btn" onClick={() => setActingOn({ business: b, kind: "tier" })}>
                              Tier
                            </button>
                            {b.status === "suspended" ? (
                              <button
                                className="sa-btn"
                                onClick={() => setActingOn({ business: b, kind: "reactivate" })}
                              >
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
          onDone={reload}
        />
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
      {pricingTier && <TierPriceModal tier={pricingTier} onClose={() => setPricingTier(null)} onDone={reload} />}
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

/* The wizard's steps. `admin` is create-only — an existing business already
 * has its administrator, and changing that login is an employee-management
 * job inside the business, not a vendor one. */
type StepId = "profile" | "branding" | "grants" | "admin" | "review";

type Step = { id: StepId; label: string };

function stepsFor(isCreate: boolean): Step[] {
  const steps: Step[] = [
    { id: "profile", label: "Business" },
    { id: "branding", label: "Branding" },
    { id: "grants", label: "Modules & languages" },
  ];
  if (isCreate) steps.push({ id: "admin", label: "Administrator" });
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

  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminName, setAdminName] = useState("");

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
  const reasonRequired = false;

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
    }
    if (id === "branding" && color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return "The colour must be a hex value like #6054bf.";
    }
    if (id === "admin") {
      if (!adminUsername.trim()) return "An administrator username is required.";
      if (adminPassword.length < 8) return "The administrator password must be at least 8 characters.";
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
                      <span className="sa-hint">
                        Used in /login/&lt;code&gt;. Permanent once shared — it cannot be changed later.
                      </span>
                    </>
                  ) : (
                    <>
                      <input value={business.code} readOnly disabled />
                      <span className="sa-hint">Permanent — every staff bookmark depends on it.</span>
                    </>
                  )}
                </div>
              </div>

              {isCreate && (
                <div className="sa-field">
                  <label>Tier</label>
                  <Select
                    value={String(tierId)}
                    onChange={(v) => setTierId(Number(v))}
                    ariaLabel="Tier"
                    options={tiers.map((t) => ({
                      value: String(t.id),
                      label: `${t.name} (${t.branchQuota} branch${t.branchQuota === 1 ? "" : "es"})`,
                    }))}
                  />
                  <span className="sa-hint">Changed later from the Tier action on the business row.</span>
                </div>
              )}

              <div className="sa-grid-2">
                <div className="sa-field">
                  <label>Legal name</label>
                  <input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                  <span className="sa-hint">Printed on the pledge agreement. Falls back to the business name.</span>
                </div>
                <div className="sa-field">
                  <label>Short name (optional)</label>
                  <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder={name || "e.g. CTFI"} />
                  <span className="sa-hint">
                    Shown where the full name doesn&apos;t fit: sidebar headline, browser tab, login page. Falls
                    back to the business name.
                  </span>
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
                  <span className="sa-hint">
                    The small line under the sidebar headline. Use the full name (&ldquo;Chittilapilly
                    Thommana&rdquo; under &ldquo;CTFI&rdquo;) or a descriptor (&ldquo;Gold Finance&rdquo; under
                    &ldquo;Ambika&rdquo;). Press Return to split it over two lines (typing
                    &ldquo;\n&rdquo; works too). Hidden when it would only repeat the headline.
                  </span>
                </div>
                <div className="sa-field">
                  <label>Registration no.</label>
                  <input value={kmlRegNo} onChange={(e) => setKmlRegNo(e.target.value)} />
                  <span className="sa-hint">
                    Printed on this business&rsquo;s customer-facing lending documents.
                  </span>
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
                <span className="sa-hint">
                  The regulatory regime this business lends under. It decides which pledge
                  agreement its borrowers sign &mdash; these are different legal instruments,
                  not translations of one &mdash; and narrows the document languages offered
                  on the Grants step.
                </span>
              </div>

              <div className="sa-field">
                <label>Registered address</label>
                <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
                <span className="sa-hint">One line, as it should appear on customer documents.</span>
              </div>

              <div className="sa-field">
                <label>Deployment URL</label>
                <input
                  value={appUrl}
                  onChange={(e) => setAppUrl(e.target.value)}
                  placeholder="https://acme.cloudhousesupport.site"
                />
                <span className="sa-hint">
                  Where this business&apos;s frontend is deployed. Recorded for reference only — sign-in is still
                  resolved by the code above, not by hostname.
                </span>
              </div>
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
                <span className="sa-hint">
                  Every other shade the app uses — hovers, fills, pale backgrounds, the print header — is derived
                  from this one, which is what the strip above shows.
                </span>
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
                  PNG, JPEG or WebP. SVG is refused — an SVG can carry a script, and serving one from this origin
                  would run it against the viewer&apos;s session.
                  {isCreate && " Uploaded once the business has been created."}
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
                  <span className="sa-hint">
                    Pulled from the uploaded logo&apos;s own pixels — a suggestion only. Click a swatch to fill the
                    next empty colour field; every field stays yours to edit or clear afterwards.
                  </span>
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
                <span className="sa-hint">
                  <b>Also sets the sidebar and login panel&apos;s dark background</b> — enter this to match an
                  existing brand&apos;s exact sidebar colour (e.g. a design tool&apos;s colour picker). Leave empty
                  and it derives one from the primary colour automatically instead.
                </span>
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
                <span className="sa-hint">
                  Only affects the sidebar and header — the login page&apos;s logo is a fixed size (already matched
                  to a reference design) and does not use this setting. The logo already scales to fit its
                  sidebar/header slot automatically; use this only when it still reads smaller or larger than it
                  should there (e.g. thin linework vs. a solid block mark).
                </span>
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
                  Limited to the languages the{" "}
                  {catalogue.policies.find((p) => p.code === policy)?.label ?? "selected"} policy
                  has templates for. Change the policy on the Profile step to see others.
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

          {step.id === "admin" && (
            <>
              <p className="sa-modal-note">
                The first login for this business&apos;s own owner. They can create the rest of their staff themselves
                once signed in.
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
                  <label>Password</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    minLength={8}
                  />
                  <span className="sa-hint">At least 8 characters.</span>
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
                {isCreate && <ReviewRow label="Administrator" value={adminUsername} />}
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
          {kind === "tier" && (
            <div className="sa-field">
              <label>New tier</label>
              <Select
                value={String(tierId)}
                onChange={(v) => setTierId(Number(v))}
                ariaLabel="New tier"
                options={tiers.map((t) => ({
                  value: String(t.id),
                  label: `${t.name} (${t.branchQuota} branch${t.branchQuota === 1 ? "" : "es"})`,
                }))}
              />
            </div>
          )}
          <ReasonField value={reason} onChange={setReason} required />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
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
