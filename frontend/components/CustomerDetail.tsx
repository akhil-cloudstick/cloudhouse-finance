"use client";

import { useEffect, useState } from "react";
import { useLoans } from "@/lib/LoansProvider";
import { useToast } from "@/components/Toast";
import { fmt, initials } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { LoanRow } from "@/components/LoanRow";
import { Icon } from "@/lib/icons";
import { getCustomer, type CustomerView } from "@/lib/customersApi";

function ProofLink({ label, url }: { label: string; url: string }) {
  if (!url) return <div className="i"><div className="k">{label}</div><div className="v" style={{ color: "var(--muted)" }}>Not provided</div></div>;
  return (
    <div className="i"><div className="k">{label}</div><div className="v">
      <a href={url} target="_blank" rel="noreferrer">View</a>
    </div></div>
  );
}

/* Ported from legacy/app.js's `renderCustomerDetail(id)`. Personal/KYC/
 * nominee/proof-document sections now come from the real backend
 * (`GET /api/v1/customers/:id`); loan/ornament/payment/auction history
 * still reads the mock `db` — the Loan module itself is out of scope for
 * this stage. SMS reminder / follow-up history is omitted entirely — no
 * data source exists anywhere yet. */
export function CustomerDetail({ id }: { id?: string }) {
  const { loans } = useLoans();
  const toast = useToast();

  const [c, setC] = useState<CustomerView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setC(null);
    setError("");
    getCustomer(id)
      .then(setC)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customer."));
  }, [id]);

  if (error) return <div className="empty">Customer not found — {error}</div>;
  if (!c) return <div className="empty">Loading customer…</div>;

  const cLoans = loans.filter((l) => l.customerId === c.id);
  const disbursed = cLoans.reduce((s, l) => s + l.principal, 0);
  const out = cLoans.reduce((s, l) => s + (l.status === "Closed" ? 0 : l.outstanding), 0);

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
        <a className="btn sm" href="#newloan"><Icon name="plus" /> New Loan</a>
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
              <div className="i"><div className="k">Total Disbursed</div><div className="v">{fmt(disbursed)}</div></div>
              <div className="i"><div className="k">Outstanding</div><div className="v">{fmt(out)}</div></div>
              <div className="i"><div className="k">Active Loans</div><div className="v">{cLoans.filter((l) => l.status !== "Closed").length}</div></div>
              <div className="i"><div className="k">Closed Loans</div><div className="v">{cLoans.filter((l) => l.status === "Closed").length}</div></div>
            </div></div>
          </div>
        </div>
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
      </div>
    </>
  );
}
