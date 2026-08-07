"use client";

import { useData } from "@/lib/DataProvider";
import { useToast } from "@/components/Toast";
import { fmt, initials } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { LoanRow } from "@/components/LoanRow";
import { Icon } from "@/lib/icons";

/* Ported from legacy/app.js's `renderCustomerDetail(id)`. */
export function CustomerDetail({ id }: { id?: string }) {
  const { db } = useData();
  const toast = useToast();

  const c = db.customers.find((x) => x.id === id);
  if (!c) return <div className="empty">Customer not found.</div>;

  const cLoans = db.loans.filter((l) => l.cust === c.id);
  const disbursed = cLoans.reduce((s, l) => s + l.principal, 0);
  const out = cLoans.reduce((s, l) => s + (l.status === "Closed" ? 0 : l.outstanding), 0);

  const kycMark = (v: string) => (v === "V" ? "✔ Verified" : v === "P" ? "⏳ Pending" : "✖ Failed");

  return (
    <>
      <div className="page-h">
        <div className="dhead">
          <div className="big-av">{initials(c.name)}</div>
          <div><h1 style={{ fontSize: 26 }}>{c.name}</h1><p>{c.id} · Customer since {c.since} · {c.branch} branch</p></div>
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
                <div className="i"><div className="k">PAN</div><div className="v">{kycMark(c.pan)}</div></div>
                <div className="i"><div className="k">Aadhaar / KYC</div><div className="v">{kycMark(c.aadhaar)}</div></div>
                <div className="i"><div className="k">Overall</div><div className="v"><StatusChip status={c.kyc} /></div></div>
                <div className="i"><div className="k">Date of Birth</div><div className="v">{c.dob}</div></div>
                <div className="i"><div className="k">Phone</div><div className="v">{c.phone}</div></div>
                <div className="i"><div className="k">Address</div><div className="v">{c.addr}</div></div>
              </div>
              {c.kyc !== "Verified" && (
                <div className="notice" style={{ marginTop: 14 }}>
                  <Icon name="shield" /> Loan operations are blocked until mandatory KYC checks pass.
                </div>
              )}
            </div>
          </div>
          <div className="card"><div className="hd"><h3>Relationship Summary</h3></div>
            <div className="bd"><div className="kv">
              <div className="i"><div className="k">Total Disbursed</div><div className="v">{fmt(disbursed)}</div></div>
              <div className="i"><div className="k">Outstanding</div><div className="v">{fmt(out)}</div></div>
              <div className="i"><div className="k">Active Loans</div><div className="v">{cLoans.filter((l) => l.status !== "Closed").length}</div></div>
              <div className="i"><div className="k">Closed Loans</div><div className="v">{cLoans.filter((l) => l.status === "Closed").length}</div></div>
              <div className="i"><div className="k">SMS Reminders</div><div className="v">6 sent</div></div>
              <div className="i"><div className="k">Follow-ups</div><div className="v">2 recorded</div></div>
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
