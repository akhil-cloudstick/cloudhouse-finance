"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { ApiError, getAuthToken } from "@/product/services/httpClient";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { createExpense, uploadReceipt, type ExpenseView } from "@/product/pages/cash/services/cashService";
import { searchExpenseCategoriesPage, createExpenseCategory, type BackendExpenseCategory } from "@/product/pages/cash/services/expenseCategoryService";
import { searchBanksPage, createBank, type BackendBank } from "@/product/pages/banks/services/bankService";
import { Select } from "@/product/components/ui/Select";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { FileInput } from "@/product/components/ui/FileInput";
import { useLoanBalance } from "@/product/hooks/useLoanBalance";
import { singleFlight } from "@/product/utils/singleFlight";

const MODES = ["Cash", "UPI", "Bank"];
const MODE_OPTIONS = MODES.map((m) => ({ value: m, label: m }));

/* Ported from legacy/app.js's `openExpenseModal()` / `saveExpense()`. Now
 * posts to the real POST /expenses endpoint: branch options come from the
 * Branch Management API, and a chosen receipt file is uploaded via the
 * shared /uploads endpoint first (see cashApi.ts's uploadReceipt), storing
 * the returned URL — no more base64 blobs. Recorded expenses always start
 * "Pending" server-side and go through the approve/reject flow on
 * Cash.tsx's Expense Register. */
export function ExpenseModalContent({ onSaved, tabs }: { onSaved?: () => void; tabs?: ReactNode }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [cat, setCat] = useState("");
  const [catRec, setCatRec] = useState<BackendExpenseCategory | null>(null);
  // An expense under a loan is a repayment — it can't exceed what has been
  // drawn and not yet repaid. Blocks the button (the backend refuses it too).
  const loanBal = useLoanBalance(catRec);
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) : 0;
  const loanExceeded = !!loanBal && (+amt || 0) > owed + 0.005;
  const loanWarning = loanExceeded
    ? `Repayment exceeds what has been paid on ${cat} — only ${fmt(owed)} is outstanding.`
    : "";
  const [mode, setMode] = useState(MODES[0]);
  // From Bank — the branch account the expense is paid from, required when
  // Mode is UPI/Bank (see backend/internal/cash/service.go's
  // ExpenseService.Record).
  const [fromBankId, setFromBankId] = useState("");
  const [fromBankName, setFromBankName] = useState("");
  const banksRequired = mode === "UPI" || mode === "Bank";
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

  async function save() { return singleFlight("modal:expense:save", async () => {
    if (!cat.trim()) { setErr("Please select a category."); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid amount."); return; }
    if (!date) { setErr("Please select the date."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }
    if (banksRequired && !fromBankId) { setErr("Please select the From Bank."); return; }

    setSaving(true);
    try {
      let receiptImage: string | undefined;
      if (receiptFile) receiptImage = await uploadReceipt(receiptFile);

      const created = await createExpense({
        category: cat, amount, mode, branchId,
        fromBankId: banksRequired ? +fromBankId : undefined,
        occurredOn: date, receiptImage,
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
  }); }

  return (
    <>
      <div className="hd"><h3>Record Expense</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        {tabs}
        {/* Same order as every entry form: Category → Date → Mode → Amount → Branch → Bill. */}
        <div className="frow"><div><label className="f">Category *</label>
          <SearchableSelect<BackendExpenseCategory>
            portal
            value={cat}
            onChange={(_id, item) => {
              setCat(item.name);
              setCatRec(item);
              // A category from another form: choosing it flips it to common.
              if (item.type && item.type !== "expense" && !item.isCommon) createExpenseCategory(item.name).catch(() => {});
            }}
            fetchFn={searchExpenseCategoriesPage}
            searchHint="Searches: category name"
            getLabel={(c) => c.name}
            getId={(c) => String(c.id)}
            placeholder="Search or add a category…"
            allowCreate
            onCreate={createExpenseCategory}
          /></div></div>
        <div className="frow c2">
          <div><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /></div>
          <div><label className="f">Mode *</label>
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
                portal
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
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Branch *</label>
            <Select
              disabled={singleBranch}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              value={branchId ? String(branchId) : ""}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
              placeholder="Select branch…"
            /></div>
        </div>
        <div className="frow"><div><label className="f">Bill</label>
          <FileInput value={receiptFile} onChange={setReceiptFile} accept="image/*" /></div></div>
        {loanWarning && (
          <div className="notice" style={{ marginBottom: 4, borderLeft: "3px solid var(--red)", color: "var(--red)" }}>
            {loanWarning}
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || loanExceeded}><Icon name="check" /> {saving ? "Saving…" : "Record Expense"}</button>
      </div>
    </>
  );
}

/* Ported from legacy/app.js's `viewExpenseReceipt()`. */
export function ReceiptViewModalContent({ e }: { e: ExpenseView }) {
  const { closeModal } = useModal();
  return (
    <>
      <div className="hd"><h3>Receipt — {e.cat} ({fmt(e.amt)})</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll" style={{ textAlign: "center" }}>
        <img src={e.img} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt="Receipt" />
      </div>
    </>
  );
}

/* A bill image attached to any ledger entry (expense, cash-in, self transfer). */
export function BillViewModalContent({ title, url }: { title: string; url: string }) {
  const { closeModal } = useModal();
  // Fetched with the session's own token and shown from a blob: a plain
  // <img src="/uploads/…"> relies on a cookie shared across browser tabs,
  // which another business's login in a second tab silently replaces.
  const [src, setSrc] = useState<string>("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    const token = getAuthToken();
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { if (!cancelled) { objectUrl = URL.createObjectURL(b); setSrc(objectUrl); } })
      .catch(() => { if (!cancelled) { setSrc(url); setFailed(true); } });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return (
    <>
      <div className="hd"><h3>Bill — {title}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll" style={{ textAlign: "center" }}>
        {src
          ? <img src={src} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt="Bill" />
          : <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading bill…</p>}
        {failed && <p style={{ color: "var(--muted)", fontSize: 12.5 }}>Could not load this bill.</p>}
      </div>
    </>
  );
}
