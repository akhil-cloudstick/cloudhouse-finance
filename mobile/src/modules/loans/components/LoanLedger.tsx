import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getLoanLedger } from "@/modules/loans/services/loanService";
import { AccBtn, AccGroup, AccRow, C, EmptyText, type AccDetail, type ChipTone } from "@/common/components/ui";
import { dmy, inr } from "@/common/utils/format";
import type { Loan, LoanTopUp } from "@/modules/loans/types/loan-types";

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

type ChargeEntry = { key: string; kind: string; date: string; amount: number; note?: string };

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

type Part = { mode: string; amount: number; index: number; count: number };

/** A split payment/payout's per-mode shares, or [] when it used one mode. */
function splitParts(r: { cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number }): Part[] {
  const modes = (
    [
      ["Cash", r.cashAmount ?? 0],
      ["UPI", r.upiAmount ?? 0],
      ["Bank Transfer", r.bankTransferAmount ?? 0],
      ["Cheque", r.chequeAmount ?? 0],
    ] as const
  ).filter(([, amount]) => amount > 0);
  return modes.length > 1 ? modes.map(([mode, amount], index) => ({ mode, amount, index, count: modes.length })) : [];
}

const partNote = (p: Part, total: number) => `Split ${p.index + 1} of ${p.count} · total ${inr(total)}`;

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
 * the backend records against each payment. A payment, payout or top-up
 * split across modes is one row per mode (the way the Cash/UPI/Bank ledgers
 * book it), each with the balance after that share. The loan's
 * "Disbursement" payment only carries the payout's mode split — the same
 * event as the sanction row, so it splits that row instead of showing again
 * as a credit. */
export function buildLedger(l: Loan, topUps: LoanTopUp[], charges: ChargeEntry[] = []): Entry[] {
  const rows: Entry[] = [];

  // Server-computed interest / penal-interest charges: debit rows with no
  // running balance. Any other (unknown) kind is ignored.
  for (const c of charges) {
    if (c.kind !== "interest" && c.kind !== "penal") continue;
    if (!c.date || !(Number(c.amount) > 0)) continue;
    rows.push({
      key: c.key || `${c.kind}-${c.date}`,
      sortKey: c.date,
      date: c.date,
      title: c.kind === "penal" ? "Penal Interest Charged" : "Interest Charged",
      sub: c.note || undefined,
      debit: Number(c.amount),
      split: [],
    });
  }
  const payments = l.payments ?? [];
  const disbursement = payments.find((p) => p.type === "Disbursement");

  if (l.disbursementDate) {
    const withheld = (l.sanctionedAmount ?? 0) - (l.disbursedAmount ?? 0);
    const disbursed = l.disbursedAmount ?? l.principalAmount;
    const sanctioned = l.sanctionedAmount || l.principalAmount;
    const sanction: Entry = {
      key: "sanction",
      // The bare date sorts ahead of any same-day timestamp; sort is stable
      // for an equal key, and this row goes in first.
      sortKey: l.disbursementDate.slice(0, 10),
      date: l.disbursementDate,
      title: "Loan sanctioned",
      sub: withheld > 0.004 ? `${inr(withheld)} withheld as service charge` : "Disbursed",
      debit: disbursed,
      balance: sanctioned,
      method: disbursement ? paymentMethod(disbursement) || undefined : undefined,
      split:
        withheld > 0.004
          ? [
              { k: "Sanctioned", v: inr(l.sanctionedAmount) },
              { k: "Withheld", v: inr(withheld) },
            ]
          : [],
    };
    const parts = disbursement ? splitParts(disbursement) : [];
    if (parts.length === 0) rows.push(sanction);
    let later = parts.reduce((sum, pt) => sum + pt.amount, 0);
    for (const pt of parts) {
      later -= pt.amount;
      rows.push({
        ...sanction,
        key: `sanction-${pt.mode}`,
        sub: [pt.mode, partNote(pt, disbursed)].join(" · "),
        debit: pt.amount,
        balance: sanctioned - later,
        method: pt.mode,
        split: pt.index === 0 ? sanction.split : [],
      });
    }
  }

  for (const t of topUps) {
    // A top-up still in (or turned down by) the approval chain never paid
    // anything out — it's shown on the loan page's pending card instead.
    if (t.status === "Pending" || t.status === "Rejected") continue;
    const modes = modeSplit(t);
    const reversed = t.status === "Reversed";
    const topUp: Entry = {
      key: `topup-${t.id}`,
      sortKey: t.occurredOn,
      date: t.occurredOn,
      title: reversed ? "Loan top-up (reversed)" : "Loan top-up",
      sub: [modes, t.reference ? `Ref ${t.reference}` : ""].filter(Boolean).join(" · ") || undefined,
      debit: t.amount,
      method: modes || undefined,
      reference: t.reference || undefined,
      split: [{ k: "Eligible at top-up", v: inr(t.eligibleAmountAtTopUp) }],
    };
    const parts = splitParts(t);
    if (parts.length === 0) rows.push(topUp);
    for (const pt of parts) {
      rows.push({
        ...topUp,
        key: `topup-${t.id}-${pt.mode}`,
        sub: [pt.mode, partNote(pt, t.amount), t.reference ? `Ref ${t.reference}` : ""].filter(Boolean).join(" · "),
        debit: pt.amount,
        method: pt.mode,
        split: pt.index === 0 ? topUp.split : [],
      });
    }
  }

  for (const p of payments) {
    if (p.type === "Disbursement") continue;
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
    const payment: Entry = {
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
    };
    const parts = nonCash ? [] : splitParts(p);
    if (parts.length === 0) rows.push(payment);
    let later = parts.reduce((sum, pt) => sum + pt.amount, 0);
    for (const pt of parts) {
      later -= pt.amount;
      rows.push({
        ...payment,
        key: `pay-${p.id}-${pt.mode}`,
        sub: [pt.mode, partNote(pt, p.amount), p.reference ? `Ref ${p.reference}` : ""].filter(Boolean).join(" · "),
        credit: pt.amount,
        balance: p.runningBalance + later,
        method: pt.mode,
        // The allocation breakdown is the whole payment's — shown once.
        split: pt.index === 0 ? split : [],
      });
    }
  }

  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function chipFor(e: Entry): { label: string; tone: ChipTone } {
  if (e.debit != null) return { label: "Debit", tone: "overdue" };
  if (e.nonCash) return { label: "Non-cash", tone: "info" };
  return { label: "Credit", tone: "active" };
}

type LoanLedgerProps = { loan: Loan; topUps: LoanTopUp[] };

/** Payment Ledger tab of the loan page — one Loans-list-style accordion row
 * (AccRow) per entry: the date where a loan ID would sit, the amount with a
 * Debit/Credit chip, opening to the web table's columns plus the split. */
export function LoanLedger({ loan, topUps }: LoanLedgerProps) {
  // Interest / penal charge rows come from the server ledger; a failed or
  // slow fetch just leaves them out.
  const charges = useQuery({ queryKey: ["loanLedgerCharges", loan.id], queryFn: () => getLoanLedger(loan.id, { limit: 500, offset: 0 }), retry: false });
  const entries = buildLedger(loan, topUps, charges.data?.items ?? []);
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
