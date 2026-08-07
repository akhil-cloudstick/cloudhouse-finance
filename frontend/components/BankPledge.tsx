"use client";

import { useData } from "@/lib/DataProvider";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, fmtW, custOf } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";

/* Ported from legacy/app.js's `renderBankPledge()`. */
export function BankPledge() {
  const { db } = useData();
  const toast = useToast();
  const pledged = db.loans.filter((l) => l.pledge === "Bank Pledged");

  return (
    <>
      <div className="page-h">
        <div><h1>Bank &amp; Gold Re-Pledge</h1><p>Customer gold re-pledged with external banks</p></div>
        <div className="sp" />
        <button className="btn" onClick={() => toast("Re-pledge entry — full build")}><Icon name="plus" /> New Re-Pledge</button>
      </div>
      <hr className="gold-rule" />
      <div className="grid cols21">
        <div className="card">
          <div className="hd"><h3>Re-Pledged Loans</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th>Reference</th><th className="num">Weight</th><th className="num">Bank Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pledged.map((l) => (
                  <tr key={l.id}>
                    <td><a href={`#loan/${l.id}`}>{l.id}</a></td>
                    <td>{custOf(db, l.cust).name}</td>
                    <td>{l.bank}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12.5 }}>{l.bankRef}</td>
                    <td className="num">{fmtW(l.weight)}</td>
                    <td className="num">{fmt(l.principal * 0.85)}</td>
                    <td><StatusChip status="Bank Pledged" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ft">If a customer requests closure while gold is bank-pledged, the release workflow flags the bank release step first.</div>
        </div>
        <div className="grid">
          {db.banks.map((b) => (
            <div className="card gtop" key={b.name}>
              <div className="hd"><h3>{b.name}</h3></div>
              <div className="bd">
                <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div className="i"><div className="k">Branch</div><div className="v">{b.branch}</div></div>
                  <div className="i"><div className="k">IFSC</div><div className="v">{b.ifsc}</div></div>
                  <div className="i"><div className="k">Pledged Loans</div><div className="v">{b.pledged}</div></div>
                  <div className="i"><div className="k">Exposure</div><div className="v">{fmt(b.amt)}</div></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
