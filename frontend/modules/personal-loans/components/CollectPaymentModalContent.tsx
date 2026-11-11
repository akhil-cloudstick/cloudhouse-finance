"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt, roundRupee } from "@/common/utils/format";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";
import { recordPersonalLoanPayment } from "@/modules/personal-loans/services/personalLoanService";
import { type BackendPersonalLoan } from "@/modules/personal-loans/types/personal-loan-types";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";

// Server messages are put on the field they are about, by wording.
const SERVER_FIELDS: Record<string, RegExp> = {
	split: /breakdown|bank|cash|upi|cheque/i,
	amount: /amount/i,
};

type CollectPaymentModalContentProps = { loan: BackendPersonalLoan; onSaved: () => void };

export function CollectPaymentModalContent({ loan, onSaved }: CollectPaymentModalContentProps) {
	const { closeModal } = useModal();
	const toast = useToast();

	// Defaults to the loan's standard installment amount (capped at whatever
	// is actually still owed, for a loan nearing its final, smaller
	// installment) — the common case is collecting exactly one installment,
	// so the field starts pre-filled with that rather than empty; staff can
	// still edit it for a partial/extra payment.
	// Whole rupees, as the backend holds the payment to — a loan saved before
	// rounding can still owe paise (1234.60).
	const outstanding = roundRupee(loan.outstandingAmount);
	const defaultAmount = roundRupee(Math.min(loan.installmentAmount, outstanding));
	const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : "");
  // How many installments the customer is paying for. Typing a count sets the
  // amount to count × installment (capped at what is still owed); editing the
  // amount directly still works for partial/extra payments.
  const maxInstallments = loan.installmentAmount > 0 ? Math.max(1, Math.min(loan.tenureCount || Infinity, Math.ceil(outstanding / loan.installmentAmount))) : 1;
  const [count, setCount] = useState(defaultAmount > 0 ? "1" : "");
	const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
	const [remaining, setRemaining] = useState(0);
	const [bankId, setBankId] = useState<number | undefined>(undefined);
	const [err, setErr] = useState("");
	const [fe, setFe] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	const amt = +amount || 0;
	const balanced = Math.abs(remaining) < 0.01;

	const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
	const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));

	async function save() {
		// Every problem is shown at once, each under its own field.
		const errors: Record<string, string> = {};
		if (!amt || amt <= 0) errors.amount = "Please enter the amount collected.";
		else if (roundRupee(amt) > outstanding + 0.01) errors.amount = `Amount cannot exceed the outstanding balance of ${fmt(outstanding)}.`;
		if (!balanced) errors.split = "The payment breakdown must add up to the amount collected.";
		if (Object.keys(errors).length) { setErr(""); setFe(errors); return; }
		setSaving(true);
		setErr("");
		setFe({});
		try {
			await recordPersonalLoanPayment(loan.id, {
				amount: amt,
				cashAmount: split.cashAmount,
				upiAmount: split.upiAmount,
				bankTransferAmount: split.bankTransferAmount,
				chequeAmount: split.chequeAmount,
				bankId,
			});
			toast(`Payment of ${fmt(amt)} recorded against ${loan.loanNumber}`);
			onSaved();
		} catch (e) {
			const msg = e instanceof ApiError ? e.message : "Could not record the payment — try again.";
			const field = e instanceof ApiError ? fieldForMessage(msg, SERVER_FIELDS) : "";
			if (field) fail(field, msg); else setErr(msg);
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<div className="hd"><h3>Collect Payment — {loan.loanNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
			<div className="bd">
				<div className="notice" style={{ marginBottom: 16, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
					<span>Outstanding balance: <strong>{fmt(loan.outstandingAmount)}</strong></span>
					<span>Balance after payment: <strong>{fmt(Math.max(0, loan.outstandingAmount - amt))}</strong></span>
				</div>
				<div className="frow c2">
					<div><label className="f">No. of installments</label><input className="inp" type="number" min={1} max={maxInstallments} step={1} placeholder="e.g. 1" value={count} onChange={(e) => {
            // Can't exceed the installments still to be paid.
            let v = e.target.value;
            if (v !== "" && Math.floor(+v) > maxInstallments) v = String(maxInstallments);
            if (v !== "" && +v < 1) v = "1";
            setCount(v);
            const n = Math.floor(+v);
            if (n > 0) { setAmount(String(roundRupee(Math.min(n * loan.installmentAmount, outstanding)))); clearFe("amount"); }
          }} /></div>
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} max={loan.outstandingAmount} placeholder={`e.g. ${defaultAmount}`} value={amount} onChange={(e) => { setAmount(e.target.value); setCount(""); clearFe("amount"); }} /><FieldError msg={fe.amount} /></div>
				</div>
				<div className="frow" style={{ marginTop: 4 }}>
					<div className={fe.split ? "has-err" : undefined} style={{ width: "100%", minWidth: 0 }}>
						<SplitPaymentInput totalAmount={amt} onChange={(s, r, b) => { setSplit(s); setRemaining(r); setBankId(b); }} />
						<FieldError msg={fe.split} />
					</div>
				</div>
				{err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
			</div>
			<div className="ft">
				<button className="btn ghost" onClick={closeModal}>Cancel</button>
				<button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? "Collecting…" : "Collect"}</button>
			</div>
		</>
	);
}
