import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, CheckItem, NoticeBanner, PrimaryButton, ResultBox, Sheet, TextField, Txt, WarningBanner } from "@/common/components/ui";
import { ReleaseReviewPanel } from "./ReleaseReviewPanel";
import { completeRelease, createReleaseRequest } from "@/modules/loans/services/loanService";
import { inr } from "@/common/utils/format";
import type { Loan, LoanRequest } from "@/modules/loans/types/loan-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";

type ReleaseSheetProps = {
  loan: Loan;
  pending?: LoanRequest;
  visible: boolean;
  onClose: () => void;
};

/** Prototype #act-release — unified partial / full release via per-ornament
 * checkboxes. While a release request is Pending the sheet shows its review
 * (ReleaseReviewPanel); once the loan is "Closure Requested" it offers
 * Complete Release. */
export function ReleaseSheet({
  loan: l,
  pending,
  visible,
  onClose,
}: ReleaseSheetProps) {
  const qc = useQueryClient();
  // Ornaments picked for release; null = all still-pledged ones (full release).
  const [selectedIds, setSelectedIds] = useState<number[] | null>(null);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (visible) {
      setSelectedIds(null);
      setDetail("");
      setError(null);
    }
  }, [visible]);

  const pledged = (l.ornaments ?? []).filter((o) => !o.releasedAt);
  const selected = new Set(selectedIds ?? pledged.map((o) => o.id));
  const allSelected = selected.size === pledged.length;
  const ltv = l.schemeLtvPercent ?? l.scheme?.ltvPercent ?? 0;
  const outstandingBal = l.totalOutstandingBalance ?? l.outstandingAmount;
  const remainingGold = pledged.filter((o) => !selected.has(o.id)).reduce((s, o) => s + o.goldValue, 0);
  // Web's partialReleaseRemaining: balance + 5% principal buffer − what the remaining gold covers.
  const minPartial = outstandingBal + 0.05 * l.principalAmount - (remainingGold * ltv) / 100;
  const minAmount = allSelected ? l.settlementAmount ?? outstandingBal : Math.max(0, minPartial);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(Array.from(next));
  }

  const request = useMutation({
    mutationFn: async () => {
      if (submitting.current) throw new Error("__duplicate_submit__");
      submitting.current = true;
      try {
        const ornamentIds = Array.from(selected);
        return await createReleaseRequest(l.id, {
          detail: detail.trim() || (allSelected ? "Full settlement requested" : "Partial release requested"),
          requestedBy: "Staff",
          ornamentIds,
        });
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

  const complete = useMutation({
    mutationFn: () => completeRelease(l.id),
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      onClose();
    },
    onError: (e) => setError(apiErr(e)),
  });

  if (l.status === "Closure Requested") {
    const unpaid = (l.totalOutstandingBalance ?? 0) > 0.01;
    const bankPledged = l.bankPledgeStatus === "Bank Pledged";
    return (
      <Sheet visible={visible} onClose={onClose} title="Complete Release">
        {unpaid ? (
          <WarningBanner>Final settlement must be fully paid before this loan can be released.</WarningBanner>
        ) : bankPledged ? (
          <WarningBanner>This loan&apos;s ornament is still pledged to a bank — release it from the bank pledge before completing the release.</WarningBanner>
        ) : (
          <NoticeBanner>Ready to complete — hands the gold back and closes the loan.</NoticeBanner>
        )}
        <ResultBox k="Balance outstanding" v={inr(l.totalOutstandingBalance ?? 0)} tone={unpaid ? "red" : "green"} />
        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          label="Complete Release"
          loading={complete.isPending}
          onPress={() => {
            // Gates explained on press (not a silently disabled button); the backend enforces both regardless.
            if (unpaid) return setError("Final settlement must be fully paid before this loan can be released.");
            if (bankPledged) return setError("This loan's ornament is still pledged to a bank — release the ornament from the bank pledge before completing the release.");
            setError(null);
            complete.mutate();
          }}
        />
      </Sheet>
    );
  }

  if (pending) {
    return (
      <Sheet visible={visible} onClose={onClose} title={`Review Release — ${l.loanNumber}`} maxHeightPct={92}>
        {/* A release is already pending — no new request form, so the same gold can't be requested twice. */}
        <NoticeBanner>Release requested — waiting for approval</NoticeBanner>
        <ErrorText>{error}</ErrorText>
        <ReleaseReviewPanel
          request={pending}
          loan={l}
          onSaved={() => {
            setError(null);
            invalidateLoan(qc, l.id);
          }}
          onError={setError}
        />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Gold Release">
      <Txt style={{ fontSize: 11.5, fontWeight: "700", color: C.muted, marginTop: 8, marginBottom: 10 }}>
        Ornaments to release — {selected.size} of {pledged.length}
      </Txt>
      {pledged.map((o) => (
        <CheckItem
          key={o.id}
          checked={selected.has(o.id)}
          onPress={() => toggle(o.id)}
          title={o.name}
          sub={`${o.netWeight.toFixed(2)} g · ${o.purity} · ${inr(o.goldValue)}`}
        />
      ))}
      <ResultBox
        style={{ marginTop: 8 }}
        k="Minimum amount to release"
        v={inr(minAmount)}
        tone={allSelected || minAmount > 0.01 ? "brand" : "green"}
      />
      <TextField label="Note (optional)" placeholder="Add a note" value={detail} onChangeText={setDetail} />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={allSelected ? "Request Full Release" : "Request Partial Release"}
        onPress={() => {
          setError(null);
          request.mutate();
        }}
        loading={request.isPending}
        disabled={selected.size === 0}
      />
    </Sheet>
  );
}
