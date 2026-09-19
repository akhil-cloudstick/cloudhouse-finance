"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Select } from "@/common/components/ui/Select";
import {
  createInvestmentPlan,
  updateInvestmentPlan,
  listInvestmentPlans,
  type BackendInvestmentPlan,
  type CreatePlanInput,
  type InterestRateType,
  type PayoutFrequency,
  type Engine,
  type ProductType,
} from "@/modules/investments/services/investmentService";

const emptyForm: CreatePlanInput = {
  name: "",
  interestRateType: "Simple",
  interestRatePercent: 0,
  payoutFrequency: "Monthly",
  tenureMonths: 12,
  minPrincipal: 0,
  isActive: true,
  engine: "Schedule",
  productType: "Deposit",
};

/* Fixed Payout (backend Engine "Schedule") now also offers Quarterly
 * alongside Monthly/Yearly — generatePayoutSchedule steps in whole calendar
 * months, so Quarterly is just a 3-month step; Daily/Weekly aren't offered
 * here since the schedule engine has no day-based stepping. Single Payout
 * (backend Engine "Live") has no frequency picker at all: interest accrues
 * continuously and is paid out once at maturity. */
const FIXED_PAYOUT_FREQUENCIES: PayoutFrequency[] = ["Monthly", "Quarterly", "Yearly"];

/* Admin-only "Manage Plans" modal, launched from Investments.tsx — lists
 * every plan (active and retired: a retired plan must stay visible here
 * since existing investments still reference it, see backend/internal/
 * investment/model_plan.go's IsActive doc comment) and a create/edit form
 * for one plan at a time, inline in the same modal rather than a second
 * nested modal. */
export function InvestmentPlansModalContent({ onChanged }: { onChanged: () => void }) {
  const { closeModal } = useModal();

  const PAGE_SIZE = 5;

  const [plans, setPlans] = useState<BackendInvestmentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreatePlanInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      setPlans(await listInvestmentPlans(false));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load plans.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const totalPages = Math.max(1, Math.ceil(plans.length / PAGE_SIZE));
  const pagePlans = plans.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // A save/delete can shrink the list out from under the current page (e.g.
  // page 3 no longer exists once a plan is removed) — clamp back rather
  // than showing an empty page with working Prev/Next stuck past the end.
  useEffect(() => { setPage((p) => Math.min(p, totalPages)); }, [totalPages]);

  function startCreate() {
    setEditingId(0);
    setForm(emptyForm);
    setFormErr("");
  }

  function startEdit(p: BackendInvestmentPlan) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      interestRateType: p.interestRateType,
      interestRatePercent: p.interestRatePercent,
      payoutFrequency: p.payoutFrequency,
      tenureMonths: p.tenureMonths,
      minPrincipal: p.minPrincipal,
      isActive: p.isActive,
      engine: p.engine,
      productType: p.productType,
    });
    setFormErr("");
  }

  async function save() {
    if (!form.name.trim()) { setFormErr("Please enter a plan name."); return; }
    if (form.interestRatePercent < 0) { setFormErr("Interest rate must not be negative."); return; }
    if (form.tenureMonths <= 0) { setFormErr("Tenure must be greater than zero."); return; }
    // The tenure/frequency divisibility rule only applies to Fixed Payout
    // plans (whose payout schedule steps in whole calendar-month periods) —
    // Single Payout plans accrue continuously and pay out once at maturity,
    // with nothing to divide evenly.
    if (form.engine === "Schedule") {
      const stepMonths = form.payoutFrequency === "Yearly" ? 12 : form.payoutFrequency === "Quarterly" ? 3 : 1;
      if (form.tenureMonths % stepMonths !== 0) { setFormErr(`Tenure months must divide evenly by ${stepMonths} for ${form.payoutFrequency} payouts.`); return; }
    }

    setSaving(true);
    setFormErr("");
    try {
      if (editingId) {
        await updateInvestmentPlan(editingId, form);
      } else {
        await createInvestmentPlan(form);
      }
      setEditingId(null);
      await refresh();
      onChanged();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : "Could not save the plan — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Investment Plans</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        {editingId === null ? (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button className="btn sm" onClick={startCreate}>+ New Plan</button>
            </div>
            {error && <div className="notice">{error}</div>}
            <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
              <thead><tr><th>Name</th><th>Type</th><th className="num">Rate</th><th>Frequency</th><th className="num">Tenure</th><th className="num">Min Principal</th><th>Payout</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="empty compact">Loading…</td></tr>
                ) : plans.length === 0 ? (
                  <tr><td colSpan={9} className="empty compact">No plans yet.</td></tr>
                ) : pagePlans.map((p) => (
                  <tr key={p.id} className="click" onClick={() => startEdit(p)}>
                    <td>{p.name}<div className="sub">{p.interestRateType}</div></td>
                    <td>{p.productType === "Bond" ? <span className="chip info">Bond</span> : "Deposit"}</td>
                    <td className="num">{p.interestRatePercent}%</td>
                    <td>{p.payoutFrequency}</td>
                    <td className="num">{p.tenureMonths}mo</td>
                    <td className="num">{fmt(p.minPrincipal)}</td>
                    <td>{p.engine === "Live" ? "Single Payout" : "Fixed Payout"}</td>
                    <td><StatusChip status={p.isActive ? "Active" : "Closed"} /></td>
                    <td><button className="btn plain sm" onClick={(e) => { e.stopPropagation(); startEdit(p); }}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {!loading && plans.length > PAGE_SIZE && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12 }}>
                <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
                <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
                <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="frow c2">
              <div><label className="f">Plan Name *</label><input className="inp" placeholder="e.g. Gold Saver 12mo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="f">Product Type *</label>
                <Select
                  value={form.productType}
                  onChange={(v) => setForm({ ...form, productType: v as ProductType })}
                  options={[
                    { value: "Deposit", label: "Deposit" },
                    { value: "Bond", label: "Bond — generates a Debenture Subscription Agreement" },
                  ]}
                />
              </div>
            </div>
            <div className="frow c2">
              <div><label className="f">Interest Rate Type *</label>
                <Select
                  value={form.interestRateType}
                  onChange={(v) => setForm({ ...form, interestRateType: v as InterestRateType })}
                  options={(["Simple", "Compound"] as InterestRateType[]).map((t) => ({ value: t, label: t }))}
                />
              </div>
              <div />
            </div>
            <div className="frow c2">
              <div><label className="f">Interest Rate (% p.a.) *</label><input className="inp" type="number" min={0} step={0.01} placeholder="e.g. 8" value={form.interestRatePercent || ""} onChange={(e) => setForm({ ...form, interestRatePercent: +e.target.value || 0 })} /></div>
              <div><label className="f">Payout *</label>
                <Select
                  value={form.engine}
                  onChange={(v) => setForm({
                    ...form,
                    engine: v as Engine,
                    // Reset frequency to Monthly (the shared default)
                    // whenever the allowed set changes, so a stray
                    // Quarterly value can't survive a switch back to
                    // Fixed Payout.
                    payoutFrequency: "Monthly",
                  })}
                  options={(["Schedule", "Live"] as Engine[]).map((e) => ({
                    value: e,
                    label: e === "Live" ? "Single Payout (accumulates, paid at maturity)" : "Fixed Payout",
                  }))}
                />
              </div>
            </div>
            {form.engine === "Schedule" && (
              <div className="frow c2">
                <div><label className="f">Payout Frequency *</label>
                  <Select
                    value={form.payoutFrequency}
                    onChange={(v) => setForm({ ...form, payoutFrequency: v as PayoutFrequency })}
                    options={FIXED_PAYOUT_FREQUENCIES.map((f) => ({ value: f, label: f }))}
                  />
                </div>
                <div />
              </div>
            )}
            <div className="frow c2">
              <div><label className="f">Tenure (months) *</label><input className="inp" type="number" min={1} placeholder="e.g. 12" value={form.tenureMonths || ""} onChange={(e) => setForm({ ...form, tenureMonths: +e.target.value || 0 })} /></div>
              <div><label className="f">Minimum Principal (₹)</label><input className="inp" type="number" min={0} placeholder="e.g. 10000" value={form.minPrincipal || ""} onChange={(e) => setForm({ ...form, minPrincipal: +e.target.value || 0 })} /></div>
            </div>
            <div className="frow"><div>
              <label className="cradio" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <span className="mark" /><span>Active — offered for new investments</span>
              </label>
            </div></div>
            {formErr && <div className="notice" style={{ marginTop: 10 }}>{formErr}</div>}
          </>
        )}
      </div>
      <div className="ft">
        {editingId === null ? (
          <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Close</button>
        ) : (
          <>
            <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={() => setEditingId(null)}>Back</button>
            <button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : editingId ? "Save Changes" : "Create Plan"}</button>
          </>
        )}
      </div>
    </>
  );
}
