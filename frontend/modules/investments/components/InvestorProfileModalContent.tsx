"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { ApiError } from "@/common/services/httpClient";
import { routeHref } from "@/common/services/appRoutes";
import { fmtDate } from "@/common/utils/format";
import { getCustomer, verificationLabel } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { ProofLink } from "@/modules/customers/components/ProofLink";

type InvestorProfileModalContentProps = { customerId: number };

/* Read-only profile of an investment's investor, opened from the investment
 * detail page's header. The full, editable profile stays on the customer page. */
export function InvestorProfileModalContent({ customerId }: InvestorProfileModalContentProps) {
	const { closeModal } = useModal();
	const canOpen = useCanOpenRoute();
	const [investor, setInvestor] = useState<CustomerView | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		getCustomer(String(customerId))
			.then((c) => { if (!cancelled) setInvestor(c); })
			.catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load the investor."); });
		return () => { cancelled = true; };
	}, [customerId]);

	const field = (label: string, value?: string | number | null) => (
		<div className="i"><div className="k">{label}</div><div className="v">{value || "—"}</div></div>
	);

	return (
		<>
			<div className="hd"><h3>Investor Profile</h3><button className="x" onClick={closeModal}>×</button></div>
			<div className="bd bd-scroll">
				{error && <p style={{ color: "var(--red)", fontSize: 12.5 }}>{error}</p>}
				{!error && !investor && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>}
				{investor && (
					<div className="kv">
						{field("Name", investor.name)}
						{field("Customer Code", investor.code)}
						{field("Phone", investor.phone)}
						{field("Father's Name", investor.fatherName)}
						{field("Date of Birth", investor.dob ? fmtDate(investor.dob) : "")}
						{field("Address", investor.address)}
						{field("Branch", investor.branchName)}
						{field("PAN", investor.pan)}
						{field("Aadhaar", investor.aadhaarLast4 ? `XXXX XXXX ${investor.aadhaarLast4}` : "")}
						{field("Verification", verificationLabel(investor))}
						{field("Nominee", investor.nomineeName ? `${investor.nomineeName}${investor.nomineeRelation ? ` (${investor.nomineeRelation})` : ""}` : "")}
						{field("Nominee Phone", investor.nomineePhone)}
						{field("Bank Account Name", investor.bankAccountName)}
						{field("Bank Account No.", investor.bankAccountNumber)}
						{field("IFSC", investor.bankIfsc)}
						<ProofLink label="Identity Proof" url={investor.identityProofUrl} />
						<ProofLink label="Address Proof" url={investor.addressProofUrl} />
					</div>
				)}
			</div>
			<div className="ft">
				<button className="btn ghost" onClick={closeModal}>Close</button>
				{investor && canOpen("customer") && (
					<a className="btn" href={routeHref("customer", investor.code || investor.id)} onClick={closeModal}>Open full profile</a>
				)}
			</div>
		</>
	);
}
