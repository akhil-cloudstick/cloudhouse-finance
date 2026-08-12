"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import { fmt, fmtW, initials } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { LoanRow } from "@/components/LoanRow";
import { Icon } from "@/lib/icons";
import { getCustomer360, type Customer360View } from "@/lib/customersApi";
import type { LoanView } from "@/lib/loansApi";
import {
  SelectLoanForRequestModalContent,
  RequestExtensionModalContent,
  RequestReleaseModalContent,
} from "@/components/modals/RequestExtensionModal";

function ProofLink({ label, url }: { label: string; url: string }) {
  if (!url) return <div className="i"><div className="k">{label}</div><div className="v" style={{ color: "var(--muted)" }}>Not provided</div></div>;
  return (
    <div className="i"><div className="k">{label}</div><div className="v">
      <a href={url} target="_blank" rel="noreferrer">View</a>
    </div></div>
  );
}

/* Ported from legacy/app.js's `renderCustomerDetail(id)`. Now a real
 * Customer 360° view backed by one aggregation call
 * (`GET /api/v1/customers/:id/profile360`) instead of KYC/profile data
 * from `GET /api/v1/customers/:id` plus a client-side filter over the
 * shared loans list — that older approach only ever showed a bare loan
 * table, with no ornament/payment/bank-pledge/auction history in one
 * place. SMS reminder / follow-up history is still omitted — no data
 * source exists anywhere yet. */
export function CustomerDetail({ id }: { id?: string }) {
  const { openModal } = useModal();
  const toast = useToast();
  const { role } = useAuth();
  // Cashier is outside the loan creation/approval flow — the backend
  // already 403s a Cashier's POST /loans, hide the button rather than let
  // them click into a form that can only ever fail.
  const canCreateLoans = role !== "Cashier";

  const [profile, setProfile] = useState<Customer360View | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setProfile(null);
    setError("");
    getCustomer360(id)
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customer."));
  }, [id]);

  if (error) return <div className="empty">Customer not found — {error}</div>;
  if (!profile) return <div className="empty">Loading customer…</div>;

  const c = profile.customer;
  const cLoans = profile.loans;

  function openRequestPicker() {
    openModal(
      <SelectLoanForRequestModalContent
        loans={cLoans}
        onPicked={(pickedLoan: LoanView, type: "Extension" | "Release") => {
          if (type === "Extension") {
            openModal(<RequestExtensionModalContent loan={pickedLoan} onSaved={() => {}} />);
          } else {
            openModal(<RequestReleaseModalContent loan={pickedLoan} onSaved={() => {}} />);
          }
        }}
      />
    );
  }

  return (
    <>
      <div className="page-h">
        <div className="dhead">
          <div className="big-av">{initials(c.name)}</div>
          <div><h1 style={{ fontSize: 26 }}>{c.name}</h1><p>{c.code} · {c.branchName} branch</p></div>
        </div>
        <div className="sp" />
        <button className="btn ghost sm" onClick={() => toast("SMS/WhatsApp composer — full build")}>
          <Icon name="chat" /> Message
        </button>
        <button className="btn ghost sm" onClick={openRequestPicker}><Icon name="unlock" /> Request Extension / Release</button>
        {canCreateLoans && <a className="btn sm" href="#newloan"><Icon name="plus" /> New Loan</a>}
      </div>
      <hr className="gold-rule" />
      <div className="grid cols12">
        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>KYC &amp; Verification</h3></div>
            <div className="bd">
              <div className="kv">
                <div className="i"><div className="k">PAN</div><div className="v">{c.pan || "—"} · <StatusChip status={c.panStatus} /></div></div>
                <div className="i"><div className="k">Aadhaar</div><div className="v">{c.aadhaarLast4 ? "XXXX-XXXX-" + c.aadhaarLast4 : "—"} · <StatusChip status={c.aadhaarStatus} /></div></div>
                <div className="i"><div className="k">Overall KYC</div><div className="v"><StatusChip status={c.kycStatus} /></div></div>
                <div className="i"><div className="k">Date of Birth</div><div className="v">{c.dob || "—"}</div></div>
                <div className="i"><div className="k">Phone</div><div className="v">{c.phone}</div></div>
                <div className="i"><div className="k">Address</div><div className="v">{c.address || "—"}</div></div>
              </div>
              <div className="notice" style={{ marginTop: 14 }}>
                <Icon name="shield" /> Stage 1: KYC auto-verified on registration — pending live Setu/DigiLocker integration.
              </div>
            </div>
          </div>
          <div className="card"><div className="hd"><h3>Identity &amp; KYC Documents</h3></div>
            <div className="bd"><div className="kv">
              <ProofLink label="Photograph" url={c.photoUrl} />
              <ProofLink label="Identity Proof" url={c.identityProofUrl} />
              <ProofLink label="Address Proof" url={c.addressProofUrl} />
              <ProofLink label="Supporting KYC Document" url={c.kycDocumentUrl} />
            </div></div>
          </div>
          {(c.nomineeName || c.nomineeRelation || c.nomineePhone) && (
            <div className="card"><div className="hd"><h3>Nominee Information</h3></div>
              <div className="bd"><div className="kv">
                <div className="i"><div className="k">Name</div><div className="v">{c.nomineeName || "—"}</div></div>
                <div className="i"><div className="k">Relation</div><div className="v">{c.nomineeRelation || "—"}</div></div>
                <div className="i"><div className="k">Phone</div><div className="v">{c.nomineePhone || "—"}</div></div>
              </div></div>
            </div>
          )}
          <div className="card"><div className="hd"><h3>Relationship Summary</h3></div>
            <div className="bd"><div className="kv">
              <div className="i"><div className="k">Total Disbursed</div><div className="v">{fmt(profile.totalDisbursed)}</div></div>
              <div className="i"><div className="k">Outstanding</div><div className="v">{fmt(profile.totalOutstanding)}</div></div>
              <div className="i"><div className="k">Total Paid</div><div className="v">{fmt(profile.totalPaid)}</div></div>
              <div className="i"><div className="k">Active Loans</div><div className="v">{profile.activeLoanCount}</div></div>
              <div className="i"><div className="k">Closed Loans</div><div className="v">{profile.closedLoanCount}</div></div>
            </div></div>
          </div>
        </div>
        <div className="grid">
          <div className="card"><div className="hd"><h3>Loan History</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Loan</th><th>Scheme</th><th>Opened / Due</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
              <tbody>
                {cLoans.length === 0 ? (
                  <tr><td colSpan={7} className="empty">No loans yet.</td></tr>
                ) : cLoans.map((l) => <LoanRow loan={l} key={l.id} />)}
              </tbody>
            </table></div>
          </div>

          <div className="card"><div className="hd"><h3>Pledged Ornaments (all loans)</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Loan</th><th>Ornament</th><th>Purity</th><th className="num">Net (g)</th><th className="num">Gold Value</th></tr></thead>
              <tbody>
                {cLoans.flatMap((l) => l.ornaments.map((o) => ({ l, o }))).length === 0 ? (
                  <tr><td colSpan={5} className="empty">No pledged ornaments yet.</td></tr>
                ) : cLoans.flatMap((l) => l.ornaments.map((o) => (
                  <tr key={l.id + "-" + o.id}>
                    <td><a href={`#loan/${l.id}`}>{l.id}</a></td>
                    <td>{o.name}</td>
                    <td><span className="chip gold">{o.purity}</span></td>
                    <td className="num">{fmtW(o.netWeight)}</td>
                    <td className="num">{fmt(o.goldValue)}</td>
                  </tr>
                )))}
              </tbody>
            </table></div>
          </div>

          <div className="card"><div className="hd"><h3>Payment History (all loans)</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Loan</th><th>Date</th><th>Type</th><th className="num">Amount</th><th>Method</th></tr></thead>
              <tbody>
                {cLoans.flatMap((l) => l.payments.map((p) => ({ l, p }))).length === 0 ? (
                  <tr><td colSpan={5} className="empty">No payments recorded yet.</td></tr>
                ) : cLoans.flatMap((l) => l.payments.map((p) => (
                  <tr key={l.id + "-" + p.id}>
                    <td><a href={`#loan/${l.id}`}>{l.id}</a></td>
                    <td>{p.paidOn}</td>
                    <td>{p.type}</td>
                    <td className="num">{fmt(p.amount)}</td>
                    <td>{p.method || "—"}</td>
                  </tr>
                )))}
              </tbody>
            </table></div>
          </div>

          <div className="card"><div className="hd"><h3>Bank Pledges (all loans)</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Loan</th><th>Bank</th><th className="num">Amount</th><th>Pledged On</th><th>Status</th></tr></thead>
              <tbody>
                {cLoans.flatMap((l) => l.bankPledges.map((p) => ({ l, p }))).length === 0 ? (
                  <tr><td colSpan={5} className="empty">No bank pledges yet.</td></tr>
                ) : cLoans.flatMap((l) => l.bankPledges.map((p) => (
                  <tr key={l.id + "-" + p.id}>
                    <td><a href={`#loan/${l.id}`}>{l.id}</a></td>
                    <td>{p.bankName}</td>
                    <td className="num">{fmt(p.pledgedAmount)}</td>
                    <td>{p.pledgeDate}</td>
                    <td><StatusChip status={p.isReleased ? "Released" : "Bank Pledged"} /></td>
                  </tr>
                )))}
              </tbody>
            </table></div>
          </div>

          {profile.auctionHistory.length > 0 && (
            <div className="card"><div className="hd"><h3>Auction History</h3></div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Loan</th><th>Stage</th><th>Auction Date</th><th className="num">Sale Amount</th><th className="num">Surplus/Shortfall</th></tr></thead>
                <tbody>
                  {profile.auctionHistory.map((a) => {
                    const l = cLoans.find((cl) => cl.numericId === a.loanId);
                    return (
                      <tr key={a.id}>
                        <td>{l ? <a href={`#loan/${l.id}`}>{l.id}</a> : a.loanId}</td>
                        <td><StatusChip status={a.stage} /></td>
                        <td>{a.auctionDate || "—"}</td>
                        <td className="num">{a.saleAmount ? fmt(a.saleAmount) : "—"}</td>
                        <td className="num" style={{ color: a.surplusShortfall >= 0 ? "var(--green)" : "var(--red)" }}>{a.saleAmount ? fmt(Math.abs(a.surplusShortfall)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
