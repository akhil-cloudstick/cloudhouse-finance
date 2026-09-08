"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import {
  createInvestmentPlan,
  updateInvestmentPlan,
  listInvestmentPlans,
  type BackendInvestmentPlan,
  type CreatePlanInput,
  type InterestRateType,
  type PayoutFrequency,
} from "@/modules/investments/services/investmentService";

const emptyForm: CreatePlanInput = {
  name: "",
  interestRateType: "Simple",
  interestRatePercent: 0,
  payoutFrequency: "Monthly",
  tenureMonths: 12,
  minPrincipal: 0,
  isActive: true,
};

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
    });
    setFormErr("");
  }

  async function save() {
    if (!form.name.trim()) { setFormErr("Please enter a plan name."); return; }
    if (form.interestRatePercent < 0) { setFormErr("Interest rate must not be negative."); return; }
    if (form.tenureMonths <= 0) { setFormErr("Tenure must be greater than zero."); return; }
    const stepMonths = form.payoutFrequency === "Yearly" ? 12 : 1;
    if (form.tenureMonths % stepMonths !== 0) { setFormErr(`Tenure months must divide evenly by ${stepMonths} for ${form.payoutFrequency} payouts.`); return; }

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
              <thead><tr><th>Name</th><th className="num">Rate</th><th>Frequency</th><th className="num">Tenure</th><th className="num">Min Principal</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
                ) : plans.length === 0 ? (
                  <tr><td colSpan={7} className="empty compact">No plans yet.</td></tr>
                ) : pagePlans.map((p) => (
                  <tr key={p.id} className="click" onClick={() => startEdit(p)}>
                    <td>{p.name}<div className="sub">{p.interestRateType}</div></td>
                    <td className="num">{p.interestRatePercent}%</td>
                    <td>{p.payoutFrequency}</td>
                    <td className="num">{p.tenureMonths}mo</td>
                    <td className="num">{fmt(p.minPrincipal)}</td>
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
              <div><label className="f">Interest Rate Type *</label>
                <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                  {(["Simple", "Compound"] as InterestRateType[]).map((t) => (
                    <label key={t} className="cradio" style={{ fontSize: 13 }}>
                      <input type="radio" name="rateType" checked={form.interestRateType === t} onChange={() => setForm({ ...form, interestRateType: t })} />
                      <span className="mark" /><span>{t}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="frow c2">
              <div><label className="f">Interest Rate (% p.a.) *</label><input className="inp" type="number" min={0} step={0.01} placeholder="e.g. 8" value={form.interestRatePercent || ""} onChange={(e) => setForm({ ...form, interestRatePercent: +e.target.value || 0 })} /></div>
              <div><label className="f">Payout Frequency *</label>
                <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                  {(["Monthly", "Yearly"] as PayoutFrequency[]).map((f) => (
                    <label key={f} className="cradio" style={{ fontSize: 13 }}>
                      <input type="radio" name="payoutFreq" checked={form.payoutFrequency === f} onChange={() => setForm({ ...form, payoutFrequency: f })} />
                      <span className="mark" /><span>{f}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
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
