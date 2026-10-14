"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { fmtDate } from "@/common/utils/format";
import { type LoanView } from "@/modules/loans/types/loan-types";
import { FieldError } from "@/common/components/ui/FieldError";

type SelectLoanForRequestModalContentProps = { loans: LoanView[]; onPicked: (loan: LoanView, type: "Extension" | "Release") => void };

/* Loan picker shown from CustomerDetail.tsx's "Request Extension / Release"
 * button — a customer can have multiple loans, so pick one first, then
 * choose which kind of request to log for it. Mirrors
 * RepledgeModal.tsx's SelectLoanForRepledgeModalContent. */
export function SelectLoanForRequestModalContent({ loans, onPicked }: SelectLoanForRequestModalContentProps) {
  const { closeModal } = useModal();
  const [loanId, setLoanId] = useState("");
  const [type, setType] = useState<"Extension" | "Release">("Extension");
  // Shown under the loan picker.
  const [err, setErr] = useState("");

  const eligible = loans.filter((l) => l.status !== "Closed" && l.status !== "Rejected" && l.status !== "Pending Approval");
  const selected = eligible.find((l) => l.id === loanId);

  // Not blanket-disabled on `!selected` — see RepledgeModal.tsx's own
  // SelectLoanForRepledgeModalContent for why.
  function next() {
    if (!selected) { setErr("Please select a loan first."); return; }
    onPicked(selected, type);
  }

  return (
    <>
      <div className="hd"><h3>Request Extension / Release</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow"><div className={err ? "has-err" : undefined}><label className="f">Loan *</label>
          <Select
            options={[
              { value: "", label: "Select loan…" },
              ...eligible.map((l) => ({ value: l.id, label: `${l.id} — due ${fmtDate(l.due)} (outstanding ₹${l.outstanding.toLocaleString("en-IN")})` })),
            ]}
            value={loanId}
            onChange={(v) => { setLoanId(v); setErr(""); }}
          /><FieldError msg={err} /></div></div>
        <div className="frow"><div><label className="f">Request Type *</label>
          <Select
            options={[{ value: "Extension", label: "Extension" }, { value: "Release", label: "Release" }]}
            value={type}
            onChange={(v) => setType(v as "Extension" | "Release")}
          /></div></div>
        {eligible.length === 0 && (
          <p className="notice"><Icon name="shield" /> This customer has no open loans to request an extension or release for.</p>
        )}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={next}><Icon name="check" /> Next</button>
      </div>
    </>
  );
}
