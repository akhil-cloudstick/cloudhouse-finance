"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import { fmt, fmtW, initials } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { DatePicker } from "@/components/DatePicker";
import { LoanRow } from "@/components/LoanRow";
import { Icon } from "@/lib/icons";
import { getCustomer360, verifyCustomerPan, startAadhaarVerify, checkAadhaarVerify, type Customer360View } from "@/lib/customersApi";
import type { LoanView } from "@/lib/loansApi";
import {
  SelectLoanForRequestModalContent,
  RequestExtensionModalContent,
  RequestReleaseModalContent,
} from "@/components/modals/RequestExtensionModal";
import { EditCustomerModalContent } from "@/components/modals/EditCustomerModal";

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
  const [verifying, setVerifying] = useState(false);
  // DigiLocker Aadhaar verify is a redirect flow — "started" means the
  // customer's been sent the DigiLocker login URL and we're waiting for
  // them to complete it on their own device, so a "Check Status" button
  // replaces "Send Verification Link" until they confirm or we give up.
  const [aadhaarStarted, setAadhaarStarted] = useState(false);
  const [checkingAadhaar, setCheckingAadhaar] = useState(false);
  // Opened-date window for the whole profile. Empty = unbounded on that
  // side; both are handed to the backend, which filters the loans and
  // recomputes the relationship totals over the narrowed set — nothing here
  // is filtered client-side.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError("");
    setReloading(true);
    getCustomer360(id, { from, to })
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customer."))
      .finally(() => setReloading(false));
  }, [id, from, to]);

  // A range change keeps the previously loaded profile on screen (dimmed
  // via `reloading`) so the page doesn't blank out between fetches.
  if (error && !profile) return <div className="empty">Customer not found — {error}</div>;
  if (!profile) return <div className="empty">Loading customer…</div>;

  const c = profile.customer;
  const cLoans = profile.loans;

  async function verifyPan() {
    if (!id) return;
    setVerifying(true);
    try {
      const result = await verifyCustomerPan(id);
      setProfile((p) => (p ? { ...p, customer: result.customer } : p));
      const status = result.customer.panStatus;
      if (status === "Verified") {
        toast(`PAN verified — Setu returned "${result.matchedName}". ${result.message}`);
      } else if (status === "Name Mismatch") {
        toast(`PAN is valid but registered to a different name — Setu returned "${result.matchedName}", which doesn't match this customer's name. Please review before proceeding.`);
      } else {
        toast(`PAN verification failed — ${result.message}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "PAN verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  async function sendAadhaarVerificationLink() {
    if (!id) return;
    setVerifying(true);
    try {
      const redirectUrl = `${window.location.origin}/digilocker-callback`;
      const started = await startAadhaarVerify(id, redirectUrl);
      window.open(started.url, "_blank", "noopener,noreferrer");
      setAadhaarStarted(true);
      toast("DigiLocker login opened in a new tab — ask the customer to complete Aadhaar + OTP login there, then click \"Check Status\" here.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start Aadhaar verification.");
    } finally {
      setVerifying(false);
    }
  }

  async function checkAadhaarStatus() {
    if (!id) return;
    setCheckingAadhaar(true);
    try {
      const result = await checkAadhaarVerify(id);
      if (result.status !== "authenticated" || !result.customer) {
        toast("Customer hasn't completed DigiLocker login yet — ask them to finish it in the tab that opened, then check again.");
        return;
      }
      setProfile((p) => (p ? { ...p, customer: result.customer! } : p));
      setAadhaarStarted(false);
      const status = result.customer.aadhaarStatus;
      if (status === "Verified") {
        toast(`Aadhaar verified via DigiLocker — matched name "${result.matchedName}".`);
      } else if (status === "Name Mismatch") {
        toast(`Aadhaar verified but registered name "${result.matchedName}" doesn't match this customer's name. Please review before proceeding.`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not check Aadhaar verification status.");
    } finally {
      setCheckingAadhaar(false);
    }
  }

  function openEditCustomer() {
    openModal(
      <EditCustomerModalContent
        customer={c}
        onSaved={() => {
          if (!id) return;
          getCustomer360(id, { from, to }).then(setProfile).catch(() => {});
        }}
      />
    );
  }

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
        <button className="btn ghost sm" onClick={openEditCustomer}><Icon name="edit" /> Edit Customer</button>
        <button className="btn ghost sm" onClick={openRequestPicker}><Icon name="unlock" /> Request Extension / Release</button>
        {canCreateLoans && <a className="btn sm" href="#newloan"><Icon name="plus" /> New Loan</a>}
      </div>
      <hr className="gold-rule" />
      {/* Opened-date filter for the whole 360 view — every card below plus
          the relationship totals come from the backend-filtered loan set. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 190 }}>
          <label className="f">Loans Opened From</label>
          <DatePicker value={from} onChange={setFrom} placeholder="Any start date…" max={to || undefined} />
        </div>
        <div style={{ minWidth: 190 }}>
          <label className="f">To</label>
          <DatePicker value={to} onChange={setTo} placeholder="Any end date…" min={from || undefined} />
        </div>
        {(from || to) && (
          <button className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); }}>Clear</button>
        )}
        {reloading && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading…</span>}
        {error && <span style={{ fontSize: 12.5, color: "var(--red)" }}>{error}</span>}
      </div>
      <div className="grid cols12" style={reloading ? { opacity: 0.6 } : undefined}>
        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>KYC &amp; Verification</h3></div>
            <div className="bd">
              <div className="kv">
                <div className="i"><div className="k">PAN</div><div className="v" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{c.pan || "—"} · <StatusChip status={c.panStatus} /></span>
                  {c.pan && c.panStatus !== "Verified" && (
                    <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={verifyPan} disabled={verifying}>
                      {verifying ? "Verifying…" : "Verify PAN"}
                    </button>
                  )}
                </div></div>
                <div className="i"><div className="k">Aadhaar</div><div className="v" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{c.aadhaarLast4 ? "XXXX-XXXX-" + c.aadhaarLast4 : "—"} · <StatusChip status={c.aadhaarStatus} /></span>
                  {c.aadhaarStatus !== "Verified" && !aadhaarStarted && (
                    <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={sendAadhaarVerificationLink} disabled={verifying}>
                      {verifying ? "Starting…" : "Verify via DigiLocker"}
                    </button>
                  )}
                  {c.aadhaarStatus !== "Verified" && aadhaarStarted && (
                    <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={checkAadhaarStatus} disabled={checkingAadhaar}>
                      {checkingAadhaar ? "Checking…" : "Check Status"}
                    </button>
                  )}
                </div></div>
                <div className="i"><div className="k">Overall KYC</div><div className="v"><StatusChip status={c.kycStatus} /></div></div>
                <div className="i"><div className="k">Date of Birth</div><div className="v">{c.dob || "—"}</div></div>
                <div className="i"><div className="k">Phone</div><div className="v">{c.phone}</div></div>
                <div className="i"><div className="k">Address</div><div className="v">{c.address || "—"}</div></div>
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
