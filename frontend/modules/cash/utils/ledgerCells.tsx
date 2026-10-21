"use client";

import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { expenseCategoryOf, loanNumberOfCategory } from "@/common/hooks/use-expense-category-ids";
import { MODE_LEDGER_ROUTE } from "@/modules/cash/services/cashService";
import { type CashMovementView } from "@/modules/cash/types/cash-types";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { isLoanSource } from "@/modules/cash/services/cashSourceService";

// Matches "Bank pledge — <bank> — LN-00007" so the loan number (already in Ref No) is dropped from the row.
const BANK_PLEDGE_RE = /^(Bank pledge(?: release)?) — (.+) — (?:LN|PL|INV)-\S+$/;

export function particularsFor(m: CashMovementView, categoryIds: Record<string, number>) {
  const pledge = m.purpose ? BANK_PLEDGE_RE.exec(m.purpose) : null;
  if (pledge) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1.3 }}>
        <span>{pledge[1]}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{pledge[2]}</span>
      </span>
    );
  }
  // A gold-loan repayment (source "Collection", LN- reference) reads "Gold Loan".
  const source = m.source === "Collection" && loanNumberFor(m).startsWith("LN-") ? "Gold Loan" : m.source;
  const text = m.type === "in" && m.source !== "Self Transfer" ? (m.purpose ? `${source} · ${m.purpose}` : source) : m.purpose || "—";
  if (m.source === "Self Transfer" && m.bankId) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", verticalAlign: "middle", flexWrap: "wrap", gap: 6 }}>
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
  // A loan-sourced Add Cash entry links to that loan's own ledger via its same-named repayment category.
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

// Pulls the loan number out of a "… — LN-00049" purpose suffix; "" when there's none.
const LOAN_NUMBER_RE = /—\s*((?:LN|PL|INV)-\S+)\s*$/;
export function loanNumberFor(m: CashMovementView): string {
  const match = m.purpose ? LOAN_NUMBER_RE.exec(m.purpose) : null;
  return match?.[1] || "";
}

const SELF_TRANSFER_PREFIX = "Self transfer — ";
export function selfTransferCategory(purpose?: string): string {
  return purpose && purpose.startsWith(SELF_TRANSFER_PREFIX) ? purpose.slice(SELF_TRANSFER_PREFIX.length).trim() : "";
}

export function refCellFor(m: CashMovementView, categoryIds?: Record<string, number>) {
  if (m.source === "Self Transfer") {
    const cat = selfTransferCategory(m.purpose);
    const id = cat && isLoanSource(cat) ? categoryIds?.[cat.toLowerCase()] : undefined;
    return id ? <LedgerRefLink kind="category" id={id} label={loanNumberOfCategory(cat) || cat} /> : "—";
  }
  // A repayment booked as an expense on a bank loan reads as the loan's number, not the bank paid from.
  const expenseCat = expenseCategoryOf(m.purpose);
  if (expenseCat && isLoanSource(expenseCat)) {
    const loanId = categoryIds?.[expenseCat.toLowerCase()];
    const number = loanNumberOfCategory(expenseCat) || expenseCat;
    if (loanId) return <LedgerRefLink kind="category" id={loanId} label={number} />;
    return number;
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

export function refTitleFor(m: CashMovementView): string {
  const category =
    m.source === "Self Transfer" ? selfTransferCategory(m.purpose)
    : expenseCategoryOf(m.purpose) ?? (m.type === "in" && m.source ? m.source : "");
  if (category && isLoanSource(category)) {
    const number = loanNumberOfCategory(category);
    if (number) return number;
  }
  return m.bankName || loanNumberFor(m);
}

export function modeCellFor(mode: string | undefined) {
  if (!mode) return "—";
  const route = MODE_LEDGER_ROUTE[mode];
  return route ? <ModeLink route={route} mode={mode} /> : mode;
}

type ModeLinkProps = { route: string; mode: string };

function ModeLink({ route, mode }: ModeLinkProps) {
  const canOpen = useCanOpenRoute();
  return canOpen(route) ? <a href={routeHref(route)}>{mode}</a> : <>{mode}</>;
}

export function loanCatRef(r: { type: string; reference?: string; description?: string }, categoryIds: Record<string, number>) {
  const expenseCat = expenseCategoryOf(r.description);
  if (expenseCat && isLoanSource(expenseCat)) {
    const loanId = categoryIds[expenseCat.toLowerCase()];
    const number = loanNumberOfCategory(expenseCat) || expenseCat;
    return loanId ? <LedgerRefLink kind="category" id={loanId} label={number} /> : number;
  }
  if (r.type === "Self Transfer") {
    const cat = selfTransferCategory(r.description);
    const catId = cat && isLoanSource(cat) ? categoryIds[cat.toLowerCase()] : undefined;
    return catId ? <LedgerRefLink kind="category" id={catId} label={loanNumberOfCategory(cat) || cat} /> : "—";
  }
  const id = r.type && isLoanSource(r.type) ? categoryIds[r.type.toLowerCase()] : undefined;
  return id && r.reference ? <LedgerRefLink kind="category" id={id} label={r.reference} /> : r.reference || "—";
}
