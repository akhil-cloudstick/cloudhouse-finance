"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { Icon } from "@/common/components/Icon";
import { SchemeModalContent } from "@/common/components/modals/SchemeModal";
import { listSchemes, type SchemeView } from "@/modules/schemes/services/schemeService";
import { useAuth } from "@/common/auth-context";

/* Ported from legacy/app.js's `renderSchemes()` (legacy/app.js:1222-1244).
 * Loads real data from the Go backend (`GET /api/v1/schemes`) instead of
 * the localStorage mock store. */
export function Schemes() {
  const { openModal } = useModal();
  // Every action here is hidden, not disabled, when the role lacks its
  // permission — see Customers.tsx.
  const { can } = useAuth();
  const canCreateSchemes = can("Scheme_Management", "can_create_scheme");
  const canUpdateSchemes = can("Scheme_Management", "can_update_scheme");
  const [schemes, setSchemes] = useState<SchemeView[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setSchemes(await listSchemes());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schemes.");
    }
  }

  useEffect(() => { load(); }, []);

  function onSaved() {
    load();
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Schemes</h1><p>Interest rates, tenure, LTV and calculation rules per scheme</p></div>
        <div className="sp" />
        {canCreateSchemes && <button className="btn" onClick={() => openModal(<SchemeModalContent onSaved={onSaved} />)}><Icon name="plus" /> New Scheme</button>}
      </div>
      <hr className="gold-rule" />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
        </p>
      )}
      {!error && schemes === null && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading schemes…</p>
      )}
      {schemes !== null && schemes.length === 0 && !error && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          No loan schemes yet. Click &quot;New Scheme&quot; to create one.
        </p>
      )}
      {/* Fixed 300px columns (auto-fill, not auto-fill/minmax's usual
       * "stretch to fill" 1fr) — a hardcoded repeat(5,...) never reflowed
       * at any width, so on anything narrower than a very wide desktop the
       * cards just kept shrinking (and their fixed-height/overflow:hidden
       * content clipping) instead of wrapping to fewer per row. A plain
       * 1fr fixed that but let each card's own width still stretch/shrink
       * with the container, changing size across screens instead of
       * staying constant. A flat 300px column, repeated with auto-fill,
       * keeps every card exactly the same size everywhere — 300px is
       * simply as many columns as actually fit, wrapping the rest onto the
       * next row instead of resizing anything (same pattern used on the
       * Roles & Permissions grid, so both pages' cards match). */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
        {(schemes || []).map((s) => (
          <div className="card gtop" key={s.id} style={{ minHeight: 300 }}>
            <div className="hd"><h3>{s.name}</h3><div className="sp" />
              {s.active ? <span className="chip green">Active</span> : <span className="chip gray">Inactive</span>}
            </div>
            <div className="bd">
              <div className="kv scheme-kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="i"><div className="k">Interest</div><div className="v" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>{s.rate}% p.a.</div></div>
                <div className="i"><div className="k">Duration</div><div className="v">{s.durationMonths} months</div></div>
                <div className="i"><div className="k">LTV</div><div className="v">{s.ltv}%</div></div>
                <div className="i"><div className="k">Method</div><div className="v">{s.method || "—"}</div></div>
                <div className="i"><div className="k">Penal Charges</div><div className="v" style={{ color: "var(--red)", fontWeight: 600 }}>{s.penal}% / month</div></div>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, borderTop: "1px dashed var(--line)", paddingTop: 10, height: 60, overflow: "hidden" }}>{s.cond || "—"}</p>
            </div>
            <div className="ft" style={{ display: "flex", gap: 8 }}>
              <span>{s.code}</span><span style={{ flex: 1 }} />
              {canUpdateSchemes && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<SchemeModalContent scheme={s} onSaved={onSaved} />); }}>Edit</a>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
