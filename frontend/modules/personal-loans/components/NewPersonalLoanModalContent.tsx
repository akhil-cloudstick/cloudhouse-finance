"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt, roundRupee } from "@/common/utils/format";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { searchBorrowersPage } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { VerifiedBadge } from "@/modules/customers/components/VerifiedBadge";
import { RegisterCustomerModalContent } from "@/common/components/modals/RegisterCustomerModalContent";
import { createPersonalLoan, editPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";
import { type BackendPersonalLoan, type Frequency, type InterestType } from "@/modules/personal-loans/types/personal-loan-types";
import { useBalanceInHand } from "@/common/hooks/use-balance-in-hand";
import { useApprovalWorkflow, useAuth } from "@/common/providers/AuthProvider";
import { firstStage, isFlowOff } from "@/common/services/approvalWorkflowService";

/* Client-side mirror of backend/internal/personalloan/service.go's
 * computeInterest — used only to render a live preview before submit; the
 * backend recomputes and is the source of truth. */
function computeInterest(principal: number, interestType: InterestType, value: number): number {
	const raw = interestType === "Percentage" ? (principal * value) / 100 : value;
	return roundRupee(raw);
}

// Server messages are put on the field they are about, by wording.
const SERVER_FIELDS: Record<string, RegExp> = {
	penal: /penal/i,
	grace: /grace/i,
	interest: /interest/i,
	principal: /principal/i,
	tenure: /installment|tenure/i,
	split: /breakdown|bank|cash|upi|cheque|balance/i,
	customer: /customer/i,
};

type NewPersonalLoanModalContentProps = { onSaved: () => void; /** Set to correct this loan's terms instead of opening a new one (only before any payment). */ loan?: BackendPersonalLoan };

// The loan amount as it was typed in: the stored principal is what is owed, which includes the interest on a full disbursement.
const enteredPrincipal = (l: BackendPersonalLoan) => (l.fullDisbursement ? l.principalAmount - l.interestAmount : l.principalAmount);
// Penal terms left at their default follow the loan's own interest, so they are shown blank.
const penalIsDefault = (l: BackendPersonalLoan) => (l.interestType === "Percentage" ? l.penalInterestRate === l.interestValue && !l.penalFlatAmount : !l.penalInterestRate && l.penalFlatAmount === l.interestAmount);

/* "New Personal Loan" — a modal (not a page) launched from PersonalLoans.tsx's
 * "+ New Personal Loan" button. No PAN/Aadhaar verification is required for
 * this product, unlike Gold Loan's NewLoan.tsx — any existing Customer may
 * be picked. Creation and disbursement happen as one step: submitting this
 * form both creates the loan and (implicitly) hands the customer
 * DisbursedAmount in cash. */
export function NewPersonalLoanModalContent({ onSaved, loan }: NewPersonalLoanModalContentProps) {
	const editing = !!loan;
	const canCreateCustomer = useAuth().can("Customer_Management", "can_create_customer");
	const { closeModal } = useModal();
	const toast = useToast();

	const [customerId, setCustomerId] = useState<number | undefined>(loan?.customerId);
	const [customerBranchId, setCustomerBranchId] = useState<number | undefined>(loan?.branchId);
	const [customerLabel, setCustomerLabel] = useState(loan ? `${loan.customer.name} (${loan.customer.code})` : "");
	// the picker's own id; not a number while the customer has not reached the server
	const [customerRef, setCustomerRef] = useState("");
	const pick = (id: string, branchId: number | undefined, label: string) => {
		const n = /^\d+$/.test(id) ? Number(id) : 0;
		setCustomerRef(id);
		setCustomerId(n > 0 ? n : undefined);
		setCustomerBranchId(branchId);
		setCustomerLabel(label);
	};
	const [principal, setPrincipal] = useState(loan ? String(enteredPrincipal(loan)) : "");
	const [interestType, setInterestType] = useState<InterestType>(loan?.interestType ?? "Flat");
	const [interestValue, setInterestValue] = useState(loan ? String(loan.interestValue) : "");
	const [frequency, setFrequency] = useState<Frequency>(loan?.frequency ?? "Daily");
	const [tenureCount, setTenureCount] = useState(loan ? String(loan.tenureCount) : "");
	// Default unchecked — today's behavior (interest withheld upfront, customer
	// repays principal only) is unchanged unless staff opts in.
	const [fullDisbursement, setFullDisbursement] = useState(loan?.fullDisbursement ?? false);
	// Both optional — left blank, the backend defaults penal rate to the
	// loan's own effective interest rate and grace period to 0 (see
	// CreateInput.PenalInterestRate's doc comment).
	const [penalInterestRate, setPenalInterestRate] = useState(loan && !penalIsDefault(loan) && loan.penalInterestRate ? String(loan.penalInterestRate) : "");
	const [gracePeriodDays, setGracePeriodDays] = useState(loan?.gracePeriodDays ? String(loan.gracePeriodDays) : "");
	// How the customer is paid (Cash / UPI / Bank Transfer / Cheque), and the
	// branch bank account a non-cash share leaves from. With the approval chain
	// on, the final stage books the cash-out using this choice.
	const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
	const [remaining, setRemaining] = useState(0);
	const [bankId, setBankId] = useState<number | undefined>(undefined);
	const [err, setErr] = useState("");
	const [fe, setFe] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	// Toggles this same mounted component over to the inline "+ Add new
	// customer" form (RegisterCustomerModalContent, via its `onCreated` prop)
	// instead of swapping the modal via useModal — swapping would unmount
	// this component and lose every field already typed (principal, tenure,
	// …). Kept local rather than lifted, since only this modal ever needs it.
	const [creatingCustomer, setCreatingCustomer] = useState(false);

	const principalNum = +principal || 0;
	const interestValueNum = +interestValue || 0;
	const tenureNum = +tenureCount || 0;
	const interestAmount = principalNum > 0 ? computeInterest(principalNum, interestType, interestValueNum) : 0;
	// Mirrors backend/internal/personalloan/service.go's CreateLoan branch:
	// unchecked disburses Principal-Interest and the obligation stays
	// Principal; checked disburses the full Principal and the obligation
	// becomes Principal+Interest instead.
	const disbursedAmount = fullDisbursement
		? principalNum
		: roundRupee((principalNum - interestAmount));
	const obligation = fullDisbursement
		? roundRupee((principalNum + interestAmount))
		: principalNum;
	const installmentAmount = tenureNum > 0 ? roundRupee((obligation / tenureNum)) : 0;
	// Disbursement is blocked until the branch has enough balance in hand.
	const balanceInHand = useBalanceInHand(customerBranchId);
	// With the personal_loan approval flow on, creating the loan only submits
	// it into the chain — nothing leaves the till until the final stage
	// approves it, so the balance check doesn't block submitting.
	const { config: workflow } = useApprovalWorkflow();
	const needsApproval = !editing && !isFlowOff(workflow, "personal_loan");
	// Editing keeps how the customer was paid unless the amount changes (then a new breakdown is needed); the server checks the till.
	const amountChanged = !!loan && Math.abs(disbursedAmount - loan.disbursedAmount) >= 0.005;
	const insufficient = !editing && !needsApproval && balanceInHand !== null && disbursedAmount > balanceInHand + 0.005;

	const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
	const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));

	async function save() {
		// Collect every missing/invalid section so all warnings show at once.
		const errs: Record<string, string> = {};
		// a customer this PC registered is known by its uuid until the server numbers it; the loan points at it by that, and the
		// server resolves it when the loan is sent (after the customer), so nothing waits for a number here
		const cid: number | string | undefined = customerId ?? (customerRef.startsWith("uuid:") ? customerRef : undefined);
		const bid = customerBranchId;
		if (!cid || !bid) errs.customer = "Please select a customer.";
		if (!principalNum || principalNum <= 0) errs.principal = "Please enter the principal amount.";
		if (!tenureNum || tenureNum <= 0) errs.tenure = "Please enter the number of installments.";
		if (interestValue.trim() === "") errs.interest = "Please enter the interest value.";
		else if (interestValueNum < 0) errs.interest = "Interest value must not be negative.";
		else if (principalNum > 0 && interestAmount >= principalNum) errs.interest = "Interest amount must be less than the principal amount.";
		if (insufficient) errs.split = "Insufficient balance in hand to disburse this loan.";
		else if ((!editing || amountChanged) && Math.abs(remaining) >= 0.01) errs.split = "The disbursement breakdown must add up to the amount the customer gets.";
		if (Object.keys(errs).length) { setErr(""); setFe(errs); return; }
		if (!cid || !bid) return;

		setSaving(true);
		setErr("");
		setFe({});
		try {
			if (loan) {
				await editPersonalLoan(loan.id, {
					principalAmount: principalNum,
					interestType,
					interestValue: interestValueNum,
					frequency,
					tenureCount: tenureNum,
					fullDisbursement,
					penalInterestRate: penalInterestRate ? +penalInterestRate : 0,
					gracePeriodDays: gracePeriodDays ? +gracePeriodDays : 0,
					...(amountChanged ? { ...split, bankId } : {}),
				});
				toast(`${loan.loanNumber} updated`);
				onSaved();
				return;
			}
			const created = await createPersonalLoan({
				branchId: bid,
				customerId: cid,
				principalAmount: principalNum,
				interestType,
				interestValue: interestValueNum,
				frequency,
				tenureCount: tenureNum,
				fullDisbursement,
				penalInterestRate: penalInterestRate ? +penalInterestRate : undefined,
				gracePeriodDays: gracePeriodDays ? +gracePeriodDays : undefined,
				...split,
				bankId,
			}, { customerName: customerLabel.replace(/\s*\([^)]*\)\s*$/, ""), customerCode: /\(([^)]*)\)\s*$/.exec(customerLabel)?.[1] ?? "", needsApproval });
			if (created.loanNumber === "Pending") {
				toast(needsApproval
					? "Personal loan saved on this PC and will be submitted for approval once the connection is back"
					: `Personal loan saved on this PC — ${fmt(disbursedAmount)} to the customer; it is sent once the connection is back`);
			} else if (created.status === "Pending Approval") {
				const first = firstStage(workflow, "personal_loan");
				toast(`Personal loan ${created.loanNumber} submitted for approval${first ? ` — awaiting ${first.label}` : ""}`);
			} else {
				toast(`Personal loan created — ${fmt(disbursedAmount)} disbursed to the customer`);
			}
			onSaved();
		} catch (e) {
			const msg = e instanceof ApiError ? e.message : "Could not create the loan — try again.";
			const field = e instanceof ApiError ? fieldForMessage(msg, SERVER_FIELDS) : "";
			if (field) fail(field, msg); else setErr(msg);
		} finally {
			setSaving(false);
		}
	}

	if (creatingCustomer && !editing) {
		return (
			<RegisterCustomerModalContent
				onCreated={(c) => {
					pick(String(c.id), c.branchId, `${c.name} (${c.code})`);
					setCreatingCustomer(false);
				}}
			/>
		);
	}

	return (
		<>
			<div className="hd"><h3>{loan ? `Edit ${loan.loanNumber}` : "New Personal Loan"}</h3><button className="x" onClick={closeModal}>×</button></div>
			<div className="bd bd-scroll pl-modal">
				<div className="frow"><div className={fe.customer ? "has-err" : undefined}><label className="f">Customer *</label>
					{editing ? <input className="inp" value={customerLabel} disabled readOnly /> : <SearchableSelect<CustomerView>
						value={customerLabel}
						onChange={(id, item) => { pick(String(id), item.branchId, `${item.name} (${item.code})`); clearFe("customer"); }}
						fetchFn={searchBorrowersPage}
						searchHint="Searches: customer name, customer code, phone"
						getLabel={(c) => `${c.name} (${c.code})`}
						/* Same treatment as the gold-loan picker (NewLoan.tsx): name
						 * plus a "Verified" badge when fully verified, and no negative
						 * text otherwise. */
						renderLabel={(c) => (
							<span className="ss-name">
								<b>{c.name} ({c.code})</b>
								<VerifiedBadge customer={c} />
							</span>
						)}
						getId={(c) => c.id}
						placeholder="Search for a customer…"
						onCreateNew={canCreateCustomer ? () => setCreatingCustomer(true) : undefined}
						createNewLabel="+ Add new customer"
					/>}<FieldError msg={fe.customer} /></div></div>
				<div className="pl-sec-h">Loan terms</div>
				<div className="frow c2">
					<div className={fe.principal ? "has-err" : undefined}><label className="f">Principal Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={principal} onChange={(e) => { setPrincipal(e.target.value); clearFe("principal"); clearFe("interest"); }} /><FieldError msg={fe.principal} /></div>
					<div className={fe.tenure ? "has-err" : undefined}><label className="f">Number of Installments *</label><input className="inp" type="number" min={1} placeholder="e.g. 50" value={tenureCount} onChange={(e) => { setTenureCount(e.target.value); clearFe("tenure"); }} /><FieldError msg={fe.tenure} /></div>
				</div>
				<div className="frow c2">
					<div><label className="f">Interest Type *</label>
						<div className="pl-seg" role="radiogroup">
							{([["Flat", "Flat ₹"], ["Percentage", "Percent %"]] as [InterestType, string][]).map(([v, label]) => (
								<button key={v} type="button" role="radio" aria-checked={interestType === v}
									className={interestType === v ? "on" : ""} onClick={() => setInterestType(v)}>{label}</button>
							))}
						</div>
					</div>
					<div className={fe.interest ? "has-err" : undefined}><label className="f">Interest Value *</label><input className="inp" type="number" min={0} step={0.01} placeholder={interestType === "Flat" ? "e.g. 100" : "e.g. 2"} value={interestValue} onChange={(e) => { setInterestValue(e.target.value); clearFe("interest"); }} /><FieldError msg={fe.interest} /></div>
				</div>
				<div className="frow c2">
					<div><label className="f">Collection Frequency *</label>
						<div className="pl-seg" role="radiogroup">
							{(["Daily", "Weekly", "Monthly"] as Frequency[]).map((f) => (
								<button key={f} type="button" role="radio" aria-checked={frequency === f}
									className={frequency === f ? "on" : ""} onClick={() => setFrequency(f)}>{f}</button>
							))}
						</div>
					</div>
					<div><label className="f">Disbursement</label>
						<label className={"ccheck pl-opt" + (fullDisbursement ? " on" : "")}>
							<input type="checkbox" checked={fullDisbursement} onChange={(e) => setFullDisbursement(e.target.checked)} />
							<span className="mark" />
							<span><strong>Full amount</strong> <span className="pl-opt-d">· no interest cut upfront</span></span>
						</label>
					</div>
				</div>

				<div className="pl-sec-h">Late payment <span>optional</span></div>
				<div className="frow c2">
					<div className={fe.penal ? "has-err" : undefined}><label className="f">Penal Interest Rate (% p.a.)</label><input className="inp" type="number" min={0} step={0.01} placeholder="Same as loan rate" value={penalInterestRate} onChange={(e) => { setPenalInterestRate(e.target.value); clearFe("penal"); }} /><FieldError msg={fe.penal} /></div>
					<div className={fe.grace ? "has-err" : undefined}><label className="f">Grace Period (days)</label><input className="inp" type="number" min={0} placeholder="e.g. 5" value={gracePeriodDays} onChange={(e) => { setGracePeriodDays(e.target.value); clearFe("grace"); }} /><FieldError msg={fe.grace} /></div>
				</div>

				{(!editing || amountChanged) && <><div className="pl-sec-h">Disbursement method</div>
				<div className="frow">
					<div className={fe.split ? "has-err" : undefined} style={{ width: "100%", minWidth: 0 }}>
						<SplitPaymentInput totalAmount={Math.max(0, disbursedAmount)} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
						<FieldError msg={fe.split} />
					</div>
				</div></>}

				{/* Live preview — dashes until principal and installments are set. */}
				{(() => {
					const ready = principalNum > 0 && tenureNum > 0;
					const v = (n: number) => (ready ? fmt(n) : "—");
					return (
						<div className="pl-sum">
							<div><span>Interest</span><b>{v(interestAmount)}</b></div>
							<div><span>Customer gets</span><b>{v(disbursedAmount)}</b></div>
							<div><span>Per installment</span><b>{v(installmentAmount)}</b>{ready && <small>/ {frequency.toLowerCase()}</small>}</div>
							<div><span>Total to repay</span><b>{v(obligation)}</b></div>
						</div>
					);
				})()}
				{balanceInHand !== null && (
					<p className={"pl-bal" + (insufficient ? " low" : "")}>
						Balance in hand: <strong>{fmt(balanceInHand)}</strong>
						{insufficient && " — add cash to disburse."}
					</p>
				)}

				{err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
			</div>
			<div className="ft">
				<button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
				<button className="btn" disabled={saving || insufficient} onClick={save}>{editing ? (saving ? "Saving…" : "Save Changes") : saving ? (needsApproval ? "Submitting…" : "Creating…") : needsApproval ? "Submit for Approval" : "Create & Disburse"}</button>
			</div>
		</>
	);
}
