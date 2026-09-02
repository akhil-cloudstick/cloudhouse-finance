"use client";

import { useEffect, useState } from "react";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/common/components/Modal";
import { RateModalContent } from "@/common/components/modals/RateModal";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { listGoldRatesPage, GOLD_RATES_HISTORY_PAGE_SIZE, type GoldRateView } from "@/modules/gold-rates/services/goldRateService";
import { useAuth } from "@/common/auth-context";

function RateTile({ k, r }: { k: string; r: number }) {
  return (
    <div className="rate-tile">
      <div className="k">{k}</div>
      <div className="r">{fmt(r)}</div>
      <div className="u">per gram</div>
    </div>
  );
}

/* Ported from legacy/app.js's `renderGoldRates()` / `rateTile()`. Now backed
 * by the real /gold-rates API via GoldRatesProvider instead of the mock
 * db.rates/db.rateHistory localStorage pair. */
export function GoldRates() {
  const { latest } = useGoldRates();
  const { openModal } = useModal();
  // Hidden rather than disabled when the role cannot record a rate — see
  // Customers.tsx.
  const { can } = useAuth();
  const canCreateRates = can("Gold_Rate_Management", "can_create_gold_rate");

  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<GoldRateView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / GOLD_RATES_HISTORY_PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listGoldRatesPage(page)
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
        setError("");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load rate history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  return (
    <>
      <div className="page-h">
        <div><h1>Gold Rates</h1><p>Daily published rates by purity · full history maintained for audit</p></div>
        <div className="sp"></div>
        {canCreateRates && (
          <button className="btn" onClick={() => openModal(<RateModalContent />)}>
            <Icon name="coin" /> Set Today&apos;s Rate
          </button>
        )}
      </div>
      <hr className="gold-rule" />
      <div className="rates3" style={{ maxWidth: 720, marginBottom: 20 }}>
        <RateTile k="24K · 999 · published" r={latest.k24} />
        <RateTile k="22K · 916 · computed" r={latest.k22} />
        <RateTile k="18K · 750 · computed" r={latest.k18} />
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -12, marginBottom: 20 }}>
        Only 24K is published daily — 22K/18K above are computed for reference. Any other purity is
        resolved per-ornament, at pledge time.
      </p>
      <div className="card">
        <div className="hd"><h3>Rate History</h3></div>
        {error && <div className="notice" style={{ margin: "0 16px 14px" }}>{error}</div>}
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center">
            <thead>
              <tr><th>Date</th><th className="num">24K ₹/g</th><th className="num">22K ₹/g (comp.)</th><th className="num">18K ₹/g (comp.)</th><th>Published By</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty">Loading rate history…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="empty">No rates published yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td className="num">{fmt(r.k24)}</td>
                  <td className="num">{fmt(r.k22)}</td>
                  <td className="num">{fmt(r.k18)}</td>
                  <td>{r.setBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
        </div>
      </div>
    </>
  );
}
