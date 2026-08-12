/* Ported from legacy/app.js's small formatting/lookup helpers. */
import type { CustomerView } from "./customersApi";
import type { SchemeView } from "./schemesApi";

export const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const fmtW = (n: number) => n.toFixed(1) + " g";

const CUSTOMER_FALLBACK = { name: "—", id: "—" };
export const custOf = (customers: CustomerView[], id: string) =>
  customers.find((c) => c.id === id) || CUSTOMER_FALLBACK;

const SCHEME_FALLBACK: SchemeView = { id: "—", code: "—", name: "—", rate: 0, durationMonths: 0, ltv: 0, method: "—", penal: 0, cond: "—", active: false, branchId: 0, branchName: "—" };
export const schemeOf = (schemes: SchemeView[], id: string) =>
  schemes.find((s) => s.id === id) || SCHEME_FALLBACK;

export const initials = (n: string) =>
  n.split(" ").map((w) => w[0]).slice(0, 2).join("");

const STATUS_COLOR: Record<string, string> = {
  Active: "green", Closed: "gray", "Due Soon": "amber", Overdue: "red",
  "Pending Approval": "blue", "Auction Eligible": "red", Verified: "green",
  Pending: "amber", Failed: "red", Completed: "gray", Approved: "green",
  "Locker Stored": "gold", "Bank Pledged": "blue", "Ready for Release": "amber",
  Released: "gray", "Notice Issued": "amber", "Not Pledged": "gray", "Auction Scheduled": "red",
  "Packet Generated": "blue", "Ready For Release": "amber", Returned: "gold",
};

export function statusChipColor(status: string): string {
  return STATUS_COLOR[status] || "gray";
}
