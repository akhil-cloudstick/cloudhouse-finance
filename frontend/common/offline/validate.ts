/* Checks the server makes on every entry, made here too before an entry is queued offline, so what is queued is what the server will
 * accept and nothing lands in the review list afterwards. The messages are the server's own words. Every check works only from what
 * this PC holds; where the answer cannot be known here the check does not block (the server decides).
 *
 * Use these only inside the offline (queueing) branch of an operation: online, the server does the checking. */

import { ApiError } from "@/common/services/httpClient";

export type PaymentSplit = { cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number | null };

const n = (v: unknown) => Number(v) || 0;
const money = (v: number) => (Math.round(v * 100) / 100).toString();

/* Stops the entry with the server's refusal. */
export function refuse(message: string, status = 400): never {
  throw new ApiError(message, status);
}

/* A required value that has to be above zero. */
export function requirePositive(value: unknown, message: string): void {
  if (!(n(value) > 0)) refuse(message);
}

/* A value that must not be negative. */
export function requireNotNegative(value: unknown, message: string): void {
  if (n(value) < 0) refuse(message);
}

/* Mirrors the backend's ValidateSplit / NormalizeSplit: the parts add up to the amount (to the paisa), Cheque is not accepted, and a
 * bank is named for any UPI / Bank Transfer part. `emptyMeansCash` — a split with no part at all is read as all Cash, as the server does
 * where the split is optional. */
export function requireValidSplit(amount: number, split: PaymentSplit, emptyMeansCash = true): void {
  if (n(split.chequeAmount) > 0) refuse("Cheque is not a supported payment mode");
  const parts = n(split.cashAmount) + n(split.upiAmount) + n(split.bankTransferAmount);
  if (parts === 0 && emptyMeansCash) return;
  if (Math.abs(parts - amount) > 0.005) refuse(`payment breakdown (${money(parts)}) does not match the amount (${money(amount)})`);
  if (n(split.upiAmount) + n(split.bankTransferAmount) > 0 && !split.bankId) refuse("bank is required for the payment split");
}

/* "YYYY-MM-DD" of a date or timestamp as the person on this PC sees it. */
export function dayOf(value: string | Date | undefined | null): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function today(): string {
  return dayOf(new Date());
}

/* A date that may not be in the future. */
export function requireNotFuture(day: string | undefined | null, message: string): void {
  const d = dayOf(day);
  if (d && d > today()) refuse(message);
}

/* A date that may not be before another one. */
export function requireNotBefore(day: string | undefined | null, earliest: string | undefined | null, message: string): void {
  const d = dayOf(day);
  const e = dayOf(earliest);
  if (d && e && d < e) refuse(message);
}
