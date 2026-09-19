"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import {
  createScheme, updateScheme,
  type SchemeView, type ServiceChargeType, type ServiceChargeMode,
} from "@/product/pages/schemes/services/schemeService";
import { Select } from "@/product/components/ui/Select";

const DEFAULT_DURATION_MONTHS = 12;
const METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly"];
const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: m }));
const STATUS_OPTIONS = [{ value: "1", label: "Active" }, { value: "0", label: "Inactive" }];
const CHARGE_TYPE_OPTIONS: { value: ServiceChargeType; label: string }[] = [
  { value: "None", label: "No service charge" },
  { value: "Flat", label: "Flat amount (₹)" },
  { value: "Percent", label: "Percentage of principal" },
];
const CHARGE_MODE_OPTIONS: { value: ServiceChargeMode; label: string }[] = [
  { value: "WithheldFromPayout", label: "Withhold from payout — deducted from what's disbursed" },
  { value: "AddedToPrincipal", label: "Added to principal — borrowed and repaid like the rest of the loan" },
];

/* Ported from legacy/app.js's `openSchemeModal(id)` / `saveScheme(id)`
 * (legacy/app.js:1154-1219). Now calls the Go backend (`POST`/`PUT
 * /api/v1/schemes`) instead of writing to the localStorage mock store. */
export function SchemeModalContent({ scheme: s, onSaved }: { scheme?: SchemeView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { isAdmin, branchId: myBranchId } = useAuth();

  const [name, setName] = useState(s?.name || "");
  const [rate, setRate] = useState(s ? String(s.rate) : "");
  const [duration, setDuration] = useState(String(s?.durationMonths || DEFAULT_DURATION_MONTHS));
  const [ltv, setLtv] = useState(s ? String(s.ltv) : "");
  const [method, setMethod] = useState(s?.method || METHODS[0]);
  const [penal, setPenal] = useState(s ? String(s.penal) : "");
  const [cond, setCond] = useState(s?.cond || "");
  const [active, setActive] = useState(s ? s.active : true);
  const [chargeType, setChargeType] = useState<ServiceChargeType>(s?.serviceChargeType || "None");
  const [chargeValue, setChargeValue] = useState(s && s.serviceChargeType !== "None" ? String(s.serviceChargeValue) : "");
  const [chargeMode, setChargeMode] = useState<ServiceChargeMode>(s?.serviceChargeMode || "WithheldFromPayout");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">(
    s?.branchId || (!isAdmin && myBranchId ? myBranchId : "")
  );
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Non-admins are confined to their own branch (the backend enforces
    // this server-side regardless) — auto-lock the field instead of
    // offering a dropdown of branches they can't actually use.
    if (!isAdmin) {
      if (myBranchId) setBranchId(myBranchId);
      return;
    }
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length && !s) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, [s, isAdmin, myBranchId]);

  async function save() {
    const n = name.trim();
    const r = parseFloat(rate);
    const d = parseInt(duration, 10);
    const l = parseInt(ltv, 10);
    const p = parseFloat(penal);
    if (n.length < 3) { setErr("Please enter a scheme name."); return; }
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

    const input = {
      name: n, rate: r, durationMonths: d, ltv: l, penal: p, method, cond: cond.trim(), active, branchId: branchId as number,
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
  }

  return (
    <>
      <div className="hd"><h3>{s ? "Edit Scheme — " + s.name : "New Loan Scheme"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2 scheme-frow">
          <div><label className="f">Scheme Name *</label><input className="inp" placeholder="e.g. Swarna Premium" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Interest Rate (% p.a.) *</label><input className="inp" type="number" step="0.1" min={0} placeholder="12.5" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        </div>
        <div className="frow c2 scheme-frow">
          <div><label className="f">Loan Duration (months) *</label>
            <input className="inp" type="number" min={1} step={1} placeholder="e.g. 12" value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
          <div><label className="f">LTV (%) *</label><input className="inp" type="number" min={1} max={100} placeholder="e.g. 90" value={ltv} onChange={(e) => setLtv(e.target.value)} /></div>
        </div>
        <div className="frow c2 scheme-frow">
          <div><label className="f">Interest Calculation Method</label>
            <Select options={METHOD_OPTIONS} value={method} onChange={setMethod} /></div>
          <div><label className="f">Penal Charges (% p.a.) *</label>
            <input className="inp" type="number" step="0.1" min={0} max={60} placeholder="e.g. 24" value={penal} onChange={(e) => setPenal(e.target.value)} /></div>
        </div>
        <div className="frow scheme-frow"><div><label className="f">Applicable Conditions</label>
          <input className="inp" placeholder="e.g. Interest payable monthly; penal 24% p.a. after due" value={cond} onChange={(e) => setCond(e.target.value)} /></div></div>
        <div className="frow c2 scheme-frow">
          <div><label className="f">Service Charge</label>
            <Select options={CHARGE_TYPE_OPTIONS} value={chargeType} onChange={(v) => setChargeType(v as ServiceChargeType)} /></div>
          {chargeType !== "None" && (
            <div><label className="f">{chargeType === "Flat" ? "Charge Amount (₹) *" : "Charge (% of principal) *"}</label>
              <input
                className="inp" type="number" step={chargeType === "Flat" ? 1 : 0.1} min={0} max={chargeType === "Percent" ? 100 : undefined}
                placeholder={chargeType === "Flat" ? "e.g. 500" : "e.g. 2"}
                value={chargeValue} onChange={(e) => setChargeValue(e.target.value)}
              /></div>
          )}
        </div>
        {chargeType !== "None" && (
          <div className="frow scheme-frow"><div><label className="f">How the charge is collected *</label>
            <Select options={CHARGE_MODE_OPTIONS} value={chargeMode} onChange={(v) => setChargeMode(v as ServiceChargeMode)} /></div></div>
        )}
        <div className="frow c2 scheme-frow">
          <div><label className="f">Status</label>
            <Select options={STATUS_OPTIONS} value={active ? "1" : "0"} onChange={(v) => setActive(v === "1")} /></div>
          <div><label className="f">Branch *</label>
            {isAdmin ? (
              <Select
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
            )}</div>
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
