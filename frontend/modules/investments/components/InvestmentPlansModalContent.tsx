"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Select } from "@/common/components/ui/Select";
import { createInvestmentPlan, updateInvestmentPlan, listInvestmentPlans } from "@/modules/investments/services/investmentService";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";
import { type BackendInvestmentPlan, type CreatePlanInput, type InterestRateType, type PayoutFrequency, type Engine } from "@/modules/investments/types/investment-types";

// Every plan is a Bond product now — ProductType has no live "Deposit"
// alternative left in the UI, so the create/edit form no longer offers a
// choice; every plan is created/saved as "Bond" (see form submission below).
const emptyForm: CreatePlanInput = {
  name: "",
  interestRateType: "Simple",
  interestRatePercent: 0,
  payoutFrequency: "Monthly",
  tenureMonths: 12,
  minPrincipal: 0,
  isActive: true,
  engine: "Schedule",
  productType: "Bond",
};

/* Fixed Payout (backend Engine "Schedule") now also offers Quarterly
 * alongside Monthly/Yearly — generatePayoutSchedule steps in whole calendar
 * months, so Quarterly is just a 3-month step; Daily/Weekly aren't offered
 * here since the schedule engine has no day-based stepping. Single Payout
 * (backend Engine "Live") has no frequency picker at all: interest accrues
 * continuously and is paid out once at maturity. */
const FIXED_PAYOUT_FREQUENCIES: PayoutFrequency[] = ["Monthly", "Quarterly", "Yearly"];

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  name: /name/i, rate: /interest rate|rate/i, frequency: /frequency|payout/i, tenure: /tenure/i, minPrincipal: /minimum|principal/i,
};

type InvestmentPlansModalContentProps = { onChanged: () => void };

/* Admin-only "Manage Plans" modal, launched from Investments.tsx — lists
 * every plan (active and retired: a retired plan must stay visible here
 * since existing investments still reference it, see backend/internal/
 * investment/model_plan.go's IsActive doc comment) and a create/edit form
 * for one plan at a time, inline in the same modal rather than a second
 * nested modal. */
export function InvestmentPlansModalContent({ onChanged }: InvestmentPlansModalContentProps) {
  const { closeModal } = useModal();

  // Scroll-paginated: 10 plans shown at a time, the next 10 revealed as the
  // height-capped table is scrolled to its end. The plan list is one small
  // unpaged fetch, so "pages" are revealed client-side.
  const PAGE_SIZE = 10;

  const [plans, setPlans] = useState<BackendInvestmentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreatePlanInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  // Validation messages, each shown under the field it is about; `formErr` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setFormErr(""); setFe({ [field]: msg }); };

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

  const shownPlans = plans.slice(0, page * PAGE_SIZE);
  const hasMore = shownPlans.length < plans.length;

  function onWrapScroll() {
    const el = wrapRef.current;
    if (hasMore && el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) setPage((p) => p + 1);
  }

  // A batch too short to overflow the table never fires onScroll, so keep
  // revealing until the rows actually scroll or the list runs out.
  useEffect(() => {
    const el = wrapRef.current;
    if (hasMore && el && el.scrollHeight <= el.clientHeight) setPage((p) => p + 1);
  }, [shownPlans.length, hasMore, editingId]);

  function startCreate() {
    setEditingId(0);
    setForm(emptyForm);
    setFormErr("");
    setFe({});
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
      productType: "Bond",
    });
    setFormErr("");
    setFe({});
  }

  async function save() {
    if (!form.name.trim()) { fail("name", "Please enter a plan name."); return; }
    if (form.interestRatePercent < 0) { fail("rate", "Interest rate must not be negative."); return; }
    if (form.tenureMonths <= 0) { fail("tenure", "Tenure must be greater than zero."); return; }
    // The tenure/frequency divisibility rule only applies to Fixed Payout
    // plans (whose payout schedule steps in whole calendar-month periods) —
    // Single Payout plans accrue continuously and pay out once at maturity,
    // with nothing to divide evenly.
    if (form.engine === "Schedule") {
      const stepMonths = form.payoutFrequency === "Yearly" ? 12 : form.payoutFrequency === "Quarterly" ? 3 : 1;
      if (form.tenureMonths % stepMonths !== 0) { fail("tenure", `Tenure months must divide evenly by ${stepMonths} for ${form.payoutFrequency} payouts.`); return; }
    }

    setSaving(true);
    setFormErr("");
    setFe({});
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
      const msg = e instanceof ApiError ? e.message : "Could not save the plan — try again.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setFormErr(msg);
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
            <div className="tbl-wrap tbl-wrap-auto tbl-scroll-paged" ref={wrapRef} onScroll={onWrapScroll}><table className="tbl tbl-center plans-tbl">
              <thead><tr><th>Name</th><th>Type</th><th className="num">Rate</th><th>Frequency</th><th className="num">Tenure</th><th className="num">Min Principal</th><th>Payout</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="empty compact">Loading…</td></tr>
                ) : plans.length === 0 ? (
                  <tr><td colSpan={9} className="empty compact">No plans yet.</td></tr>
                ) : shownPlans.map((p) => (
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
            {!loading && plans.length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
                Showing {shownPlans.length} of {plans.length}{hasMore ? " — scroll for more" : ""}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="frow c2">
              <div className={fe.name ? "has-err" : undefined}><label className="f">Plan Name *</label><input className="inp" placeholder="e.g. Gold Saver 12mo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><FieldError msg={fe.name} /></div>
              <div><label className="f">Interest Rate Type *</label>
                <Select
                  value={form.interestRateType}
                  onChange={(v) => setForm({ ...form, interestRateType: v as InterestRateType })}
                  options={(["Simple", "Compound"] as InterestRateType[]).map((t) => ({ value: t, label: t }))}
                />
              </div>
            </div>
            <div className="frow c2">
              <div className={fe.rate ? "has-err" : undefined}><label className="f">Interest Rate (% p.a.) *</label><input className="inp" type="number" min={0} step={0.01} placeholder="e.g. 8" value={form.interestRatePercent || ""} onChange={(e) => setForm({ ...form, interestRatePercent: +e.target.value || 0 })} /><FieldError msg={fe.rate} /></div>
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
                <div className={fe.frequency ? "has-err" : undefined}><label className="f">Payout Frequency *</label>
                  <Select
                    value={form.payoutFrequency}
                    onChange={(v) => setForm({ ...form, payoutFrequency: v as PayoutFrequency })}
                    options={FIXED_PAYOUT_FREQUENCIES.map((f) => ({ value: f, label: f }))}
                  /><FieldError msg={fe.frequency} />
                </div>
                <div />
              </div>
            )}
            <div className="frow c2">
              <div className={fe.tenure ? "has-err" : undefined}><label className="f">Tenure (months) *</label><input className="inp" type="number" min={1} placeholder="e.g. 12" value={form.tenureMonths || ""} onChange={(e) => setForm({ ...form, tenureMonths: +e.target.value || 0 })} /><FieldError msg={fe.tenure} /></div>
              <div className={fe.minPrincipal ? "has-err" : undefined}><label className="f">Minimum Principal (₹)</label><input className="inp" type="number" min={0} placeholder="e.g. 10000" value={form.minPrincipal || ""} onChange={(e) => setForm({ ...form, minPrincipal: +e.target.value || 0 })} /><FieldError msg={fe.minPrincipal} /></div>
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
      {/* List view closes from the header × alone — no footer Close. */}
      {editingId !== null && (
        <div className="ft">
          <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={() => setEditingId(null)}>Back</button>
          <button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : editingId ? "Save Changes" : "Create Plan"}</button>
        </div>
      )}
    </>
  );
}
