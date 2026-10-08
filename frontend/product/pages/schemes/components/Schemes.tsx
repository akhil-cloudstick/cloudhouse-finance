"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { SchemeModalContent } from "@/product/components/modals/SchemeModal";
import { SchemeStatementModalContent } from "@/product/components/modals/SchemeStatementModal";
import { ConfirmModalContent } from "@/product/components/modals/ConfirmModal";
import { deleteScheme, listSchemes, type SchemeView } from "@/product/pages/schemes/services/schemeService";
import { useAuth } from "@/product/providers/auth-context";
import { useIsSmallScreen } from "@/product/utils/responsive";

/* Ported from legacy/app.js's `renderSchemes()` (legacy/app.js:1222-1244).
 * Loads real data from the Go backend (`GET /api/v1/schemes`) instead of
 * the localStorage mock store. */
export function Schemes() {
  const { openModal } = useModal();
  // Every action here is hidden, not disabled, when the role lacks its
  // permission — see Customers.tsx.
  const { can } = useAuth();
  const smallScreen = useIsSmallScreen();
  const canCreateSchemes = can("Scheme_Management", "can_create_scheme");
  const canUpdateSchemes = can("Scheme_Management", "can_update_scheme");
  const canDeleteSchemes = can("Scheme_Management", "can_delete_scheme");
  const toast = useToast();
  // The statement lists the scheme's loans and is a download.
  const canDownloadStatement = can("Loan_Management", "can_view_loan_module") && can("Ledger_Export", "can_export_ledger");
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

  // Permanent delete — the backend refuses (409) while any loan or loan
  // draft still uses the scheme, and that message shows inside the modal.
  function onDelete(s: SchemeView) {
    openModal(
      <ConfirmModalContent
        title="Delete Scheme"
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={async () => {
          await deleteScheme(s.id);
          toast(`Scheme "${s.name}" deleted`);
          load();
        }}
      >
        <p style={{ fontSize: 13.5, margin: 0 }}>
          Permanently delete scheme &quot;{s.name}&quot; ({s.code})? This cannot be undone.
        </p>
      </ConfirmModalContent>
    );
  }

  return (
    <>
      <div className="page-h" >
        <div><h1>Loan Schemes</h1><p>Interest rates, tenure, LTV and calculation rules per scheme</p></div>
        <div className="sp" />
        {canCreateSchemes && <button className="btn" onClick={() => openModal(<SchemeModalContent onSaved={onSaved} />)}><Icon name="plus" /> New Scheme</button>}
      </div>
      {/* Explicit small-screen margin (matches Loans.tsx's own hr override)
       * — .page-h's negative marginTop above pulls the header block up
       * toward the top of the page on small/short (useIsSmallScreen)
       * windows, which was leaving this rule reading as missing since it
       * collapsed almost flush against the header instead of showing as a
       * clearly separate divider line. */}
      <hr className="gold-rule" style={smallScreen ? { margin: "4px 0 18px" } : undefined} />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Something went wrong. Please try again later.
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
      <div className="grid schemes-grid" style={{ gridTemplateColumns: smallScreen ? "repeat(4, 1fr)" : "repeat(auto-fill,minmax(300px,1fr))" }}>
        {(schemes || []).map((s) => (
          <div className="card gtop" key={s.id} style={{ minHeight: smallScreen ? 190 : 300 }}>
            <div className="hd" style={smallScreen ? { padding: "8px 12px 6px" } : undefined}>
              <div>
                <h3>{s.name}</h3>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.code}</span>
              </div>
              <div className="sp" />
              {s.active ? <span className="chip green">Active</span> : <span className="chip gray">Inactive</span>}
            </div>
            <div className="bd" style={smallScreen ? { padding: "8px 12px" } : undefined}>
              <div className="kv scheme-kv" style={{ gridTemplateColumns: "1fr 1fr", gap: smallScreen ? "6px 12px" : undefined }}>
                <div className="i"><div className="k">Interest</div><div className="v" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>{s.rate}% p.a.</div></div>
                <div className="i"><div className="k">Duration</div><div className="v">{s.durationMonths} months</div></div>
                <div className="i"><div className="k">LTV</div><div className="v">{s.ltv}%</div></div>
                <div className="i"><div className="k">Method</div><div className="v">{s.method || "—"}</div></div>
                <div className="i"><div className="k">Penal Charges</div><div className="v" style={{ color: "var(--red)", fontWeight: 600 }}>{s.penal}% p.a.</div></div>
                {s.serviceChargeType !== "None" && (
                  <div className="i"><div className="k">Service Charge</div><div className="v">
                    {s.serviceChargeType === "Flat" ? `₹${s.serviceChargeValue}` : `${s.serviceChargeValue}%`}
                    {" "}({s.serviceChargeMode === "AddedToPrincipal" ? "added to principal" : "withheld"})
                  </div></div>
                )}
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: smallScreen ? 4 : 12, borderTop: "1px dashed var(--line)", paddingTop: smallScreen ? 4 : 10, height: smallScreen ? 28 : 60, overflow: "hidden" }}>{s.cond || "—"}</p>
            </div>
            <div className="ft" style={{ display: "flex", gap: 8, padding: smallScreen ? "6px 12px" : undefined }}>
              {canDownloadStatement && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<SchemeStatementModalContent scheme={s} />, true); }}>Download Statement</a>}
              <span style={{ flex: 1 }} />
              {canUpdateSchemes && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<SchemeModalContent scheme={s} onSaved={onSaved} />); }}>Edit</a>}
              {canDeleteSchemes && <a href="#" style={{ color: "var(--red)" }} onClick={(e) => { e.preventDefault(); onDelete(s); }}>Delete</a>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
