"use client";

import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { LoanView } from "@/modules/loans/types/loan-types";
import { navigate } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";

// l.status from the List endpoint can be stale "Active" past due date; isOverdue/isDueSoon/isDefaulted are always fresh.
function displayStatus(l: LoanView): string {
  if (l.isDefaulted) return "Defaulted";
  if (l.isOverdue) {
    const inArrears = l.outstandingInterest > 0.01 || l.outstandingPenalInterest > 0.01;
    return inArrears ? "Overdue" : "Active";
  }
  if (l.isDueSoon) return "Due Soon";
  return l.status;
}

type LoanRowProps = { loan: LoanView };

export function LoanRow({ loan: l }: LoanRowProps) {
  const canOpen = useCanOpenRoute()("loan");
  return (
    <tr className={canOpen ? "click" : undefined} onClick={canOpen ? () => navigate("loan/" + l.id) : undefined}>
      <td data-label="Loan / Customer"><span className="id">{l.id}</span><span className="sub">{l.customerName}</span></td>
      <td data-label="Scheme">{l.schemeName}</td>
      <td className="td-date" data-label="Opened / Due">{fmtDate(l.opened)}<span className="sub">due {fmtDate(l.due)}</span></td>
      <td className="num" data-label="Principal">{fmt(l.principal)}</td>
      <td className="num" data-label="Outstanding">{l.outstanding ? fmt(l.outstanding) : "—"}</td>
      <td data-label="Pledge"><StatusChip status={l.bankPledgeStatus} /></td>
      <td data-label="Status"><StatusChip status={displayStatus(l)} /></td>
    </tr>
  );
}
