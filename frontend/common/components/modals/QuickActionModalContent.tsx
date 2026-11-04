"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { Icon } from "@/common/components/Icon";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { FieldError } from "@/common/components/ui/FieldError";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { RequestExtensionModalContent } from "@/common/components/modals/RequestExtensionModalContent";
import { RequestReleaseModalContent } from "@/common/components/modals/RequestReleaseModalContent";
import { ExtensionReviewModalContent } from "@/modules/loans/components/ExtensionReviewModalContent";
import { ReleaseReviewModalContent } from "@/modules/loans/components/ReleaseReviewModalContent";
import { searchBorrowersPage } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { getLoan, searchLoansPage, listLoanRequests } from "@/modules/loans/services/loanService";
import { type LoanView, type RequestView } from "@/modules/loans/types/loan-types";
import { canActAtStage, isFlowOff, stageByPending } from "@/common/services/approvalWorkflowService";
import { fmt } from "@/common/utils/format";

export type QuickAction = "payment" | "extension" | "release";

const TITLES: Record<QuickAction, string> = {
  payment: "Record Payment",
  extension: "Request Extension",
  release: "Request Release",
};

// The loans these actions apply to: everything but finished or not-yet-approved loans, which is what the
// loan page itself refuses them on. Filtered on the server so every page of the dropdown is full.
const OPEN_STATUSES = ["Active", "Due Soon", "Overdue", "Closure Requested", "Auction Eligible"];
// Rows per page in both dropdowns; more load as the list is scrolled.
const PAGE_SIZE = 5;

const customerLabel = (c: CustomerView) => `${c.name} · ${c.phone}`;
const loanLabel = (l: LoanView) => `${l.id} · ${l.status}`;

type QuickActionModalContentProps = { action: QuickAction; onChanged?: () => void };

/* The dashboard's grouped Quick actions entry point for Record Payment / Request Extension /
 * Request Release. This modal only picks WHICH loan (customer by name or phone, then one of that
 * customer's loans with its current status); it then hands over to the very same modal the loan
 * page uses, so the payment form, the pay-the-pending-interest rule for extensions and the
 * release payment step all stay exactly as they are.
 *
 * Extension and release are approval-flow requests. Once one is logged, and the signed-in user
 * holds the approval right for the stage it now waits at, that stage's review modal opens
 * straight away so they can approve it here; the request then carries on from the Requests page
 * for whoever approves the later stages. A user who can't approve that stage just sees the
 * request logged (the existing toast) and it waits on the Requests page. */
export function QuickActionModalContent({ action, onChanged }: QuickActionModalContentProps) {
  const { closeModal, openModal } = useModal();
  const { can, role, isSystem } = useAuth();
  const { config: workflow } = useApprovalWorkflow();

  const [customer, setCustomer] = useState<CustomerView | null>(null);
  const [customerText, setCustomerText] = useState("");
  const [loan, setLoan] = useState<LoanView | null>(null);
  const [loanText, setLoanText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function pickCustomer(c: CustomerView) {
    setCustomer(c);
    setCustomerText(customerLabel(c));
    setLoan(null);
    setLoanText("");
    setErr("");
  }

  // Server-side, 5 per page, for the picked customer only. The loan dropdown is remounted per customer
  // (see its key) because the dropdown remembers what it fetched for an empty search.
  const searchCustomerLoans = (q: string, page: number) =>
    searchLoansPage(q, page, { customerId: Number(customer?.id), status: OPEN_STATUSES, limit: PAGE_SIZE });

  // After a request is logged, open its review modal when the user may approve the stage it waits at.
  async function reviewIfMine(kind: "Extension" | "Release", loanNumericId: number) {
    onChanged?.();
    const flow = kind === "Extension" ? "loan_extension" : "loan_release";
    if (isFlowOff(workflow, flow) || !can("Loan_Management", "can_update_loan")) return;
    let pending: RequestView[];
    try {
      pending = await listLoanRequests({ loanId: loanNumericId, status: "Pending" });
    } catch {
      return; // the request is logged either way; it can be reviewed from the Requests page
    }
    const mine = pending.filter((r) => r.type === kind).sort((a, b) => b.id - a.id)[0];
    if (!mine) return;
    if (!canActAtStage({ role, isSystem }, stageByPending(workflow, flow, mine.approvalStage))) return;
    openModal(
      kind === "Extension"
        ? <ExtensionReviewModalContent request={mine} onSaved={() => onChanged?.()} />
        : <ReleaseReviewModalContent request={mine} onSaved={() => onChanged?.()} />,
      true,
    );
  }

  async function next() {
    if (!customer) { setErr("Please select a customer."); return; }
    if (!loan) { setErr("Please select a loan."); return; }
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      // Fresh copy: the list row carries less than the full loan view the modals expect.
      const full = await getLoan(loan.numericId);
      if (action === "payment") {
        openModal(<PaymentModalContent loan={full} onSaved={() => onChanged?.()} />, true);
      } else if (action === "extension") {
        openModal(<RequestExtensionModalContent loan={full} onPaid={() => onChanged?.()} onSaved={() => { void reviewIfMine("Extension", full.numericId); }} />, true);
      } else {
        openModal(<RequestReleaseModalContent loan={full} onSaved={() => { void reviewIfMine("Release", full.numericId); }} />);
      }
    } catch {
      setErr("Could not open this loan — try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>{TITLES[action]}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow"><div>
          <label className="f">Customer *</label>
          <SearchableSelect<CustomerView>
            value={customerText}
            onChange={(_id, c) => pickCustomer(c)}
            fetchFn={searchBorrowersPage}
            searchHint="Searches: name, customer code, phone number"
            getLabel={customerLabel}
            getId={(c) => c.id}
            renderOption={(c) => (
              <>
                <span className="tx"><b>{c.name}</b></span>
                <span style={{ color: "var(--muted)", fontSize: 12.5, fontFamily: "inherit", whiteSpace: "nowrap" }}>{c.phone}</span>
              </>
            )}
            placeholder="Search by name or phone number…"
            portal
          />
          <FieldError msg={customer ? "" : err} />
        </div></div>
        <div className="frow"><div className={err && customer ? "has-err" : undefined}>
          <label className="f">Loan *</label>
          <SearchableSelect<LoanView>
            key={customer?.id ?? "none"}
            value={loanText}
            onChange={(_id, l) => { setLoan(l); setLoanText(loanLabel(l)); setErr(""); }}
            fetchFn={searchCustomerLoans}
            searchHint="Searches: loan number"
            getLabel={loanLabel}
            getId={(l) => String(l.numericId)}
            renderOption={(l) => (
              <>
                <span className="tx"><b>{l.id}</b></span>
                <span style={{ color: "var(--muted)", fontSize: 12.5, fontFamily: "inherit", whiteSpace: "nowrap" }}>{fmt(l.totalOutstandingBalance)}</span>
                <StatusChip status={l.status} />
              </>
            )}
            placeholder={customer ? "Select a loan" : "Select a customer first"}
            disabled={!customer}
            portal
          />
          <FieldError msg={customer ? err : ""} />
        </div></div>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={next} disabled={busy}><Icon name="check" /> Continue</button>
      </div>
    </>
  );
}
