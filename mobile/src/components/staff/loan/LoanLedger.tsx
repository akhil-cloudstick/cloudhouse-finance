import React, { useState } from "react";
import { View } from "react-native";
import { AccBtn, AccGroup, AccRow, C, EmptyText, type AccDetail, type ChipTone } from "../../ui";
import { dmy, inr } from "../../../lib/format";
import type { Loan, LoanTopUp } from "../../../types/loan";

type Payment = NonNullable<Loan["payments"]>[number];

type Entry = {
  key: string;
  sortKey: string;
  date: string;
  title: string;
  sub?: string;
  debit?: number;
  credit?: number;
  /** Non-cash credit (Waiver / Adjustment) — reduces what's owed, no money moved. */
  nonCash?: boolean;
  balance?: number;
  method?: string;
  reference?: string;
  split: AccDetail[];
};

const PAGE = 10;

function modeSplit(r: { cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number }) {
  return [
    (r.cashAmount ?? 0) > 0 && `Cash ${inr(r.cashAmount)}`,
    (r.upiAmount ?? 0) > 0 && `UPI ${inr(r.upiAmount)}`,
    (r.bankTransferAmount ?? 0) > 0 && `Bank Transfer ${inr(r.bankTransferAmount)}`,
    (r.chequeAmount ?? 0) > 0 && `Cheque ${inr(r.chequeAmount)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function paymentMethod(p: Payment) {
  if (p.method) return p.method;
  const modes = [
    ["Cash", p.cashAmount],
    ["UPI", p.upiAmount],
    ["Bank Transfer", p.bankTransferAmount],
    ["Cheque", p.chequeAmount],
  ].filter(([, v]) => ((v as number) ?? 0) > 0);
  return modes.length > 1 ? "Split" : modes.length === 1 ? (modes[0][0] as string) : "";
}

/** The Payment Ledger's rows — mirrors the web LoanDetail's "Payment Ledger"
 * table: the sanction/disbursement, then every top-up (a further debit) and
 * payment (a credit) in date order, oldest first, with the running balance
 * the backend records against each payment. */
export function buildLedger(l: Loan, topUps: LoanTopUp[]): Entry[] {
  const rows: Entry[] = [];

  if (l.disbursementDate) {
    const withheld = (l.sanctionedAmount ?? 0) - (l.disbursedAmount ?? 0);
    rows.push({
      key: "sanction",
      // The bare date sorts ahead of any same-day timestamp; sort is stable
      // for an equal key, and this row goes in first.
      sortKey: l.disbursementDate.slice(0, 10),
      date: l.disbursementDate,
      title: "Loan sanctioned",
      sub: withheld > 0.004 ? `${inr(withheld)} withheld as service charge` : "Disbursed",
      debit: l.disbursedAmount ?? l.principalAmount,
      balance: l.sanctionedAmount || l.principalAmount,
      split:
        withheld > 0.004
          ? [
              { k: "Sanctioned", v: inr(l.sanctionedAmount) },
              { k: "Withheld", v: inr(withheld) },
            ]
          : [],
    });
  }

  for (const t of topUps) {
    // A top-up still in (or turned down by) the approval chain never paid
    // anything out — it's shown on the loan page's pending card instead.
    if (t.status === "Pending" || t.status === "Rejected") continue;
    const modes = modeSplit(t);
    const reversed = t.status === "Reversed";
    rows.push({
      key: `topup-${t.id}`,
      sortKey: t.occurredOn,
      date: t.occurredOn,
      title: reversed ? "Loan top-up (reversed)" : "Loan top-up",
      sub: [modes, t.reference ? `Ref ${t.reference}` : ""].filter(Boolean).join(" · ") || undefined,
      debit: t.amount,
      method: modes || undefined,
      reference: t.reference || undefined,
      split: [{ k: "Eligible at top-up", v: inr(t.eligibleAmountAtTopUp) }],
    });
  }

  for (const p of l.payments ?? []) {
    // Interest/Principal/Partial/Full Settlement/Waiver all reduce what's
    // owed (a credit); Waiver/Adjustment move no money (web: "Non-cash").
    const nonCash = p.type === "Adjustment" || p.type === "Waiver";
    const method = nonCash ? "Non-cash" : paymentMethod(p);
    const split: AccDetail[] = [];
    if (p.processingFeeApplied > 0) split.push({ k: "Fee", v: inr(p.processingFeeApplied) });
    if (p.penalInterestApplied > 0) split.push({ k: "Penal", v: inr(p.penalInterestApplied) });
    if (p.interestApplied > 0) split.push({ k: "Interest", v: inr(p.interestApplied) });
    if (p.principalApplied > 0) split.push({ k: "Principal", v: inr(p.principalApplied) });
    if (p.processingFee > 0) split.push({ k: "Fee charged", v: `+${inr(p.processingFee)}`, color: C.red });
    rows.push({
      key: `pay-${p.id}`,
      sortKey: p.paidOn || p.createdAt,
      date: p.paidOn || p.createdAt,
      title: p.type,
      sub: [method, p.reference ? `Ref ${p.reference}` : "", p.processingFee > 0 ? `+${inr(p.processingFee)} fee` : ""].filter(Boolean).join(" · ") || undefined,
      credit: p.amount,
      nonCash,
      balance: p.runningBalance,
      method: method || undefined,
      reference: p.reference || undefined,
      split,
    });
  }

  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function chipFor(e: Entry): { label: string; tone: ChipTone } {
  if (e.debit != null) return { label: "Debit", tone: "overdue" };
  if (e.nonCash) return { label: "Non-cash", tone: "info" };
  return { label: "Credit", tone: "active" };
}

/** Payment Ledger tab of the loan page — one Loans-list-style accordion row
 * (AccRow) per entry: the date where a loan ID would sit, the amount with a
 * Debit/Credit chip, opening to the web table's columns plus the split. */
export function LoanLedger({ loan, topUps }: { loan: Loan; topUps: LoanTopUp[] }) {
  const entries = buildLedger(loan, topUps);
  // Oldest first; long ledgers start collapsed to the latest PAGE entries.
  const [shown, setShown] = useState(PAGE);
  const hidden = Math.max(0, entries.length - shown);
  const visible = entries.slice(hidden);
  if (entries.length === 0) {
    return (
      <View style={{ paddingHorizontal: 18 }}>
        <EmptyText>No ledger entries yet.</EmptyText>
      </View>
    );
  }
  return (
    <View style={{ paddingHorizontal: 18 }}>
      {hidden > 0 ? <AccBtn label={`Show ${Math.min(PAGE, hidden)} earlier (${hidden} more)`} onPress={() => setShown((s) => s + PAGE)} style={{ marginBottom: 10 }} /> : null}
      <AccGroup>
        {visible.map((e, i) => {
          const chip = chipFor(e);
          const isDebit = e.debit != null;
          const details: AccDetail[] = [
            { k: "Date", v: dmy(e.date) },
            { k: "Description", v: e.title },
            { k: "Debit", v: isDebit ? inr(e.debit) : "—", color: isDebit ? C.red : C.muted },
            { k: "Credit", v: isDebit ? "—" : inr(e.credit), color: isDebit ? C.muted : C.green },
            { k: "Method", v: e.method ?? "—" },
            { k: "Reference", v: e.reference ?? "—" },
            ...e.split,
            { k: "Running balance", v: e.balance != null ? inr(e.balance) : "—", color: C.brandDeep },
          ];
          return (
            <AccRow
              key={e.key}
              defaultOpen={i === visible.length - 1}
              id={dmy(e.date)}
              name={e.title}
              sub={e.sub}
              amount={isDebit ? `−${inr(e.debit)}` : `+${inr(e.credit)}`}
              amountColor={isDebit ? C.red : C.green}
              status={chip.label}
              statusTone={chip.tone}
              details={details}
            />
          );
        })}
      </AccGroup>
    </View>
  );
}
