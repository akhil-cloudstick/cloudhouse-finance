import React, { useEffect } from "react";
import { Pressable, View } from "react-native";
import { C, ChipToggle, Field, Input, PIcon, Txt } from "@/common/components/ui";
import { inr } from "@/common/utils/format";
import type { Bank } from "@/modules/banks/types/bank-types";
import type { PaymentPart } from "@/modules/cash/types/cash-types";
import { BankPicker } from "./EntryFormParts";

export const PAY_MODES = ["Cash", "UPI", "Bank Transfer"] as const;
export type PayMode = (typeof PAY_MODES)[number];

const MAX_ROWS = 6;

/** One line of a payment breakdown as the form holds it. `auto` is true while
 * the row is the only one and untouched — its amount then follows the entry's
 * Amount field, so the common single-mode entry needs no extra typing. */
export type PaymentRow = { key: number; mode: PayMode; amount: string; bank: Bank | null; auto: boolean };

let nextKey = 1;

export function newPaymentRow(init?: Partial<PaymentRow>): PaymentRow {
  return { key: nextKey++, mode: "Cash", amount: "", bank: null, auto: true, ...init };
}

export const isBankMode = (mode: string) => mode === "UPI" || mode === "Bank Transfer";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The rows as the backend's payment lines — rows with no amount are dropped. */
export function paymentRowsToInput(rows: PaymentRow[]): PaymentPart[] {
  return rows
    .filter((r) => Number(r.amount) > 0)
    .map((r) => ({ mode: r.mode, amount: round2(Number(r.amount)), bankId: isBankMode(r.mode) ? r.bank?.id : undefined }));
}

/** "" when the breakdown is valid for `total`, otherwise the message to show. */
export function paymentRowsError(rows: PaymentRow[], total: number): string {
  if (!rows.length) return "Please add the payment mode.";
  for (const r of rows) {
    if (!(Number(r.amount) > 0)) return "Please enter the amount for every payment mode.";
    if (isBankMode(r.mode) && !r.bank) return "Please select the bank.";
  }
  const allocated = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  if (allocated !== round2(total)) return `Payment breakdown must add up to ${inr(total)} (now ${inr(allocated)}).`;
  return "";
}


/* Types an amount into one line of the breakdown: it can't go past what is left of the entry's Amount after the
 * other lines, and the last of the other lines takes the remainder so the lines keep adding up to the Amount. */
function withAmount(rows: PaymentRow[], key: number, text: string, total: number): PaymentRow[] {
  const setOnly = () => rows.map((r) => (r.key === key ? { ...r, amount: text, auto: false } : r));
  if (!(total > 0) || rows.length < 2) return setOnly();
  const others = rows.filter((r) => r.key !== key);
  const balancer = others[others.length - 1];
  const fixed = others.slice(0, -1).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const max = Math.max(0, round2(total - fixed));
  const typed = Number(text);
  const value = Number.isFinite(typed) && typed > 0 ? typed : 0;
  const shown = value > max ? String(max) : text;
  const rest = round2(max - Math.min(value, max));
  return rows.map((r) => {
    if (r.key === key) return { ...r, amount: shown, auto: false };
    if (r.key === balancer.key) return { ...r, amount: String(rest), auto: false };
    return r;
  });
}

type PaymentBreakdownFieldsProps = {
  total: number;
  rows: PaymentRow[];
  onChange: React.Dispatch<React.SetStateAction<PaymentRow[]>>;
  // The bank picker's label — "Bank (your account)" on a credit, "From Bank" on a debit.
  bankLabel: string;
};

/** Mode with its payment breakdown — the Credit and Debit forms' Mode section.
 * Each line is a mode, its amount and (for UPI / Bank Transfer) the bank it
 * moved through; the lines must add up to the entry's Amount, and each one is
 * saved as its own ledger entry. */
export function PaymentBreakdownFields({ total, rows, onChange, bankLabel }: PaymentBreakdownFieldsProps) {
  useEffect(() => {
    if (rows.length !== 1 || !rows[0].auto) return;
    const v = total > 0 ? String(total) : "";
    if (rows[0].amount !== v) onChange((cur) => (cur.length === 1 && cur[0].auto ? [{ ...cur[0], amount: v }] : cur));
  }, [total, rows, onChange]);

  const allocated = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = round2(total - allocated);
  const patch = (key: number, p: Partial<PaymentRow>) => onChange((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));
  // A removed line's amount goes to the last line left, so the lines still add up.
  const remove = (key: number) => onChange((cur) => {
    if (cur.length < 2) return cur;
    const gone = cur.find((r) => r.key === key);
    const left = cur.filter((r) => r.key !== key);
    const last = left[left.length - 1];
    return left.map((r) => (r.key === last.key && gone ? { ...r, amount: String(round2((Number(r.amount) || 0) + (Number(gone.amount) || 0))), auto: false } : r));
  });
  const add = () => onChange((cur) => (cur.length >= MAX_ROWS ? cur : [...cur, newPaymentRow({ auto: false, amount: remaining > 0 ? String(remaining) : "" })]));

  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <Txt style={{ fontSize: 12, fontWeight: "700", color: C.muted }}>MODE · PAYMENT BREAKDOWN</Txt>
        <Pressable
          onPress={add} disabled={rows.length >= MAX_ROWS} hitSlop={8} accessibilityLabel="Add payment mode"
          style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.card, alignItems: "center", justifyContent: "center", opacity: rows.length >= MAX_ROWS ? 0.5 : 1 }}
        >
          <PIcon name="plus" color={C.brandDeep} size={16} />
        </Pressable>
      </View>
      {rows.map((r, i) => (
        <View key={r.key} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, marginBottom: 10 }}>
          <ChipToggle
            options={PAY_MODES}
            value={r.mode}
            onChange={(v) => patch(r.key, { mode: v, ...(isBankMode(v) ? {} : { bank: null }) })}
            wrap
          />
          <Field label="Amount">
            <Input
              keyboardType="decimal-pad" placeholder="₹" value={r.amount}
              onChangeText={(t) => onChange((cur) => withAmount(cur, r.key, t, total))}
            />
          </Field>
          {isBankMode(r.mode) ? <BankPicker label={bankLabel} bank={r.bank} onChange={(b) => patch(r.key, { bank: b })} /> : null}
          {rows.length > 1 ? (
            <Pressable onPress={() => remove(r.key)} hitSlop={8} accessibilityLabel={`Remove payment mode ${i + 1}`}>
              <Txt style={{ fontSize: 12.5, color: C.red, fontWeight: "600" }}>Remove</Txt>
            </Pressable>
          ) : null}
        </View>
      ))}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {total > 0 ? (
          <Txt style={{ fontSize: 12.5, color: Math.abs(remaining) < 0.005 ? C.green : C.red }}>
            {Math.abs(remaining) < 0.005
              ? `Fully allocated ${inr(total)}`
              : remaining > 0 ? `${inr(remaining)} still to allocate` : `Exceeds the amount by ${inr(-remaining)}`}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}
