"use client";

import { NoteField } from "@/common/components/ui/NoteField";
import { useEffect, useRef, useState } from "react";
import { MAX_ORN_PHOTOS } from "@/modules/loans/utils/ornamentPhotos";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { PurityPicker } from "@/common/components/PurityPicker";
import { fmt, roundRupee, schemeOptionLabel } from "@/common/utils/format";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { rateForPurityFull } from "@/common/utils/purity";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { searchActiveSchemesPage } from "@/modules/schemes/services/schemeService";
import { type SchemeView } from "@/modules/schemes/types/scheme-types";
import { searchOrnamentTypesPage, createOrnamentType, deleteOrnamentType } from "@/modules/ornament-types/services/ornamentTypeService";
import { type BackendOrnamentType } from "@/modules/ornament-types/types/ornament-type-types";
import { customerRef } from "@/modules/customers/services/customerOffline";
import { FollowingEntriesTable } from "@/modules/loans/components/FollowingEntriesTable";
import { InterestChangesTable, type InterestChangeView } from "@/modules/loans/components/InterestChangesTable";
import { GoldReleaseDependents, goldChoicesOf } from "@/modules/loans/components/GoldReleaseDependents";
import { type LedgerEditDependent, type LedgerFollowingEntry, previewLoanEdit, listTopUps, updateLoan, addOrnament, updateOrnament, deleteOrnament, addOrnamentImage } from "@/modules/loans/services/loanService";
import { uploadFile } from "@/modules/customers/services/customerService";
import { PhotoSourceMenu } from "@/common/components/ui/PhotoSourceMenu";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { Select } from "@/common/components/ui/Select";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { listLockers } from "@/modules/lockers/services/lockerService";
import { type LockerView } from "@/modules/lockers/types/locker-types";
import { listPackets } from "@/modules/packets/services/packetService";
import { SplitPaymentInput, type SplitAmounts, type SplitPaymentLine } from "@/common/components/SplitPaymentInput";
import { type LoanView, type OrnamentView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// `photos` are the ornament's saved photos; `newPhotos` were uploaded in this
// edit and are attached on Save (so Cancel leaves the loan untouched).
type OrnRow = { id?: number; name: string; purity: string; gross: string; less: string; net: string; qty: string; removed?: boolean; photos: string[]; newPhotos: string[] };

function toRow(o: OrnamentView): OrnRow {
	return { id: o.id, name: o.name, purity: o.purity, gross: String(o.grossWeight), less: String(Math.round(Math.max(0, o.grossWeight - o.netWeight) * 1000) / 1000), net: String(o.netWeight), qty: String(o.quantity), photos: o.photoUrls ?? [], newPhotos: [] };
}

type EditLoanModalContentProps = { loan: LoanView; onSaved: () => void };

/* Lets staff correct a loan's scheme, principal amount, or ornaments even
 * after final sanction — see backend Service.UpdateLoan/DeleteOrnament's
 * own doc comments for exactly what does and doesn't change (prospective
 * only: a scheme swap applies to interest/eligibility from here forward,
 * never rewriting already-recorded AccruedInterest). Editing scheme or
 * principal — the two fields that change what's charged/owed — resubmits
 * the loan for the sanction chain (ApprovalStage resets, Status goes back
 * to Pending Approval), so the warning below fires the moment either one
 * differs from what the loan already has; ornament-only edits do not. */
// Local calendar date as YYYY-MM-DD (not UTC, so late evening does not read as tomorrow).
function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function EditLoanModalContent({ loan, onSaved }: EditLoanModalContentProps) {
	const { closeModal } = useModal();
	const toast = useToast();
	const { latest: goldRate } = useGoldRates();

	const [schemeId, setSchemeId] = useState(loan.schemeId); // string, matches SchemeView.id
	const [schemeLabel, setSchemeLabel] = useState(`${loan.schemeName}`);
  // The scheme's LTV now (what the server checks the amount against), not the one frozen on the loan.
  const [schemeLtv, setSchemeLtv] = useState(loan.currentSchemeLtv ?? loan.schemeLtv);
  // the newly picked scheme's service charge terms (null while the loan's own scheme is kept)
  const [schemeObj, setSchemeObj] = useState<SchemeView | null>(null);
  // How the service charge is taken: kept from the loan, or reset to the new scheme's own when the scheme is switched.
  type ChargeMode = "WithheldFromPayout" | "AddedToPrincipal";
  const loanChargeMode: ChargeMode = loan.serviceChargeMode === "AddedToPrincipal" ? "AddedToPrincipal" : "WithheldFromPayout";
  const [chargeMode, setChargeMode] = useState<ChargeMode>(loanChargeMode);
  // The loan's opening date; changing it moves the due date and redoes the interest from the new date.
  const [openedDate, setOpenedDate] = useState(loan.opened);
  // The amount the customer asked for: the loan's principal, less the service charge when that was added on top of it.
  const [amount, setAmount] = useState(String(Math.round((loan.principal - (loanChargeMode === "AddedToPrincipal" ? (loan.serviceChargeAmount || 0) : 0)) * 100) / 100));
	const [rows, setRows] = useState<OrnRow[]>(loan.ornaments.map(toRow));
	const [overallPhoto, setOverallPhoto] = useState(loan.overallPhotoUrl);
	const [additionalInfo, setAdditionalInfo] = useState(loan.additionalInfo || "");
	const [err, setErr] = useState("");
	const [fe, setFe] = useState<Record<string, string>>({});
	// Row-level message: which ornament row (index into `rows`) it is about.
	const [rowErr, setRowErr] = useState<{ idx: number; msg: string } | null>(null);
	const [saving, setSaving] = useState(false);

	const fail = (field: string, msg: string) => { setErr(""); setRowErr(null); setFe({ [field]: msg }); };
	const failRow = (r: OrnRow, msg: string) => { setErr(""); setFe({}); setRowErr({ idx: rows.indexOf(r), msg }); };

	function updRow(i: number, patch: Partial<OrnRow>) {
		setRowErr((cur) => (cur?.idx === i ? null : cur));
		setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
	}
	// Gross/Less drive Net (gross − less); typing Net directly back-fills Less — same as New Loan.
	const w3 = (n: number) => String(Math.round(Math.max(0, n) * 1000) / 1000);
	const wOk = (v: string) => /^\d*\.?\d{0,3}$/.test(v);
	function setGross(i: number, v: string) {
		if (!wOk(v)) return;
		setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, gross: v, net: v === "" ? "" : w3(+v - (+r.less || 0)) } : r)));
		setRowErr((cur) => (cur?.idx === i ? null : cur));
	}
	function setLess(i: number, v: string) {
		if (!wOk(v)) return;
		setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, less: v, net: r.gross === "" ? r.net : w3(+r.gross - (+v || 0)) } : r)));
		setRowErr((cur) => (cur?.idx === i ? null : cur));
	}
	function setNet(i: number, v: string) {
		if (!wOk(v)) return;
		setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, net: v, less: r.gross === "" || v === "" ? r.less : w3(+r.gross - +v) } : r)));
		setRowErr((cur) => (cur?.idx === i ? null : cur));
	}
	function addRow() {
		setRows((rs) => [...rs, { name: "", purity: "22K", gross: "", less: "", net: "", qty: "1", photos: [], newPhotos: [] }]);
	}
  // At most MAX_ORN_PHOTOS per ornament (saved + new); uploads in flight count too,
  // since a multi-select delivers several files in one tick.
  const pendingPhotos = useRef<Record<number, number>>({});
	async function ornPhotoPicked(i: number, f: File) {
		if (!f.type.startsWith("image/")) { toast("Please choose an image file"); return; }
    const inFlight = pendingPhotos.current[i] ?? 0;
    const have = (rows[i]?.photos.length ?? 0) + (rows[i]?.newPhotos.length ?? 0);
    if (have + inFlight >= MAX_ORN_PHOTOS) {
      toast(`Too many photos — an ornament can have at most ${MAX_ORN_PHOTOS}`);
      return;
    }
    pendingPhotos.current[i] = inFlight + 1;
		try {
			const url = await uploadFile(f);
			setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, newPhotos: [...r.newPhotos, url] } : r)));
		} catch {
			toast("Could not upload photo — try again");
    } finally {
      pendingPhotos.current[i] = Math.max(0, (pendingPhotos.current[i] ?? 1) - 1);
		}
	}
	function dropNewPhoto(i: number, url: string) {
		setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, newPhotos: r.newPhotos.filter((u) => u !== url) } : r)));
	}
	async function overallPhotoPicked(f: File) {
		if (!f.type.startsWith("image/")) { toast("Please choose an image file"); return; }
		try {
			setOverallPhoto(await uploadFile(f));
		} catch {
			toast("Could not upload photo — try again");
		}
	}
	function removeRow(i: number) {
		setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, removed: true } : r)));
	}

	const activeRows = rows.filter((r) => !r.removed);

	// Live preview — deliberately NOT the same plain K24-only derivation
	// NewLoan.tsx's own valuation panel uses. This modal edits an EXISTING
	// loan, so a 22K/18K ornament here can very plausibly have been valued
	// (and re-valued on every future accrual) against an independently
	// Manual-published K22/K18 that diverges from the K24 ratio — using the
	// plain derivation here silently disagreed with what the backend
	// actually enforces, showing an eligible amount high enough to accept a
	// principal the save then rejected. rateForPurityFull reads the same
	// stored K22/K18 the backend's own rateForPurity does. NewLoan.tsx
	// itself is untouched — this fix is scoped to this modal only.
  // An ornament left as it was keeps the value it was given when it was saved (that stored value is what the
  // backend adds up for the eligible amount). Only a new or changed ornament is valued at today's rate; valuing
  // every row at today's rate made the eligible amount — and so the highest principal allowed — drop whenever
  // the gold rate had fallen since the loan was opened.
  const totalGoldValue = activeRows.reduce((s, r) => {
    const saved = r.id != null ? loan.ornaments.find((o) => o.id === r.id) : undefined;
    const unchanged = saved && saved.purity === r.purity && Math.abs((+r.net || 0) - saved.netWeight) < 0.0005;
    return s + (unchanged ? saved.goldValue : (+r.net || 0) * (rateForPurityFull(goldRate, r.purity) ?? 0));
  }, 0);
	// Rounded to paise like the backend's common.RoundMoney — the raw float can
	// carry hidden digits past the two shown, which made the exact eligible
	// amount typed into Principal fail the "cannot exceed" check.
  // A scheme not based on gold LTV (LTV 0) puts no cap on the amount.
  const ltvBased = schemeLtv > 0;
	const eligibleLoanAmount = roundRupee(((totalGoldValue * schemeLtv) / 100));

	// Mirrors the backend's own materialChange check in Service.UpdateLoan —
	// scheme or principal differing from what's on file is what triggers
	// re-approval there, so the warning here fires on exactly the same
	// condition rather than a looser "any field touched" guess.
	// The principal can never be typed above the eligible amount — anything
	// higher is pulled back to the cap (floored to a whole rupee so it stays
	// under it) instead of waiting for Save to refuse it.
	const capToEligible = (value: string) => {
		const n = +value;
    return ltvBased && eligibleLoanAmount > 0 && n > eligibleLoanAmount ? String(Math.floor(eligibleLoanAmount)) : value;
	};

	// A loan already paid out: how its payout was made can be corrected here too. The total follows the principal
	// (a percentage service charge follows it, a flat one stays), and the breakdown must add up to it.
	const paidOut = !!loan.disbursementDate;
	// the payout in force: a loan edited the old way also keeps an earlier payout and its reversal
	const disbursement = [...loan.payments].reverse().find((p) => p.type === "Disbursement");
  // Like New Loan: staff type the Amount; the service charge comes off it (Deduct) or rides on top of it (Add to loan),
  // and the loan's principal follows.
  const amountNum = +amount > 0 ? +amount : 0;
  const useNew = schemeObj !== null && schemeId !== loan.schemeId;
  const chargeType = useNew ? schemeObj.serviceChargeType : loan.serviceChargeType;
  const chargeValue = useNew ? schemeObj.serviceChargeValue : (loan.serviceChargeValue ?? 0);
  const serviceCharge = chargeType === "Percent"
    ? Math.round(amountNum * chargeValue) / 100
    : useNew ? (chargeType === "Flat" ? chargeValue : 0) : loan.serviceChargeAmount;
  const hasCharge = !!chargeType && chargeType !== "None";
  const principalTotal = amountNum > 0 ? Math.round((hasCharge && chargeMode === "AddedToPrincipal" ? amountNum + serviceCharge : amountNum) * 100) / 100 : loan.principal;
  // The amount the loan started with is its principal less the top-ups paid out since — the same figure the server
  // works from. Until the top-ups load, the stored sanction stands in for it.
  const [topUpSum, setTopUpSum] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    listTopUps(loan.numericId)
      .then((ups) => { if (!cancelled) setTopUpSum(roundRupee(ups.filter((t) => t.status === "Active").reduce((s, t) => s + t.amount, 0))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loan.numericId]);
  const newSanctioned = topUpSum !== null
    ? principalTotal - topUpSum
    : (loan.sanctionedAmount || loan.principal) + (principalTotal - loan.principal);
  const modeChanged = hasCharge && chargeMode !== loanChargeMode;
  // A switched scheme brings its own mode on the server, so the chosen one is always sent along with it.
  const sendMode = hasCharge && (modeChanged || schemeId !== loan.schemeId);
	const payout = roundRupee((newSanctioned - serviceCharge));
	const payoutLines: SplitPaymentLine[] | undefined = disbursement ? [
		disbursement.cashAmount > 0 && { mode: "Cash" as const, amount: String(disbursement.cashAmount) },
		disbursement.upiAmount > 0 && { mode: "UPI" as const, amount: String(disbursement.upiAmount), bankId: disbursement.bankId ?? undefined, bankName: disbursement.bankName },
		disbursement.bankTransferAmount > 0 && { mode: "Bank Transfer" as const, amount: String(disbursement.bankTransferAmount), bankId: disbursement.bankId ?? undefined, bankName: disbursement.bankName },
	].filter(Boolean) as SplitPaymentLine[] : undefined;
	const [payoutSplit, setPayoutSplit] = useState<SplitAmounts | null>(null);
	const [payoutRemaining, setPayoutRemaining] = useState(0);
	const [payoutBankId, setPayoutBankId] = useState<number | undefined>(undefined);
	const payoutChanged = !!disbursement && !!payoutSplit && (
		Math.abs(payoutSplit.cashAmount - disbursement.cashAmount) > 0.005 ||
		Math.abs(payoutSplit.upiAmount - disbursement.upiAmount) > 0.005 ||
		Math.abs(payoutSplit.bankTransferAmount - disbursement.bankTransferAmount) > 0.005 ||
		((payoutSplit.upiAmount > 0 || payoutSplit.bankTransferAmount > 0) && (payoutBankId ?? null) !== (disbursement.bankId ?? null))
	);

	// Branch and locker: only for a role that may see every branch. The gold goes to a locker of the loan's branch.
	const showBranch = useShowBranch();
	const [branches, setBranches] = useState<BranchView[]>([]);
	const [branchSel, setBranchSel] = useState(String(loan.branchId));
	const [lockers, setLockers] = useState<LockerView[]>([]);
	const [lockerSel, setLockerSel] = useState("");
	const [packetLocker, setPacketLocker] = useState<number | null>(null); // the locker the packet is in now
	const [hasPacket, setHasPacket] = useState(false);
	useEffect(() => {
		if (!showBranch) return;
		listActiveBranches().then(setBranches).catch(() => {});
		listPackets({ loanId: loan.numericId }).then((ps) => {
			setHasPacket(ps.length > 0);
			const id = ps[0]?.currentLockerId ?? null;
			setPacketLocker(id);
			if (id) setLockerSel(String(id));
		}).catch(() => {});
	}, [showBranch, loan.numericId]);
	useEffect(() => {
		if (!showBranch) return;
		listLockers({ branchId: [+branchSel] }).then((ls) => setLockers(ls.filter((x) => x.isActive))).catch(() => setLockers([]));
	}, [showBranch, branchSel]);
	const branchChanged = branchSel !== String(loan.branchId);
	const lockerChanged = !!lockerSel && +lockerSel !== packetLocker;

	// Later payments that no longer fit once the loan is recalculated under the new scheme / amount: shown for review
	// (each lowered to what it can still be, editable) before anything is saved.
	const [following, setFollowing] = useState<LedgerFollowingEntry[]>([]);
	const [follow, setFollow] = useState<Record<number, string>>({});
	// the scheme / amount the review above was made for: change either and the review no longer applies
	const [reviewedFor, setReviewedFor] = useState("");
	const [depList, setDepList] = useState<LedgerEditDependent[]>([]);
	const [interestList, setInterestList] = useState<InterestChangeView[]>([]);
	const [chosenDeps, setChosenDeps] = useState<Record<string, boolean>>({});
  const reviewKey = `${schemeId}|${principalTotal}|${modeChanged ? chargeMode : ""}`;
	const activeFollowing = reviewedFor === reviewKey ? following : [];
	const activeDeps = reviewedFor === reviewKey ? depList : [];

  const triggersReapproval = schemeId !== loan.schemeId || (amountNum > 0 && principalTotal !== loan.principal) || modeChanged;

	async function save() { return singleFlight("modal:editloan:save", async () => {
		setErr(""); setFe({}); setRowErr(null);
		// Every problem is shown at once, each beside its own field.
		const errors: Record<string, string> = {};
    if (!(amountNum > 0)) errors["principal"] ??= "Please enter a valid amount.";
		if (!activeRows.length) errors["ornaments"] ??= "A loan must have at least one ornament.";
		const incomplete = activeRows.find((r) => !r.name.trim() || !(+r.gross > 0) || !(+r.net > 0));
		if (incomplete) {
			const missing = [!incomplete.name.trim() && "name", !(+incomplete.gross > 0) && "gross weight", !(+incomplete.net > 0) && "net weight"].filter(Boolean).join(", ");
			failRow(incomplete, `Ornament ${rows.indexOf(incomplete) + 1} is missing: ${missing}.`);
			return;
		}
		const heavier = activeRows.find((r) => +r.net > +r.gross);
		if (heavier) { failRow(heavier, "Net Wt cannot be greater than Gross Wt for any ornament."); return; }
		// Checked against the SAME live estimate shown in the Eligible Loan
		// Amount field above, not a stale pre-edit figure — the backend
		// recomputes and enforces this independently on save too, but this
		// gives immediate feedback consistent with what's already on screen.
    if (ltvBased && roundRupee(amountNum) > eligibleLoanAmount) errors["principal"] ??= `Amount cannot exceed the eligible loan amount (${fmt(eligibleLoanAmount)}).`;
		if (Object.keys(errors).length) { setErr(""); setFe(errors); return; }

		if (showBranch && branchChanged && hasPacket && packetLocker && !lockerSel) {
			setErr("Choose a locker in the new branch for the gold."); return;
		}
    const principalChanged = principalTotal !== loan.principal;
    if (hasCharge && payout <= 0) { setErr("The service charge must be less than the amount."); return; }
		if (paidOut && (payoutChanged || principalChanged)) {
			if (Math.abs(payoutRemaining) > 0.01) { setErr(`The payout breakdown must add up to ${fmt(payout)}.`); return; }
			if (payoutSplit && (payoutSplit.upiAmount > 0 || payoutSplit.bankTransferAmount > 0) && !payoutBankId) { setErr("Select the bank for the UPI / Bank Transfer part of the payout."); return; }
		}

		setSaving(true);
		try {
			// A loan already paid out is recalculated by a scheme or amount change: look first at what that does to its
			// later payments, so nothing is saved until the staff member has seen them.
      const recalculates = paidOut && (schemeId !== loan.schemeId || principalChanged || modeChanged);
			// Any recalculating edit is looked at first: the later payments (and what a release did to the gold) are shown
			// and nothing is saved until they have been seen and Save is pressed again.
			if (recalculates && reviewedFor !== reviewKey) {
				const probe = await previewLoanEdit(loan.numericId, {
					schemeId: schemeId !== loan.schemeId ? Number(schemeId) : undefined,
          principalAmount: principalChanged ? principalTotal : undefined,
          serviceChargeMode: sendMode ? chargeMode : undefined,
					...(paidOut && payoutSplit && (payoutChanged || principalChanged)
						? { cashAmount: payoutSplit.cashAmount, upiAmount: payoutSplit.upiAmount, bankTransferAmount: payoutSplit.bankTransferAmount, bankId: payoutBankId }
						: {}),
				});
				if (probe.following?.length || probe.dependents?.length || probe.interestChanges?.length) {
					setInterestList(probe.interestChanges ?? []);
					setFollowing(probe.following ?? []);
					setDepList(probe.dependents ?? []);
					setReviewedFor(reviewKey);
					setFollow(Object.fromEntries((probe.following ?? []).map((f) => [f.id, String(f.current)])));
					setChosenDeps(Object.fromEntries((probe.dependents ?? []).map((d) => [d.kind, true])));
					return;
				}
			}
			// Ornaments MUST be saved before updateLoan() below — each ornament
			// call revalues that row against the live gold rate and recalculates
			// the loan's EligibleLoanAmount for real (see backend's
			// valueOrnament/recalculateTotals), while updateLoan()'s own
			// eligibility check just sums whatever GoldValue is ALREADY stored
			// per ornament. Calling updateLoan() first (the original order here)
			// meant a principal raised to match a net-weight increase in this
			// same save got validated against the OLD, not-yet-applied
			// ornament values and rejected even though the live preview above
			// already accounted for the new ones.
			for (const r of rows) {
				const input = {
					name: r.name.trim(), purity: r.purity, grossWeight: +r.gross,
					deductionWeight: Math.round(Math.max(0, +r.gross - +r.net) * 1000) / 1000, quantity: +r.qty || 1,
				};
				if (r.removed) {
					if (r.id) await deleteOrnament(r.id);
				} else if (r.id) {
					await updateOrnament(r.id, input);
					for (const url of r.newPhotos) await addOrnamentImage(r.id, url);
				} else {
					await addOrnament(loan.numericId, { ...input, images: r.newPhotos });
				}
			}
			await updateLoan(loan.numericId, {
				schemeId: schemeId !== loan.schemeId ? customerRef(schemeId) : undefined,
        principalAmount: principalChanged ? principalTotal : undefined,
				serviceChargeMode: sendMode ? chargeMode : undefined,
				openedDate: openedDate && openedDate !== loan.opened ? openedDate : undefined,
				overallPhotoUrl: overallPhoto !== loan.overallPhotoUrl ? overallPhoto : undefined,
				additionalInfo: additionalInfo.trim() !== (loan.additionalInfo || "").trim() ? additionalInfo.trim() : undefined,
				...goldChoicesOf(activeDeps, chosenDeps),
				...(activeFollowing.length ? { adjustFollowing: activeFollowing.map((f) => ({ id: f.id, amount: +(follow[f.id] ?? f.current) || 0 })) } : {}),
				...(showBranch && branchChanged ? { branchId: +branchSel } : {}),
				...(showBranch && hasPacket && lockerChanged ? { lockerId: +lockerSel } : {}),
				...(paidOut && payoutSplit && (payoutChanged || principalChanged)
					? { cashAmount: payoutSplit.cashAmount, upiAmount: payoutSplit.upiAmount, bankTransferAmount: payoutSplit.bankTransferAmount, bankId: payoutBankId }
					: {}),
			}, loan.uuid);
			onSaved();
			closeModal();
			toast("Loan updated");
		} catch (e) {
			const msg = e instanceof ApiError ? e.message : "Could not save changes — try again.";
			const field = fieldForMessage(msg, { principal: /principal|eligible/i, scheme: /scheme/i });
			if (field) fail(field, msg); else { setFe({}); setErr(msg); }
		} finally {
			setSaving(false);
		}
	}); }

	return (
		<>
			<div className="hd"><h3>Edit Loan — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
			<div className="bd bd-scroll edit-loan-bd">
				<div className="frow c2">
					<div className={fe.scheme ? "has-err" : undefined}><label className="f">Scheme</label>
						<SearchableSelect<SchemeView>
							value={schemeLabel}
              onChange={(id, item) => { setFe((cur) => ({ ...cur, scheme: "" })); setSchemeId(id); setSchemeObj(item); setChargeMode(item.serviceChargeMode === "AddedToPrincipal" ? "AddedToPrincipal" : "WithheldFromPayout"); setSchemeLabel(schemeOptionLabel(item)); setSchemeLtv(item.ltvBased ? item.ltv : 0); }}
							fetchFn={searchActiveSchemesPage}
							searchHint="Searches: scheme name, scheme code"
              getLabel={schemeOptionLabel}
							getId={(s) => s.id}
							placeholder="Search active schemes…"
						/><FieldError msg={fe.scheme} /></div>
          <div className={fe.principal ? "has-err" : undefined}><label className="f">{hasCharge ? "Amount (₹)" : "Principal Amount (₹)"}</label>
            <input className="inp" type="number" min={1} max={ltvBased ? eligibleLoanAmount : undefined} value={amount} onChange={(e) => { setAmount(capToEligible(e.target.value)); setFe((cur) => ({ ...cur, principal: "" })); }} /><FieldError msg={fe.principal} />
            {ltvBased && <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
							Max {fmt(eligibleLoanAmount)} (based on scheme LTV)
            </p>}
					</div>
				</div>
        <div className="frow c2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <div>
            <label className="f">Loan Date</label>
            <DatePicker value={openedDate} onChange={setOpenedDate} max={localISO(new Date())} />
          </div>
          {ltvBased && (
					<div>
						<label className="f">Eligible Loan Amount</label>
						<input className="inp" value={fmt(eligibleLoanAmount)} disabled />
					</div>
          )}
        </div>
        {ltvBased && (
          <div className="frow c2">
					<div>
						<label className="f">LTV</label>
						<input className="inp" value={`${schemeLtv}%`} disabled />
					</div>
				</div>
        )}

        {hasCharge && (
          <div className="frow c2">
            <div>
              <label className="f">Service Charge{chargeType === "Percent" ? ` (${chargeValue}%)` : ""}</label>
              <input className="inp" value={`${chargeMode === "WithheldFromPayout" ? "−" : "+"}${fmt(serviceCharge)}`} disabled />
            </div>
            <div>
              <label className="f">Charge Method</label>
              <Select
                value={chargeMode}
                onChange={(v) => setChargeMode(v as ChargeMode)}
                options={[
                  { value: "WithheldFromPayout", label: "Deduct from loan" },
                  { value: "AddedToPrincipal", label: "Add to loan" },
                ]}
              />
            </div>
          </div>
        )}
        {hasCharge && (
          <div className="frow c2">
            <div>
              <label className="f">Loan Principal</label>
              <input className="inp" value={fmt(principalTotal)} disabled />
            </div>
            <div>
              <label className="f">{chargeMode === "WithheldFromPayout" ? "Customer Receives" : "Customer Receives (full amount)"}</label>
              <input className="inp" value={fmt(payout)} disabled />
            </div>
          </div>
        )}

				{showBranch && (
					<div className="frow c2" style={{ marginBottom: 14 }}>
						<div>
							<label className="f">Branch</label>
							<Select
								options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
								value={branchSel}
								onChange={(v) => { setBranchSel(v); setLockerSel(""); }}
							/>
						</div>
						{hasPacket && (
							<div>
								<label className="f">Locker</label>
								<Select
									options={lockers.map((x) => ({ value: String(x.id), label: `${x.code} (${x.occupied}/${x.capacity})`, disabled: x.occupied >= x.capacity && x.id !== packetLocker }))}
									value={lockerSel}
									onChange={setLockerSel}
									placeholder="Select locker…"
								/>
							</div>
						)}
					</div>
				)}

				{paidOut && disbursement && (
					<div style={{ marginBottom: 14 }}>
						<label className="f">Payout breakdown — {fmt(payout)}</label>
						<SplitPaymentInput totalAmount={payout} initialLines={payoutLines} label={null}
							onChange={(s, r, b) => { setPayoutSplit(s); setPayoutRemaining(r); setPayoutBankId(b); }} />
					</div>
				)}

				<InterestChangesTable changes={reviewedFor === reviewKey ? interestList : []} />
				{activeFollowing.length > 0 && (
					<FollowingEntriesTable entries={activeFollowing} values={follow} onChange={(id, v) => setFollow((cur) => ({ ...cur, [id]: v }))} />
				)}
				<GoldReleaseDependents dependents={activeDeps} chosen={chosenDeps} onToggle={(k, on) => setChosenDeps((c) => ({ ...c, [k]: on }))} />

				{/* a loan already paid out is edited where it is; only one still waiting for approval goes back to its first stage */}
				{triggersReapproval && !loan.disbursementDate && (
					<div className="notice" style={{ marginBottom: 14, color: "var(--red)" }}>
						<Icon name="shield" />
						Saving will resubmit this loan for approval from the first stage.
					</div>
				)}

        <label className="f" style={{ marginTop: 10, display: "block" }}>Ornaments</label>
        <div className="edit-loan-orn-scroll">
          {rows.map((r, i) => r.removed ? null : (
            <div key={i} className={rowErr?.idx === i ? "eln-card has-err" : "eln-card"} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
              {/* Bare "frow" (no .c2/.c3 modifier) is a single-column grid —
                  these rows need the modifier or every field stacks onto its
                  own line instead of sitting side by side. */}
              <div className="eln-top">
                <div className="orn-type-td"><label className="f">Name</label>
                  {/* Same ornament-type catalog picker NewLoan.tsx uses; the
                      `orn-type-td` wrapper pins it to the 31px row height the
                      PurityPicker beside it (`.pur-row`) already uses. */}
                  <SearchableSelect<BackendOrnamentType>
                    value={r.name}
                    onChange={(_id, item) => updRow(i, { name: item.name })}
                    fetchFn={searchOrnamentTypesPage}
                    searchHint="Searches: ornament type name"
                    getLabel={(t) => t.name}
                    getId={(t) => String(t.id)}
                    placeholder="Ornament type…"
                    allowCreate
                    onCreate={createOrnamentType}
                    onDeleteItem={(t) => deleteOrnamentType(t.id).then(() => { if (t.name === r.name) updRow(i, { name: "" }); toast(`Ornament type "${t.name}" deleted`); }, (e) => { toast(e instanceof ApiError ? e.message : "Could not delete this ornament type."); throw e; })}
                  /></div>
                <div><label className="f">Purity</label>
                  <PurityPicker value={r.purity} onChange={(v) => updRow(i, { purity: v })} /></div>
                <div><label className="f">Qty</label>
                  <input className="inp" type="number" min={1} value={r.qty} onChange={(e) => updRow(i, { qty: e.target.value })} /></div>
              </div>
              {/* Plain `.frow.c3` — this modal now opens `wide` (820px,
                  see LoanDetail.tsx's openModal calls) instead of the
                  default 520px, so the standard 3-up row (used by every
                  other dense form in the app) has enough room without a
                  local override, and gets the same small-screen collapse
                  every other `.frow.c3` row already gets for free. */}
              <div className="eln-wt">
                <div><label className="f">Gross (g)</label>
                  <input className="inp" type="text" inputMode="decimal" placeholder="0.000" value={r.gross} onChange={(e) => setGross(i, e.target.value)} /></div>
                <div><label className="f">Less (g)</label>
                  <input className="inp" type="text" inputMode="decimal" placeholder="0.000" value={r.less} onChange={(e) => setLess(i, e.target.value)} /></div>
                <div><label className="f">Net (g)</label>
                  <input className="inp" type="text" inputMode="decimal" placeholder="0.000" value={r.net} onChange={(e) => setNet(i, e.target.value)} /></div>
                {/* Icon-only square actions, bottom-aligned with the inputs. */}
                <PhotoSourceMenu
                  multiple
                  onFile={(f) => { void ornPhotoPicked(i, f); }}
                  webcamTitle={`Ornament Photo${r.name ? " — " + r.name : ""}`}
                  trigger={(t) => (
                    <button ref={t.ref} type="button" className="btn plain eln-sq" title="Add photo" aria-label="Add photo" aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}><Icon name="camera" /></button>
                  )}
                />
                <button type="button" className="btn danger eln-sq" onClick={() => removeRow(i)} title="Remove ornament" aria-label="Remove ornament"><Icon name="x" /></button>
              </div>
              {/* Third row: photos, only once there are any. */}
              {(r.photos.length > 0 || r.newPhotos.length > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  {r.photos.map((u) => (
                    <SafeImage key={u} src={u} style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                  ))}
                  {r.newPhotos.map((u) => (
                    <span key={u} style={{ position: "relative", display: "inline-flex" }}>
                      <SafeImage src={u} style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 6, border: "1px solid var(--brand)" }} />
                      <button type="button" title="Remove photo" aria-label="Remove photo"
                        style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, padding: 0, borderRadius: "50%", border: "1px solid var(--line)", background: "var(--card, #fff)", color: "var(--red)", fontSize: 9, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                        onClick={() => dropNewPhoto(i, u)}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              {rowErr?.idx === i && <FieldError msg={rowErr.msg} />}
            </div>
          ))}
        </div>
        <FieldError msg={fe.ornaments} />
        <div style={{ padding: "6px 0" }}>
          <button className="btn plain sm" onClick={addRow}><Icon name="plus" /> Add Ornament</button>
        </div>

				<div style={{ padding: "10px 0 2px" }}>
					<label className="f">Overall Photo</label>
					<div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
						{overallPhoto && <SafeImage src={overallPhoto} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />}
						<PhotoSourceMenu
							onFile={(f) => { void overallPhotoPicked(f); }}
							webcamTitle="Overall Photo"
							trigger={(t) => (
								<button ref={t.ref} type="button" className="btn plain sm" style={{ height: 38 }} aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}>
									<Icon name="camera" /> {overallPhoto ? "Change overall photo" : "Add overall photo"}
								</button>
							)}
						/>
						{overallPhoto && <button type="button" className="btn plain sm" title="Remove overall photo" onClick={() => setOverallPhoto("")}>✕</button>}
					</div>
				</div>

				<p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
					Total net weight: {fmt(activeRows.reduce((s, r) => s + (+r.net || 0) * (+r.qty || 1), 0)).replace("₹", "")}g · eligible amount updates on save
				</p>
				<label className="f" htmlFor="edit-additional-info" style={{ marginTop: 10 }}>Additional Information</label>
				<NoteField id="edit-additional-info" placeholder="Anything else worth recording on this loan…" value={additionalInfo} onChange={setAdditionalInfo} />
			</div>
			{/* The sticky-within-`.modal-bg` treatment this used to declare inline
					is now on `.modal .ft` in app.css, for every modal — nothing needed
					here beyond the class. */}
			<div className="ft">
					{err && <span className="ft-err" role="alert">{err}</span>}
				<button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Save Changes"}</button>
			</div>
		</>
	);
}
