"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";
import { createGoldSale } from "@/modules/cash/services/cashService";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";

/* "Gold Sale" — the business selling gold it owns (bought stock, not a
 * customer's pledged loan collateral, which goes through the Auction
 * module instead). Books a matching cash-in movement automatically (see
 * cashService.createGoldSale) so it shows up in Cash Movements/Expected
 * Cash without a separate step here. Cost is staff-entered — there's no
 * separate purchase-inventory record to look it up from yet — and profit
 * is computed server-side as sold − cost. */
export function GoldSaleModalContent({ onSaved }: { onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [ornamentType, setOrnamentType] = useState("");
  const [soldAmount, setSoldAmount] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [date, setDate] = useState(today);
  const [remarks, setRemarks] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, []);

  const sold = +soldAmount || 0;
  const cost = +costAmount || 0;
  const profit = sold > 0 ? sold - cost : 0;

  async function save() {
    const type = ornamentType.trim();
    if (!type) { setErr("Please enter the ornament type."); return; }
    if (!(sold > 0)) { setErr("Please enter a valid sold amount."); return; }
    if (cost < 0) { setErr("Cost amount cannot be negative."); return; }
    if (!date) { setErr("Please select the date."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }

    setSaving(true);
    try {
      await createGoldSale({
        ornamentType: type, soldAmount: sold, costAmount: cost, branchId,
        soldOn: date, remarks: remarks.trim() || undefined,
      });
      onSaved?.();
      closeModal();
      toast(`Gold sale of ${fmt(sold)} recorded${profit >= 0 ? ` — profit ${fmt(profit)}` : ` — loss ${fmt(Math.abs(profit))}`}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Record Gold Sale</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow"><div><label className="f">Ornament Type *</label>
          <input className="inp" placeholder="e.g. Chain, Bangle, Studs" value={ornamentType} onChange={(e) => setOrnamentType(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">Sold For (₹) *</label><input className="inp" type="number" min={1} value={soldAmount} onChange={(e) => setSoldAmount(e.target.value)} /></div>
          <div><label className="f">Cost to Acquire (₹) *</label><input className="inp" type="number" min={0} value={costAmount} onChange={(e) => setCostAmount(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /></div>
          <div><label className="f">Branch *</label>
            <Select
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              value={branchId ? String(branchId) : ""}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
              placeholder="Select branch…"
            /></div>
        </div>
        {soldAmount && (
          <div className="notice" style={{ marginBottom: 4 }}>
            {profit >= 0 ? "Profit" : "Loss"}: <strong style={{ color: profit >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(Math.abs(profit))}</strong>
          </div>
        )}
        <div className="frow"><div><label className="f">Remarks</label>
          <textarea className="inp" rows={2} placeholder="Optional notes" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Record Sale"}</button>
      </div>
    </>
  );
}
