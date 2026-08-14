"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { createCashMovement } from "@/lib/cashApi";
import { searchBanksPage, createBank, type BackendBank } from "@/lib/bankApi";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";

const SOURCE_OPTIONS = [{ value: "Savings", label: "Savings" }, { value: "Loan", label: "Loan" }];

/* Ported from legacy/app.js's `openAddCashModal()` / `acSourceChanged()` /
 * `saveAddCash()` — now posts to the real POST /cash-movements endpoint.
 * The bank picker used to come from db.banks (a hardcoded list); banks are
 * now a real backend resource (see internal/bank), so this uses the same
 * SearchableSelect + allowCreate pattern as RepledgeModal.tsx. */
export function AddCashModalContent({ onSaved }: { onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [source, setSource] = useState("");
  const [bank, setBank] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!source) { setErr("Please select where the cash is coming from."); return; }
    if (source === "Loan" && !bank) { setErr("Please select the bank the loan was taken from."); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid cash amount."); return; }
    if (!date) { setErr(source === "Loan" ? "Please select the date of the loan." : "Please select the date."); return; }

    setSaving(true);
    try {
      await createCashMovement({ type: "in", source, bank: source === "Loan" ? bank : undefined, amount, occurredOn: date });
      onSaved?.();
      closeModal();
      toast(`${fmt(amount)} added to cash (${source})`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add Cash</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Source of Cash *</label>
          <Select
            options={SOURCE_OPTIONS}
            value={source}
            onChange={(v) => { setSource(v); if (v !== "Loan") setBank(""); }}
            placeholder="Select source…"
          /></div></div>
        {source === "Loan" && (
          <div className="frow"><div><label className="f">Bank *</label>
            <SearchableSelect<BackendBank>
              value={bank}
              onChange={(_id, item) => setBank(item.name)}
              fetchFn={searchBanksPage}
              getLabel={(b) => b.name}
              getId={(b) => String(b.id)}
              placeholder="Search or add a bank…"
              allowCreate
              onCreate={createBank}
            /></div></div>
        )}
        <div className="frow c2">
          <div><label className="f">Cash Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">{source === "Loan" ? "Date of Loan *" : "Date *"}</label><DatePicker value={date} onChange={setDate} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Add Cash"}</button>
      </div>
    </>
  );
}
