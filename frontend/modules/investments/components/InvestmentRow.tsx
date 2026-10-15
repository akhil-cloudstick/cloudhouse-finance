"use client";

import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import type { BackendInvestment } from "@/modules/investments/types/investment-types";
import { navigate } from "@/common/services/appRoutes";

type InvestmentRowProps = { investment: BackendInvestment };

export function InvestmentRow({ investment }: InvestmentRowProps) {
  return (
    <tr className="click" onClick={() => { navigate("investment/" + investment.id); }}>
      <td data-label="Investment / Investor"><span className="id">{investment.investmentNumber}</span><span className="sub">{investment.customer?.name}</span></td>
      <td className="num" data-label="Principal">{fmt(investment.principalAmount)}</td>
      <td data-label="Rate">{investment.interestRatePercent}% {investment.payoutFrequency}</td>
      <td data-label="Maturity">{fmtDate(investment.maturityDate)}</td>
      <td data-label="Status"><StatusChip status={investment.status} /></td>
    </tr>
  );
}
