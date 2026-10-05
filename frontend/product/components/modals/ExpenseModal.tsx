"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { createExpense, uploadReceipt, type ExpenseView } from "@/product/pages/cash/services/cashService";
import { searchExpenseCategoriesPage, createExpenseCategory, type BackendExpenseCategory } from "@/product/pages/cash/services/expenseCategoryService";
import { searchBanksPage, createBank, type BackendBank } from "@/product/pages/banks/services/bankService";
import { Select } from "@/product/components/ui/Select";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { FileInput } from "@/product/components/ui/FileInput";

const MODES = ["Cash", "UPI", "Bank"];
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
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [cat, setCat] = useState("");
  const [mode, setMode] = useState(MODES[0]);
  // From Bank — the branch account the expense is paid from, required when
  // Mode is UPI/Bank (see backend/internal/cash/service.go's
  // ExpenseService.Record).
  const [fromBankId, setFromBankId] = useState("");
  const [fromBankName, setFromBankName] = useState("");
  const banksRequired = mode === "UPI" || mode === "Bank";
  const [remarks, setRemarks] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
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
    if (!cat.trim()) { setErr("Please select a category."); return; }
    if (banksRequired && !fromBankId) { setErr("Please select the From Bank."); return; }

    setSaving(true);
    try {
      let receiptImage: string | undefined;
      if (receiptFile) receiptImage = await uploadReceipt(receiptFile);

      const created = await createExpense({
        category: cat, amount, mode, payee, branchId,
        fromBankId: banksRequired ? +fromBankId : undefined,
        occurredOn: date, remarks: remarks.trim() || undefined, receiptImage,
      });
      onSaved?.();
      closeModal();
      // With the expense approval flow on, the expense comes back Pending —
      // no cash moves until it is approved from the Expense Register.
      toast(created.status === "Pending" ? `Expense of ${fmt(amount)} submitted for approval` : `Expense of ${fmt(amount)} recorded`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Record Expense</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow"><div><label className="f">Description *</label>
          <input className="inp" placeholder="e.g. Office maintenance" value={desc} onChange={(e) => setDesc(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Category *</label>
            <SearchableSelect<BackendExpenseCategory>
              value={cat}
              onChange={(_id, item) => setCat(item.name)}
              fetchFn={searchExpenseCategoriesPage}
              searchHint="Searches: category name"
              getLabel={(c) => c.name}
              getId={(c) => String(c.id)}
              placeholder="Search or add a category…"
              allowCreate
              onCreate={createExpenseCategory}
            /></div>
          <div><label className="f">Payment Mode</label>
            <Select
              options={MODE_OPTIONS}
              value={mode}
              onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank") { setFromBankId(""); setFromBankName(""); } }}
            /></div>
        </div>
        {banksRequired && (
          <div className="frow">
            <div><label className="f">Bank *</label>
              <SearchableSelect<BackendBank>
                value={fromBankName}
                onChange={(id, item) => { setFromBankId(id); setFromBankName(item.name); }}
                fetchFn={searchBanksPage}
                searchHint="Searches: bank name"
                getLabel={(b) => b.name}
                getId={(b) => String(b.id)}
                placeholder="Search or add a bank…"
                allowCreate
                onCreate={createBank}
              /></div>
          </div>
        )}
        <div className="frow"><div><label className="f">Branch *</label>
          <Select
            disabled={singleBranch}
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            value={branchId ? String(branchId) : ""}
            onChange={(v) => setBranchId(v ? Number(v) : "")}
            placeholder="Select branch…"
          /></div></div>
        <div className="frow"><div><label className="f">Receipt / Bill Image</label>
          <FileInput value={receiptFile} onChange={setReceiptFile} accept="image/*" /></div></div>
        <div className="frow"><div><label className="f">Remarks</label>
          <textarea className="inp" rows={2} placeholder="Optional notes" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
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
      <div className="bd bd-scroll" style={{ textAlign: "center" }}>
        <img src={e.img} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt="Receipt" />
      </div>
    </>
  );
}
