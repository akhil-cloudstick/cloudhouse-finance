import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffering, DateField, Field, FieldRow, Input } from "@/common/components/ui";
import { LedgerEditShell, loanPreviewRows } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr } from "@/common/components/loanSheetKit";
import { editAuctionSale, getAuctionSaleCurrent, type AuctionEditPreview } from "@/modules/auctions/services/auctionService";
import { todayISO } from "@/common/utils/format";
import type { ConcludedAuctionRow } from "@/modules/auctions/types/auction-types";

type Props = { auction: ConcludedAuctionRow | null; onClose: () => void };

/** Edit a concluded auction's sale (date, amount, expenses, how the buyer paid). Two steps like every ledger edit:
 * the first press previews the effect on the loan, the second saves — with the entries booked from the sale updated too. */
export function AuctionSaleEditSheet({ auction, onClose }: Props) {
  const qc = useQueryClient();
  const loanId = auction?.loanId ?? 0;
  const cur = useQuery({ queryKey: ["auctionSaleCurrent", loanId], queryFn: () => getAuctionSaleCurrent(loanId), enabled: !!auction, gcTime: 0 });
  const [date, setDate] = useState("");
  const [sale, setSale] = useState("");
  const [expenses, setExpenses] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [preview, setPreview] = useState<AuctionEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = cur.data;

  useEffect(() => {
    if (!c) return;
    setDate((c.saleDate || todayISO()).slice(0, 10));
    setSale(String(c.saleAmount));
    setExpenses(String(c.auctionExpenses || 0));
    setPreview(null);
    setError(null);
  }, [c]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setPreview(null);
    setError(null);
    set(v);
  };
  const total = Number(sale) || 0;

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      const exp = Number(expenses) || 0;
      if (!(total > 0)) throw new Error("Enter a valid sale amount.");
      if (exp < 0 || exp > total) throw new Error("Auction expenses cannot be negative or more than the sale amount.");
      if (!pay?.ready) throw new Error("Check the payment breakdown and banks.");
      return editAuctionSale(
        loanId,
        {
          saleAmount: total,
          auctionExpenses: exp,
          saleDate: date,
          cashAmount: pay.split.cashAmount,
          upiAmount: pay.split.upiAmount,
          bankTransferAmount: pay.split.bankTransferAmount,
          bankId: pay.bankId,
          applyDependents: dry || !preview ? [] : preview.dependents.map((d) => ({ kind: d.kind, id: d.id })),
        },
        dry
      );
    },
    onSuccess: (res, dry) => {
      if (dry) {
        setPreview(res);
        setError(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ["auctionHistory"] });
      qc.invalidateQueries({ queryKey: ["auction", String(loanId)] });
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      onClose();
    },
    onError: (e) => {
      setPreview(null);
      setError(e instanceof Error && !("status" in e) ? e.message : apiErr(e, "Could not save the change — try again."));
    },
  });

  const form = !c ? (
    cur.isError ? null : <Buffering block />
  ) : (
    <>
      <FieldRow>
        <DateField label="Sale date" value={date} onChange={touch(setDate)} max={todayISO()} />
        <Field label="Sale amount (₹)">
          <Input keyboardType="decimal-pad" value={sale} onChangeText={touch(setSale)} />
        </Field>
      </FieldRow>
      <Field label="Auction expenses (₹)">
        <Input keyboardType="decimal-pad" value={expenses} onChangeText={touch(setExpenses)} />
      </Field>
      <View style={{ marginBottom: 12 }}>
        <SplitPaymentInput
          key={loanId}
          total={total}
          bankLabel="Bank (account the buyer paid into)"
          initial={{ split: { cashAmount: c.cashAmount, upiAmount: c.upiAmount, bankTransferAmount: c.bankTransferAmount, chequeAmount: 0 }, bankId: c.bankId }}
          onChange={(v) => {
            setPreview(null);
            setPay(v);
          }}
        />
      </View>
    </>
  );

  return (
    <LedgerEditShell
      visible={!!auction}
      onClose={onClose}
      title={`Edit auction${auction ? ` — ${auction.loanNumber}` : ""}`}
      notice="The loan is recalculated and the entries booked from this sale are updated with it."
      mode="edit"
      form={form}
      deleteText=""
      previewTitle="What changes on the loan"
      preview={preview ? loanPreviewRows(preview) : null}
      error={cur.isError ? "Could not load this auction — try again." : error}
      busy={run.isPending}
      onSubmit={() => {
        if (!c) return;
        setError(null);
        run.mutate(preview == null);
      }}
    />
  );
}
