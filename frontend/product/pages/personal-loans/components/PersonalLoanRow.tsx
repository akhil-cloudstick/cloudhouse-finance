"use client";

import { fmt } from "@/product/utils/format";
import { StatusChip } from "@/product/components/ui/StatusChip";
import type { BackendPersonalLoan } from "@/product/pages/personal-loans/services/personalLoanService";
import { navigate } from "@/product/services/appRoutes";

export function PersonalLoanRow({ loan }: { loan: BackendPersonalLoan }) {
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
