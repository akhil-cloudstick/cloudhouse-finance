"use client";

import { useEffect, useState } from "react";
import { useGoldRates } from "@/product/pages/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/product/components/Modal";
import { RateModalContent } from "@/product/components/modals/RateModal";
import { Icon } from "@/product/components/Icon";
import { fmt, fmtDate } from "@/product/utils/format";
import { listGoldRatesPage, type GoldRateView } from "@/product/pages/gold-rates/services/goldRateService";
import { useAuth } from "@/product/providers/auth-context";
import { useResponsivePageSize, useIsSmallScreen } from "@/product/utils/responsive";

function RateTile({ k, r, small }: { k: string; r: number; small?: boolean }) {
  return (
    <div className={small ? "rate-tile rate-tile-sm" : "rate-tile"}>
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
  const { latest, version } = useGoldRates();
  const { openModal } = useModal();
  const pageSize = useResponsivePageSize(15, 15);
  const smallScreen = useIsSmallScreen();
  // Hidden rather than disabled when the role cannot record a rate — see
  // Customers.tsx.
  const { can } = useAuth();
  const canCreateRates = can("Gold_Rate_Management", "can_create_gold_rate");

  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<GoldRateView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listGoldRatesPage(page, pageSize)
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
        setError("");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load rate history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, version]);

  return (
    <>
      <div className="page-h" >
        <div><h1>Gold Rates</h1><p>Daily published rates by purity · full history maintained for audit</p></div>
        <div className="sp"></div>
        {canCreateRates && (
          <button className="btn" onClick={() => openModal(<RateModalContent />)}>
            <Icon name="coin" /> Set Today&apos;s Rate
          </button>
        )}
      </div>
      <hr className="gold-rule" />
      <div className="rates3" style={{ maxWidth: smallScreen ? 480 : 720, marginBottom: 20 }}>
        <RateTile k="24K · 999 · published" r={latest.k24} small={smallScreen} />
        <RateTile k="22K · 916" r={latest.k22} small={smallScreen} />
        <RateTile k="18K · 750" r={latest.k18} small={smallScreen} />
      </div>
      
      <div className="card tbl-card tbl-card-fill">
        <div className="hd"><h3>Rate History</h3></div>
        {error && <div className="notice" style={{ margin: "0 16px 14px" }}>{error}</div>}
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center">
            <thead>
              <tr><th>Date</th><th className="num">24K ₹/g</th><th className="num">22K ₹/g</th><th className="num">18K ₹/g</th><th>Published By</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty">Loading rate history…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="empty">No rates published yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.date)}</td>
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
