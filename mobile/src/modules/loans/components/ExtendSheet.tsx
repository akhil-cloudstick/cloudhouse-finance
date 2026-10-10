import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Field, Input, PrimaryButton, Sheet, TextField, WarningBanner, toast } from "@/common/components/ui";
import { ExtensionReviewPanel } from "./ExtensionReviewPanel";
import { createExtensionRequest } from "@/modules/loans/services/loanService";
import { dmy, inr } from "@/common/utils/format";
import type { Loan, LoanRequest } from "@/modules/loans/types/loan-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";

type ExtendSheetProps = {
  loan: Loan;
  pending?: LoanRequest;
  visible: boolean;
  onClose: () => void;
};

/** Prototype #act-extend — request a tenure extension; once one is Pending,
 * the sheet shows the review (stage approve / reject) instead. */
export function ExtendSheet({
  loan: l,
  pending,
  visible,
  onClose,
}: ExtendSheetProps) {
  const qc = useQueryClient();
  // Free-text month count (was a fixed 1/2/3/6/12 dropdown) — kept as a
  // string while editing so the field can be legitimately empty mid-type,
  // parsed/validated only on submit. The backend already accepts any
  // positive integer (ExtensionRequestInput.Months), so this needed no
  // backend change.
  const [monthsText, setMonthsText] = useState("1");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Guards against a fast double-tap creating two duplicate requests (the
  // button's disabled state only lands on the next render).
  const submitting = useRef(false);

  useEffect(() => {
    if (visible) {
      setMonthsText("1");
      setDetail("");
      setError(null);
    }
  }, [visible]);

  const oi = l.outstandingInterest ?? 0;
  const penal = l.outstandingPenalInterest ?? 0;
  const blocked = oi > 0.01 || penal > 0.01;
  const months = Math.trunc(Number(monthsText));
  const monthsValid = monthsText.trim() !== "" && Number.isFinite(months) && months > 0 && months <= 60;

  const request = useMutation({
    mutationFn: async () => {
      if (submitting.current) throw new Error("__duplicate_submit__");
      submitting.current = true;
      try {
        return await createExtensionRequest(l.id, { months, detail: detail.trim() || undefined, requestedBy: "Staff" });
      } finally {
        submitting.current = false;
      }
    },
    onSuccess: (r) => {
      invalidateLoan(qc, l.id);
      // With the tenant's "loan_extension" flow off the request is approved
      // (and the loan extended) as soon as it is raised.
      if (r?.status === "Approved") toast.success("Loan extended", `+${months} month${months === 1 ? "" : "s"} on ${l.loanNumber}`);
      else toast.success("Extension submitted for approval");
      onClose();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "__duplicate_submit__") return;
      setError(apiErr(e));
    },
  });

  if (pending) {
    return (
      <Sheet visible={visible} onClose={onClose} title={`Review Extension — ${l.loanNumber}`} maxHeightPct={85}>
        <ErrorText>{error}</ErrorText>
        <ExtensionReviewPanel
          request={pending}
          loan={l}
          onSaved={() => {
            setError(null);
            invalidateLoan(qc, l.id);
            onClose();
          }}
          onError={setError}
        />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Extend Loan Tenure">
      {blocked ? (
        <WarningBanner>
          Outstanding interest {inr(oi)}
          {penal > 0.01 ? ` + penal interest ${inr(penal)}` : ""} must be paid before an extension can be requested — use Collect Payment first.
        </WarningBanner>
      ) : null}
      <Field label="Current due date">
        <Input value={dmy(l.dueDate)} editable={false} />
      </Field>
      <Field label="Extend by (months)">
        <Input
          value={monthsText}
          onChangeText={setMonthsText}
          keyboardType="number-pad"
          placeholder="e.g. 3"
        />
      </Field>
      {!monthsValid && monthsText.trim() !== "" ? <ErrorText>Enter a whole number of months (1–60).</ErrorText> : null}
      <TextField label="Reason" placeholder="e.g. customer requested extension" value={detail} onChangeText={setDetail} />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Confirm Extension"
        onPress={() => {
          setError(null);
          request.mutate();
        }}
        loading={request.isPending}
        disabled={blocked || !monthsValid}
      />
    </Sheet>
  );
}
