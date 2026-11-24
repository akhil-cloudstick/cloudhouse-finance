import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, CheckItem, DateField, NoticeBanner, PrimaryButton, ResultBox, Sheet, TextField, Txt, WarningBanner, toast } from "@/common/components/ui";
import { ReleaseReviewPanel } from "./ReleaseReviewPanel";
import { completeRelease, createReleaseRequest } from "@/modules/loans/services/loanService";
import { inr, todayISO } from "@/common/utils/format";
import type { Loan, LoanRequest } from "@/modules/loans/types/loan-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { FieldErr } from "@/common/components/ErrorText";

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
  const [requestedOn, setRequestedOn] = useState(todayISO());
  const [tried, setTried] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (visible) {
      setSelectedIds(null);
      setDetail("");
      setRequestedOn(todayISO());
      setTried(false);
    }
  }, [visible]);

  const pledged = (l.ornaments ?? []).filter((o) => !o.releasedAt);
  const selected = new Set(selectedIds ?? pledged.map((o) => o.id));
  const allSelected = pledged.length > 0 && selected.size === pledged.length;
  const ltv = l.schemeLtvPercent ?? l.scheme?.ltvPercent ?? 0;
  const outstandingBal = l.totalOutstandingBalance ?? l.outstandingAmount;
  const remainingGold = pledged.filter((o) => !selected.has(o.id)).reduce((s, o) => s + o.goldValue, 0);
  // Backend's partialReleaseDrift: balance − what the remaining gold covers.
  const minPartial = outstandingBal - (remainingGold * ltv) / 100;
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
          ornamentIds,
          requestedAt: requestedOn,
        });
      } finally {
        submitting.current = false;
      }
    },
    onSuccess: (created) => {
      invalidateLoan(qc, l.id);
      onClose();
      // The amount the backend worked out when it logged the request; it is checked again when the payment is recorded.
      toast.success("Release request logged", `${inr(created.settlementAmount ?? minAmount)} needed to release the gold`);
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "__duplicate_submit__") return;
      toast.error(apiErr(e));
    },
  });

  const complete = useMutation({
    mutationFn: () => completeRelease(l.id),
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      onClose();
    },
    onError: (e) => toast.error(apiErr(e)),
  });

  if (l.status === "Closure Requested") {
    const unpaid = (l.totalOutstandingBalance ?? 0) > 0.01;
    const bankPledged = l.bankPledgeStatus === "Bank Pledged";
    return (
      <Sheet visible={visible} onClose={onClose} title="Complete Release">
        {unpaid ? (
          <WarningBanner>Final settlement must be fully paid before this loan can be released.</WarningBanner>
        ) : bankPledged ? (
          <WarningBanner>Release bank pledge first.</WarningBanner>
        ) : (
          <NoticeBanner>Ready to complete — hands the gold back and closes the loan.</NoticeBanner>
        )}
        <ResultBox k="Balance outstanding" v={inr(l.totalOutstandingBalance ?? 0)} tone={unpaid ? "red" : "green"} />
        <PrimaryButton
          label="Complete Release"
          loading={complete.isPending}
          onPress={() => {
            // Gates explained on press (not a silently disabled button); the backend enforces both regardless.
            if (unpaid) return toast.error("Final settlement must be fully paid before this loan can be released.");
            if (bankPledged) return toast.error("Release bank pledge first.");
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
        <ReleaseReviewPanel
          request={pending}
          loan={l}
          onSaved={() => {
            invalidateLoan(qc, l.id);
          }}
          onError={(m) => toast.error(m)}
        />
      </Sheet>
    );
  }

  if (pledged.length === 0) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Gold Release">
        <NoticeBanner>Nothing left to release — every ornament on this loan has already been released.</NoticeBanner>
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
      <FieldErr m={tried && selected.size === 0 ? "Select at least one ornament to release." : undefined} />
      <ResultBox
        style={{ marginTop: 8 }}
        k="Minimum amount to release"
        v={inr(minAmount)}
        tone={allSelected || minAmount > 0.01 ? "brand" : "green"}
      />
      <DateField label="Request date" value={requestedOn} onChange={setRequestedOn} min={l.openedDate?.slice(0, 10) || undefined} max={todayISO()} />
      <TextField label="Note (optional)" maxLength={150} placeholder="Add a note (max 150 characters)" value={detail} onChangeText={setDetail} />
      <PrimaryButton
        label={allSelected ? "Request Full Release" : "Request Partial Release"}
        onPress={() => {
          if (selected.size === 0) return setTried(true);
          request.mutate();
        }}
        loading={request.isPending}
      />
    </Sheet>
  );
}
