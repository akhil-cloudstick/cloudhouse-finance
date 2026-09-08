"use client";

import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { BackendInvestment } from "@/modules/investments/services/investmentService";

export function InvestmentRow({ investment }: { investment: BackendInvestment }) {
  return (
    <tr className="click" onClick={() => { location.hash = "investment/" + investment.id; }}>
      <td><span className="id">{investment.investmentNumber}</span><span className="sub">{investment.customer?.name}</span></td>
      <td className="num">{fmt(investment.principalAmount)}</td>
      <td>{investment.interestRatePercent}% {investment.payoutFrequency}</td>
      <td>{investment.maturityDate.slice(0, 10)}</td>
      <td><StatusChip status={investment.status} /></td>
    </tr>
  );
}
