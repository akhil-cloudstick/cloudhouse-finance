import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffering, C, ChipToggle, DateField, Field, Txt } from "@/common/components/ui";
import { LedgerEditShell, loanPreviewRows, type PreviewRow } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr } from "@/common/components/loanSheetKit";
import {
  deleteAuctionSale,
  deleteAuctionSurplus,
  deleteAuctionWriteOff,
  editAuctionSurplus,
  editAuctionWriteOff,
  getAuctionHistory,
  type AuctionEditPreview,
} from "@/modules/auctions/services/auctionService";
import { AuctionSaleEditSheet } from "@/modules/auctions/components/AuctionSaleEditSheet";
import type { AuctionSurplusDisposition } from "@/modules/auctions/types/auction-types";
import { inr, todayISO } from "@/common/utils/format";

export type AuctionEditKind = "sale" | "surplus" | "write-off";
type Target = { loanId: number; loanNumber: string; kind: AuctionEditKind; mode: "edit" | "delete" };
type Props = { target: Target | null; onClose: () => void };

const TITLES: Record<AuctionEditKind, string> = { sale: "Auction Sale", surplus: "Auction Surplus Settlement", "write-off": "Auction Write-Off" };
const DISP_LABELS: Record<AuctionSurplusDisposition, string> = { RefundedToCustomer: "Refund to customer", RecordedAsIncome: "Record as company income" };
// Same sentences as web's AuctionEditModalContent.
const DELETE_TEXT: Record<AuctionEditKind, string> = {
  sale: "Delete this auction sale? Its cash entries and expense entry are removed and the auction goes back to the scheduled stage.",
  surplus: "Delete this surplus settlement? The refund's cash entry is removed and the surplus is payable again.",
  "write-off": "Delete this write-off? The shortfall decision goes back to pending and the loan to Auctioned - Balance Due.",
};

/** The auction editors web opens from Auction History / the loan ledger (AuctionEditModalContent): edit or delete a
 * sale, its surplus settlement or its write-off. Two steps like every ledger edit: the first press previews (nothing
 * saved), the second saves, updating the entries the auction booked from the change. Editing a sale is its own sheet. */
export function AuctionEntryEditSheet({ target, onClose }: Props) {
  if (target?.kind === "sale" && target.mode === "edit") return <AuctionSaleEditSheet auction={target} onClose={onClose} />;
  return <EntrySheet key={target ? `${target.loanId}-${target.kind}-${target.mode}` : "closed"} target={target} onClose={onClose} />;
}

function EntrySheet({ target, onClose }: Props) {
  const qc = useQueryClient();
  const loanId = target?.loanId ?? 0;
  const kind = target?.kind ?? "surplus";
  const mode = target?.mode ?? "edit";
  const needsRecord = !!target && mode === "edit" && kind === "surplus";
  const hist = useQuery({ queryKey: ["auctionEntryRecord", loanId], queryFn: () => getAuctionHistory(loanId), enabled: !!target && mode === "edit" && kind !== "sale", gcTime: 0 });
  const record = (hist.data ?? []).find((r) => (r.saleAmount ?? 0) > 0) ?? null;
  const [pickedDate, setDate] = useState<string | null>(null);
  const [pickedDisp, setDisposition] = useState<AuctionSurplusDisposition | null>(null);
  // What was recorded is the starting point; anything the user picks wins.
  const woDecided = record?.decisionRequests?.find((d) => d.status === "WriteOff")?.decidedAt;
  const date = pickedDate ?? (woDecided ? woDecided.slice(0, 10) : todayISO());
  const disposition: AuctionSurplusDisposition = pickedDisp || record?.surplusDisposition || "RefundedToCustomer";
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [preview, setPreview] = useState<AuctionEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Form version: a dry-run answer is only shown if the form has not changed since it was sent.
  const ver = useRef(0);
  const sentVer = useRef(0);
  const previewVer = useRef(-1);

  const touch =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      ver.current += 1;
      setPreview(null);
      setError(null);
      set(v);
    };
  const surplusAmount = record?.surplusPayableAmount ?? 0;
  const refund = disposition === "RefundedToCustomer";
  const modes = pay ? ([pay.split.cashAmount > 0 && "Cash", pay.split.upiAmount > 0 && "UPI", pay.split.bankTransferAmount > 0 && "Bank Transfer"].filter(Boolean) as string[]) : [];

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      const applied = dry || !preview ? [] : preview.dependents.map((d) => ({ kind: d.kind, id: d.id }));
      if (kind === "sale") return deleteAuctionSale(loanId, applied, dry);
      if (kind === "surplus") {
        if (mode === "delete") return deleteAuctionSurplus(loanId, dry);
        if (refund) {
          if (!pay?.ready || modes.length !== 1) throw new Error("The refund must be paid out by one mode and add up to the surplus.");
          if (modes[0] !== "Cash" && !pay.bankId) throw new Error("Select the bank for the refund.");
        }
        return editAuctionSurplus(loanId, { disposition, ...(refund ? { mode: modes[0], bankId: pay?.bankId, settledOn: date || undefined } : {}) }, dry);
      }
      if (mode === "delete") return deleteAuctionWriteOff(loanId, applied, dry);
      if (!date) throw new Error("Choose the write-off date.");
      return editAuctionWriteOff(loanId, date, dry);
    },
    onSuccess: (res, dry) => {
      if (dry) {
        if (sentVer.current !== ver.current) return; // the form changed while this was running
        previewVer.current = ver.current;
        setPreview(res);
        setError(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ["auctionHistory"] });
      qc.invalidateQueries({ queryKey: ["auction", String(loanId)] });
      qc.invalidateQueries({ queryKey: ["loan", String(loanId)] });
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loanLedgerCharges"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      onClose();
    },
    onError: (e, dry) => {
      if (dry && sentVer.current !== ver.current) return;
      setPreview(null);
      setError(e instanceof Error && !("status" in e) ? e.message : apiErr(e, "Could not save the change — try again."));
    },
  });

  const needsHistory = !!target && mode === "edit" && kind === "write-off";
  const form =
    needsHistory && !hist.data ? (
      hist.isError ? null : <Buffering block />
    ) : mode === "edit" && kind !== "sale" && !record && kind === "surplus" ? (
      hist.isError ? null : <Buffering block />
    ) : kind === "write-off" ? (
      <DateField label="Write-off date *" value={date} onChange={touch(setDate)} max={todayISO()} />
    ) : (
      <>
        <Field label={`Surplus ${inr(surplusAmount)} *`}>
          <ChipToggle options={["RefundedToCustomer", "RecordedAsIncome"] as const} value={disposition} onChange={touch(setDisposition)} labels={DISP_LABELS} />
        </Field>
        {refund ? (
          <View style={{ marginBottom: 12 }}>
            <DateField label="Refund date" value={date} onChange={touch(setDate)} max={todayISO()} />
            <SplitPaymentInput
              total={surplusAmount}
              bankLabel="Bank (account it is paid from)"
              onChange={(v) => {
                ver.current += 1;
                setPreview(null);
                setPay(v);
              }}
            />
            {pay && modes.length > 1 ? <Txt style={{ fontSize: 12, color: C.red }}>Refund the surplus in one payment mode: Cash, UPI or Bank Transfer.</Txt> : null}
          </View>
        ) : null}
      </>
    );

  // Loan figures only when the loan itself changes; a surplus / write-off edit usually leaves them alone.
  const rows: PreviewRow[] | null = preview
    ? preview.before.total !== preview.after.total || preview.before.principal !== preview.after.principal || preview.before.status !== preview.after.status
      ? loanPreviewRows(preview)
      : [{ label: "Loan status", before: preview.before.status || "—", after: preview.after.status || "—" }]
    : null;
  const extra =
    preview && preview.dependents.length ? (
      <View style={{ marginBottom: 12 }}>
        <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginBottom: 4 }}>This also updates entries booked from the auction</Txt>
        {preview.dependents.map((d) => (
          <View key={`${d.kind}:${d.id}`} style={{ paddingVertical: 3 }}>
            <Txt style={{ fontSize: 12.5 }}>{d.description}</Txt>
            <Txt style={{ fontSize: 11.5, color: C.muted }}>
              {d.current} → {d.suggested}
              {d.required ? " (required to keep the books consistent)" : ""}
            </Txt>
          </View>
        ))}
      </View>
    ) : null;

  return (
    <LedgerEditShell
      visible={!!target}
      onClose={onClose}
      title={`${mode === "delete" ? "Delete" : "Edit"} ${TITLES[kind]}${target ? ` — ${target.loanNumber}` : ""}`}
      mode={mode}
      form={form}
      deleteText={DELETE_TEXT[kind]}
      previewTitle="What changes on the loan"
      preview={rows}
      extra={extra}
      error={hist.isError ? "Could not load this auction entry — try again." : error}
      busy={run.isPending}
      onSubmit={() => {
        if (needsRecord && !record) return;
        if (needsHistory && !hist.data) return; // the recorded date has not loaded yet
        setError(null);
        // only confirm a preview that matches the form as it is now
        const confirm = preview != null && previewVer.current === ver.current;
        if (preview != null && !confirm) setPreview(null);
        sentVer.current = ver.current;
        run.mutate(!confirm);
      }}
    />
  );
}
