/* Ported from legacy/app.js's small formatting/lookup helpers. */
import type { CustomerView } from "@/modules/customers/types/customer-types";
import type { SchemeView } from "@/modules/schemes/types/scheme-types";

// Money is shown in whole rupees (the backend rounds every figure the same way, so a line and its
// total agree). A NaN/Infinity (e.g. a 0/0 ratio, or a figure derived from a response that
// never arrived because the backend was down) renders as "-" rather than
// "₹NaN" (Infinity too). null/undefined still read as zero.
/* Whole-rupee rounding, halves away from zero (5.2 -> 5, 5.5 -> 6, 5.7 -> 6) — the same rule as the
 * backend's RoundMoney, including snapping float noise first so 5.499999999999 (really 5.5) rounds up.
 * For money only: ornament weights and rates keep their decimals. */
export const roundRupee = (n: number): number => {
	const v = n ?? 0;
	if (!Number.isFinite(v)) return 0;
	const snapped = Math.round(Math.abs(v) * 1e6) / 1e6;
	const r = Math.round(snapped);
	return v < 0 ? -r : r;
};
export const fmt = (n: number) => {
	let v = n ?? 0;
	if (!Number.isFinite(v)) return "-";
	// Whole rupees, halves away from zero (5.5 -> 6), matching the backend's RoundMoney. A balance that is
	// zero up to float drift (e.g. -1e-12) must read ₹0, not ₹-0.
	v = roundRupee(v);
	if (v === 0) v = 0;
	return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
export const fmtW = (n: number) => (Number.isFinite(n) ? n.toFixed(1) + " g" : "-");

const CUSTOMER_FALLBACK = { name: "—", id: "—" };
export const custOf = (customers: CustomerView[], id: string) =>
	customers.find((c) => c.id === id) || CUSTOMER_FALLBACK;

const SCHEME_FALLBACK: SchemeView = { id: "—", code: "—", name: "—", rate: 0, rateTiers: [], minimumDays: 0, durationMonths: 0, ltv: 0, method: "—", penal: 0, accrualBasis: "daily", cond: "—", active: false, branchId: 0, branchName: "—", serviceChargeType: "None", serviceChargeValue: 0, serviceChargeMode: "WithheldFromPayout" };
export const schemeOf = (schemes: SchemeView[], id: string) =>
	schemes.find((s) => s.id === id) || SCHEME_FALLBACK;

export const initials = (n: string) =>
	n.split(" ").map((w) => w[0]).slice(0, 2).join("");

const STATUS_COLOR: Record<string, string> = {
	Active: "green", Closed: "gray", Rejected: "red", "Due Soon": "amber", Overdue: "red",
	"Pending Approval": "info", "Auction Eligible": "red", Verified: "green",
	Pending: "amber", Failed: "red", Completed: "gray", Approved: "green",
	"Locker Stored": "brand", "Bank Pledged": "info", "Ready for Release": "amber",
	Released: "gray", "Notice Issued": "amber", "Not Pledged": "gray", "Auction Scheduled": "red",
	"Packet Generated": "info", "Ready For Release": "amber", Returned: "brand",
	"Name Mismatch": "red",
	// A personal-loan installment whose due date has passed unpaid.
	Missed: "red",
	// Investment (internal/investment) status/payout chips.
	Matured: "amber", Renewed: "blue", Paid: "green",
	// verificationLabel()'s 3-value summary (customerService.ts) — shown as a
	// chip in the New Loan customer picker's dropdown rows.
	"Part Verified": "amber", Unverified: "red",
	// Loan-level only — a packet whose gold was auctioned still shows plain
	// "Released" (see loan.PacketMover.RecordGoldReleaseMovement), it's the
	// loan's own status that distinguishes an auction sale from an ordinary
	// release.
	Auctioned: "red", "Auctioned - Balance Due": "red",
};

export function statusChipColor(status: string): string {
	return STATUS_COLOR[status] || "gray";
}

// Today's date in the viewer's timezone as YYYY-MM-DD (toISOString would give the UTC day,
// which is yesterday in India before 05:30).
export const localToday = (): string => {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// App-wide date style: "05-10-2026" (DD-MM-YYYY). Reads the YYYY-MM-DD prefix
// of an ISO date/timestamp directly so it never shifts a day across timezones.
// "—" when empty or unparseable.
export const fmtDate = (v?: string | null) => {
	const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
	// Year 0001 is Go's zero time.Time — the backend's "never set" — not a date.
	return m && m[1] !== "0001" ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};

// "2026-11-02" + 3 → "2027-02-02". Overflow rolls on like the backend's time.AddDate (31 Jan + 1 → 3 Mar), so a
// preview shows the due date the server will actually set. "" for an unreadable date.
export const addMonthsISO = (v: string | null | undefined, months: number) => {
	const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
	if (!m || !Number.isFinite(months)) return "";
	const d = new Date(+m[1], +m[2] - 1 + months, +m[3]);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Whole years from a "YYYY-MM-DD" date of birth to today (local date), read
// from the string like fmtDate so it never shifts a day across timezones.
// null when empty, unparseable, Go's zero time, or in the future.
export const ageFromDob = (v?: string | null): number | null => {
	const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
	if (!m || m[1] === "0001") return null;
	const now = new Date();
	const [y, mo, d] = [+m[1], +m[2], +m[3]];
	const hadBirthday = now.getMonth() + 1 > mo || (now.getMonth() + 1 === mo && now.getDate() >= d);
	const age = now.getFullYear() - y - (hadBirthday ? 0 : 1);
	return age >= 0 ? age : null;
};

// Timestamp with its time kept: "05-10-2026 14:32" in local time. "—" when
// empty or unparseable.
export const fmtDateTime = (v?: string | null) => {
	const d = v ? new Date(v) : null;
	if (!d || Number.isNaN(d.getTime())) return "—";
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Today's local date as "05-10-2026".
export const fmtToday = () => {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};
