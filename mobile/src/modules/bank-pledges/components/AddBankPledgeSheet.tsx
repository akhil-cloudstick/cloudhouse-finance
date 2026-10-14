import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet } from "@/common/components/ui";
import { ApiError } from "@/common/services/httpClient";
import { recordBankPledge } from "@/modules/bank-pledges/services/bankPledgeService";
import { todayISO } from "@/common/utils/format";
import { BankPledgeForm, bankPledgeFormInit, cashInPayload } from "@/common/components/BankPledgeForm";
import { invalidateBankPledgeViews } from "./bankPledgeViews";

type AddBankPledgeSheetProps = { visible: boolean; onClose: () => void };

export function AddBankPledgeSheet({ visible, onClose }: AddBankPledgeSheetProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => bankPledgeFormInit());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setForm(bankPledgeFormInit());
    setError(null);
  }, [visible]);

  const save = useMutation({
    mutationFn: () =>
      recordBankPledge(form.loan!.id, {
        bankId: form.bankId,
        bankName: form.bankName,
        pledgedAmount: Number(form.amount),
        pledgeDate: form.pledgeDate || todayISO(),
        bankInterestRate: form.rate ? Number(form.rate) : undefined,
        referenceNumber: form.reference.trim() || undefined,
        bankPledgeDueDate: form.dueDate || undefined,
        cashTreatment: form.cash,
        ...cashInPayload(form),
      }),
    onSuccess: () => {
      invalidateBankPledgeViews(qc);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not add the bank pledge."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="Add to Bank Pledge" maxHeightPct={88}>
      <BankPledgeForm value={form} onChange={setForm} error={error} onSubmit={() => save.mutate()} submitting={save.isPending} />
    </Sheet>
  );
}
