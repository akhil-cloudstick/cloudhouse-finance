"use client";

import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { AddCashModalContent } from "@/components/modals/AddCashModal";
import { CashOutModalContent } from "@/components/modals/CashOutModal";
import { ExpenseModalContent, ReceiptViewModalContent } from "@/components/modals/ExpenseModal";
import type { CashMovement, Expense } from "@/lib/data";

function Kpi({ l, v, s, cls }: { l: string; v: string | number; s?: string; cls?: string }) {
  return (
    <div className={`kpi ${cls || ""}`}>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="s">{s || ""}</div>
    </div>
  );
}

function MovementRow({ m, onToggleLoan }: { m: CashMovement; onToggleLoan: (id: string) => void }) {
  const isLoan = m.type === "in" && m.source === "Loan";
  return (
    <tr>
      <td>{m.d}</td>
      <td>{m.type === "in" ? <span className="chip green">Cash In</span> : <span className="chip red">Cash Out</span>}</td>
      <td>{m.type === "in" ? m.source : m.purpose || "—"}</td>
      <td>{m.bank || "—"}</td>
      <td className="num" style={{ color: m.type === "in" ? "var(--green)" : "var(--red)" }}>
        {m.type === "in" ? "+" : "−"}{fmt(m.amount)}
      </td>
      <td>
        {isLoan ? (
          <>
            <span className={`chip ${m.status === "Closed" ? "gray" : "amber"}`}>{m.status || "Open"}</span>
            <button className="btn plain sm" style={{ padding: "3px 8px", marginLeft: 6 }} onClick={() => onToggleLoan(m.id!)}>
              {m.status === "Closed" ? "Reopen" : "Mark Closed"}
            </button>
          </>
        ) : "—"}
      </td>
    </tr>
  );
}

function ExpenseRow({ e, onViewReceipt }: { e: Expense; onViewReceipt: () => void }) {
  return (
    <tr>
      <td>{e.d}</td>
      <td>{e.cat}</td>
      <td className="num">{fmt(e.amt)}</td>
      <td>{e.mode}</td>
      <td>{e.payee}</td>
      <td>{e.branch}</td>
      <td><StatusChip status={e.status} /></td>
      <td style={{ textAlign: "center" }}>
        {e.img
          ? <img src={e.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }} title="View receipt" onClick={onViewReceipt} />
          : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
    </tr>
  );
}

/* Ported from legacy/app.js's `renderCash()` / `toggleCashLoan()`. The 4
 * "today" KPI values are hardcoded demo numbers exactly as legacy — this is
 * a faithful prototype port, not a real cash-flow engine. */
export function Cash() {
  const { db, refresh } = useData();
  const { openModal } = useModal();
  const toast = useToast();

  const total = db.expenses.reduce((s, e) => s + e.amt, 0);
  const cashIn = db.cashMovements.filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0);
  const cashOut = db.cashMovements.filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);

  function toggleCashLoan(id: string) {
    const m = db.cashMovements.find((x) => x.id === id);
    if (!m) return;
    const next = m.status === "Closed" ? "Open" : "Closed";
    db.setCashLoanStatus(id, next);
    refresh();
    toast(`Loan from ${m.bank} marked ${next.toLowerCase()}`);
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Cash-in-Hand &amp; Expenses</h1><p>Opening Cash + Collections − Disbursements − Expenses = Expected Cash in Hand</p></div>
        <div className="sp" />
        <button className="btn ghost" onClick={() => openModal(<CashOutModalContent />)}><Icon name="coin" /> Take Cash Out</button>
        <button className="btn ghost" onClick={() => openModal(<AddCashModalContent />)}><Icon name="coin" /> Add Cash</button>
        <button className="btn" onClick={() => openModal(<ExpenseModalContent />)}><Icon name="plus" /> Record Expense</button>
      </div>
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 18 }}>
        <Kpi l="Opening Cash (today)" v={fmt(510000)} />
        <Kpi l="Collections / Income" v={fmt(96350)} s="interest + principal" cls="ok" />
        <Kpi l="Loan Disbursements" v={fmt(118000)} s="GL-2051 (new)" />
        <Kpi l="Expenses (today)" v={fmt(6000)} />
        <Kpi l="Expected Cash in Hand" v={fmt(482350 + cashIn - cashOut)} s="auto-calculated" cls="ok" />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="hd"><h3>Cash Movements</h3><div className="sp" />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>In {fmt(cashIn)} · Out {fmt(cashOut)}</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Type</th><th>Source / Purpose</th><th>Bank</th><th className="num">Amount</th><th>Loan Status</th></tr></thead>
            <tbody>
              {db.cashMovements.length
                ? db.cashMovements.map((m, i) => <MovementRow key={m.id || i} m={m} onToggleLoan={toggleCashLoan} />)
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
            <thead><tr><th>Date</th><th>Category</th><th className="num">Amount</th><th>Mode</th><th>Description / Payee</th><th>Branch</th><th>Status</th><th style={{ textAlign: "center" }}>Receipt</th></tr></thead>
            <tbody>
              {db.expenses.map((e, i) => (
                <ExpenseRow key={i} e={e} onViewReceipt={() => openModal(<ReceiptViewModalContent e={e} />, true)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft">Cash expenses automatically reflect in Cash-in-Hand calculations · receipt images attached to expense records</div>
      </div>
    </>
  );
}
