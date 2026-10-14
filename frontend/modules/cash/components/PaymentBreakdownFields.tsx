"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { fmt } from "@/common/utils/format";
import { Icon } from "@/common/components/Icon";
import { FieldError } from "@/common/components/ui/FieldError";
import { Select } from "@/common/components/ui/Select";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { searchBanksPage, createBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { type PaymentPartInput } from "@/modules/cash/types/cash-types";

const MODE_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "Bank Transfer", label: "Bank Transfer" },
];

const MAX_ROWS = 6;

const noWheelStep = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

/* One line of a payment breakdown as the form holds it. `auto` is true while
 * the row is the only one and untouched — its amount then follows the entry's
 * Amount field, so the common single-mode entry needs no extra typing. */
export type PaymentRow = { key: number; mode: string; amount: string; bankId: string; bankName: string; auto: boolean };

let nextKey = 1;

export function newPaymentRow(init?: Partial<PaymentRow>): PaymentRow {
  return { key: nextKey++, mode: "", amount: "", bankId: "", bankName: "", auto: true, ...init };
}

export const isBankMode = (mode: string) => mode === "UPI" || mode === "Bank Transfer";

const round2 = (n: number) => Math.round(n * 100) / 100;

/* The rows as the backend's payment lines — rows with no amount are dropped. */
export function paymentRowsToInput(rows: PaymentRow[]): PaymentPartInput[] {
  return rows
    .filter((r) => +r.amount > 0)
    .map((r) => ({ mode: r.mode, amount: round2(+r.amount), bankId: isBankMode(r.mode) ? +r.bankId : undefined }));
}

/* The first problem with the breakdown: the row it is on (null for the breakdown as a whole) and what to say. */
export type PaymentIssue = { key: number | null; message: string };

export function paymentRowIssue(rows: PaymentRow[], total: number): PaymentIssue | null {
  if (!rows.length) return { key: null, message: "Please add the payment mode." };
  for (const r of rows) {
    if (!r.mode) return { key: r.key, message: "Please select the mode of payment." };
    if (!(+r.amount > 0)) return { key: r.key, message: "Please enter the amount for every payment mode." };
    if (isBankMode(r.mode) && !r.bankId) return { key: r.key, message: "Please select the bank." };
  }
  const allocated = round2(rows.reduce((s, r) => s + (+r.amount || 0), 0));
  if (allocated !== round2(total)) return { key: null, message: `Payment breakdown must add up to ${fmt(total)} (now ${fmt(allocated)}).` };
  return null;
}

/* "" when the breakdown is valid for `total`, otherwise the message to show. */
export function paymentRowsError(rows: PaymentRow[], total: number): string {
  return paymentRowIssue(rows, total)?.message ?? "";
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
  onChange: Dispatch<SetStateAction<PaymentRow[]>>;
  /** false lets the lines grow instead of scrolling inside a fixed height (the modal body scrolls). */
  scrollInternally?: boolean;
  /** Heading beside the add button; null drops the text, leaving only the button. */
  label?: string | null;
  /** The problem to show: under its row, or under the whole breakdown when `key` is null. */
  error?: PaymentIssue | null;
};

/* Mode with its payment breakdown — the Credit and Debit forms' Mode section.
 * Each line is a mode, its amount and (for UPI / Bank Transfer) the bank it
 * moved through; the lines must add up to the entry's Amount, and each one is
 * saved as its own ledger entry. */
export function PaymentBreakdownFields({ total, rows, onChange, scrollInternally = true, label, error }: PaymentBreakdownFieldsProps) {
  useEffect(() => {
    if (rows.length !== 1 || !rows[0].auto) return;
    const v = total > 0 ? String(total) : "";
    if (rows[0].amount !== v) onChange((cur) => (cur.length === 1 && cur[0].auto ? [{ ...cur[0], amount: v }] : cur));
  }, [total, rows, onChange]);

  const allocated = round2(rows.reduce((s, r) => s + (+r.amount || 0), 0));
  const remaining = round2(total - allocated);
  const patch = (key: number, p: Partial<PaymentRow>) =>
    onChange((cur) => cur.map((r) => (r.key === key ? { ...r, auto: false, ...p } : r)));
  // A removed line's amount goes to the last line left, so the lines still add up.
  const remove = (key: number) => onChange((cur) => {
    if (cur.length < 2) return cur;
    const gone = cur.find((r) => r.key === key);
    const left = cur.filter((r) => r.key !== key);
    const last = left[left.length - 1];
    return left.map((r) => (r.key === last.key && gone ? { ...r, amount: String(round2((Number(r.amount) || 0) + (Number(gone.amount) || 0))), auto: false } : r));
  });
  const add = () => onChange((cur) => (cur.length >= MAX_ROWS ? cur : [...cur, newPaymentRow({ auto: false, amount: remaining > 0 ? String(remaining) : "" })]));

  // The remove column only exists once there is more than one line.
  const grid = {
    display: "grid",
    gridTemplateColumns: rows.length > 1 ? "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.3fr) 22px" : "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.3fr)",
    gap: 10,
    alignItems: "center",
  } as const;

  return (
    <div className="frow">
      <div style={{ width: "100%", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
          {label === null ? <span /> : <label className="f" style={{ margin: 0 }}>{label ?? <>Mode * <span style={{ fontWeight: 400, color: "var(--muted)" }}>(payment breakdown)</span></>}</label>}
          <button
            type="button" onClick={add} disabled={rows.length >= MAX_ROWS} title="Add payment mode" aria-label="Add payment mode"
            style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid var(--line)", background: "#fff", color: "var(--brand-deep, #423591)", cursor: rows.length >= MAX_ROWS ? "not-allowed" : "pointer", opacity: rows.length >= MAX_ROWS ? 0.5 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}
          ><Icon name="plus" /></button>
        </div>
        <div style={{ ...grid, marginBottom: 4 }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Mode</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Amount (₹)</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Bank</span>
          {rows.length > 1 ? <span /> : null}
        </div>
        {/* The lines scroll inside a fixed height, so adding modes never grows the modal. */}
        <div style={{ ...(scrollInternally ? { maxHeight: 132, overflowY: "auto", overflowX: "hidden" } : {}), marginBottom: 8, paddingBottom: 2 }}>
        {rows.map((r) => (
          <div key={r.key} className={error?.key === r.key ? "has-err" : undefined} style={{ marginBottom: 8 }}>
          <div style={grid}>
            <Select
              options={MODE_OPTIONS}
              value={r.mode}
              onChange={(v) => patch(r.key, { mode: v, ...(isBankMode(v) ? {} : { bankId: "", bankName: "" }), auto: r.auto })}
              placeholder="Select mode…"
            />
            <input
              className="inp" type="number" min={0} value={r.amount} placeholder="0"
              onChange={(e) => onChange((cur) => withAmount(cur, r.key, e.target.value, total))} onWheel={noWheelStep}
            />
            {isBankMode(r.mode) ? (
              <SearchableSelect<BackendBank>
                portal
                value={r.bankName}
                onChange={(id, item) => patch(r.key, { bankId: id, bankName: item.name, auto: r.auto })}
                fetchFn={searchBanksPage}
                searchHint="Searches: bank name"
                getLabel={(b) => b.name}
                getId={(b) => String(b.id)}
                placeholder="Search or add a bank…"
                allowCreate
                onCreate={createBank}
              />
            ) : (
              <input className="inp" disabled placeholder="No bank needed" />
            )}
            {rows.length > 1 ? (
              <button
                type="button" aria-label="Remove payment mode" onClick={() => remove(r.key)}
                style={{ border: 0, background: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, color: "var(--muted)", padding: 0 }}
              >×</button>
            ) : <span />}
          </div>
          {error?.key === r.key && <FieldError msg={error.message} />}
          </div>
        ))}
        </div>
        <div style={{ minHeight: 18 }}>
          {error && error.key === null && <FieldError msg={error.message} />}
          {total > 0 && !(error && error.key === null) && (
            <span style={{ fontSize: 12.5, color: Math.abs(remaining) < 0.005 ? "var(--green)" : "var(--red)" }}>
              {Math.abs(remaining) < 0.005
                ? `Fully allocated ${fmt(total)}`
                : remaining > 0 ? `${fmt(remaining)} still to allocate` : `Exceeds the amount by ${fmt(-remaining)}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
