import { AccRow } from "@/common/components/ui";
import { dmy, inr } from "@/common/utils/format";
import type { CashMovement } from "@/modules/cash/types/cash-types";
import { billDetail, expenseCategoryOf, modeLink, openLedger, openLoanByNumber } from "./LedgerList";
import { LedgerLink } from "./LedgerLink";

// loanRefFor pulls the loan number back out of `purpose` — every
// loan-related movement's Purpose carries it as a "… — LN-00049" suffix
// (see cash.MovementService.RecordLoanDisbursementCashOut/
// RecordLoanPaymentCashIn/etc) — same regex web's Cash.tsx uses. "" for a
// movement with no loan number (manual top-ups, expenses, gold sales, …) —
// the internal transaction group id / movement id is never shown as a Ref No.
const LOAN_NUMBER_RE = /—\s*(LN-\S+)\s*$/;
function loanRefFor(m: CashMovement): string {
  const match = m.purpose ? LOAN_NUMBER_RE.exec(m.purpose) : null;
  return match?.[1] || "";
}
const SELF_TRANSFER_PREFIX = "Self transfer — ";
function selfTransferCategory(purpose?: string): string {
  return purpose && purpose.startsWith(SELF_TRANSFER_PREFIX) ? purpose.slice(SELF_TRANSFER_PREFIX.length).trim() : "";
}
type MovementRowProps = {
  m: CashMovement;
  balance: number;
  categoryIds: Record<string, number>;
  defaultOpen?: boolean;
};

/** One movement: amount, purpose, in/out, and its Date / Ref / Mode / Debit /
 * Credit / Balance plus links to the loan, bank, customer and category. */
export function MovementRow({
  m,
  balance,
  categoryIds,
  defaultOpen,
}: MovementRowProps) {
  const ref = loanRefFor(m);
  const bankName = m.bankRef?.name || m.bank || "Bank";
  // A self transfer reads "Self transfer — <category>"; a loan category links
  // to that loan's own ledger, same as web.
  const isSelf = m.source === "Self Transfer";
  const category = isSelf ? selfTransferCategory(m.purpose) || null : expenseCategoryOf(m.purpose);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  // Ref No: an expense (incl. a loan repayment) or a loan-sourced Add Cash
  // shows its bank — blank when it has none; a gold-loan number links to the
  // loan; everything else is blank.
  const bankBacked = m.expenseId != null || category !== null || (m.type === "in" && m.source?.trim().toLowerCase().startsWith("loan"));
  const refValue = isSelf
    ? categoryId
      ? <LedgerLink label={category!} to="/cash" onPress={() => openLedger("category", categoryId, category!)} />
      : "—"
    : bankBacked
    ? m.bankId
      ? <LedgerLink label={bankName} to="/cash" onPress={() => openLedger("bank", m.bankId!, bankName)} />
      : m.bankRef?.name || m.bank || "—"
    : ref
      ? <LedgerLink label={ref} to="/loans" onPress={() => openLoanByNumber(ref)} />
      : "—";
  return (
    <AccRow
      defaultOpen={defaultOpen}
      name={inr(m.amount)}
      sub={m.purpose || m.source}
      status={m.type === "in" ? "Cash in" : "Cash out"}
      statusTone={m.type === "in" ? "active" : "due"}
      details={[
        { k: "Date", v: dmy(m.occurredOn) },
        { k: "Ref No", v: refValue },
        { k: "Mode", v: modeLink(m.mode) },
        { k: "Debit", v: m.type === "out" ? inr(m.amount) : "—" },
        { k: "Credit", v: m.type === "in" ? inr(m.amount) : "—" },
        { k: "Balance", v: inr(balance) },
        m.bankId
          ? { k: "Bank", v: <LedgerLink label={bankName} to="/cash" onPress={() => openLedger("bank", m.bankId!, bankName)} /> }
          : m.bank
            ? { k: "Bank", v: m.bank }
            : { k: "Branch", v: m.branch?.name || "—" },
        ...(m.partyCustomerId
          ? [{ k: "Customer", v: <LedgerLink label={m.partyCustomer?.name || "Customer"} to="/cash" onPress={() => openLedger("customer", m.partyCustomerId!, m.partyCustomer?.name || "Customer")} /> }]
          : []),
        ...(categoryId ? [{ k: "Category", v: <LedgerLink label={category!} to="/cash" onPress={() => openLedger("category", categoryId, category!)} /> }] : []),
        ...(m.status ? [{ k: "Status", v: m.status }] : []),
        ...billDetail(m.receiptImage),
      ]}
    />
  );
}
