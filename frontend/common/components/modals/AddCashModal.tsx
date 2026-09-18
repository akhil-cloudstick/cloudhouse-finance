"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { createCashMovement } from "@/modules/cash/services/cashService";
import { searchBanksPage, createBank, type BackendBank } from "@/modules/banks/services/bankService";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";

const SOURCE_OPTIONS = [{ value: "Savings", label: "Savings" }, { value: "Loan", label: "Loan" }];
const MODE_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "Bank Transfer", label: "Bank Transfer" },
];

/* Ported from legacy/app.js's `openAddCashModal()` / `acSourceChanged()` /
 * `saveAddCash()` — now posts to the real POST /cash-movements endpoint.
 * The bank picker used to come from db.banks (a hardcoded list); banks are
 * now a real backend resource (see internal/bank), so this uses the same
 * SearchableSelect + allowCreate pattern as RepledgeModal.tsx.
 *
 * Mode of Cash (Cash/UPI/Bank Transfer) records how the money physically
 * arrived — the Bank picker doubles for both cases that imply one: a
 * Loan-sourced top-up (which bank the loan itself came from) and a non-cash
 * Mode (which bank the UPI/transfer moved through) — see `bankRequired`
 * below and backend/internal/cash/service.go's Record. */
export function AddCashModalContent({ onSaved }: { onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [source, setSource] = useState("");
  const [mode, setMode] = useState("");
  const [bank, setBank] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Bank is required either way it can come up: a Loan-sourced top-up
  // (which bank the loan itself was from) or a non-cash Mode (which bank
  // the UPI/transfer actually moved through) — see backend/internal/cash/
  // service.go's Record.
  const bankRequired = source === "Loan" || mode === "UPI" || mode === "Bank Transfer";

  async function save() {
    if (!source) { setErr("Please select where the cash is coming from."); return; }
    if (!mode) { setErr("Please select the mode of cash."); return; }
    if (bankRequired && !bank) {
      setErr(source === "Loan" ? "Please select the bank the loan was taken from." : "Please select the bank.");
      return;
    }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid cash amount."); return; }
    if (!date) { setErr(source === "Loan" ? "Please select the date of the loan." : "Please select the date."); return; }

    setSaving(true);
    try {
      await createCashMovement({ type: "in", source, mode, bank: bankRequired ? bank : undefined, amount, occurredOn: date });
      onSaved?.();
      closeModal();
      toast(`${fmt(amount)} added to cash (${source} · ${mode})`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add Cash</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div><label className="f">Source of Cash *</label>
            <Select
              options={SOURCE_OPTIONS}
              value={source}
              onChange={(v) => { setSource(v); if (v !== "Loan" && mode !== "UPI" && mode !== "Bank Transfer") setBank(""); }}
              placeholder="Select source…"
            /></div>
          <div><label className="f">Mode of Cash *</label>
            <Select
              options={MODE_OPTIONS}
              value={mode}
              onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer" && source !== "Loan") setBank(""); }}
              placeholder="Select mode…"
            /></div>
        </div>
        {bankRequired && (
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
