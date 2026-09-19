"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { getCashSummary, setOpeningBalance } from "@/product/pages/cash/services/cashService";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";

/* Was an inline card sitting above the Cash & Expenses KPIs — pulled out
 * into its own modal (triggered by an "Opening Balance" button) so the
 * page's own branch filter (Cash.tsx's branchId/branchLabel, which can be
 * "All branches") stays entirely separate from THIS picker: setting an
 * opening balance always needs one real branch, never "all" of them, so
 * this modal owns its own branch state rather than sharing the page's.
 *
 * initialBranchId/initialBranchLabel seed the picker from whatever branch
 * the page currently has selected (skipped if that's "All branches", id 0)
 * — a convenience, not a requirement; staff can still switch branches here
 * before setting the figure. */
export function OpeningCashModalContent({
  initialBranchId,
  initialBranchLabel,
  date,
  onSaved,
}: {
  initialBranchId?: number;
  initialBranchLabel?: string;
  date: string;
  onSaved: () => void;
}) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">(initialBranchId || "");
  const [branchLabel, setBranchLabel] = useState(initialBranchLabel || "");
  const [amount, setAmount] = useState("");
  const [alreadySet, setAlreadySet] = useState(false);
  const [currentValue, setCurrentValue] = useState(0);
  const [editing, setEditing] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (!branchId && list.length) {
        setBranchId(list[0].id);
        setBranchLabel(list[0].name);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-checks whether today's figure is already on record every time the
  // branch changes — same "Already recorded, use Change to correct" gate
  // the old inline card enforced, now scoped to this modal's own picker.
  useEffect(() => {
    if (!branchId) { setAlreadySet(false); setCurrentValue(0); return; }
    setLoadingStatus(true);
    getCashSummary(branchId, date).then((s) => {
      setAlreadySet(s.openingCashSet);
      setCurrentValue(s.openingCash);
      setAmount(s.openingCashSet ? String(s.openingCash) : "");
      setEditing(false);
    }).catch(() => {}).finally(() => setLoadingStatus(false));
  }, [branchId, date]);

  async function searchBranches(q: string): Promise<{ items: BranchView[]; hasMore: boolean }> {
    const query = q.trim().toLowerCase();
    const items = query ? branches.filter((b) => b.name.toLowerCase().includes(query)) : branches;
    return { items, hasMore: false };
  }

  async function save() {
    if (!branchId) { setErr("Please select a branch."); return; }
    const value = +amount;
    if (amount.trim() === "" || !(value >= 0)) { setErr("Enter a valid opening balance."); return; }
    setSaving(true);
    setErr("");
    try {
      await setOpeningBalance(branchId, value, date);
      onSaved();
      closeModal();
      toast(`Opening cash set to ${fmt(value)}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save opening balance.");
    } finally {
      setSaving(false);
    }
  }

  const locked = alreadySet && !editing;

  return (
    <>
      <div className="hd"><h3>Opening Balance</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Branch *</label>
          <SearchableSelect<BranchView>
            value={branchLabel}
            onChange={(id, item) => { setBranchId(item.id); setBranchLabel(item.name); }}
            fetchFn={searchBranches}
            getLabel={(b) => b.name}
            getId={(b) => String(b.id)}
            placeholder="Search branch…"
          /></div></div>
        <div className="frow"><div>
          <label className="f">Opening Cash-in-Hand (₹)</label>
          {locked ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 18, color: "var(--brand-deep)" }}>{fmt(currentValue)}</b>
              <button className="btn ghost sm" onClick={() => { setAmount(String(currentValue)); setEditing(true); }}>Change</button>
            </div>
          ) : (
            <input className="inp" type="number" min={0} placeholder="e.g. 50000" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={loadingStatus} />
          )}
        </div></div>
        <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: -6 }}>
          {alreadySet
            ? "Already recorded for this branch today — it feeds directly into the Cash & Expenses KPIs. Use “Change” only to correct a wrong figure."
            : "Enter the opening cash-in-hand for the selected branch at the start of the day — it feeds directly into the Cash & Expenses KPIs."}
        </p>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        {!locked && (
          <button className="btn" onClick={save} disabled={saving || !branchId}>{saving ? "Saving…" : "Set"}</button>
        )}
      </div>
    </>
  );
}
