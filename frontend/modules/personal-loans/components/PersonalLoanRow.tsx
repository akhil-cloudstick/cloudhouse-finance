"use client";

import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { BackendPersonalLoan } from "@/modules/personal-loans/types/personal-loan-types";
import { navigate } from "@/common/services/appRoutes";

type PersonalLoanRowProps = { loan: BackendPersonalLoan };

export function PersonalLoanRow({ loan }: PersonalLoanRowProps) {
  return (
    <tr className="click" onClick={() => { navigate("personalloan/" + loan.id); }}>
      <td><span className="id">{loan.loanNumber}</span><span className="sub">{loan.customer?.name}</span></td>
      <td className="num">{fmt(loan.principalAmount)}</td>
      <td className="num">{fmt(loan.outstandingAmount)}</td>
      <td>{loan.frequency}</td>
      <td><StatusChip status={loan.status} /></td>
    </tr>
  );
}
