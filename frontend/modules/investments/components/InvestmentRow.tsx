"use client";

import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { BackendInvestment } from "@/modules/investments/types/investment-types";
import { navigate } from "@/common/services/appRoutes";

type InvestmentRowProps = { investment: BackendInvestment };

export function InvestmentRow({ investment }: InvestmentRowProps) {
  return (
    <tr className="click" onClick={() => { navigate("investment/" + investment.id); }}>
      <td><span className="id">{investment.investmentNumber}</span><span className="sub">{investment.customer?.name}</span></td>
      <td className="num">{fmt(investment.principalAmount)}</td>
      <td>{investment.interestRatePercent}% {investment.payoutFrequency}</td>
      <td>{fmtDate(investment.maturityDate)}</td>
      <td><StatusChip status={investment.status} /></td>
    </tr>
  );
}
