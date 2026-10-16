"use client";

import { useEffect, useState } from "react";
import { createBusiness, changeTier, updateProfile, setBranding, setModules, setLanguages, uploadLogo, clearLogo, uploadSignature, fetchSignatureUrl, clearSignature, getAdminLogin, updateAdminLogin, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Business, type Tier, type Catalogue } from "@/modules/superadmin/types/superadmin-types";
import { Select } from "@/modules/superadmin/components/Select";
import { DEFAULT_BRAND_COLOR, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SCALE, LOGO_SCALES, DEFAULT_LOGO_SCALE, DEFAULT_LOGO_DISPLAY } from "@/modules/superadmin/config/theme";
import BrandingStep, { type BrandingDraft } from "@/modules/superadmin/components/BrandingStep";
import { classicLayout, LAYOUT_PRESETS, LOGO_WIDTH_SQUARE, matchingPreset, parseHeaderLayout, serializeHeaderLayout, type HeaderLayout } from "@/common/config/headerLayout";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";
import { ReviewRow } from "@/modules/superadmin/components/ReviewRow";
import { sortedTiers, plansFor, downgradeNote, planLabel, MODULE_LABELS, LANGUAGE_LABELS } from "@/modules/superadmin/utils/dashboardHelpers";
import { useActiveBranches } from "@/modules/superadmin/hooks/use-active-branches";
import { StepId } from "@/modules/superadmin/types/dashboard-types";

function planLabelFor(tiers: Tier[], id: number): string {
  const t = tiers.find((x) => x.id === id);
  return t ? planLabel(t) : `#${id}`;
}
const MODULE_HINTS: Record<string, string> = {
  settings: "The Settings page (integration API keys).",
  branches: "The Branch Management page. Branches themselves keep working either way — only administering them is hidden.",
  whatsapp:
    "Settings > Integrations > WhatsApp: lets this business link its own WhatsApp number (QR or phone number) so messages go out from it. Without it the business keeps using the shared server number.",
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
  ta: "Pledge book (indemnity and eSign bond) in Tamil for Tamil Nadu businesses.",
};
type Step = { id: StepId; label: string };
function stepsFor(isCreate: boolean): Step[] {
  const steps: Step[] = [
    { id: "profile", label: "Business" },
    { id: "branding", label: "Branding" },
    { id: "grants", label: "Modules, languages & signature" },
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
type BusinessWizardProps = {
  business: Business | null;
  openAt: StepId;
  tiers: Tier[];
  catalogue: Catalogue;
  onClose: () => void;
  onDone: () => void;
};

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
export function BusinessWizard({
  business,
  openAt,
  tiers,
  catalogue,
  onClose,
  onDone,
}: BusinessWizardProps) {
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
  const [tierId, setTierId] = useState(business?.tierId ?? sortedTiers(tiers)[0]?.id ?? 0);
  const activeBranches = useActiveBranches(business?.id ?? null);
  const planOptions = plansFor(tiers);
  const planNote = downgradeNote(tiers.find((t) => t.id === tierId), activeBranches);
  /* Single-branch mode follows the plan: a 1-branch plan hides Branch
   * Management and locks every branch picker to Head Office. The server
   * derives it the same way on create and on a plan change. */
  const singleBranch = tiers.find((t) => t.id === tierId)?.branchQuota === 1;
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
  /* Registration no., phone, address and the GML lender particulars are not
   * edited here: the business fills them in itself under Settings > Business
   * Profile. */
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
  /* No longer edited here: the arranged header's logo width (dragged in the
   * Branding preview) replaced the size dropdown. Sent back unchanged so a
   * business still on the classic lockup keeps the size it had. */
  const logoScale = business?.logoScale || DEFAULT_LOGO_SCALE;
  const initialLogoDisplay = business?.logoDisplay || DEFAULT_LOGO_DISPLAY;
  const [logoDisplay, setLogoDisplay] = useState(initialLogoDisplay);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  /* Removing the saved logo is held until save, like every other edit here. */
  const [removeLogo, setRemoveLogo] = useState(false);
  const initialNavText = business?.navTextColor || "";
  const [navTextColor, setNavTextColor] = useState(initialNavText);
  const initialOnBrandText = business?.onBrandTextColor || "";
  const [onBrandTextColor, setOnBrandTextColor] = useState(initialOnBrandText);

  /* The sidebar header. A business never arranged starts from the classic
   * lockup at its current logo size, and keeps rendering classically until
   * the vendor actually changes the header (see `layoutTouched`). */
  const savedLayoutRaw = business?.headerLayout ?? "";
  const [initialLayout] = useState<HeaderLayout>(
    () =>
      parseHeaderLayout(savedLayoutRaw) ?? {
        ...classicLayout("square"),
        logoWidth: Math.round(LOGO_WIDTH_SQUARE * (LOGO_SCALES[logoScale] ?? 1)),
      }
  );
  const [headerLayout, setHeaderLayout] = useState<HeaderLayout>(initialLayout);
  const layoutTouched = JSON.stringify(headerLayout) !== JSON.stringify(initialLayout);
  /* What the save sends. The backend overwrites the stored layout on every
   * branding save, so an untouched one goes back exactly as it was ("" keeps
   * a classic business classic). A new business is saved arranged. */
  const layoutToSave = isCreate || layoutTouched ? serializeHeaderLayout(headerLayout) : savedLayoutRaw;
  const classicHeader = !isCreate && !savedLayoutRaw && !layoutTouched;

  /* The lender's signature, printed by the backend on every document with a
   * lender/owner signature line. A new pick is held locally and uploaded on
   * save, like the logo; `removeSignature` clears a saved one instead. The
   * saved image is fetched behind the superadmin token for the preview. */
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [savedSignatureUrl, setSavedSignatureUrl] = useState<string | null>(null);
  const [removeSignature, setRemoveSignature] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);

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

  const hasSavedSignature = business?.hasSignature ?? false;
  useEffect(() => {
    if (businessId === undefined || !hasSavedSignature) return;
    let cancelled = false;
    let url: string | null = null;
    fetchSignatureUrl(businessId)
      .then((u) => {
        url = u;
        if (cancelled) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        setSavedSignatureUrl(u);
      })
      .catch(() => {
        /* preview only — the row still says a signature is set */
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [businessId, hasSavedSignature]);

  function pickSignature(file: File | null) {
    setSignatureError(null);
    if (file && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setSignatureError("Use a PNG, JPEG or WebP image.");
      return;
    }
    if (file && file.size > 1024 * 1024) {
      setSignatureError("The signature image must be 1 MB or smaller.");
      return;
    }
    if (signaturePreview) URL.revokeObjectURL(signaturePreview);
    setSignatureFile(file);
    setSignaturePreview(file ? URL.createObjectURL(file) : null);
    if (file) setRemoveSignature(false);
  }

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

  /* The Branding step edits one draft object (it keeps undo history of it);
   * these are the wizard fields it maps onto. The short name and subtitle are
   * Step 1's own fields, also typed directly in the header preview. */
  const brandingDraft: BrandingDraft = {
    color,
    secondaryColor,
    navTextColor,
    onBrandTextColor,
    logoDisplay,
    fontFamily,
    fontScale,
    layout: headerLayout,
    shortName,
    tagline,
    logoFile,
    logoPreview,
    removeLogo,
  };
  function setBrandingDraft(d: BrandingDraft) {
    setColor(d.color);
    setSecondaryColor(d.secondaryColor);
    setNavTextColor(d.navTextColor);
    setOnBrandTextColor(d.onBrandTextColor);
    setLogoDisplay(d.logoDisplay);
    setFontFamily(d.fontFamily);
    setFontScale(d.fontScale);
    setHeaderLayout(d.layout);
    setShortName(d.shortName);
    if (d.tagline !== tagline) setTaglineTouched(true);
    setTagline(d.tagline);
    setLogoFile(d.logoFile);
    setLogoPreview(d.logoPreview);
    setRemoveLogo(d.removeLogo);
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
        policy !== initialPolicy ||
        appUrl !== (business.appUrl ?? "")),
    theme:
      !isCreate &&
      (color !== initialColor ||
        secondaryColor !== initialSecondary ||
        fontFamily !== initialFontFamily ||
        fontScale !== initialFontScale ||
        logoDisplay !== initialLogoDisplay ||
        navTextColor !== initialNavText ||
        onBrandTextColor !== initialOnBrandText ||
        layoutTouched),
    logo: logoFile !== null || (removeLogo && !!business?.logoUrl),
    signature: signatureFile !== null || (removeSignature && hasSavedSignature),
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
    layoutToSave !== "" ||
    navTextColor !== "" ||
    onBrandTextColor !== "" ||
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
        if (signatureFile) await uploadSignature(created.id, signatureFile, reason);
        if (shortName || tagline) {
          await updateProfile(created.id, {
            name, legalName, shortName, lockupTagline: tagline, policy, appUrl, reason,
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
            navTextColor,
            onBrandTextColor,
            headerLayout: layoutToSave,
            reason,
          });
        }
      } else {
        if (changed.plan) await changeTier(business.id, tierId, reason);
        if (changed.profile) {
          await updateProfile(business.id, {
            name, legalName, shortName, lockupTagline: tagline, policy, appUrl, reason,
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
            navTextColor,
            onBrandTextColor,
            headerLayout: layoutToSave,
            reason,
          });
        }
        if (changed.logo && logoFile) await uploadLogo(business.id, logoFile, reason);
        else if (changed.logo && removeLogo) await clearLogo(business.id, reason);
        if (signatureFile) await uploadSignature(business.id, signatureFile, reason);
        else if (removeSignature && hasSavedSignature) await clearSignature(business.id, reason);
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

        {/* The Branding step lays out its own two scrolling panes edge to edge. */}
        <div className={`sa-modal-body${step.id === "branding" ? " bs-host" : ""}`}>
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
                  Decides the pledge agreement and narrows document languages on the Grants step. Registration no.,
                  phone, address{policy === "gml" ? " and the lender's age, PAN and Aadhaar" : ""} are filled in by the
                  business itself under Settings &gt; Business Profile.
                </span>
              </div>

              <div className="sa-field">
                <label>Plan</label>
                <Select
                  value={String(tierId)}
                  onChange={(v) => setTierId(Number(v))}
                  ariaLabel="Plan"
                  options={planOptions.map((t) => ({ value: String(t.id), label: planLabel(t) }))}
                />
                <span className="sa-hint">
                  {singleBranch
                    ? "Head Office only: Branch Management is hidden and every branch picker is locked to it."
                    : "Decides how many active branches this business may run. Enforced by the server."}
                  {!isCreate && " Takes effect on save and asks for a reason."}
                </span>
                {planNote && <span className="sa-hint">{planNote}</span>}
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
            <BrandingStep
              draft={brandingDraft}
              onChange={setBrandingDraft}
              savedLogoUrl={business?.logoUrl ?? ""}
              businessName={name}
              code={isCreate ? code : business.code}
              classic={classicHeader}
              isCreate={isCreate}
            />
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
                  // Branch Management is meaningless for a single-branch
                  // business; the server refuses it regardless. The stored
                  // tick is kept so switching back restores it.
                  const locked = m === "branches" && singleBranch;
                  const on = modules.includes(m) && !locked;
                  return (
                    <div key={m}>
                      <label className={`sa-check${destructive ? " danger" : ""}${confirmGrant === m ? " confirming" : ""}${locked ? " locked" : ""}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={locked}
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
                          <span className="sa-check-sub">
                            {locked ? "Off for single-branch businesses (see Plan)." : MODULE_HINTS[m] ?? ""}
                          </span>
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

              <div className="sa-field">
                <label>Lender signature</label>
                <div className="sa-logo-row">
                  {(signaturePreview || (!removeSignature && savedSignatureUrl)) && (
                    <img
                      className="sa-logo-preview sa-sign-preview"
                      src={signaturePreview || savedSignatureUrl || undefined}
                      alt="Lender signature"
                    />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => pickSignature(e.target.files?.[0] ?? null)}
                  />
                  {!signatureFile && hasSavedSignature && (
                    <button
                      type="button"
                      className="sa-link-btn"
                      onClick={() => setRemoveSignature((r) => !r)}
                    >
                      {removeSignature ? "Keep signature" : "Remove"}
                    </button>
                  )}
                </div>
                {signatureError && <span className="sa-error">{signatureError}</span>}
                <span className="sa-hint">
                  Printed on the lender/owner signature line of every document — pledge agreements, release
                  agreements, receipts and debenture agreements. Use a PNG with a transparent or white background, 1 MB
                  max.{isCreate && " Uploaded once the business has been created."}
                  {removeSignature && " It will be removed on save; documents then print a blank line for a wet-ink signature."}
                </span>
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
                <ReviewRow
                  label="Document policy"
                  value={catalogue.policies.find((p) => p.code === policy)?.label ?? policy}
                  changed={changed.profile}
                />
                <ReviewRow label="Deployment URL" value={appUrl} changed={changed.profile} />
                <ReviewRow label="Primary colour" value={color} changed={changed.theme} />
                <ReviewRow label="Secondary colour" value={secondaryColor || "unset"} changed={changed.theme} />
                <ReviewRow label="Text on primary" value={onBrandTextColor || "automatic"} changed={changed.theme} />
                <ReviewRow label="Sidebar text" value={navTextColor || "automatic"} changed={changed.theme} />
                <ReviewRow
                  label="Sidebar header"
                  value={
                    classicHeader
                      ? "classic"
                      : (LAYOUT_PRESETS.find((p) => p.id === matchingPreset(headerLayout.tree))?.label ?? "custom") +
                        ` · ${headerLayout.logoShape} logo`
                  }
                  changed={changed.theme}
                />
                <ReviewRow label="Font" value={fontFamily} changed={changed.theme} />
                <ReviewRow label="Text size" value={fontScale} changed={changed.theme} />
                <ReviewRow label="Logo backing" value={logoDisplay} changed={changed.theme} />
                <ReviewRow
                  label="Logo"
                  value={logoFile ? logoFile.name : removeLogo && business?.logoUrl ? "removed" : business?.logoUrl ? "already set" : ""}
                  changed={changed.logo}
                />
                <ReviewRow
                  label="Lender signature"
                  value={
                    signatureFile
                      ? signatureFile.name
                      : removeSignature && hasSavedSignature
                        ? "removed"
                        : hasSavedSignature
                          ? "already set"
                          : ""
                  }
                  changed={changed.signature}
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

          {/* The body scrolls, so an error rendered down here can sit below
            * the fold — scroll it into view the moment it appears. */}
          {error && <p className="sa-error" ref={(el) => el?.scrollIntoView({ block: "nearest" })}>{error}</p>}
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
