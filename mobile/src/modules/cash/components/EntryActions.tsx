import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { C, PIcon, PrimaryButton, Sheet, SheetFooter, Txt, toast, type AccAction } from "@/common/components/ui";
import { billDetail } from "@/common/components/LedgerList";
import { inr, dmy } from "@/common/utils/format";
import { getMovementEntry } from "@/modules/cash/services/cashService";
import type { EntryInfo, EntryKind, LedgerRow } from "@/modules/cash/types/cash-types";
import { EditEntrySheet } from "./EntryForms";

const KIND_LABEL: Record<EntryKind, string> = {
  cash_in: "Credit (Cash In)",
  debit: "Debit (Expense)",
  self_transfer: "Self Transfer",
  gold_sale: "Gold Sale",
  system: "Entry",
};

// "2026-10-13T10:31:00Z" -> "13-10-2026 10:31"
const stamp = (v?: string) => (v ? `${dmy(v)} ${new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}` : "—");

type CellProps = { k: string; v: React.ReactNode };

function Cell({ k, v }: CellProps) {
  return (
    <View style={{ width: "50%", paddingRight: 10, marginBottom: 12 }}>
      <Txt style={{ fontSize: 10.5, letterSpacing: 1, color: C.muted, textTransform: "uppercase" }}>{k}</Txt>
      {typeof v === "string" ? <Txt style={{ fontSize: 14, fontWeight: "500", marginTop: 2 }}>{v}</Txt> : v}
    </View>
  );
}

type EntryInfoSheetProps = { info: EntryInfo | null; onClose: () => void; onEdit: () => void };

// The ledger's info popup for a cash-in, a debit or a self transfer: its
// remarks and everything recorded about it — category, amount, date, the
// payment breakdown (or the From / To banks of a transfer), branch, bill.
function EntryInfoSheet({ info, onClose, onEdit }: EntryInfoSheetProps) {
  const bill = billDetail(info?.receiptImage)[0];
  return (
    <Sheet visible={info != null} onClose={onClose} title="Entry Details" maxHeightPct={85}>
      {info ? (
        <>
          <Txt style={{ fontSize: 12, fontWeight: "700", letterSpacing: 0.6, color: C.brandDeep, marginBottom: 12 }}>{KIND_LABEL[info.kind].toUpperCase()}</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Cell k="Category" v={info.category || "—"} />
            {info.loanNumber ? <Cell k="Loan" v={info.loanNumber} /> : null}
            {info.ornamentType ? <Cell k="Ornament" v={info.ornamentType} /> : null}
            {info.kind === "gold_sale" ? <Cell k="Cost" v={inr(info.costAmount ?? 0)} /> : null}
            <Cell k="Amount" v={inr(info.amount)} />
            <Cell k="Date" v={dmy(info.occurredOn)} />
            {info.branchName ? <Cell k="Branch" v={info.branchName} /> : null}
            {info.status ? <Cell k="Status" v={info.status} /> : null}
            {info.approvedBy ? <Cell k="Approved by" v={info.approvedBy} /> : null}
            {info.approvedAt ? <Cell k="Approved on" v={stamp(info.approvedAt)} /> : null}
          </View>

          <Txt style={{ fontSize: 13, fontWeight: "700", marginTop: 6, marginBottom: 6 }}>Remarks</Txt>
          <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, minHeight: 44 }}>
            <Txt style={{ fontSize: 13.5, color: info.remarks ? undefined : C.muted }}>{info.remarks || "No remarks were added to this entry."}</Txt>
          </View>

          {info.kind === "self_transfer" ? (
            <>
              <Txt style={{ fontSize: 13, fontWeight: "700", marginTop: 16, marginBottom: 8 }}>Transfer</Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Cell k="Mode" v={info.lines[0]?.mode || "—"} />
                <Cell k="From bank" v={info.fromBank || "—"} />
                <Cell k="To bank" v={info.toBank || "—"} />
              </View>
            </>
          ) : (
            <>
              <Txt style={{ fontSize: 13, fontWeight: "700", marginTop: 16, marginBottom: 8 }}>Payment breakdown</Txt>
              {info.lines.map((l) => (
                <View key={l.movementId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.line }}>
                  <Txt style={{ fontSize: 13.5, flex: 1 }}>{l.mode}{l.bankName ? ` · ${l.bankName}` : ""}</Txt>
                  <Txt style={{ fontSize: 13.5, fontWeight: "600" }}>{inr(l.amount)}</Txt>
                </View>
              ))}
              {info.lines.length > 1 ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.line }}>
                  <Txt style={{ fontSize: 13.5, fontWeight: "700" }}>Total</Txt>
                  <Txt style={{ fontSize: 13.5, fontWeight: "700" }}>{inr(info.amount)}</Txt>
                </View>
              ) : null}
            </>
          )}

          {bill ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }}>
              <Txt style={{ fontSize: 13 }}>Bill:</Txt>
              {bill.v}
            </View>
          ) : null}
          {info.editable ? (
            <SheetFooter>
              <PrimaryButton label="Edit" onPress={onEdit} />
            </SheetFooter>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

type RowInfoSheetProps = { row: LedgerRow | null; onClose: () => void };

// The info popup for a ledger row with no cash movement behind it (a loan or personal-loan payment, an opening row…):
// it shows what the row itself carries.
function RowInfoSheet({ row, onClose }: RowInfoSheetProps) {
  return (
    <Sheet visible={row != null} onClose={onClose} title="Entry Details" maxHeightPct={85}>
      {row ? (
        <>
          <Txt style={{ fontSize: 12, fontWeight: "700", letterSpacing: 0.6, color: C.brandDeep, marginBottom: 12 }}>
            {(row.debitOrCredit === "debit" ? "Debit" : "Credit").toUpperCase()}{row.type ? ` · ${row.type.toUpperCase()}` : ""}
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Cell k="Date" v={dmy(row.date)} />
            <Cell k="Amount" v={inr(row.amount)} />
            <Cell k="Mode" v={row.method || "—"} />
            {row.reference ? <Cell k="Reference" v={row.reference} /> : null}
            {row.customerName ? <Cell k="Customer" v={row.customerName} /> : null}
            {row.bankName ? <Cell k="Bank" v={row.bankName} /> : null}
            <Cell k="Balance" v={inr(row.runningBalance)} />
          </View>
          <Txt style={{ fontSize: 13, fontWeight: "700", marginTop: 6, marginBottom: 6 }}>Description</Txt>
          <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, minHeight: 44 }}>
            <Txt style={{ fontSize: 13.5 }}>{row.description || row.type || "—"}</Txt>
          </View>
          {billDetail(row.receiptImage)[0] ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }}>
              <Txt style={{ fontSize: 13 }}>Bill:</Txt>
              {billDetail(row.receiptImage)[0].v}
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

/** What a ledger row needs for its info icon (put it beside the row's text), the Edit action (pass it to AccRow's
 * `actions`) and the sheets those open (render `sheets` anywhere in the row). Every row with a cash movement behind
 * it (`entryId`) gets the info icon; only an `editable` one also gets Edit. A row with no entry (pass `row`) still
 * gets an info popup built from its own fields. The entry is fetched BEFORE the popup opens, so it opens complete. */
export function useEntryActions(entryId?: number, editable?: boolean, row?: LedgerRow): { infoButton: React.ReactNode; actions: AccAction[]; sheets: React.ReactNode } {
  const [sheet, setSheet] = useState<"info" | "edit" | "row" | null>(null);
  const [info, setInfo] = useState<EntryInfo | null>(null);
  const [busy, setBusy] = useState(false);
  if (!entryId && !row) return { infoButton: null, actions: [], sheets: null };

  async function openInfo() {
    if (busy) return;
    if (!entryId) { setSheet("row"); return; }
    setBusy(true);
    try {
      setInfo(await getMovementEntry(entryId));
      setSheet("info");
    } catch {
      toast.error("Could not load details", "The details of this entry could not be loaded — try again.");
    } finally {
      setBusy(false);
    }
  }

  const close = () => setSheet(null);
  return {
    infoButton: (
      <Pressable onPress={openInfo} hitSlop={10} accessibilityLabel="Entry details" style={{ marginLeft: 6, opacity: busy ? 0.5 : 1 }}>
        <PIcon name="info" color={C.brandDeep} size={16} />
      </Pressable>
    ),
    actions: entryId && editable ? [{ label: "Edit", onPress: () => setSheet("edit") }] : [],
    sheets:
      sheet === "info" ? <EntryInfoSheet info={info} onClose={close} onEdit={() => setSheet(info?.editable ? "edit" : null)} />
      : sheet === "edit" && entryId ? <EditEntrySheet entryId={entryId} onClose={close} />
      : sheet === "row" ? <RowInfoSheet row={row ?? null} onClose={close} />
      : null,
  };
}

type EntrySubProps = { text?: string; infoButton: React.ReactNode };

/** A row's sub-line with the info icon after it (use it only when the row has an info button). */
export function EntrySub({ text, infoButton }: EntrySubProps) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 1 }}>
      <Txt style={{ fontSize: 11, color: C.muted, flexShrink: 1 }} numberOfLines={1}>{text}</Txt>
      {infoButton}
    </View>
  );
}
