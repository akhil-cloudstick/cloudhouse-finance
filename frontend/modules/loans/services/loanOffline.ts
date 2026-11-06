/* What a loan looks like while it has not reached the server yet, and how the Loans screens read the local
 * copy when the server does not answer. A loan made offline is an ordinary loan in every list and on its
 * detail page; it only lacks the server's number, so it carries PENDING-xxxxxxxx until the next send. */

import { getLocal, listLocal, offlineReady, upsertLocal, type Actor, type LocalRecord } from "@/common/offline";
import { refuse, requirePositive, requireNotNegative, requireValidSplit, requireNotFuture, requireNotBefore, dayOf } from "@/common/offline/validate";
import { auctionStageOf } from "@/common/offline/auctionStages";
import { currentActor } from "@/common/offline/actor";
import { getSelectedBranchId } from "@/common/services/branchSelection";
import { ApiError } from "@/common/services/httpClient";
import type { StageView } from "@/common/types/approval-workflow-types";
import type {
  ApprovalInput,
  BackendLoan,
  BackendOrnament,
  BankPledgeInput,
  CreateLoanInput,
  LoanFilters,
  PaymentInput,
  BackendLoanPayment,
} from "@/modules/loans/types/loan-types";

/** The few things the form already knows that the server would otherwise work out. */
export type CreateLoanHint = {
  customerName: string;
  customerCode: string;
  customerPhone?: string;
  branchName: string;
  scheme: {
    name: string;
    rate: number;
    ltv: number;
    method: string;
    penal: number;
    serviceChargeType?: "None" | "Flat" | "Percent";
    serviceChargeValue?: number;
  };
  /** Gold value of each ornament row, in the same order as input.ornaments. */
  ornamentValues: number[];
  /** The stage the loan waits at first, from this business's approval chain. */
  firstStage: string;
};

export function pendingKey(uuid: string): string {
  return "PENDING-" + uuid.replace(/-/g, "").slice(-8).toUpperCase();
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function localLoans(): BackendLoan[] {
  return listLocal("loans") as unknown as BackendLoan[];
}

/* Finds a loan by what the screens call its id: the server's number, or the PENDING key. */
export function localLoanByKey(key: string): (BackendLoan & { uuid: string }) | undefined {
  return localLoans().find((l) => l.loanNumber === key || (l.uuid && pendingKey(l.uuid) === key)) as
    | (BackendLoan & { uuid: string })
    | undefined;
}

export function localLoanByNumericId(id: number): (BackendLoan & { uuid: string }) | undefined {
  return id ? (localLoans().find((l) => l.id === id) as (BackendLoan & { uuid: string }) | undefined) : undefined;
}

/* The loan as the server would have created it, for the local copy until the server's own record arrives. */
export function buildOptimisticLoan(uuid: string, input: CreateLoanInput, hint: CreateLoanHint): BackendLoan {
  const now = new Date().toISOString();
  const ornaments: BackendOrnament[] = input.ornaments.map((o, i) => ({
    // not on the server yet, so no real id; a distinct negative one keeps each row selectable on its own
    id: -(i + 1),
    loanId: 0,
    name: o.name,
    purity: o.purity,
    grossWeight: o.grossWeight,
    deductionWeight: o.deductionWeight ?? 0,
    netWeight: round3(o.grossWeight - (o.deductionWeight ?? 0)),
    quantity: o.quantity ?? 1,
    goldValue: round2(hint.ornamentValues[i] ?? 0),
    remarks: o.remarks ?? "",
    images: (o.images ?? []).map((imageUrl) => ({ id: 0, ornamentId: 0, imageUrl, createdAt: now })),
  }));
  const totalGoldValue = round2(ornaments.reduce((s, o) => s + o.goldValue, 0));
  const eligible = round2((totalGoldValue * hint.scheme.ltv) / 100);
  const charge = round2(
    hint.scheme.serviceChargeType === "Flat"
      ? hint.scheme.serviceChargeValue ?? 0
      : hint.scheme.serviceChargeType === "Percent"
        ? (input.principalAmount * (hint.scheme.serviceChargeValue ?? 0)) / 100
        : 0,
  );
  const mode = input.serviceChargeMode ?? "WithheldFromPayout";
  // a customer the server has not numbered yet has no number to show; the pull supplies it
  const customerNumber = typeof input.customerId === "number" ? input.customerId : 0;
  const schemeNumber = typeof input.schemeId === "number" ? input.schemeId : 0;
  const principal = mode === "AddedToPrincipal" ? round2(input.principalAmount + charge) : input.principalAmount;
  return {
    uuid,
    id: 0,
    loanNumber: "",
    branchId: input.branchId,
    branch: { id: input.branchId, name: hint.branchName, code: "" },
    customerId: customerNumber,
    customer: { id: customerNumber, name: hint.customerName, code: hint.customerCode, phone: hint.customerPhone ?? "" },
    schemeId: schemeNumber,
    scheme: { id: schemeNumber, name: hint.scheme.name, interestRate: hint.scheme.rate, ltvPercent: hint.scheme.ltv, interestMethod: hint.scheme.method, penalRate: hint.scheme.penal },
    schemeInterestRate: hint.scheme.rate,
    schemeLtvPercent: hint.scheme.ltv,
    schemeInterestMethod: hint.scheme.method,
    schemePenalRate: hint.scheme.penal,
    openedDate: input.openedDate,
    dueDate: input.dueDate,
    additionalInfo: input.additionalInfo ?? "",
    overallPhotoUrl: input.overallPhotoUrl ?? "",
    totalNetWeight: round3(ornaments.reduce((s, o) => s + o.netWeight * o.quantity, 0)),
    totalGoldValue,
    eligibleLoanAmount: eligible,
    principalAmount: principal,
    outstandingAmount: principal,
    accruedInterest: 0,
    interestPaid: 0,
    accruedPenalInterest: 0,
    penalInterestPaid: 0,
    outstandingInterest: 0,
    outstandingPenalInterest: 0,
    outstandingProcessingFee: 0,
    totalOutstandingBalance: principal,
    settlementAmount: principal,
    totalPaid: 0,
    status: "Pending Approval",
    approvalStage: hint.firstStage,
    serviceChargeMode: mode,
    serviceChargeAmount: charge,
    serviceChargeType: hint.scheme.serviceChargeType ?? "None",
    serviceChargeValue: hint.scheme.serviceChargeValue ?? 0,
    bankPledgeStatus: "Not Pledged",
    isDueSoon: false,
    isOverdue: false,
    isDefaulted: false,
    daysOverdue: 0,
    ornaments,
    approvals: [],
    payments: [],
    bankPledges: [],
    createdAt: now,
    updatedAt: now,
  } as BackendLoan;
}

export function saveOptimisticLoan(loan: BackendLoan & { uuid: string }): Promise<void> {
  return upsertLocal("loans", loan as unknown as LocalRecord);
}

/* The stage a loan moves to when an action is recorded on the local copy: the next one in this business's
 * chain, or approved and active after the last one. A rejection ends it. */
export function applyActionLocally(
  rec: BackendLoan,
  input: ApprovalInput,
  chain: StageView[],
  actor: Actor,
): BackendLoan {
  const next = { ...rec } as BackendLoan;
  const now = new Date().toISOString();
  next.updatedAt = now;
  next.approvals = [
    ...(rec.approvals ?? []),
    { id: 0, loanId: rec.id, stage: input.stage, action: input.action, actorEmployeeId: actor.id, remarks: "", createdAt: now },
  ];
  if (input.action === "Rejected") {
    next.approvalStage = "Rejected";
    next.status = "Rejected";
    next.rejectedByName = actor.name;
    next.rejectedAt = now;
    return next;
  }
  const idx = chain.findIndex((s) => s.key === input.stage || s.pending === input.stage || s.pending === rec.approvalStage);
  const following = idx >= 0 ? chain[idx + 1] : undefined;
  if (following) {
    next.approvalStage = following.pending;
    return next;
  }
  const charge = rec.serviceChargeAmount ?? 0;
  next.approvalStage = "Approved";
  next.status = "Active";
  next.sanctionedAmount = rec.principalAmount;
  next.disbursedAmount = round2(rec.principalAmount - charge);
  next.disbursementDate = now;
  return next;
}

/* The terms of the scheme an edit moves a loan to, as the server freezes them onto the loan (applySchemeSnapshot). */
export type EditSchemeTerms = {
  name: string;
  rate: number;
  ltv: number;
  method: string;
  penal: number;
  serviceChargeType?: string;
  serviceChargeValue?: number;
  serviceChargeMode?: string;
};

/* What the server charges for a scheme's service charge on a principal (computeServiceChargeAmount). */
function chargeFor(type: string | undefined, value: number, principal: number): number {
  return type === "Flat" ? value : type === "Percent" ? (principal * value) / 100 : 0;
}

/* A loan edited on this PC, applied the way the server applies it (Loan updateLoan): a changed scheme or principal sends
 * the loan back to the first sanction stage as Pending Approval, undoes an earlier disbursement and records an "Edited"
 * approval row, so the approval flow shows at once and the ledger follows the new amount once it is approved again. The
 * same refusals the server gives are raised here, before anything is queued. A new scheme brings its own terms (LTV,
 * rates, service charge), and the eligible amount and the service charge are re-worked from them and from the principal,
 * so the loan shows the figures the server will arrive at rather than the old scheme's. */
export function applyEditLocally(
  rec: BackendLoan,
  input: { schemeId?: number | string; principalAmount?: number; overallPhotoUrl?: string },
  firstStage: string,
  actor: Actor,
  scheme?: EditSchemeTerms,
): BackendLoan {
  if (["Closed", "Rejected", "Auctioned", "Auctioned (Balance Due)"].includes(rec.status)) {
    throw new ApiError("loan is closed — nothing to extend", 400);
  }
  const newScheme = typeof input.schemeId === "number" && input.schemeId !== rec.schemeId ? input.schemeId : undefined;
  const newPrincipal = input.principalAmount !== undefined ? round2(input.principalAmount) : undefined;
  if (newPrincipal !== undefined && newPrincipal <= 0) throw new ApiError("principal amount must be greater than zero", 400);
  const principalChanged = newPrincipal !== undefined && newPrincipal !== round2(rec.principalAmount);
  const material = newScheme !== undefined || principalChanged;
  const now = new Date().toISOString();
  const next = { ...rec, updatedAt: now } as BackendLoan;
  if (newScheme !== undefined) {
    next.schemeId = newScheme;
    if (scheme) {
      next.schemeLtvPercent = scheme.ltv;
      next.schemeInterestRate = scheme.rate;
      next.schemeInterestMethod = scheme.method;
      next.schemePenalRate = scheme.penal;
      next.serviceChargeType = scheme.serviceChargeType ?? "None";
      next.serviceChargeValue = scheme.serviceChargeValue ?? 0;
      if (scheme.serviceChargeMode) next.serviceChargeMode = scheme.serviceChargeMode;
      next.scheme = { ...(rec.scheme ?? {}), id: newScheme, name: scheme.name, interestRate: scheme.rate, ltvPercent: scheme.ltv, interestMethod: scheme.method, penalRate: scheme.penal } as BackendLoan["scheme"];
      // the gold is the same, the share of it the new scheme lends against is not
      next.eligibleLoanAmount = round2(((rec.totalGoldValue ?? 0) * scheme.ltv) / 100);
    }
  }
  if (input.overallPhotoUrl !== undefined) next.overallPhotoUrl = input.overallPhotoUrl.trim();
  if (newPrincipal !== undefined) {
    const delta = newPrincipal - rec.principalAmount;
    next.principalAmount = newPrincipal;
    next.outstandingAmount = round2(Math.max(0, (rec.outstandingAmount ?? 0) + delta));
    next.totalOutstandingBalance = round2(Math.max(0, (rec.totalOutstandingBalance ?? 0) + delta));
    next.settlementAmount = round2(Math.max(0, (rec.settlementAmount ?? 0) + delta));
  }
  const principal = next.principalAmount;
  const type = next.serviceChargeType;
  const value = next.serviceChargeValue ?? 0;
  if (newScheme !== undefined || newPrincipal !== undefined) {
    if (type !== undefined) next.serviceChargeAmount = round2(chargeFor(type, value, principal));
    else if (rec.serviceChargeAmount && rec.principalAmount > 0) next.serviceChargeAmount = round2((rec.serviceChargeAmount * principal) / rec.principalAmount);
  }
  // a service charge that is added to the principal is not part of what the gold can back; the server checks this after every
  // edit that touches the scheme or the principal, against the eligible amount under the (possibly new) scheme
  let capped = principal;
  if (next.serviceChargeMode === "AddedToPrincipal") {
    if (type !== undefined && value > 0) {
      capped = type === "Flat" ? principal - value : type === "Percent" ? principal / (1 + value / 100) : principal;
    } else if (type === undefined && rec.serviceChargeAmount && rec.principalAmount > 0) {
      capped = principal * (1 - rec.serviceChargeAmount / rec.principalAmount);
    }
  }
  const eligible = next.eligibleLoanAmount ?? 0;
  if ((newScheme !== undefined || newPrincipal !== undefined) && round2(capped) > round2(eligible)) {
    throw new ApiError(`principal amount ₹${round2(capped).toFixed(2)} cannot exceed the eligible loan amount ₹${round2(eligible).toFixed(2)} (based on scheme LTV)`, 400);
  }
  if (material) {
    const wasDisbursed = !!rec.disbursementDate;
    next.approvalStage = firstStage;
    next.status = "Pending Approval";
    if (wasDisbursed) {
      next.sanctionedAmount = 0;
      next.disbursedAmount = 0;
      next.disbursementDate = undefined as unknown as BackendLoan["disbursementDate"];
    }
    next.approvals = [
      ...(rec.approvals ?? []),
      { id: 0, loanId: rec.id, stage: firstStage, action: "Edited", actorEmployeeId: actor.id, remarks: "Loan edited (scheme/principal changed) — resubmitted for approval", createdAt: now },
    ];
  }
  return next;
}

/* A payment taken while the server does not answer: it shows on the loan at once. How the amount splits
 * between fee, penal interest, interest and principal (and the new balances) is worked out by the server
 * when the entry is sent; the local copy is then replaced with those figures. */
/* A payment taken on this PC, applied to the loan the way the server applies it (processing fee, then penal interest,
 * then interest, then principal, each capped by what is owed), so the balances, the status and the payment's own split
 * move at once. It uses the interest the PC last knew; the server accrues up to the payment date and its numbers replace
 * these when the entry is sent. */
export function applyPaymentLocally(rec: BackendLoan, input: PaymentInput, actor: Actor): BackendLoan {
  const now = new Date().toISOString();
  const round = (n: number) => Math.round(n * 100) / 100;
  const cash = input.cashAmount ?? 0;
  const upi = input.upiAmount ?? 0;
  const bank = input.bankTransferAmount ?? 0;
  const cheque = input.chequeAmount ?? 0;
  const modes = [cash, upi, bank, cheque].filter((v) => v > 0).length;
  const method = modes > 1 ? "Split" : upi > 0 ? "UPI" : bank > 0 ? "Bank Transfer" : cheque > 0 ? "Cheque" : "Cash";

  const feeOwed = (rec.outstandingProcessingFee ?? 0) + (input.processingFee ?? 0);
  const penalOwed = Math.max(0, (rec.accruedPenalInterest ?? 0) > 0 ? (rec.accruedPenalInterest ?? 0) - (rec.penalInterestPaid ?? 0) : (rec.outstandingPenalInterest ?? 0));
  const interestOwed = Math.max(0, input.interestOverride ?? ((rec.accruedInterest ?? 0) > 0 ? (rec.accruedInterest ?? 0) - (rec.interestPaid ?? 0) : (rec.outstandingInterest ?? 0)));
  const principalOwed = Math.max(0, rec.outstandingAmount ?? 0);

  let fee = 0, penal = 0, interest = 0, principal = 0;
  let left = input.amount;
  const take = (owed: number) => {
    const part = Math.min(left, owed);
    left -= part;
    return part;
  };
  switch (input.type) {
    case "Principal":
      fee = take(feeOwed);
      principal = take(principalOwed);
      break;
    case "Interest":
      fee = take(feeOwed);
      penal = take(penalOwed);
      interest = take(interestOwed);
      break;
    case "Penal Interest":
      fee = take(feeOwed);
      penal = take(penalOwed);
      break;
    case "Full Settlement":
      fee = feeOwed;
      penal = penalOwed;
      interest = interestOwed;
      principal = principalOwed;
      break;
    default: // Partial and anything else: everything it can pay, in order
      fee = take(feeOwed);
      penal = take(penalOwed);
      interest = take(interestOwed);
      principal = take(principalOwed);
  }

  // The same refusal the server gives online: a payment cannot be more than the buckets its mode reaches hold.
  // This runs on the freshest local balance, so payments already taken on this PC (even unsent) count.
  const ceiling = input.type === "Full Settlement" ? feeOwed + penalOwed + interestOwed + principalOwed : input.amount - left;
  if (input.type === "Full Settlement" && input.amount < ceiling - 0.01) {
    throw new ApiError(`Full settlement needs the full ${round(ceiling)}. The amount is ${round(ceiling - input.amount)} short.`, 400);
  }
  if (input.amount > ceiling + 0.01) {
    throw new ApiError(`Amount exceeds what is owed on this loan (${round(ceiling)} for this payment type). Reduce the amount.`, 400);
  }

  const outstandingAmount = round(Math.max(0, principalOwed - principal));
  const outstandingInterest = round(Math.max(0, interestOwed - interest));
  const outstandingPenalInterest = round(Math.max(0, penalOwed - penal));
  const outstandingProcessingFee = round(Math.max(0, feeOwed - fee));
  const owedNow = round(outstandingAmount + outstandingInterest + outstandingPenalInterest + outstandingProcessingFee);
  const applied = round(fee + penal + interest + principal);
  const clearedAll = outstandingAmount <= 0 && outstandingInterest <= 0.01 && outstandingPenalInterest <= 0.01 && outstandingProcessingFee <= 0.01;
  const status = clearedAll && ["Active", "Due Soon", "Overdue"].includes(rec.status) ? "Closure Requested" : rec.status;

  const payment: BackendLoanPayment = {
    id: 0,
    loanId: rec.id,
    amount: input.amount,
    type: input.type,
    processingFee: input.processingFee ?? 0,
    processingFeeApplied: round(fee),
    paidOn: input.paidOn,
    receivedByEmployeeId: actor.id,
    description: input.description ?? "",
    method,
    cashAmount: cash,
    upiAmount: upi,
    bankTransferAmount: bank,
    chequeAmount: cheque,
    reference: input.reference ?? "",
    penalInterestApplied: round(penal),
    interestApplied: round(interest),
    principalApplied: round(principal),
    runningBalance: owedNow,
    bankId: input.bankId ?? null,
    createdAt: now,
  };
  return {
    ...rec,
    payments: [...(rec.payments ?? []), payment],
    totalPaid: round((rec.totalPaid ?? 0) + input.amount),
    outstandingAmount,
    outstandingInterest,
    outstandingPenalInterest,
    outstandingProcessingFee,
    interestPaid: round((rec.interestPaid ?? 0) + interest),
    penalInterestPaid: round((rec.penalInterestPaid ?? 0) + penal),
    totalOutstandingBalance: owedNow,
    settlementAmount: round(Math.max(0, (rec.settlementAmount ?? owedNow) - applied)),
    status,
    updatedAt: now,
  };
}

/* Takes one payment made on this PC (not sent yet) back off the local loan: what it paid goes back onto what is owed. This
 * is the inverse of applyPaymentLocally and is only for the local picture; the server works the real figures out when the
 * entry is (or is not) sent. */
export function reversePaymentLocally(rec: BackendLoan, p: BackendLoanPayment): BackendLoan {
  const round = (n: number) => Math.round(n * 100) / 100;
  const fee = p.processingFeeApplied ?? 0;
  const penal = p.penalInterestApplied ?? 0;
  const interest = p.interestApplied ?? 0;
  const principal = p.principalApplied ?? 0;
  // the extra charge in the amount was added to what was owed before it was paid off
  const applied = round(fee + penal + interest + principal - (p.processingFee ?? 0));
  const owedNow = round((rec.totalOutstandingBalance ?? 0) + applied);
  return {
    ...rec,
    payments: (rec.payments ?? []).filter((x) => x.id !== p.id),
    totalPaid: round(Math.max(0, (rec.totalPaid ?? 0) - p.amount)),
    outstandingAmount: round((rec.outstandingAmount ?? 0) + principal),
    outstandingInterest: round((rec.outstandingInterest ?? 0) + interest),
    outstandingPenalInterest: round((rec.outstandingPenalInterest ?? 0) + penal),
    outstandingProcessingFee: round(Math.max(0, (rec.outstandingProcessingFee ?? 0) + fee - (p.processingFee ?? 0))),
    interestPaid: round(Math.max(0, (rec.interestPaid ?? 0) - interest)),
    penalInterestPaid: round(Math.max(0, (rec.penalInterestPaid ?? 0) - penal)),
    totalOutstandingBalance: owedNow,
    settlementAmount: round((rec.settlementAmount ?? owedNow) + applied),
    // a payment that cleared the loan had asked for its closure; taking it back puts the loan back to being serviced
    status: rec.status === "Closure Requested" && owedNow > 0.01 ? "Active" : rec.status,
    updatedAt: new Date().toISOString(),
  };
}

/* The Loans page's own filters, applied to the local copy. */
export function filterLocalLoans(list: BackendLoan[], f?: LoanFilters): BackendLoan[] {
  // An admin's local copy holds every branch; the branch picked in the switcher narrows what is shown, exactly
  // as the X-Branch-Id header does on a live request.
  const picked = getSelectedBranchId();
  if (picked) list = list.filter((l) => l.branchId === picked);
  if (!f) return list;
  const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const statuses = asArray(f.status).filter(Boolean);
  const branches = asArray(f.branchId);
  const customers = asArray(f.customerId);
  const servicing = asArray(f.servicing);
  // the Loans page sends an empty array when no scheme is picked: that means "any scheme", not "no loan matches"
  const schemes = asArray(f.schemeId);
  const pledges = asArray(f.bankPledgeStatus as string | string[] | undefined).filter(Boolean);
  // the auction stage lives on the loan's latest auction case, not on the loan: this PC keeps it per loan (auctionStages.ts)
  const stagesWanted = asArray(f.auctionStage as string | string[] | undefined).filter(Boolean);
  const q = (f.q ?? "").trim().toLowerCase();
  return list.filter((l) => {
    if (q) {
      const hay = [l.loanNumber, l.uuid ? pendingKey(l.uuid) : "", l.customer?.name, l.customer?.code, l.customer?.phone].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const byStatus = statuses.length > 0 && statuses.includes(l.status);
    const byServicing =
      servicing.length > 0 &&
      servicing.some((s) => (s === "due_soon" ? l.isDueSoon : s === "overdue" ? l.isOverdue : s === "defaulted" ? l.isDefaulted : false));
    if ((statuses.length > 0 || servicing.length > 0) && !byStatus && !byServicing) return false;
    if (branches.length && !branches.includes(l.branchId)) return false;
    if (customers.length && !customers.includes(l.customerId)) return false;
    if (schemes.length && !schemes.includes(l.schemeId)) return false;
    // the Loans page sends this as a list, empty when nothing is picked ("any"), exactly like the other filters
    if (pledges.length > 0 && !pledges.includes(l.bankPledgeStatus)) return false;
    if (stagesWanted.length > 0) {
      const stage = auctionStageOf(l.id, l.status);
      if (!stage || !stagesWanted.includes(stage)) return false;
    }
    if (f.from && l.openedDate.slice(0, 10) < f.from) return false;
    if (f.to && l.openedDate.slice(0, 10) > f.to) return false;
    return true;
  });
}

/* The server's own order: opened date, newest first, then id, newest first. A loan the server has not numbered yet (id 0) is the
 * newest of its day, so it comes first there; loans made the same moment keep the order they were saved in. */
export function sortNewestFirst(list: BackendLoan[]): BackendLoan[] {
  const rank = (l: BackendLoan) => (l.id > 0 ? l.id : Number.MAX_SAFE_INTEGER);
  return [...list].sort(
    (a, b) =>
      (b.openedDate ?? "").slice(0, 10).localeCompare((a.openedDate ?? "").slice(0, 10)) ||
      rank(b) - rank(a) ||
      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
}

export { currentActor, getLocal, offlineReady };

/* ---- The server's own refusals, raised on this PC before an entry is queued (only where the answer is certain from local data) ---- */

const SOLD = ["Auctioned", "Auctioned (Balance Due)"];
const GONE = ["Closed", "Rejected", ...SOLD];

/* Record payment (payment.go SaveLoanPayment). */
export function checkPaymentLocally(rec: BackendLoan, input: PaymentInput): void {
  if (rec.status === "Pending Approval") refuse("payments cannot be recorded until the loan is approved");
  requirePositive(input.amount, "amount must be greater than zero");
  requireNotNegative(input.processingFee, "amount must be greater than zero");
  requireNotFuture(input.paidOn, "payment date cannot be in the future");
  const floor = [dayOf(rec.openedDate), dayOf(rec.disbursementDate)].filter(Boolean).sort()[0];
  requireNotBefore(input.paidOn, floor, "payment date cannot be before the loan was opened on " + floor);
  if (input.type !== "Discount") requireValidSplit(input.amount, input);
  requireNotNegative(input.discount, "discount cannot be negative");
  if ((input.discount ?? 0) > 0) {
    if (!(input.discountReason ?? "").trim()) refuse("a reason is required for a discount");
    if (!["Cash", "UPI", "Bank Transfer", "Cheque"].includes(input.discountMode ?? "")) refuse("discount mode must be Cash, UPI, Bank Transfer or Cheque");
    const owed = (rec.outstandingProcessingFee ?? 0) + Math.max(0, (rec.accruedPenalInterest ?? 0) - (rec.penalInterestPaid ?? 0)) + Math.max(0, (rec.accruedInterest ?? 0) - (rec.interestPaid ?? 0)) + (rec.outstandingAmount ?? 0);
    if (rec.accruedInterest !== undefined && (input.discount ?? 0) > owed + 0.01 && owed > 0) refuse("the discount cannot exceed what is owed on the loan");
  }
}

/* Create loan (loan.go SaveLoan). */
export function checkCreateLoanLocally(input: CreateLoanInput, hint: CreateLoanHint): void {
  if (!input.ornaments?.length) refuse("at least one ornament is required");
  requirePositive(input.principalAmount, "principal amount must be greater than zero");
  if (dayOf(input.dueDate) <= dayOf(input.openedDate)) refuse("due date must be after the opened date");
  requireNotFuture(input.openedDate, "loan date cannot be in the future");
  for (const o of input.ornaments) {
    if (!(o.grossWeight > 0)) refuse("gross weight must be greater than zero");
    const p = String(o.purity ?? "").trim();
    const m = /^(\d+(?:\.\d+)?)\s*(K|%)$/i.exec(p);
    if (p && (!m || (m[2].toUpperCase() === "K" ? +m[1] < 10 || +m[1] > 24 : +m[1] > 100))) {
      refuse('purity must be a karat like "22K" (10-24) or a fineness percentage like "91.6%" (0-100)');
    }
  }
  const extra = (input.additionalInfo ?? "").length;
  if (extra > 2000) refuse("additional information cannot be longer than 2000 characters");
  const total = (hint.ornamentValues ?? []).reduce((s, v) => s + (v || 0), 0);
  if (total > 0 && hint.scheme?.ltv > 0) {
    const eligible = round2((total * hint.scheme.ltv) / 100);
    const type = hint.scheme.serviceChargeType;
    const value = hint.scheme.serviceChargeValue ?? 0;
    let capped = input.principalAmount;
    if ((input.serviceChargeMode ?? "WithheldFromPayout") === "AddedToPrincipal") {
      capped = type === "Flat" ? capped - value : type === "Percent" ? capped / (1 + value / 100) : capped;
    }
    if (round2(capped) > eligible) refuse("principal amount cannot exceed the eligible loan amount");
  }
}

/* Top-up split and a second waiting top-up (topup.go). */
export function checkTopUpLocally(rec: BackendLoan, input: { amount: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number | null }, needsApproval: boolean): void {
  requireValidSplit(input.amount, input);
  if (needsApproval && (rec.localTopUps ?? []).some((t) => t.status === "Pending")) refuse("this loan already has a top-up waiting for approval", 409);
}

/* Sanction decision (approval.go SaveLoanApproval). */
export function checkApprovalLocally(rec: BackendLoan, input: ApprovalInput, chain: StageView[]): void {
  if (!["Approved", "Rejected", "Verified"].includes(input.action)) refuse("action must be Approved or Rejected");
  if (rec.approvalStage === "Approved" || rec.approvalStage === "Rejected") refuse("loan  already disbursed");
  if (chain.length > 0) {
    const step = chain.find((s) => s.pending === rec.approvalStage || s.key === rec.approvalStage);
    // Only when this PC knows exactly which stage the loan waits at: a stage name it does not recognise (an older value, a chain that
    // changed) is left to the server rather than blocking an approval that is valid.
    if (step && input.stage && input.stage !== step.key && input.stage !== step.pending) refuse("wrong approval stage");
  }
}

/* An auction step (auction.go): each needs the case at a particular stage - a notice any time before the sale, a schedule after a notice, a
 * sale after a schedule, a settlement after a sale - and a sale needs sensible amounts. `stage` is the case as this PC shows it, with the steps
 * already waiting counted, so a second press of the same step is caught here. Without a case on this PC the stage rule is left to the server. */
export function checkAuctionStepLocally(step: string, body: unknown, stage: string | undefined): void {
  const mismatch = "action does not match the auction case's current stage";
  if (step === "sale") {
    const b = (body ?? {}) as { saleAmount?: number; auctionExpenses?: number };
    requirePositive(b.saleAmount, "amount must be greater than zero");
    if (Number(b.auctionExpenses) < 0) refuse("amount must be greater than zero");
    if (Number(b.auctionExpenses) > Number(b.saleAmount)) refuse("auction expenses cannot be more than the sale amount");
  }
  if (!stage) return;
  if (step === "notice" && (stage === "Auctioned" || stage === "Settled")) refuse(mismatch);
  if (step === "schedule" && stage !== "NoticeIssued") refuse(mismatch);
  if (step === "sale" && stage !== "AuctionScheduled") refuse(mismatch);
  if (step === "settle" && stage !== "Auctioned") refuse(mismatch);
}

/* Extension / release request (extension.go, release.go). */
export function checkRequestLocally(rec: BackendLoan, type: "Extension" | "Release", months?: number): void {
  if (type === "Extension" && months !== undefined && !(months > 0)) refuse("requested extension months must be greater than zero");
  if (rec.status === "Pending Approval") refuse("loan is not approved yet");
  if (SOLD.includes(rec.status)) refuse("this loan's gold has been auctioned — extension or release can no longer be requested");
  if (type === "Release" && (rec.status === "Closed" || rec.status === "Closure Requested")) refuse("a release has already been approved for this loan — complete it instead of requesting another", 409);
}

/* Bank pledge (bank_pledge.go). */
export function checkBankPledgeLocally(rec: BackendLoan, input: BankPledgeInput): void {
  requirePositive(input.pledgedAmount, "amount must be greater than zero");
  if (GONE.includes(rec.status)) refuse("gold is no longer held — can't re-pledge");
  const active = (rec.bankPledges ?? []).filter((p) => (p.status || "Active") === "Active");
  if (active.length > 0 && !(input.ornamentIds?.length)) refuse("some of this loan's ornaments are already pledged to a bank — select the remaining ornaments to pledge");
  const mine = new Set((rec.ornaments ?? []).map((o) => o.id));
  const bad = (input.ornamentIds ?? []).find((id) => id > 0 && !mine.has(id));
  if (bad !== undefined) refuse("ornament does not belong to this loan");
  if (input.cashTreatment && !["CashIn", "RecordOnly"].includes(input.cashTreatment)) refuse('cash_treatment must be either "CashIn" or "RecordOnly"');
}

/* Ornament change (ornament.go, loan.go). */
export function checkOrnamentLocally(input: { purity?: string; grossWeight?: number } | undefined): void {
  if (!input) return;
  if (input.grossWeight !== undefined && !(input.grossWeight > 0)) refuse("gross weight must be greater than zero");
}
