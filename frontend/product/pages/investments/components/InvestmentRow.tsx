"use client";

import { fmt } from "@/product/utils/format";
import { StatusChip } from "@/product/components/ui/StatusChip";
import type { BackendInvestment } from "@/product/pages/investments/services/investmentService";
import { navigate } from "@/product/services/appRoutes";

export function InvestmentRow({ investment }: { investment: BackendInvestment }) {
  return (
    <tr className="click" onClick={() => { navigate("investment/" + investment.id); }}>
      <td><span className="id">{investment.investmentNumber}</span><span className="sub">{investment.customer?.name}</span></td>
      <td className="num">{fmt(investment.principalAmount)}</td>
      <td>{investment.interestRatePercent}% {investment.payoutFrequency}</td>
      <td>{investment.maturityDate.slice(0, 10)}</td>
      <td><StatusChip status={investment.status} /></td>
    </tr>
  );
}
