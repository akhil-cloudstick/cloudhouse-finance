/* Loan documents made on this PC while the server cannot be reached. The same templates the backend uses are bundled in
 * the desktop app (desktop/templates, filled by desktop/documents.go) and filled here from the loan this PC holds, so a
 * document prints with the customer's data in it. Online the backend makes every document as before: callers only come
 * here when the server did not answer at all. */

import { getLocal, listLocal } from "@/common/offline";
import { canMakeOffline, canRenderOffline, printHtml, renderAndPrint } from "@/common/offline/documents";
import { offlineDocs } from "@/common/services/desktopBridge";
import { getBusinessProfile } from "@/modules/settings/services/businessProfileService";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { localLoanByNumericId } from "@/modules/loans/services/loanOffline";
import type { IndemnityBondPreviewInput } from "@/modules/loans/types/loan-types";

export { canMakeOffline, canRenderOffline };

export type OfflineDocKind = "pledge-slip" | "statement" | "release-agreement" | "bond" | "tml-pledge-slip" | "tml-statement";

/* The loan this PC holds: by the server's number, or by the id this PC gave it while the server has not numbered it yet. */
function heldLoan(loanNumericId: number, uuid?: string): (Record<string, unknown> & { customerId?: number; customer?: Record<string, unknown> }) | undefined {
	const loan = (localLoanByNumericId(loanNumericId) ?? (uuid ? getLocal("loans", uuid) : undefined)) as unknown as (Record<string, unknown> & { customerId?: number; customer?: Record<string, unknown> }) | undefined;
	if (!loan) return undefined;
	// the server gives the number when it receives the loan; until then the paper says so rather than showing a blank
	return loan.loanNumber ? loan : { ...loan, loanNumber: "Pending (number given on sync)" };
}

export async function printOfflineLoanDocument(kind: OfflineDocKind, loanNumericId: number, lang = "en", uuid?: string): Promise<void> {
	await printHtml(await renderOfflineLoanDocument(kind, loanNumericId, lang, uuid));
}

/* The finished HTML of a loan document, made from the loan this PC holds. */
export async function renderOfflineLoanDocument(kind: OfflineDocKind, loanNumericId: number, lang = "en", uuid?: string): Promise<string> {
	const loan = heldLoan(loanNumericId, uuid);
	if (!loan) throw new Error("This loan is not on this PC yet, so its document cannot be made offline.");
	// the loan carries only the customer's name, code and phone; the address is on the customer's own record
	const customer = listLocal("customers").find((c) => c.id === loan.customerId) as Record<string, unknown> | undefined;
	const profile = await getBusinessProfile().catch(() => null);
	const branches = await listActiveBranches().catch(() => []);
	// the same value under either spelling (the local copy is camelCase, the server's own answer snake_case)
	const pick = (a: string, b: string) => (customer?.[a] ?? customer?.[b] ?? "") as string;
	const input = {
		loan: {
			...loan,
			customer: {
				...(loan.customer ?? {}), id: loan.customerId, address: pick("address", "address"),
				dob: pick("dob", "dob"), pan: pick("pan", "pan"), aadhaarLast4: pick("aadhaarLast4", "aadhaar_last4"),
				age: (customer?.age as number | undefined) ?? null,
			},
		},
		profile: profile ?? {},
		singleBranch: branches.length <= 1,
	};
	// a Tamil Nadu (TML) business has its own pledge slip
	const policy = String((profile as { policy?: string } | null)?.policy ?? "").toUpperCase();
	return offlineDocs.render(kind === "pledge-slip" && policy === "TML" ? "tml-pledge-slip" : kind, lang, JSON.stringify(input));
}

/* The pledge agreement printed from New Loan before the loan is saved: filled from the form (the server needs the loan to
 * exist for anything else). */
export async function printOfflineBondPreview(data: IndemnityBondPreviewInput, lang: string): Promise<void> {
	const profile = await getBusinessProfile().catch(() => null);
	const branches = await listActiveBranches().catch(() => []);
	const input = {
		loan: {
			loanNumber: data.loanNumber,
			principalAmount: data.principalAmount ?? 0,
			schemeInterestRate: data.interestRate ?? 0,
			dueDate: data.dueDate ?? "",
			openedDate: new Date().toISOString(),
			branch: { Name: data.branchName ?? "" },
			customer: { name: data.name ?? "", address: data.address ?? "", phone: data.phone ?? "", pan: data.pan ?? "", dob: data.dob ?? "", aadhaar: data.aadhaar ?? "" },
			ornaments: data.ornaments.map((o) => ({ name: o.name, purity: o.purity ?? "", grossWeight: o.grossWeight, netWeight: o.netWeight, quantity: 1, goldValue: o.value })),
		},
		profile: profile ?? {},
		singleBranch: branches.length <= 1,
	};
	await renderAndPrint("bond", lang, input);
}

/* The receipt of a partial gold release, from the release request and this PC's copy of the loan. `request` is the row the
 * Requests page lists (what was settled, which ornaments the request released). */
export async function printOfflinePartialReceipt(request: { loanNumericId: number; settlementAmount?: number; ornamentIds?: number[] }, lang: string): Promise<void> {
	const loan = localLoanByNumericId(request.loanNumericId) as unknown as (Record<string, unknown> & { customerId?: number; customer?: Record<string, unknown> }) | undefined;
	if (!loan) throw new Error("This loan is not on this PC yet, so its receipt cannot be made offline.");
	const customer = listLocal("customers").find((c) => c.id === loan.customerId) as { address?: string } | undefined;
	const profile = await getBusinessProfile().catch(() => null);
	const branches = await listActiveBranches().catch(() => []);
	await renderAndPrint("partial-release-receipt", lang, {
		loan: { ...loan, customer: { ...(loan.customer ?? {}), id: loan.customerId, address: customer?.address ?? "" } },
		receipt: { settlementAmount: request.settlementAmount ?? 0, ornamentIds: request.ornamentIds ?? [], releaseDate: new Date().toISOString() },
		profile: profile ?? {},
		singleBranch: branches.length <= 1,
	});
}
