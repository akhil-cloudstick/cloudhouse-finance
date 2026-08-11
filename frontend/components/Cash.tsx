"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { AddCashModalContent } from "@/components/modals/AddCashModal";
import { CashOutModalContent } from "@/components/modals/CashOutModal";
import { ExpenseModalContent, ReceiptViewModalContent } from "@/components/modals/ExpenseModal";
import { listActiveBranches, type BranchView } from "@/lib/branchApi";
import {
  listCashMovements, listExpenses, getCashSummary, setOpeningBalance,
  setCashMovementLoanStatus, approveExpense, rejectExpense,
  type CashMovementView, type ExpenseView, type CashSummary,
} from "@/lib/cashApi";
import { ApiError } from "@/lib/api";

function Kpi({ l, v, s, cls }: { l: string; v: string | number; s?: string; cls?: string }) {
  return (
    <div className={`kpi ${cls || ""}`}>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="s">{s || ""}</div>
    </div>
  );
}

function MovementRow({ m, onToggleLoan }: { m: CashMovementView; onToggleLoan: (id: number) => void }) {
  const isLoan = m.type === "in" && m.source === "Loan";
  return (
    <tr>
      <td>{m.d}</td>
      <td>{m.type === "in" ? <span className="chip green">Cash In</span> : <span className="chip red">Cash Out</span>}</td>
      {/* Loan repayments post as source="Collection" with the payment
          type/loan number in `purpose` (see cash.MovementService.
          RecordLoanPaymentCashIn) — show both, not just source, so those
          rows don't all read as a bare "Collection". */}
      <td>{m.type === "in" ? (m.purpose ? `${m.source} · ${m.purpose}` : m.source) : m.purpose || "—"}</td>
      <td>{m.bank || "—"}</td>
      <td className="num" style={{ color: m.type === "in" ? "var(--green)" : "var(--red)" }}>
        {m.type === "in" ? "+" : "−"}{fmt(m.amount)}
      </td>
      <td>
        {isLoan ? (
          <>
            <span className={`chip ${m.status === "Closed" ? "gray" : "amber"}`}>{m.status || "Open"}</span>
            <button className="btn plain sm" style={{ padding: "3px 8px", marginLeft: 6 }} onClick={() => onToggleLoan(m.id)}>
              {m.status === "Closed" ? "Reopen" : "Mark Closed"}
            </button>
          </>
        ) : "—"}
      </td>
    </tr>
  );
}

function ExpenseRow({ e, onViewReceipt, onApprove, onReject }: {
  e: ExpenseView; onViewReceipt: () => void; onApprove: () => void; onReject: () => void;
}) {
  return (
    <tr>
      <td>{e.d}</td>
      <td>{e.cat}</td>
      <td className="num">{fmt(e.amt)}</td>
      <td>{e.mode}</td>
      <td>{e.payee}</td>
      <td>{e.branch}</td>
      <td>
        <StatusChip status={e.status} />
        {e.remarks ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{e.remarks}</div> : null}
      </td>
      <td style={{ textAlign: "center" }}>
        {e.img
          ? <img src={e.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }} title="View receipt" onClick={onViewReceipt} />
          : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      <td>
        {e.status === "Pending" ? (
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn plain sm" style={{ padding: "3px 8px", color: "var(--green)" }} onClick={onApprove}>Approve</button>
            <button className="btn plain sm" style={{ padding: "3px 8px", color: "var(--red)" }} onClick={onReject}>Reject</button>
          </div>
        ) : "—"}
      </td>
    </tr>
  );
}

/* Ported from legacy/app.js's `renderCash()` / `toggleCashLoan()`. Fully
 * backend-backed: cash movements, the expense register, the opening cash
 * balance, and the Expected Cash in Hand figure all come from the Go API
 * (backend/internal/cash) instead of localStorage. */
export function Cash() {
  const { openModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">("");
  const [movements, setMovements] = useState<CashMovementView[]>([]);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [openingInput, setOpeningInput] = useState("");

  const refresh = useCallback(() => {
    listCashMovements().then(setMovements).catch(() => setMovements([]));
    listExpenses().then(setExpenses).catch(() => setExpenses([]));
    getCashSummary(branchId || undefined, today).then((s) => {
      setSummary(s);
      setOpeningInput(String(s.openingCash));
    }).catch(() => setSummary(null));
  }, [branchId, today]);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const total = expenses.reduce((s, e) => s + e.amt, 0);
  const expensesToday = expenses.filter((e) => e.d === today).reduce((s, e) => s + e.amt, 0);
  const cashIn = movements.filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0);
  const cashOut = movements.filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);

  async function toggleCashLoan(id: number) {
    const m = movements.find((x) => x.id === id);
    if (!m) return;
    const next = m.status === "Closed" ? "Open" : "Closed";
    try {
      await setCashMovementLoanStatus(id, next);
      refresh();
      toast(`Loan from ${m.bank} marked ${next.toLowerCase()}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not update loan status.");
    }
  }

  async function saveOpeningBalance() {
    if (!branchId) { toast("Select a branch first."); return; }
    const amount = +openingInput;
    if (!(amount >= 0)) { toast("Enter a valid opening balance."); return; }
    try {
      await setOpeningBalance(branchId, amount, today);
      refresh();
      toast(`Opening cash set to ${fmt(amount)}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save opening balance.");
    }
  }

  async function handleApprove(id: number) {
    try {
      await approveExpense(id);
      refresh();
      toast("Expense approved");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not approve expense.");
    }
  }

  async function handleReject(id: number) {
    const remarks = window.prompt("Reason for rejecting this expense?");
    if (!remarks || !remarks.trim()) return;
    try {
      await rejectExpense(id, remarks.trim());
      refresh();
      toast("Expense rejected");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not reject expense.");
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Cash-in-Hand &amp; Expenses</h1></div>
        <div className="sp" />
        <button className="btn ghost" onClick={() => openModal(<CashOutModalContent onSaved={refresh} />)}><Icon name="coin" /> Take Cash Out</button>
        <button className="btn ghost" onClick={() => openModal(<AddCashModalContent onSaved={refresh} />)}><Icon name="coin" /> Add Cash</button>
        <button className="btn" onClick={() => openModal(<ExpenseModalContent onSaved={refresh} />)}><Icon name="plus" /> Record Expense</button>
      </div>
      <hr className="gold-rule" />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="hd">
          <h3>Opening Cash Balance — Today</h3>
          <div className="sp" />
          <select className="inp" style={{ width: 180 }} value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input className="inp" style={{ width: 140, marginLeft: 8 }} type="number" min={0} value={openingInput} onChange={(e) => setOpeningInput(e.target.value)} />
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={saveOpeningBalance} disabled={!branchId}>Set</button>
        </div>
        <div className="ft">Enter the opening cash-in-hand for the selected branch at the start of the day — it feeds directly into the KPI below.</div>
      </div>

      <div className="kpis" style={{ marginBottom: 18 }}>
        <Kpi l="Opening Cash (today)" v={fmt(summary?.openingCash || 0)} />
        <Kpi l="Collections / Income" v={fmt(summary?.collections || 0)} s="interest + principal" cls="ok" />
        <Kpi l="Loan Disbursements" v={fmt(summary?.disbursements || 0)} />
        <Kpi l="Expenses (today)" v={fmt(expensesToday)} s={fmt(summary?.cashExpenses || 0) + " cash"} />
        <Kpi l="Expected Cash in Hand" v={fmt(summary?.expectedCash || 0)} s="auto-calculated" cls="ok" />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="hd"><h3>Cash Movements</h3><div className="sp" />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>In {fmt(cashIn)} · Out {fmt(cashOut)}</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Type</th><th>Source / Purpose</th><th>Bank</th><th className="num">Amount</th><th>Loan Status</th></tr></thead>
            <tbody>
              {movements.length
                ? movements.map((m) => <MovementRow key={m.id} m={m} onToggleLoan={toggleCashLoan} />)
                : <tr><td colSpan={6} className="empty">No cash movements recorded yet. Use &quot;Add Cash&quot; or &quot;Take Cash Out&quot;.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="ft">Cash added from a loan stays flagged until the loan is marked closed · all movements adjust Expected Cash in Hand</div>
      </div>

      <div className="card">
        <div className="hd"><h3>Expense Register</h3><div className="sp" /><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Total {fmt(total)}</span></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Category</th><th className="num">Amount</th><th>Mode</th><th>Description / Payee</th><th>Branch</th><th>Status</th><th style={{ textAlign: "center" }}>Receipt</th><th>Actions</th></tr></thead>
            <tbody>
              {expenses.length
                ? expenses.map((e) => (
                  <ExpenseRow
                    key={e.id}
                    e={e}
                    onViewReceipt={() => openModal(<ReceiptViewModalContent e={e} />, true)}
                    onApprove={() => handleApprove(e.id)}
                    onReject={() => handleReject(e.id)}
                  />
                ))
                : <tr><td colSpan={9} className="empty">No expenses recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="ft">Cash expenses automatically reflect in Cash-in-Hand calculations · receipt images attached to expense records</div>
      </div>
    </>
  );
}
