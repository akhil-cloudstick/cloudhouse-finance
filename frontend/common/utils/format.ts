/* Ported from legacy/app.js's small formatting/lookup helpers. */
import type { CustomerView } from "@/modules/customers/services/customerService";
import type { SchemeView } from "@/modules/schemes/services/schemeService";

// Money is shown to 2 decimals everywhere. Rounding each figure to whole
// rupees used to make component lines disagree with their own total (₹5,487.60
// principal + ₹1.40 interest rendered as "₹5,488 + ₹1 = ₹5,490"), which reads
// as a maths error to a cashier and invites over-collection by a rupee or two.
export const fmt = (n: number) =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  "Pending Approval": "info", "Auction Eligible": "red", Verified: "green",
  Pending: "amber", Failed: "red", Completed: "gray", Approved: "green",
  "Locker Stored": "brand", "Bank Pledged": "info", "Ready for Release": "amber",
  Released: "gray", "Notice Issued": "amber", "Not Pledged": "gray", "Auction Scheduled": "red",
  "Packet Generated": "info", "Ready For Release": "amber", Returned: "brand",
  "Name Mismatch": "red",
  // Loan-level only — a packet whose gold was auctioned still shows plain
  // "Released" (see loan.PacketMover.RecordGoldReleaseMovement), it's the
  // loan's own status that distinguishes an auction sale from an ordinary
  // release.
  Auctioned: "red", "Auctioned - Balance Due": "red",
};

export function statusChipColor(status: string): string {
  return STATUS_COLOR[status] || "gray";
}
