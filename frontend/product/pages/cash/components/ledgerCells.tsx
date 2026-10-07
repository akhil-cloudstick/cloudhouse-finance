"use client";

import { LedgerRefLink } from "@/product/components/ui/LedgerRefLink";
import { expenseCategoryOf } from "@/product/hooks/useExpenseCategoryIds";
import { MODE_LEDGER_ROUTE, type CashMovementView } from "@/product/pages/cash/services/cashService";
import { routeHref } from "@/product/services/appRoutes";
import { useCanOpenRoute } from "@/product/hooks/useCanOpenRoute";
import { isLoanSource } from "@/product/pages/cash/services/cashSourceService";
import { useModal } from "@/product/components/Modal";
import { BillViewModalContent } from "@/product/components/modals/ExpenseModal";

/* Clickable cells for a cash-movement ledger row — shared by Cash.tsx's
 * Ledger tab and the Reports Ledger / Statement Export
 * (LedgerExportView.tsx), so both link references the same way. */

// particularsFor mirrors LedgerExportView.tsx's "Particulars" column — the
// same purpose-or-source text, with a party link layered on top (category /
// customer / bank drill-down).
export function particularsFor(m: CashMovementView, categoryIds: Record<string, number>) {
  // A gold-loan repayment (source "Collection", LN- reference) reads "Gold
  // Loan"; personal-loan collections keep their existing label.
  const source = m.source === "Collection" && loanNumberFor(m).startsWith("LN-") ? "Gold Loan" : m.source;
  // A self transfer's purpose already says "Self transfer — <category>", so
  // its credit row shows just that, same as its debit row.
  const text = m.type === "in" && m.source !== "Self Transfer" ? (m.purpose ? `${source} · ${m.purpose}` : source) : m.purpose || "—";
  // An approved expense's row links to its category ledger first — that's
  // the ledger it belongs to; its From Bank still has its own bank ledger.
  // A self transfer reads "Self transfer — <category>" followed by the row's
  // bank as a link to that bank's ledger (From bank on the debit row, To bank
  // on the credit row).
  if (m.source === "Self Transfer" && m.bankId) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <span>{text}</span>
        <LedgerRefLink kind="bank" id={m.bankId} label={m.bankName || "Bank"} />
      </span>
    );
  }
  const category = expenseCategoryOf(m.purpose);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  if (categoryId) {
    return <LedgerRefLink kind="category" id={categoryId} label={text || category!} />;
  }
  // A loan-sourced Add Cash entry links to that loan's own ledger — served
  // by the loan's same-named repayment category.
  // (Any named source with a category row — Savings too — opens its own ledger.)
  const loanCategoryId = m.type === "in" && m.source ? categoryIds[m.source.toLowerCase()] : undefined;
  if (loanCategoryId) {
    return <LedgerRefLink kind="category" id={loanCategoryId} label={text || m.source!} />;
  }
  if (m.partyCustomerId) {
    return <LedgerRefLink kind="customer" id={m.partyCustomerId} label={text || "Customer"} />;
  }
  if (m.bankId) {
    return <LedgerRefLink kind="bank" id={m.bankId} label={text || "Bank"} />;
  }
  return text;
}

// loanNumberFor pulls the loan number back out of `purpose` — every
// loan-related movement's Purpose carries it as a "… — LN-00049" suffix
// (see cash.MovementService.RecordLoanDisbursementCashOut/
// RecordLoanPaymentCashIn/etc), there's no dedicated column for it. "" for a
// movement with none (manual top-ups, expenses, gold sales, …) — the internal
// transaction group id / movement id is deliberately never shown as a Ref No.
const LOAN_NUMBER_RE = /—\s*((?:LN|PL|INV)-\S+)\s*$/;
export function loanNumberFor(m: CashMovementView): string {
  const match = m.purpose ? LOAN_NUMBER_RE.exec(m.purpose) : null;
  return match?.[1] || "";
}

// Ref No column. An expense (which includes a loan repayment — those are
// booked as expenses in the loan's category) or a loan-sourced Add Cash shows
// the bank it moved through, linked to that bank's ledger, and stays blank
// shows "—" when there is none (e.g. a Cash-mode expense). A real LN-/PL-/INV-
// number links to its loan/investment. Everything else is "—" — never the
// internal transaction id.
// A self transfer's category ("Self transfer — Loan HDFC 4471" → "Loan HDFC 4471").
const SELF_TRANSFER_PREFIX = "Self transfer — ";
export function selfTransferCategory(purpose?: string): string {
  return purpose && purpose.startsWith(SELF_TRANSFER_PREFIX) ? purpose.slice(SELF_TRANSFER_PREFIX.length).trim() : "";
}

export function refCellFor(m: CashMovementView, categoryIds?: Record<string, number>) {
  // A self transfer to a loan links to that loan's own ledger.
  if (m.source === "Self Transfer") {
    const cat = selfTransferCategory(m.purpose);
    const id = cat && isLoanSource(cat) ? categoryIds?.[cat.toLowerCase()] : undefined;
    return id ? <LedgerRefLink kind="category" id={id} label={cat} /> : "—";
  }
  const bankBacked = m.expenseId != null || expenseCategoryOf(m.purpose) !== null || (m.type === "in" && !!m.source && isLoanSource(m.source));
  if (bankBacked) {
    if (m.bankId && m.bankName) return <LedgerRefLink kind="bank" id={m.bankId} label={m.bankName} />;
    return m.bankName || "—";
  }
  const ref = loanNumberFor(m);
  if (ref.startsWith("LN-")) return <LedgerRefLink kind="loan" id={ref} label={ref} />;
  if (ref.startsWith("PL-")) return <LedgerRefLink kind="personalloan" id={ref} label={ref} />;
  if (ref.startsWith("INV-")) return <LedgerRefLink kind="investment" id={ref} label={ref} />;
  return "—";
}

// Every mode is a drill-down link to that mode's own ledger — plain text for
// a role that can't open the Ledger (the cell also appears on Loan Detail and
// Reports, which don't need cash view).
export function modeCellFor(mode: string | undefined) {
  if (!mode) return "—";
  const route = MODE_LEDGER_ROUTE[mode];
  return route ? <ModeLink route={route} mode={mode} /> : mode;
}

function ModeLink({ route, mode }: { route: string; mode: string }) {
  const canOpen = useCanOpenRoute();
  return canOpen(route) ? <a href={routeHref(route)}>{mode}</a> : <>{mode}</>;
}

// Ref cell for a party/mode ledger row with no loan/investment number: a
// loan-sourced Add Cash entry (row `type` is its source name, e.g. "Loan …")
// links to that loan's own ledger — its same-named repayment category.
export function loanCatRef(r: { type: string; reference?: string; description?: string }, categoryIds: Record<string, number>) {
  // A self transfer to a loan: its category is the loan, named in the description.
  if (r.type === "Self Transfer") {
    const cat = selfTransferCategory(r.description);
    const catId = cat && isLoanSource(cat) ? categoryIds[cat.toLowerCase()] : undefined;
    return catId ? <LedgerRefLink kind="category" id={catId} label={cat} /> : "—";
  }
  const id = r.type && isLoanSource(r.type) ? categoryIds[r.type.toLowerCase()] : undefined;
  return id && r.reference ? <LedgerRefLink kind="category" id={id} label={r.reference} /> : r.reference || "—";
}

/* "View bill" link for a ledger entry that has an uploaded bill — opens the
 * image in the same viewer the Expense Register's receipt thumbnail uses. */
export function BillLink({ url, title }: { url?: string; title: string }) {
  const { openModal } = useModal();
  if (!url) return null;
  return (
    <a
      href={url}
      style={{ display: "inline-block", fontSize: 11.5, marginLeft: 8, whiteSpace: "nowrap" }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openModal(<BillViewModalContent title={title} url={url} />, true); }}
    >
      View bill
    </a>
  );
}
