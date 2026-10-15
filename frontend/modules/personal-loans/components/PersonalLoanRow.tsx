"use client";

import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { BackendPersonalLoan } from "@/modules/personal-loans/types/personal-loan-types";
import { navigate } from "@/common/services/appRoutes";

type PersonalLoanRowProps = { loan: BackendPersonalLoan };

export function PersonalLoanRow({ loan }: PersonalLoanRowProps) {
  return (
    <tr className="click" onClick={() => { navigate("personalloan/" + loan.id); }}>
      <td data-label="Loan / Customer"><span className="id">{loan.loanNumber}</span><span className="sub">{loan.customer?.name}</span></td>
      <td className="num" data-label="Principal">{fmt(loan.principalAmount)}</td>
      <td className="num" data-label="Outstanding">{fmt(loan.outstandingAmount)}</td>
      <td data-label="Frequency">{loan.frequency}</td>
      <td data-label="Status"><StatusChip status={loan.status} /></td>
    </tr>
  );
}
