import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BtnRow2, C, PrimaryButton, Sheet, Txt, WarningBanner } from "@/common/components/ui";
import { ErrorText } from "@/common/components/ErrorText";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { useAuth } from "@/common/providers/AuthProvider";
import { getLoan } from "@/modules/loans/services/loanService";
import { releaseBankPledge } from "@/modules/bank-pledges/services/bankPledgeService";
import { inr } from "@/common/utils/format";

/** Shown in place of the notice / schedule / sale actions while the gold sits with a bank (the server rejects those
 * steps too). Like web's auction card: the message plus "Release from Bank" for who may update bank pledges. The
 * loan is fetched to find its active pledge, then released exactly as the loan's Bank Pledge sheet does. */
export function GoldAtBankBlock({ loanId }: { loanId: number }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canRelease = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const [open, setOpen] = useState(false);
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loan = useQuery({ queryKey: ["loan", String(loanId)], queryFn: () => getLoan(loanId), enabled: open });
  const pledge = loan.data?.bankPledges?.find((p) => p.status === "Active");
  const cashIn = pledge?.cashTreatment === "CashIn";

  const release = useMutation({
    mutationFn: () => releaseBankPledge(loanId, pledge!.id, cashIn && pay ? { ...pay.split, bankId: pay.bankId } : undefined),
    onSuccess: () => {
      setOpen(false);
      invalidateLoan(qc, loanId);
    },
    onError: (e) => setError(apiErr(e)),
  });

  return (
    <>
      <WarningBanner>Gold is pledged to a bank — release it before continuing the auction.</WarningBanner>
      {canRelease ? <PrimaryButton label="Release from Bank" onPress={() => { setError(null); setOpen(true); }} /> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Release from Bank?">
        {loan.isLoading ? null : !pledge ? (
          <Txt style={{ fontSize: 12.5, color: C.muted, marginVertical: 10 }}>No active bank pledge found for this loan.</Txt>
        ) : (
          <>
            <Txt style={{ fontSize: 12.5, color: C.muted, lineHeight: 18, marginVertical: 10 }}>
              {cashIn ? `${inr(pledge.pledgedAmount)} is paid back to ${pledge.bankName ?? "the bank"} — choose how below.` : "This pledge never moved cash, so releasing it has no cash effect."}
            </Txt>
            {cashIn ? <SplitPaymentInput total={pledge.pledgedAmount} onChange={setPay} bankLabel="Bank (account it leaves from)" /> : null}
            <ErrorText>{error}</ErrorText>
            <BtnRow2>
              <PrimaryButton label="Cancel" variant="outline" onPress={() => setOpen(false)} />
              <PrimaryButton label="Release" onPress={() => release.mutate()} loading={release.isPending} disabled={cashIn && !pay?.ready} />
            </BtnRow2>
          </>
        )}
      </Sheet>
    </>
  );
}
