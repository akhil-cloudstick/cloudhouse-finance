import React from "react";
import { View } from "react-native";
import { C, Field, Input, PrimaryButton, Sheet, Txt } from "@/common/components/ui";
import { ErrorText } from "@/common/components/ErrorText";
import { inr } from "@/common/utils/format";

/** One line of the before / after table shown by the first (preview) press. */
export type PreviewRow = { label: string; before: number | string; after: number | string; money?: boolean };

const cell = (v: number | string, money?: boolean) => (money && typeof v === "number" ? inr(v) : String(v));

type LedgerEditShellProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  notice?: string;
  mode: "edit" | "delete";
  /** The edit fields (shown in edit mode). */
  form: React.ReactNode;
  /** The confirmation sentence (shown in delete mode). */
  deleteText: React.ReactNode;
  previewTitle: string;
  preview: PreviewRow[] | null;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  /** Extra content under the preview table (a question the staff member answers before confirming). */
  extra?: React.ReactNode;
};

/** The two-step edit / delete sheet every ledger correction uses: the first press only previews what the change
 * would do (nothing is saved), the second press saves. Mirrors the web *EditModalContent footer and preview table. */
export function LedgerEditShell({ visible, onClose, title, notice, mode, form, deleteText, previewTitle, preview, error, busy, onSubmit, extra }: LedgerEditShellProps) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {notice ? <Txt style={{ fontSize: 11.5, color: C.muted, marginVertical: 8 }}>{notice}</Txt> : null}
      {mode === "edit" ? form : <Txt style={{ fontSize: 13, marginBottom: 12 }}>{deleteText}</Txt>}
      {preview ? (
        <View style={{ marginBottom: 12 }}>
          <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginBottom: 4 }}>{previewTitle}</Txt>
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Txt style={{ fontSize: 11, color: C.muted, width: 96, textAlign: "right" }}>Before</Txt>
            <Txt style={{ fontSize: 11, color: C.muted, width: 96, textAlign: "right" }}>After</Txt>
          </View>
          {preview.map((r) => (
            <View key={r.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
              <Txt style={{ fontSize: 12.5, color: C.muted, flex: 1 }}>{r.label}</Txt>
              <Txt style={{ fontSize: 12.5, width: 96, textAlign: "right" }}>{cell(r.before, r.money)}</Txt>
              <Txt style={{ fontSize: 12.5, width: 96, textAlign: "right", fontWeight: "700", color: String(r.before) !== String(r.after) ? C.brandDeep : undefined }}>{cell(r.after, r.money)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {preview ? extra : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label={preview ? (mode === "delete" ? "Confirm delete" : "Confirm") : "Preview the change"} onPress={onSubmit} loading={busy} />
    </Sheet>
  );
}

/** What the loan summary previews (gold loan + top-up) show. */
export function loanPreviewRows(p: { before: { principal: number; interest: number; penalInterest: number; total: number; status: string }; after: { principal: number; interest: number; penalInterest: number; total: number; status: string } }): PreviewRow[] {
  return [
    { label: "Principal owed", before: p.before.principal, after: p.after.principal, money: true },
    { label: "Interest owed", before: p.before.interest, after: p.after.interest, money: true },
    { label: "Penal interest owed", before: p.before.penalInterest, after: p.after.penalInterest, money: true },
    { label: "Total owed", before: p.before.total, after: p.after.total, money: true },
    { label: "Status", before: p.before.status, after: p.after.status },
  ];
}
