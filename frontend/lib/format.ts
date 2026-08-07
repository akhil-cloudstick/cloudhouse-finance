/* Ported from legacy/app.js's small formatting/lookup helpers. */
import type { DB, Scheme } from "./data";

export const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const fmtW = (n: number) => n.toFixed(1) + " g";

export const custOf = (db: DB, id: string) => db.customers.find((c) => c.id === id) || { name: "—", id };

const SCHEME_FALLBACK: Scheme = { id: "—", name: "—", rate: 0, duration: "—", ltv: 0, method: "—", penal: 0, cond: "—", active: false };
export const schemeOf = (db: DB, id: string) => db.schemes.find((s) => s.id === id) || SCHEME_FALLBACK;

export const initials = (n: string) =>
  n.split(" ").map((w) => w[0]).slice(0, 2).join("");

const STATUS_COLOR: Record<string, string> = {
  Active: "green", Closed: "gray", "Due Soon": "amber", Overdue: "red",
  "Pending Approval": "blue", "Auction Eligible": "red", Verified: "green",
  Pending: "amber", Failed: "red", Completed: "gray", Approved: "green",
  "Locker Stored": "gold", "Bank Pledged": "blue", "Ready for Release": "amber",
  Released: "gray", "Notice Issued": "amber", "Not Pledged": "gray", "Auction Scheduled": "red",
};

export function statusChipColor(status: string): string {
  return STATUS_COLOR[status] || "gray";
}

/* Ported from legacy/app.js's `renderCustomers()`-local `vmark` helper —
 * used for the PAN / Aadhaar verification columns (a 3-state 'V'/'P'/other
 * code, distinct from the general status chip map above). */
export function kycMarkColor(v: string): string {
  return v === "V" ? "green" : v === "P" ? "amber" : "red";
}
export function kycMarkLabel(v: string): string {
  return v === "V" ? "Verified" : v === "P" ? "Pending" : "Failed";
}
