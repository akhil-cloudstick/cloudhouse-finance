"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { searchBanksPage, createBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { updateLoanDetails } from "@/modules/cash/services/cashSourceService";
import { type LoanLedgerSummary } from "@/modules/cash/types/expense-category-types";
import { singleFlight } from "@/common/utils/singleFlight";

const noWheelStep = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

type EditLoanDetailsModalContentProps = { loan: LoanLedgerSummary; onSaved?: () => void };

/* The loan ledger's Edit button: changes the loan's own details — lender bank, loan number and principal.
 * Individual draws and repayments are edited from their own rows; none of their amounts change here. */
export function EditLoanDetailsModalContent({ loan, onSaved }: EditLoanDetailsModalContentProps) {
  const { closeModal } = useModal();
  const [bankId, setBankId] = useState(loan.bankId ? String(loan.bankId) : "");
  const [bankName, setBankName] = useState(loan.bankName);
  const [loanNumber, setLoanNumber] = useState(loan.loanNumber);
  const [principal, setPrincipal] = useState(String(loan.principal));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // An older backend response carries no bank id: find it from the bank's name so the bank shows as already chosen.
  useEffect(() => {
    if (bankId || !loan.bankName) return;
    let cancelled = false;
    searchBanksPage(loan.bankName, 0).then((r) => {
      const found = r.items.find((b) => b.name.toLowerCase() === loan.bankName.toLowerCase());
      if (found && !cancelled) setBankId(String(found.id));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The least the principal can be: what is already drawn, net of repayments.
  const floor = Math.max(loan.drawn - loan.repaid, 0);

  async function save() {
    return singleFlight(`cash:loan-details:${loan.sourceId}`, async () => {
      const amount = +principal;
      if (!bankId) { setErr("Please select the bank the loan is from."); return; }
      if (!loanNumber.trim()) { setErr("Please enter the loan number."); return; }
      if (!(amount > 0)) { setErr("Please enter a valid principal amount."); return; }
      if (amount < floor - 0.005) { setErr(`Principal can't be less than ${fmt(floor)} — the amount already drawn net of repayments.`); return; }
      setSaving(true);
      setErr("");
      try {
        await updateLoanDetails(loan.sourceId, { bankId: +bankId, loanNumber: loanNumber.trim(), principalAmount: amount });
        closeModal();
        onSaved?.();
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <>
      <div className="hd"><h3>Edit Loan Details</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>
          {loan.name} — cash drawn and repaid stay as recorded; only the loan's own details change.
        </p>
        <div className="frow c2">
          <div><label className="f">Bank *</label>
            <SearchableSelect<BackendBank>
              portal
              value={bankName}
              onChange={(id, item) => { setBankId(id); setBankName(item.name); }}
              fetchFn={searchBanksPage}
              searchHint="Searches: bank name"
              getLabel={(b) => b.name}
              getId={(b) => String(b.id)}
              placeholder="Search or add a bank…"
              allowCreate
              onCreate={createBank}
            /></div>
          <div><label className="f">Loan Number *</label>
            <input className="inp" placeholder="As on the bank's loan account" value={loanNumber} onChange={(e) => setLoanNumber(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Principal Amount (₹) *</label>
            <input className="inp" type="number" min={1} value={principal} onChange={(e) => setPrincipal(e.target.value)} onWheel={noWheelStep} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Save Changes"}</button>
      </div>
    </>
  );
}
