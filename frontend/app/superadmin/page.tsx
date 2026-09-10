"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import "./superadmin.css";
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
} from "@/common/services/superadminService";
import { clearSuperAdminSession, readSuperAdminToken, readSuperAdminUser } from "@/common/services/superadminSession";
import { loginPath } from "@/common/services/tenantSession";
import { VENDOR } from "@/common/config/brand";
import { brandRampHex, DEFAULT_BRAND_COLOR } from "@/common/config/theme";

type Tab = "businesses" | "tiers" | "audit";

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
        <div className="sa-topbar-brand">
          {/* The vendor's own mark. Never BrandLogo — that resolves the
            * signed-in TENANT's logo, and this console must look the same
            * whichever businesses it is managing. */}
          <img src={VENDOR.markSrc} alt="" />
          <span className="sa-wordmark">
            <b>{VENDOR.name}</b>
            <span>{VENDOR.product}</span>
          </span>
        </div>
        <div className="sa-topbar-right">
          {user && <span className="sa-topbar-user">{user.name}</span>}
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
                              const link = `${window.location.origin}${loginPath(b.code)}`;
                              navigator.clipboard.writeText(link);
                            }}
                            title={`${window.location.origin}${loginPath(b.code)}`}
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
const MODULE_LABELS: Record<string, string> = {
  settings: "Settings",
  branches: "Branch Management",
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  ml: "Malayalam",
  gu: "Gujarati",
};

const MODULE_HINTS: Record<string, string> = {
  settings: "The Settings page (integration API keys).",
  branches: "The Branch Management page. Branches themselves keep working either way — only administering them is hidden.",
};

const LANGUAGE_HINTS: Record<string, string> = {
  en: "Always available; cannot be turned off.",
  ml: "Pledge agreement and release form in Malayalam.",
  gu: "Grantable now, but the Gujarati template is not installed on the server yet — requesting one returns an explicit error rather than an English document.",
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
          : "Edits are always audited; a reason is recorded only if you give one."}
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
  const [addressLine, setAddressLine] = useState(business?.addressLine ?? "");
  const [kmlRegNo, setKmlRegNo] = useState(business?.kmlRegNo ?? "");
  const [appUrl, setAppUrl] = useState(business?.appUrl ?? "");

  const initialColor = business?.brandColor || DEFAULT_BRAND_COLOR;
  const [color, setColor] = useState(initialColor);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [modules, setModulesState] = useState<string[]>(business?.modules ?? []);
  const [languages, setLanguagesState] = useState<string[]>(business?.languages ?? ["en"]);

  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminName, setAdminName] = useState("");

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  // Per the audit design: a reason is mandatory when bringing a business into
  // existence, optional when editing one that already exists.
  const reasonRequired = isCreate;

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
  }

  // What this save will actually write — drives the Review step's change
  // markers and, in edit mode, which endpoints get called at all.
  const changed = {
    profile:
      !isCreate &&
      (name !== business.name ||
        legalName !== (business.legalName ?? "") ||
        addressLine !== (business.addressLine ?? "") ||
        kmlRegNo !== (business.kmlRegNo ?? "") ||
        appUrl !== (business.appUrl ?? "")),
    color: !isCreate && color !== initialColor,
    logo: logoFile !== null,
    modules: !isCreate && !sameSet(modules, business.modules ?? []),
    languages: !isCreate && !sameSet(languages, business.languages ?? ["en"]),
  };
  const nothingToSave = !isCreate && !Object.values(changed).some(Boolean);

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
          appUrl,
          brandColor: color,
          modules,
          languages,
          reason,
        });
        // The logo needs an existing business to belong to, so it is the one
        // thing that cannot ride along with the create call.
        if (logoFile) await uploadLogo(created.id, logoFile, reason);
      } else {
        if (changed.profile) {
          await updateProfile(business.id, { name, legalName, addressLine, kmlRegNo, appUrl, reason });
        }
        if (changed.color) await setBranding(business.id, color, reason);
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
                {s.label}
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
                  <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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
                  <select value={tierId} onChange={(e) => setTierId(Number(e.target.value))}>
                    {tiers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.branchQuota} branch{t.branchQuota === 1 ? "" : "es"})
                      </option>
                    ))}
                  </select>
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
                  <label>Registration no. (KML/MLL)</label>
                  <input value={kmlRegNo} onChange={(e) => setKmlRegNo(e.target.value)} />
                </div>
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
                  Only the primary is chosen. Every other shade the app uses — hovers, fills, pale backgrounds, the
                  print header — is derived from it, which is what the strip above shows.
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
                {catalogue.modules.map((m) => (
                  <label key={m} className="sa-check">
                    <input
                      type="checkbox"
                      checked={modules.includes(m)}
                      onChange={() => setModulesState(toggle(modules, m))}
                    />
                    <span>
                      {MODULE_LABELS[m] ?? m}
                      <span className="sa-check-sub">{MODULE_HINTS[m] ?? ""}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="sa-field">
                <label>Document languages</label>
                {catalogue.languages.map((l) => {
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
                <ReviewRow label="Address" value={addressLine} changed={changed.profile} />
                <ReviewRow label="Registration no." value={kmlRegNo} changed={changed.profile} />
                <ReviewRow label="Deployment URL" value={appUrl} changed={changed.profile} />
                <ReviewRow label="Primary colour" value={color} changed={changed.color} />
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
              <select value={tierId} onChange={(e) => setTierId(Number(e.target.value))}>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.branchQuota} branch{t.branchQuota === 1 ? "" : "es"})
                  </option>
                ))}
              </select>
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
