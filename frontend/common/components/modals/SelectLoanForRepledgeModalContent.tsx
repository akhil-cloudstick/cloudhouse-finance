"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import { searchLoansPage } from "@/modules/loans/services/loanService";
import { type LoanView } from "@/modules/loans/types/loan-types";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";

/* Loan picker shown by BankPledge.tsx's "New Re-Pledge" button — that page
 * previously only allowed starting a repledge from a loan's own detail page
 * (LoanDetail.tsx's "Repledge to Bank" button). This lets staff kick off a
 * repledge for any not-yet-bank-pledged loan directly from the Bank
 * Re-Pledge page, then hands off to RepledgeModalContent above.
 *
 * The picker is a SearchableSelect (server-side search, 10 rows per request,
 * next page appended on scroll) rather than a native <select> over the
 * caller's already-loaded loan array — that array is the Bank Re-Pledge
 * page's own list, which won't stay complete as loan volume grows. */
const loanLabel = (l: LoanView) =>
  `${l.id} — ${l.customerName} (${fmtW(l.totalNetWeight)}, outstanding ${fmt(l.outstanding)})`;
const searchEligibleLoansPage = (q: string, page: number) =>
  searchLoansPage(q, page, { excludeBankPledged: true });
type SelectLoanForRepledgeModalContentProps = { onPicked: (loan: LoanView) => void };

export function SelectLoanForRepledgeModalContent({ onPicked }: SelectLoanForRepledgeModalContentProps) {
  const { closeModal } = useModal();
  const [selected, setSelected] = useState<LoanView | null>(null);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");

  // Not blanket-disabled on `!selected` — that would block this
  // validation (and Enter-to-submit, see common/utils/enterToSubmit.ts)
  // from ever running, silently doing nothing instead of showing a warning.
  function next() {
    if (!selected) { setErr("Please search for and pick a loan first."); return; }
    onPicked(selected);
  }

  return (
    <>
      <div className="hd"><h3>New Bank Re-Pledge</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Loan *</label>
          <SearchableSelect<LoanView>
            value={label}
            onChange={(_id, l) => { setSelected(l); setLabel(loanLabel(l)); setErr(""); }}
            fetchFn={searchEligibleLoansPage}
            searchHint="Searches: loan number, customer name, customer code"
            getLabel={loanLabel}
            getId={(l) => String(l.numericId)}
            placeholder="Search by loan number…"
          /></div></div>
        <p className="notice"><Icon name="shield" /><span>Only loans whose gold isn&apos;t already with a bank are listed. Type a loan number to search, or scroll for more.</span></p>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={next}><Icon name="check" /> Next</button>
      </div>
    </>
  );
}
