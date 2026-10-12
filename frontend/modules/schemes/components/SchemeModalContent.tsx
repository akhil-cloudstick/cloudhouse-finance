"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/common/hooks/use-branch-switch";
import { createScheme, updateScheme } from "@/modules/schemes/services/schemeService";
import { type SchemeView, type ServiceChargeType, type ServiceChargeMode } from "@/modules/schemes/types/scheme-types";
import { Select } from "@/common/components/ui/Select";
import { singleFlight } from "@/common/utils/singleFlight";

const DEFAULT_DURATION_MONTHS = 12;
export const MULTIPLE_INTEREST = "Multiple interest";
export const SCHEME_METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly", MULTIPLE_INTEREST];
const METHODS = SCHEME_METHODS;
type TierDraft = { days: string; rate: string };
const EMPTY_TIERS: TierDraft[] = [{ days: "", rate: "" }, { days: "", rate: "" }];
// Digits (and one decimal point) only — these inputs are plain text, so no spinner buttons.
const cleanNum = (v: string, decimal: boolean) => (decimal ? v.replace(/[^0-9.]/g, "") : v.replace(/\D/g, ""));

/* First tier is the starting rate; each later step re-prices the interest
 * accrued so far once interest has stayed unpaid past the previous step's days. */
function tiersError(tiers: TierDraft[]): string {
  if (tiers.length < 2) return "Add at least two rate rows.";
  for (let i = 0; i < tiers.length; i++) {
    if (!(parseFloat(tiers[i].rate) > 0)) return `Row ${i + 1}: enter a rate above 0.`;
    if (i < tiers.length - 1 && !(parseInt(tiers[i].days, 10) > 0)) return `Row ${i + 1}: enter the days above 0.`;
  }
  return "";
}
const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: m }));
const STATUS_OPTIONS = [{ value: "1", label: "Active" }, { value: "0", label: "Inactive" }];
const CHARGE_TYPE_OPTIONS: { value: ServiceChargeType; label: string }[] = [
  { value: "None", label: "No service charge" },
  { value: "Flat", label: "Flat amount (₹)" },
  { value: "Percent", label: "Percentage of principal" },
];

type SchemeModalContentProps = { scheme?: SchemeView; onSaved: () => void };

/* Ported from legacy/app.js's `openSchemeModal(id)` / `saveScheme(id)`
 * (legacy/app.js:1154-1219). Now calls the Go backend (`POST`/`PUT
 * /api/v1/schemes`) instead of writing to the localStorage mock store. */
export function SchemeModalContent({ scheme: s, onSaved }: SchemeModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { can, branchId: myBranchId } = useAuth();
  const canViewAllBranches = can("Branch_Management", "can_view_all_branches");

  const [name, setName] = useState(s?.name || "");
  const [rate, setRate] = useState(s ? String(s.rate) : "");
  const [duration, setDuration] = useState(String(s?.durationMonths || DEFAULT_DURATION_MONTHS));
  const [ltv, setLtv] = useState(s ? String(s.ltv) : "");
  const [method, setMethod] = useState(s?.method || METHODS[0]);
  const [tiers, setTiers] = useState<TierDraft[]>(
    s?.rateTiers?.length ? s.rateTiers.map((t, i, a) => ({ days: i === a.length - 1 ? "" : String(t.days), rate: String(t.rate) })) : EMPTY_TIERS
  );
  const [minDays, setMinDays] = useState(s?.minimumDays ? String(s.minimumDays) : "0");
  const isMultiple = method === MULTIPLE_INTEREST;
  const [penal, setPenal] = useState(s ? String(s.penal) : "");
  const [cond, setCond] = useState(s?.cond || "");
  const [active, setActive] = useState(s ? s.active : true);
  const [chargeType, setChargeType] = useState<ServiceChargeType>(s?.serviceChargeType || "None");
  const [chargeValue, setChargeValue] = useState(s && s.serviceChargeType !== "None" ? String(s.serviceChargeValue) : "");
  // Not edited here any more — chosen per loan at creation. Passed through
  // unchanged so an existing scheme keeps its stored value.
  const chargeMode: ServiceChargeMode = s?.serviceChargeMode || "WithheldFromPayout";
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  // Single-branch plan: no branch is ever shown — the field is not rendered.
  const showBranch = useShowBranch();
  // Locked (and defaulted) to the global branch selection when one is
  // active, the same way a single-branch business locks it.
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [branchId, setBranchId] = useState<number | "">(
    s?.branchId || (!canViewAllBranches && myBranchId ? myBranchId : lockedBranchId || "")
  );
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Non-admins are confined to their own branch (the backend enforces
    // this server-side regardless) — auto-lock the field instead of
    // offering a dropdown of branches they can't actually use.
    if (!canViewAllBranches) {
      if (myBranchId) setBranchId(myBranchId);
      return;
    }
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length && !s) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, [s, canViewAllBranches, myBranchId]);

  async function save() { return singleFlight("modal:scheme:save", async () => {
    const n = name.trim();
    const d = parseInt(duration, 10);
    const l = parseInt(ltv, 10);
    const p = parseFloat(penal);
    const tErr = isMultiple ? tiersError(tiers) : "";
    // Multiple interest: the scheme's headline rate is the first step's rate.
    const r = isMultiple ? parseFloat(tiers[0]?.rate) : parseFloat(rate);
    if (n.length < 3) { setErr("Please enter a scheme name."); return; }
    if (tErr) { setErr(tErr); return; }
    if (!(r > 0)) { setErr("Please enter a valid interest rate."); return; }
    if (!(d > 0)) { setErr("Please enter a valid loan duration in months."); return; }
    if (!(l >= 1 && l <= 100)) { setErr("LTV must be between 1 and 100%."); return; }
    if (!(p >= 0 && p <= 60)) { setErr("Please enter penal charges between 0 and 60% per annum."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }
    const cv = chargeType === "None" ? 0 : parseFloat(chargeValue);
    if (chargeType !== "None" && !(cv >= 0 && (chargeType !== "Percent" || cv <= 100))) {
      setErr(chargeType === "Percent" ? "Percentage charge must be between 0 and 100." : "Please enter a valid flat charge amount.");
      return;
    }

    const rateTiers = isMultiple
      ? tiers.map((t, i) => ({ days: i === tiers.length - 1 ? 0 : parseInt(t.days, 10), rate: parseFloat(t.rate) }))
      : [];
    const input = {
      name: n, rate: r, rateTiers, minimumDays: isMultiple ? parseInt(minDays, 10) || 0 : 0, durationMonths: d, ltv: l, penal: p, method, cond: cond.trim(), active, branchId: branchId as number,
      serviceChargeType: chargeType, serviceChargeValue: cv, serviceChargeMode: chargeMode,
    };
    setSaving(true);
    setErr("");
    try {
      if (s) await updateScheme(s.id, input);
      else await createScheme(input);
      onSaved();
      closeModal();
      toast(s ? `Scheme "${n}" updated` : `Scheme "${n}" created`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save scheme.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>{s ? "Edit Scheme — " + s.name : "New Loan Scheme"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2 scheme-frow">
          <div><label className="f">Scheme Name *</label><input className="inp" placeholder="e.g. Swarna Premium" value={name} onChange={(e) => setName(e.target.value)} /></div>
          {isMultiple ? (
            <div><label className="f">Minimum Period (days)</label><input className="inp" inputMode="numeric" value={minDays} onChange={(e) => setMinDays(cleanNum(e.target.value, false))} /></div>
          ) : (
            <div><label className="f">Interest Rate (% p.a.) *</label><input className="inp" inputMode="decimal" placeholder="12.5" value={rate} onChange={(e) => setRate(cleanNum(e.target.value, true))} /></div>
          )}
        </div>
        <div className="frow c2 scheme-frow">
          <div><label className="f">Loan Duration (months) *</label>
            <input className="inp" inputMode="numeric" placeholder="e.g. 12" value={duration} onChange={(e) => setDuration(cleanNum(e.target.value, false))} /></div>
          <div><label className="f">LTV (%) *</label><input className="inp" inputMode="numeric" placeholder="e.g. 90" value={ltv} onChange={(e) => setLtv(cleanNum(e.target.value, false))} /></div>
        </div>
        <div className="frow c2 scheme-frow">
          <div><label className="f">Interest Calculation Method</label>
            <Select options={METHOD_OPTIONS} value={method} onChange={setMethod} /></div>
          <div><label className="f">Penal Charges (% p.a.) *</label>
            <input className="inp" inputMode="decimal" placeholder="e.g. 24" value={penal} onChange={(e) => setPenal(cleanNum(e.target.value, true))} /></div>
        </div>
        {isMultiple && (
          <div className="scheme-frow" style={{ marginBottom: 12 }}>
            <label className="f">Rate ladder *</label>
            <div style={{ border: "1px solid var(--line)", borderRadius: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 28px", gap: 10, padding: "8px 12px", fontSize: 11.5, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                <span>#</span><span>If interest unpaid for (days)</span><span>Rate (% p.a.)</span><span />
              </div>
              {tiers.map((t, i) => {
                const last = i === tiers.length - 1;
                const patch = (p: Partial<TierDraft>) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 28px", gap: 10, alignItems: "center", padding: "8px 12px", borderTop: i ? "1px dashed var(--line)" : undefined }}>
                    <span style={{ color: "var(--gold-deep)", fontSize: 12 }}>{i + 1}</span>
                    {last
                      ? <div className="inp" style={{ color: "var(--muted)", fontStyle: "italic" }}>Thereafter</div>
                      : <input className="inp" inputMode="numeric" placeholder="e.g. 90" value={t.days} onChange={(e) => patch({ days: cleanNum(e.target.value, false) })} />}
                    <input className="inp" inputMode="decimal" placeholder="e.g. 12" value={t.rate} onChange={(e) => patch({ rate: cleanNum(e.target.value, true) })} />
                    <button type="button" className="btn plain sm" aria-label={`Remove row ${i + 1}`} disabled={tiers.length <= 2}
                      onClick={() => setTiers((cur) => cur.filter((_, j) => j !== i))}>✕</button>
                  </div>
                );
              })}
              <div style={{ padding: "8px 12px" }}>
                <button type="button" className="btn ghost sm" onClick={() => setTiers((cur) => [...cur.slice(0, -1), { days: "", rate: "" }, cur[cur.length - 1]])}>+ Add rate row</button>
              </div>
            </div>
          </div>
        )}
        <div className="frow scheme-frow"><div><label className="f">Applicable Conditions</label>
          <input className="inp" placeholder="e.g. Interest payable monthly; penal 24% p.a. after due" value={cond} onChange={(e) => setCond(e.target.value)} /></div></div>
        <div className="frow c2 scheme-frow">
          <div><label className="f">Service Charge</label>
            <Select options={CHARGE_TYPE_OPTIONS} value={chargeType} onChange={(v) => setChargeType(v as ServiceChargeType)} /></div>
          {chargeType !== "None" && (
            <div><label className="f">{chargeType === "Flat" ? "Charge Amount (₹) *" : "Charge (% of principal) *"}</label>
              <input
                className="inp" inputMode="decimal"
                placeholder={chargeType === "Flat" ? "e.g. 500" : "e.g. 2"}
                value={chargeValue} onChange={(e) => setChargeValue(cleanNum(e.target.value, true))}
              /></div>
          )}
        </div>
        <div className={showBranch ? "frow c2 scheme-frow" : "frow scheme-frow"}>
          <div><label className="f">Status</label>
            <Select options={STATUS_OPTIONS} value={active ? "1" : "0"} onChange={(v) => setActive(v === "1")} /></div>
          {showBranch && <div><label className="f">Branch *</label>
            {canViewAllBranches ? (
              <Select
                disabled={branchLocked}
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                value={branchId ? String(branchId) : ""}
                onChange={(v) => setBranchId(v ? Number(v) : "")}
                placeholder="Select branch…"
              />
            ) : (
              // Non-admins are confined to their own branch — the backend
              // enforces this regardless, so the field is locked rather
              // than offering a choice they can't actually use.
              <Select
                options={[{ value: String(branchId || ""), label: s?.branchName || "Your branch" }]}
                value={String(branchId || "")}
                onChange={() => {}}
                disabled
              />
            )}</div>}
        </div>
        <div className="notice"><Icon name="shield" /> Scheme changes are restricted to authorized administrators and recorded in the audit trail.</div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : s ? "Save Changes" : "Create Scheme"}</button>
      </div>
    </>
  );
}
