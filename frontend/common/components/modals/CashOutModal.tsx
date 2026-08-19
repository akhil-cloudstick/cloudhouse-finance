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

/* Ported from legacy/app.js's `openCashOutModal()` / `saveCashOut()` — now
 * posts to the real POST /cash-movements endpoint. */
export function CashOutModalContent({ onSaved }: { onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [purpose, setPurpose] = useState("");
  const [bank, setBank] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!purpose.trim()) { setErr("Please enter the purpose of this cash withdrawal."); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid cash amount."); return; }
    if (!date) { setErr("Please select the date."); return; }

    setSaving(true);
    try {
      await createCashMovement({ type: "out", purpose: purpose.trim(), bank: bank || undefined, amount, occurredOn: date });
      onSaved?.();
      closeModal();
      toast(`${fmt(amount)} taken out of cash`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Take Cash Out</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Purpose *</label>
          <input className="inp" placeholder="e.g. Bank deposit" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div></div>
        <div className="frow"><div><label className="f">Bank</label>
          <SearchableSelect<BackendBank>
            value={bank}
            onChange={(_id, item) => setBank(item.name)}
            fetchFn={searchBanksPage}
            getLabel={(b) => b.name}
            getId={(b) => String(b.id)}
            placeholder="— None / not applicable —"
            allowCreate
            onCreate={createBank}
          /></div></div>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Take Cash Out"}</button>
      </div>
    </>
  );
}
