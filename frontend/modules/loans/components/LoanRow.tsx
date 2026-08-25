"use client";

import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { LoanView } from "@/modules/loans/services/loanService";

/* Ported from legacy/app.js's `loanRow(l)` — the shared row-builder used by
 * both the Customer 360° loan history table and the Loans page. Now reads
 * a real backend-backed LoanView instead of the mock Loan, which already
 * carries denormalized customer/scheme names — no lookup needed here. */
/* Same precedence LoanDetail.tsx uses for its header chips, collapsed to a
 * single label since this cell only has room for one chip. l.status itself
 * can't be trusted to tell Overdue apart from a paid-off "serviced" loan:
 * GET /loans (List) never calls refreshServicingStatus — only opening a
 * single loan (Get) does (see loan/service.go's List vs accrueAndEnrich) —
 * so the persisted status returned by the list endpoint is often stale
 * "Active" for a loan that crossed its due date only moments ago. isOverdue/
 * isDueSoon/isDefaulted ARE freshly recomputed on every List call (see
 * enrichStatusFlags in loan/accrual.go), so lean on those plus the same
 * arrears check refreshServicingStatus itself uses (outstanding interest or
 * penal interest still owed) rather than the possibly-stale l.status. */
function displayStatus(l: LoanView): string {
  if (l.isDefaulted) return "Defaulted";
  if (l.isOverdue) {
    const inArrears = l.outstandingInterest > 0.01 || l.outstandingPenalInterest > 0.01;
    return inArrears ? "Overdue" : "Active";
  }
  if (l.isDueSoon) return "Due Soon";
  return l.status;
}

export function LoanRow({ loan: l }: { loan: LoanView }) {
  return (
    <tr className="click" onClick={() => { location.hash = "loan/" + l.id; }}>
      <td><span className="id">{l.id}</span><span className="sub">{l.customerName}</span></td>
      <td>{l.schemeName}</td>
      <td>{l.opened}<span className="sub">due {l.due}</span></td>
      <td className="num">{fmt(l.principal)}</td>
      <td className="num">{l.outstanding ? fmt(l.outstanding) : "—"}</td>
      <td><StatusChip status={l.bankPledgeStatus} /></td>
      <td><StatusChip status={displayStatus(l)} /></td>
    </tr>
  );
}
