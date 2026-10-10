
import { useQueryClient } from "@tanstack/react-query";

/** Every screen that shows a pledge, the loan's packet or the till. */
export function invalidateBankPledgeViews(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["bankPledges", "bankPledgeHistory", "loan", "loans", "loanPacket", "packet", "packets", "cash-summary", "cash-movements"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}
