"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { PurityPicker } from "@/common/components/ui/PurityPicker";
import { fmt } from "@/common/utils/format";
import { rateForPurityFull } from "@/common/utils/purity";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { searchActiveSchemesPage, type SchemeView } from "@/modules/schemes/services/schemeService";
import {
  updateLoan, addOrnament, updateOrnament, deleteOrnament,
  type LoanView, type OrnamentView,
} from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";

type OrnRow = { id?: number; name: string; purity: string; gross: string; net: string; qty: string; removed?: boolean };

function toRow(o: OrnamentView): OrnRow {
  return { id: o.id, name: o.name, purity: o.purity, gross: String(o.grossWeight), net: String(o.netWeight), qty: String(o.quantity) };
}

/* Lets staff correct a loan's scheme, principal amount, or ornaments even
 * after final sanction — see backend Service.UpdateLoan/DeleteOrnament's
 * own doc comments for exactly what does and doesn't change (prospective
 * only: a scheme swap applies to interest/eligibility from here forward,
 * never rewriting already-recorded AccruedInterest). No confirmation
 * dialog or audit log here, by explicit product decision — a plain edit
 * form gated by the ordinary "can update loan" permission, same as any
 * other loan action. */
export function EditLoanModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { latest: goldRate } = useGoldRates();

  const [schemeId, setSchemeId] = useState(loan.schemeId); // string, matches SchemeView.id
  const [schemeLabel, setSchemeLabel] = useState(`${loan.schemeName}`);
  const [schemeLtv, setSchemeLtv] = useState(loan.schemeLtv);
  const [principal, setPrincipal] = useState(String(loan.principal));
  const [rows, setRows] = useState<OrnRow[]>(loan.ornaments.map(toRow));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function updRow(i: number, patch: Partial<OrnRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { name: "", purity: "22K", gross: "", net: "", qty: "1" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, removed: true } : r)));
  }

  const activeRows = rows.filter((r) => !r.removed);

  // Live preview — deliberately NOT the same plain K24-only derivation
  // NewLoan.tsx's own valuation panel uses. This modal edits an EXISTING
  // loan, so a 22K/18K ornament here can very plausibly have been valued
  // (and re-valued on every future accrual) against an independently
  // Manual-published K22/K18 that diverges from the K24 ratio — using the
  // plain derivation here silently disagreed with what the backend
  // actually enforces, showing an eligible amount high enough to accept a
  // principal the save then rejected. rateForPurityFull reads the same
  // stored K22/K18 the backend's own rateForPurity does. NewLoan.tsx
  // itself is untouched — this fix is scoped to this modal only.
  const totalGoldValue = activeRows.reduce(
    (s, r) => s + (+r.net || 0) * (+r.qty || 1) * (rateForPurityFull(goldRate, r.purity) ?? 0),
    0
  );
  const eligibleLoanAmount = (totalGoldValue * schemeLtv) / 100;

  async function save() {
    if (!(+principal > 0)) { setErr("Please enter a valid principal amount."); return; }
    if (!activeRows.length) { setErr("A loan must have at least one ornament."); return; }
    if (activeRows.some((r) => !r.name.trim() || !(+r.gross > 0) || !(+r.net > 0))) {
      setErr("Every ornament needs a name, gross weight and net weight.");
      return;
    }
    if (activeRows.some((r) => +r.net > +r.gross)) { setErr("Net Wt cannot be greater than Gross Wt for any ornament."); return; }
    // Checked against the SAME live estimate shown in the Eligible Loan
    // Amount field above, not a stale pre-edit figure — the backend
    // recomputes and enforces this independently on save too, but this
    // gives immediate feedback consistent with what's already on screen.
    if (+principal > eligibleLoanAmount) {
      setErr(`Principal amount cannot exceed the eligible loan amount (${fmt(eligibleLoanAmount)}).`);
      return;
    }

    setSaving(true);
    setErr("");
    try {
      // Ornaments MUST be saved before updateLoan() below — each ornament
      // call revalues that row against the live gold rate and recalculates
      // the loan's EligibleLoanAmount for real (see backend's
      // valueOrnament/recalculateTotals), while updateLoan()'s own
      // eligibility check just sums whatever GoldValue is ALREADY stored
      // per ornament. Calling updateLoan() first (the original order here)
      // meant a principal raised to match a net-weight increase in this
      // same save got validated against the OLD, not-yet-applied
      // ornament values and rejected even though the live preview above
      // already accounted for the new ones.
      for (const r of rows) {
        const input = {
          name: r.name.trim(), purity: r.purity, grossWeight: +r.gross,
          deductionWeight: Math.max(0, +r.gross - +r.net), quantity: +r.qty || 1,
        };
        if (r.removed) {
          if (r.id) await deleteOrnament(r.id);
        } else if (r.id) {
          await updateOrnament(r.id, input);
        } else {
          await addOrnament(loan.numericId, input);
        }
      }
      await updateLoan(loan.numericId, {
        schemeId: schemeId !== loan.schemeId ? Number(schemeId) : undefined,
        principalAmount: +principal !== loan.principal ? +principal : undefined,
      });
      onSaved();
      closeModal();
      toast("Loan updated");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save changes — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Edit Loan — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Scheme</label>
            <SearchableSelect<SchemeView>
              value={schemeLabel}
              onChange={(id, item) => { setSchemeId(id); setSchemeLabel(`${item.name} — ${item.ltv}% LTV @ ${item.rate}%`); setSchemeLtv(item.ltv); }}
              fetchFn={searchActiveSchemesPage}
              getLabel={(s) => `${s.name} — ${s.ltv}% LTV @ ${s.rate}%`}
              getId={(s) => s.id}
              placeholder="Search active schemes…"
            /></div>
          <div><label className="f">Principal Amount (₹)</label>
            <input className="inp" type="number" min={1} value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div>
            <label className="f">Eligible Loan Amount</label>
            <input className="inp" value={fmt(eligibleLoanAmount)} disabled />
          </div>
          <div>
            <label className="f">LTV</label>
            <input className="inp" value={`${schemeLtv}%`} disabled />
          </div>
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: -8, marginBottom: 10 }}>
          Recomputes live as ornaments or scheme change below. The backend recalculates the authoritative
          figure on save.
        </p>

        <label className="f" style={{ marginTop: 10, display: "block" }}>Ornaments</label>
        {/* Ornament list scrolls on its own (a loan can carry many
            ornaments, and the fixed fields above — scheme/principal/
            eligible amount — shouldn't have to scroll away with them) —
            scoped locally via inline style rather than a new global class,
            same approach as the Gross/Net/Qty row fix above. "Add
            Ornament" is the last child inside this same scrolling box with
            position:sticky so it stays reachable at the bottom of the
            visible list without needing to scroll all the way down first. */}
        <div className="edit-loan-orn-scroll" style={{ maxHeight: 340, overflowY: "auto", paddingRight: 2 }}>
          {rows.map((r, i) => r.removed ? null : (
            <div key={i} className="eln-card" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
              {/* Bare "frow" (no .c2/.c3 modifier) is a single-column grid —
                  these rows need the modifier or every field stacks onto its
                  own line instead of sitting side by side. */}
              <div className="frow c2">
                <div><label className="f">Name</label>
                  {/* PurityPicker beside it is pinned to a fixed 31px row
                      (`.pur-row`, shared with NewLoan.tsx/Dashboard.tsx) —
                      matched here rather than the other way around, since
                      that height is a reused convention across the app. */}
                  <input className="inp" style={{ height: 31, padding: "6px 8px" }} value={r.name} onChange={(e) => updRow(i, { name: e.target.value })} /></div>
                <div><label className="f">Purity</label>
                  <PurityPicker value={r.purity} onChange={(v) => updRow(i, { purity: v })} /></div>
              </div>
              {/* Plain `.frow.c3` — this modal now opens `wide` (820px,
                  see LoanDetail.tsx's openModal calls) instead of the
                  default 520px, so the standard 3-up row (used by every
                  other dense form in the app) has enough room without a
                  local override, and gets the same small-screen collapse
                  every other `.frow.c3` row already gets for free. */}
              <div className="frow c3">
                <div><label className="f">Gross (g)</label>
                  <input className="inp" type="number" min={0} value={r.gross} onChange={(e) => updRow(i, { gross: e.target.value })} /></div>
                <div><label className="f">Net (g)</label>
                  <input className="inp" type="number" min={0} value={r.net} onChange={(e) => updRow(i, { net: e.target.value })} /></div>
                <div><label className="f">Qty</label>
                  <input className="inp" type="number" min={1} value={r.qty} onChange={(e) => updRow(i, { qty: e.target.value })} /></div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn danger sm" onClick={() => removeRow(i)} title="Remove ornament">✕ Remove</button>
              </div>
            </div>
          ))}
          <div style={{ position: "sticky", bottom: 0, background: "var(--card)", padding: "6px 0" }}>
            <button className="btn plain sm" onClick={addRow}><Icon name="plus" /> Add Ornament</button>
          </div>
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
          Total net weight: {fmt(activeRows.reduce((s, r) => s + (+r.net || 0) * (+r.qty || 1), 0)).replace("₹", "")}g
          — the eligible loan amount recalculates automatically from these ornaments on save; the principal
          above is rejected if it ends up higher than the new eligible amount.
        </p>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      {/* Sticky within .modal-bg (the actual scrolling ancestor — see
          app.css's `.modal-bg{overflow-y:auto}`), scoped locally via inline
          style rather than a global `.modal .ft` change: Cancel/Save Changes
          stay reachable without scrolling all the way down through the
          scheme/principal/ornaments fields above. */}
      <div className="ft" style={{ position: "sticky", bottom: 0, background: "var(--card)", zIndex: 1 }}>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Save Changes"}</button>
      </div>
    </>
  );
}
