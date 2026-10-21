"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import { createReleaseRequest, getLoan, listLoanRequests } from "@/modules/loans/services/loanService";
import { type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = { ornaments: /ornament|collateral|remaining/i };

// Mirrors backend's partialReleaseRemaining for live feedback; buffer = 5% of principal absorbs approval drift.
function partialReleaseRemaining(outstandingBalance: number, principalAmount: number, remainingGoldValue: number, ltvPercent: number): number {
  const buffer = 0.05 * principalAmount;
  return (outstandingBalance + buffer) - (remainingGoldValue * ltvPercent) / 100;
}
type RequestReleaseModalContentProps = { loan: LoanView; onSaved: () => void };

// Selecting every ornament skips the "Remaining" collateral condition (matches backend's 100%-selection rule).
export function RequestReleaseModalContent({ loan: initialLoan, onSaved }: RequestReleaseModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();

  // The caller's `loan` prop can be stale, letting an already-released ornament show as pledged; re-fetch on mount.
  const [loan, setLoan] = useState(initialLoan);
  useEffect(() => {
    let cancelled = false;
    getLoan(initialLoan.numericId).then((fresh) => {
      if (cancelled) return;
      setLoan(fresh);
      // Re-sync selection to the freshly-fetched set; the initial useState below ran against the stale prop.
      setSelected(new Set(fresh.ornaments.filter((o) => !o.releasedAt).map((o) => o.id)));
    }).catch(() => { /* keep the possibly-stale prop rather than blocking the form */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoan.numericId]);

  const pledged = loan.ornaments.filter((o) => !o.releasedAt);
  const [selected, setSelected] = useState<Set<number>>(new Set(pledged.map((o) => o.id)));
  const [detail, setDetail] = useState("");
  const [err, setErr] = useState("");
  // A server message about the picked ornaments shows under the table; `err` keeps the rest.
  const [ornamentsErr, setOrnamentsErr] = useState("");
  const [saving, setSaving] = useState(false);
  // `disabled={saving}` alone isn't enough: both clicks of a fast double-click can read it as still-false.
  const submittingRef = useRef(false);

  // A Pending request with an empty ornamentIds list is a FULL release — every pledged ornament counts as requested.
  const [pendingOrnamentIds, setPendingOrnamentIds] = useState<Set<number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    listLoanRequests({ loanId: loan.numericId, status: "Pending" }).then((reqs) => {
      if (cancelled) return;
      const ids = new Set<number>();
      for (const r of reqs) {
        if (r.type !== "Release") continue;
        if (r.ornamentIds.length === 0) {
          pledged.forEach((o) => ids.add(o.id));
        } else {
          r.ornamentIds.forEach((id) => ids.add(id));
        }
      }
      setPendingOrnamentIds(ids);
    }).catch(() => setPendingOrnamentIds(new Set()));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan.numericId]);
  const hasPendingRelease = !!pendingOrnamentIds && pendingOrnamentIds.size > 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setOrnamentsErr("");
  }

  const allSelected = selected.size === pledged.length;
  const remainingOrnaments = pledged.filter((o) => !selected.has(o.id));
  const remainingCollateral = remainingOrnaments.reduce((sum, o) => sum + o.goldValue, 0);
  const remaining = allSelected ? 0 : partialReleaseRemaining(loan.totalOutstandingBalance, loan.principal, remainingCollateral, loan.schemeLtv);
  const conditionMet = allSelected || remaining <= 0.01;

  async function save() { return singleFlight("modal:requestextension:save:2", async () => {
    if (submittingRef.current) return;
    if (selected.size === 0) return;
    submittingRef.current = true;
    setErr(""); setOrnamentsErr("");
    setSaving(true);
    try {
      const ornamentIds = Array.from(selected);
      // Passing every pledged ornament's id behaves identically to omitting ornamentIds entirely.
      await createReleaseRequest(loan.numericId, detail.trim() || (allSelected ? "Full settlement requested" : "Partial release requested"), ornamentIds);
      onSaved();
      closeModal();
      toast(`Release request logged for ${loan.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not log the request — try again.";
      if (fieldForMessage(msg, SERVER_FIELDS)) setOrnamentsErr(msg); else setErr(msg);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Request Release — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        {hasPendingRelease && (
          <div className="notice" style={{ marginBottom: 14, color: "var(--red)" }}>
            <Icon name="shield" /> An ornament on this loan is already requested for release and has not yet been approved.
          </div>
        )}
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <div className="i"><div className="k">Outstanding Balance</div><div className="v">{fmt(loan.totalOutstandingBalance)}</div></div>
          <div className="i"><div className="k">Scheme LTV</div><div className="v">{loan.schemeLtv}%</div></div>
        </div>
        <div className={ornamentsErr ? "has-err" : undefined}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th style={{ width: 36 }}></th><th>Ornament</th><th>Purity</th><th className="num">Net (g)</th><th className="num">Gold Value</th><th></th></tr></thead>
          <tbody>
            {pledged.map((o) => {
              const isPending = !!pendingOrnamentIds?.has(o.id);
              return (
                <tr key={o.id}>
                  <td><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>
                  <td>{o.name}</td>
                  <td><span className="chip brand">{o.purity}</span></td>
                  <td className="num">{o.netWeight.toFixed(1)}</td>
                  <td className="num">{fmt(o.goldValue)}</td>
                  <td>{isPending && <span className="chip" style={{ color: "var(--red)" }} title="Already requested for release, not yet approved">Pending release</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <FieldError msg={ornamentsErr} />
        </div>
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
          <div className="i"><div className="k">Minimum Amount to Release the Gold</div>
            <div className="v" style={{ color: conditionMet ? "var(--green, #1a7f37)" : "var(--red)" }}>
              {allSelected ? fmt(loan.settlementAmount) : conditionMet ? "₹0" : fmt(remaining)}
            </div>
          </div>
        </div>
        <div className="notice" style={{ margin: "14px 0" }}>
          <Icon name="unlock" /> {allSelected ? `${fmtW(loan.totalNetWeight)} gold pledged` : `${selected.size} of ${pledged.length} ornaments selected`} 
        </div>
        <div className="frow"><div><label className="f">Note</label><input className="inp" placeholder="optional detail" value={detail} onChange={(e) => setDetail(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={selected.size === 0 || saving} onClick={save}>
          <Icon name="check" /> {saving ? "Saving…" : "Log Request"}
        </button>
      </div>
    </>
  );
}
