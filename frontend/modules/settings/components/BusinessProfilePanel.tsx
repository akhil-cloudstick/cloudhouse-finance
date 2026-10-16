"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { useBranding } from "@/common/providers/BrandingProvider";
import { getBusinessProfile, updateBusinessProfile } from "@/modules/settings/services/businessProfileService";
import { type BusinessProfile, type BusinessProfileInput } from "@/modules/settings/types/settings-types";

const POLICY_LABELS: Record<string, string> = {
  kml: "KML — Kerala Money Lenders",
  gml: "GML — Gujarat Money Lenders",
  tml: "TML — Tamil Nadu Money Lenders",
};

const HINT: React.CSSProperties = { display: "block", color: "var(--muted)", fontSize: 11.5, marginTop: 4 };
const GROUP_H: React.CSSProperties = { margin: "18px 0 8px", fontSize: 13, letterSpacing: ".04em", display: "flex", alignItems: "center", gap: 8 };

type PolicyField = {
  key: keyof BusinessProfileInput;
  label: string;
  placeholder?: string;
  maxLength: number;
  inputMode?: "numeric" | "text";
  clean: (v: string) => string;
};

/* The particulars only one policy's paperwork prints. Keyed by policy code so
 * a field KML or TML documents start to need is one entry here (plus its
 * column and the server-side check). GML deeds name the licensee as a party,
 * so the server requires all three under GML (common.LenderIdentity). */
const POLICY_FIELDS: Record<string, { title: string; hint: string; fields: PolicyField[] }> = {
  gml: {
    title: "Lender particulars (GML)",
    hint: "Required under GML. Printed on the pledge agreement as the lender's particulars.",
    fields: [
      { key: "lenderAge", label: "Lender age *", maxLength: 3, inputMode: "numeric", clean: (v) => v.replace(/\D/g, "") },
      { key: "lenderPan", label: "Lender PAN *", placeholder: "ABCDE1234F", maxLength: 10, clean: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "") },
      { key: "lenderAadhaar", label: "Lender Aadhaar no. *", placeholder: "12 digits", maxLength: 12, inputMode: "numeric", clean: (v) => v.replace(/\D/g, "") },
    ],
  },
};

const EMPTY: BusinessProfileInput = { kmlRegNo: "", contactPhone: "", addressLine: "", lenderAge: "", lenderPan: "", lenderAadhaar: "" };

function inputOf(p: BusinessProfile): BusinessProfileInput {
  return {
    kmlRegNo: p.kmlRegNo ?? "",
    contactPhone: p.contactPhone ?? "",
    addressLine: p.addressLine ?? "",
    lenderAge: p.lenderAge ?? "",
    lenderPan: p.lenderPan ?? "",
    lenderAadhaar: p.lenderAadhaar ?? "",
  };
}

/* Settings modal > Business Profile: the details this business prints on its
 * own slips, statements and pledge agreements, plus the particulars its
 * document policy needs (GML: lender age, PAN, Aadhaar). The business name,
 * legal name and policy stay with the superadmin console. */
export function BusinessProfilePanel() {
  const toast = useToast();
  const { can } = useAuth();
  const { refresh: refreshBranding } = useBranding();
  const canUpdate = can("Business_Profile", "can_update_business_profile");
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [form, setForm] = useState<BusinessProfileInput>(EMPTY);
  const [loadError, setLoadError] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBusinessProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setForm(inputOf(p));
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load the business profile.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const policy = profile?.policy || "kml";
  const policySection = POLICY_FIELDS[policy];
  const saved = profile ? inputOf(profile) : EMPTY;
  const dirty = (Object.keys(form) as (keyof BusinessProfileInput)[]).some((k) => form[k] !== saved[k]);
  const missingPolicyFields = policySection ? policySection.fields.filter((f) => !saved[f.key]) : [];

  function set(key: keyof BusinessProfileInput, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (policySection) {
      const missing = policySection.fields.find((f) => !form[f.key].trim());
      if (missing) {
        setErr(`${missing.label.replace(" *", "")} is required under ${policy.toUpperCase()}.`);
        return;
      }
    }
    setSaving(true);
    setErr("");
    try {
      const next = await updateBusinessProfile(form);
      setProfile(next);
      setForm(inputOf(next));
      refreshBranding();
      toast("Business profile saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save the business profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="set-head">
        <h4>Business Profile</h4>
        {profile && <span className="chip brand">{POLICY_LABELS[policy] ?? policy.toUpperCase()}</span>}
      </div>
      <p className="set-sub">The details printed on your slips, statements and pledge agreements.</p>

      {loadError && <p className="set-err">{loadError}</p>}
      {!loadError && profile === null && (
        <div className="set-msg"><span className="set-spin" /><span>Loading business profile…</span></div>
      )}

      {profile !== null && (
        <>
          <h5 style={{ ...GROUP_H, marginTop: 4 }}>Registration &amp; contact</h5>
          <div className="frow c2">
            <div><label className="f">Registration no.</label>
              <input className="inp" value={form.kmlRegNo} disabled={!canUpdate} maxLength={60}
                onChange={(e) => set("kmlRegNo", e.target.value)} autoComplete="off" />
              <span style={HINT}>Printed on your lending documents.</span></div>
            <div><label className="f">Business phone</label>
              <input className="inp" value={form.contactPhone} disabled={!canUpdate} inputMode="tel" maxLength={120}
                placeholder="+91 9000012345, +91 9000067890"
                onChange={(e) => set("contactPhone", e.target.value.replace(/[^0-9+,\-() ]/g, ""))} autoComplete="off" />
              <span style={HINT}>Printed in the header of slips and statements. Separate several numbers with commas.</span></div>
          </div>
          <div className="frow"><div><label className="f">Registered address</label>
            <input className="inp" value={form.addressLine} disabled={!canUpdate} maxLength={300}
              onChange={(e) => set("addressLine", e.target.value)} autoComplete="off" />
            <span style={HINT}>One line, as it should appear on customer documents.</span></div></div>

          {policySection ? (
            <>
              <h5 style={GROUP_H}>
                {policySection.title}
                {missingPolicyFields.length > 0
                  ? <span className="chip amber">Incomplete</span>
                  : <span className="chip green">Complete</span>}
              </h5>
              <div className="frow c3">
                {policySection.fields.map((f) => (
                  <div key={f.key}><label className="f">{f.label}</label>
                    <input className="inp" value={form[f.key]} disabled={!canUpdate} maxLength={f.maxLength}
                      inputMode={f.inputMode} placeholder={f.placeholder}
                      onChange={(e) => set(f.key, f.clean(e.target.value))} autoComplete="off" /></div>
                ))}
              </div>
              <span style={HINT}>
                {policySection.hint}
                {missingPolicyFields.length > 0 && " Until they are filled in, pledge agreements print placeholders."}
              </span>
            </>
          ) : (
            <p className="set-note" style={{ marginTop: 14 }}>
              No additional particulars are needed for {policy.toUpperCase()} documents — the registration no.,
              phone and address above are all they print.
            </p>
          )}

          {err && <p className="set-err">{err}</p>}
          {canUpdate && (
            <div className="set-meta" style={{ marginTop: 16 }}>
              <button className="btn sm" onClick={save} disabled={saving || !dirty}>
                <Icon name="check" /> {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
