"use client";

import { LedgerRefLink } from "@/product/components/ui/LedgerRefLink";
import { expenseCategoryOf } from "@/product/hooks/useExpenseCategoryIds";
import { MODE_LEDGER_ROUTE, type CashMovementView } from "@/product/pages/cash/services/cashService";
import { routeHref } from "@/product/services/appRoutes";

/* Clickable cells for a cash-movement ledger row — shared by Cash.tsx's
 * Ledger tab and the Reports Ledger / Statement Export
 * (LedgerExportView.tsx), so both link references the same way. */

// particularsFor mirrors LedgerExportView.tsx's "Particulars" column — the
// same purpose-or-source text, with a party link layered on top (category /
// customer / bank drill-down).
export function particularsFor(m: CashMovementView, categoryIds: Record<string, number>) {
  const text = m.type === "in" ? (m.purpose ? `${m.source} · ${m.purpose}` : m.source) : m.purpose || "—";
  // An approved expense's row links to its category ledger first — that's
  // the ledger it belongs to; its From Bank still has its own bank ledger.
  const category = expenseCategoryOf(m.purpose);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  if (categoryId) {
    return <LedgerRefLink kind="category" id={categoryId} label={text || category!} />;
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
// RecordLoanPaymentCashIn/etc), there's no dedicated column for it. Movements
// with no loan number (manual top-ups, expenses, gold sales, …) fall back to
// the transaction group id / movement id.
const LOAN_NUMBER_RE = /—\s*((?:LN|INV)-\S+)\s*$/;
export function loanNumberFor(m: CashMovementView): string {
  // A loan-sourced Add Cash entry carries the loan number staff typed in.
  if (m.loanSource?.loanNumber) return m.loanSource.loanNumber;
  const match = m.purpose ? LOAN_NUMBER_RE.exec(m.purpose) : null;
  return match?.[1] || m.transactionGroupId || String(m.id);
}

// A row's Ref No column is only ever clickable when it actually resolved to
// a real loan/investment number — the transactionGroupId/id fallback isn't a
// navigable entity, just an internal identifier.
export function refCellFor(m: CashMovementView) {
  const ref = loanNumberFor(m);
  if (ref.startsWith("LN-")) return <LedgerRefLink kind="loan" id={ref} label={ref} />;
  if (ref.startsWith("INV-")) return <LedgerRefLink kind="investment" id={ref} label={ref} />;
  return ref;
}

// Every mode is a drill-down link to that mode's own ledger.
export function modeCellFor(mode: string | undefined) {
  if (!mode) return "—";
  const route = MODE_LEDGER_ROUTE[mode];
  return route ? <a href={routeHref(route)}>{mode}</a> : mode;
}
