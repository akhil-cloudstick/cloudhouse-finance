import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Field, Input, PrimaryButton, Sheet, TextField, ThemeDropdown, WarningBanner } from "../../ui";
import { ExtensionReviewPanel } from "../../loanRequests/ExtensionReviewPanel";
import { createExtensionRequest } from "../../../api/loans";
import { dmy, inr } from "../../../lib/format";
import type { Loan, LoanRequest } from "../../../types/loan";
import { ErrorText, apiErr, invalidateLoan } from "./common";

const EXTEND_OPTIONS = [1, 2, 3, 6, 12];

/** Prototype #act-extend — request a tenure extension; once one is Pending,
 * the sheet shows the review (stage approve / reject) instead. */
export function ExtendSheet({
  loan: l,
  pending,
  visible,
  onClose,
}: {
  loan: Loan;
  pending?: LoanRequest;
  visible: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [months, setMonths] = useState(1);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Guards against a fast double-tap creating two duplicate requests (the
  // button's disabled state only lands on the next render).
  const submitting = useRef(false);

  useEffect(() => {
    if (visible) {
      setMonths(1);
      setDetail("");
      setError(null);
    }
  }, [visible]);

  const oi = l.outstandingInterest ?? 0;
  const penal = l.outstandingPenalInterest ?? 0;
  const blocked = oi > 0.01 || penal > 0.01;

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
    onSuccess: () => {
      invalidateLoan(qc, l.id);
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
      <Field label="Extend by">
        <ThemeDropdown value={months} options={EXTEND_OPTIONS} onChange={setMonths} labelOf={(m) => `${m} month${m === 1 ? "" : "s"}`} />
      </Field>
      <TextField label="Reason" placeholder="e.g. customer requested extension" value={detail} onChangeText={setDetail} />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Confirm Extension"
        onPress={() => {
          setError(null);
          request.mutate();
        }}
        loading={request.isPending}
        disabled={blocked}
      />
    </Sheet>
  );
}
