"use client";

import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { Icon } from "@/lib/icons";
import { SchemeModalContent } from "@/components/modals/SchemeModal";

/* Ported from legacy/app.js's `renderSchemes()` (legacy/app.js:1222-1244). */
export function Schemes() {
  const { db } = useData();
  const { openModal } = useModal();

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Schemes</h1><p>Interest rates, tenure, LTV and calculation rules per scheme</p></div>
        <div className="sp" />
        <button className="btn" onClick={() => openModal(<SchemeModalContent />)}><Icon name="plus" /> New Scheme</button>
      </div>
      <hr className="gold-rule" />
      {db.schemes.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          No loan schemes yet. Click &quot;New Scheme&quot; to create one.
        </p>
      )}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
        {db.schemes.map((s) => (
          <div className="card gtop" key={s.id}>
            <div className="hd"><h3>{s.name}</h3><div className="sp" />
              {s.active ? <span className="chip green">Active</span> : <span className="chip gray">Inactive</span>}
            </div>
            <div className="bd">
              <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="i"><div className="k">Interest</div><div className="v" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>{s.rate}% p.a.</div></div>
                <div className="i"><div className="k">Duration</div><div className="v">{s.duration}</div></div>
                <div className="i"><div className="k">LTV</div><div className="v">{s.ltv}%</div></div>
                <div className="i"><div className="k">Method</div><div className="v">{s.method}</div></div>
                <div className="i"><div className="k">Penal Charges</div><div className="v" style={{ color: "var(--red)", fontWeight: 600 }}>{s.penal != null ? s.penal + "% / month" : "—"}</div></div>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, borderTop: "1px dashed var(--line)", paddingTop: 10 }}>{s.cond}</p>
            </div>
            <div className="ft" style={{ display: "flex", gap: 8 }}>
              <span>{s.id}</span><span style={{ flex: 1 }} />
              <a href="#" onClick={(e) => { e.preventDefault(); openModal(<SchemeModalContent schemeId={s.id} />); }}>Edit</a>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
