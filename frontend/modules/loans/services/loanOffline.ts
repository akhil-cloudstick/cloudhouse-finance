/* What a loan looks like while it has not reached the server yet, and how the Loans screens read the local
 * copy when the server does not answer. A loan made offline is an ordinary loan in every list and on its
 * detail page; it only lacks the server's number, so it carries PENDING-xxxxxxxx until the next send. */

import { getLocal, listLocal, offlineReady, upsertLocal, type Actor, type LocalRecord } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { getSelectedBranchId } from "@/common/services/branchSelection";
import type { StageView } from "@/common/types/approval-workflow-types";
import type {
  ApprovalInput,
  BackendLoan,
  BackendOrnament,
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

/* A payment taken while the server does not answer: it shows on the loan at once. How the amount splits
 * between fee, penal interest, interest and principal (and the new balances) is worked out by the server
 * when the entry is sent; the local copy is then replaced with those figures. */
export function applyPaymentLocally(rec: BackendLoan, input: PaymentInput, actor: Actor): BackendLoan {
  const now = new Date().toISOString();
  const cash = input.cashAmount ?? 0;
  const upi = input.upiAmount ?? 0;
  const bank = input.bankTransferAmount ?? 0;
  const cheque = input.chequeAmount ?? 0;
  const modes = [cash, upi, bank, cheque].filter((v) => v > 0).length;
  const method = modes > 1 ? "Split" : upi > 0 ? "UPI" : bank > 0 ? "Bank Transfer" : cheque > 0 ? "Cheque" : "Cash";
  const payment: BackendLoanPayment = {
    id: 0,
    loanId: rec.id,
    amount: input.amount,
    type: input.type,
    processingFee: input.processingFee ?? 0,
    processingFeeApplied: 0,
    paidOn: input.paidOn,
    receivedByEmployeeId: actor.id,
    description: input.description ?? "",
    method,
    cashAmount: cash,
    upiAmount: upi,
    bankTransferAmount: bank,
    chequeAmount: cheque,
    reference: input.reference ?? "",
    penalInterestApplied: 0,
    interestApplied: 0,
    principalApplied: 0,
    runningBalance: rec.outstandingAmount,
    bankId: input.bankId ?? null,
    createdAt: now,
  };
  return { ...rec, payments: [...(rec.payments ?? []), payment], totalPaid: (rec.totalPaid ?? 0) + input.amount, updatedAt: now };
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
    if (f.schemeId && l.schemeId !== f.schemeId) return false;
    if (f.bankPledgeStatus && l.bankPledgeStatus !== f.bankPledgeStatus) return false;
    if (f.from && l.openedDate.slice(0, 10) < f.from) return false;
    if (f.to && l.openedDate.slice(0, 10) > f.to) return false;
    return true;
  });
}

export function sortNewestFirst(list: BackendLoan[]): BackendLoan[] {
  return [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export { currentActor, getLocal, offlineReady };
