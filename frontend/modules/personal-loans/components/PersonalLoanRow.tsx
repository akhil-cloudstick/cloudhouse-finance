"use client";

import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { BackendPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";

export function PersonalLoanRow({ loan }: { loan: BackendPersonalLoan }) {
  return (
    <tr className="click" onClick={() => { location.hash = "personalloan/" + loan.id; }}>
      <td><span className="id">{loan.loanNumber}</span><span className="sub">{loan.customer?.name}</span></td>
      <td className="num">{fmt(loan.principalAmount)}</td>
      <td className="num">{fmt(loan.outstandingAmount)}</td>
      <td>{loan.frequency}</td>
      <td><StatusChip status={loan.status} /></td>
    </tr>
  );
}
