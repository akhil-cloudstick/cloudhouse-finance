"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";
import { createExpense, uploadReceipt, type ExpenseView } from "@/modules/cash/services/cashService";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";

const CATS = ["Rent & Utilities", "Salaries", "Transportation", "Marketing", "Bank Charges", "Maintenance", "Stationery & Office", "Legal & Miscellaneous", "Other"];
const MODES = ["Cash", "UPI", "Bank"];
const CAT_OPTIONS = CATS.map((c) => ({ value: c, label: c }));
const MODE_OPTIONS = MODES.map((m) => ({ value: m, label: m }));

/* Ported from legacy/app.js's `openExpenseModal()` / `saveExpense()`. Now
 * posts to the real POST /expenses endpoint: branch options come from the
 * Branch Management API, and a chosen receipt file is uploaded via the
 * shared /uploads endpoint first (see cashApi.ts's uploadReceipt), storing
 * the returned URL — no more base64 blobs. Recorded expenses always start
 * "Pending" server-side and go through the approve/reject flow on
 * Cash.tsx's Expense Register. */
export function ExpenseModalContent({ onSaved }: { onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [cat, setCat] = useState(CATS[0]);
  const [mode, setMode] = useState(MODES[0]);
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

  async function save() {
    const payee = desc.trim();
    if (!payee) { setErr("Please enter a description."); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid amount."); return; }
    if (!date) { setErr("Please select the date."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }

    setSaving(true);
    try {
      let receiptImage: string | undefined;
      const file = fileRef.current?.files?.[0];
      if (file) receiptImage = await uploadReceipt(file);

      await createExpense({
        category: cat, amount, mode, payee, branchId,
        occurredOn: date, remarks: remarks.trim() || undefined, receiptImage,
      });
      onSaved?.();
      closeModal();
      toast(`Expense of ${fmt(amount)} recorded`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Record Expense</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Description *</label>
          <input className="inp" placeholder="e.g. Office maintenance" value={desc} onChange={(e) => setDesc(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Category</label>
            <Select options={CAT_OPTIONS} value={cat} onChange={setCat} /></div>
          <div><label className="f">Payment Mode</label>
            <Select options={MODE_OPTIONS} value={mode} onChange={setMode} /></div>
        </div>
        <div className="frow"><div><label className="f">Branch *</label>
          <Select
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            value={branchId ? String(branchId) : ""}
            onChange={(v) => setBranchId(v ? Number(v) : "")}
            placeholder="Select branch…"
          /></div></div>
        <div className="frow"><div><label className="f">Receipt / Bill Image</label>
          <input className="inp" type="file" accept="image/*" ref={fileRef} /></div></div>
        <div className="frow"><div><label className="f">Remarks</label>
          <textarea className="inp" rows={2} placeholder="Optional notes for the approver" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Record Expense"}</button>
      </div>
    </>
  );
}

/* Ported from legacy/app.js's `viewExpenseReceipt()`. */
export function ReceiptViewModalContent({ e }: { e: ExpenseView }) {
  const { closeModal } = useModal();
  return (
    <>
      <div className="hd"><h3>Receipt — {e.payee} ({fmt(e.amt)})</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd" style={{ textAlign: "center" }}>
        <img src={e.img} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt="Receipt" />
      </div>
    </>
  );
}
