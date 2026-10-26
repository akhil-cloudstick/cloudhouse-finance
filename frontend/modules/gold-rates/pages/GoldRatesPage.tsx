"use client";

import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { Fragment, useEffect, useState } from "react";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/common/components/ModalProvider";
import { RateModalContent } from "@/common/components/modals/RateModalContent";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtDate } from "@/common/utils/format";
import { listGoldRateDaysPage } from "@/modules/gold-rates/services/goldRateService";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { type GoldRateView } from "@/modules/gold-rates/types/gold-rate-types";
import { useAuth } from "@/common/providers/AuthProvider";
import { useResponsivePageSize, useScrollPageSize, useIsSmallScreen } from "@/common/utils/responsive";

const timeOf = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
};

/* Name, with the setter's designation (role) under it when known. */
function PublishedBy({ r }: { r: GoldRateView }) {
  return (
    <>
      {r.setBy}
      {r.setByDesignation && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.setByDesignation}</div>}
    </>
  );
}

type RateTileProps = { k: string; r: number; small?: boolean };

function RateTile({ k, r, small }: RateTileProps) {
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
export function GoldRatesPage() {
  const { latest, version } = useGoldRates();
  const { openModal } = useModal();
  const basePageSize = useResponsivePageSize(15, 15);
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
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
  // "YYYY-MM-DD", or "" for every day.
  const [day, setDay] = useState("");
  // Days whose list of changes is open.
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const toggleDay = (d: string) => setOpenDays((cur) => { const next = new Set(cur); if (next.has(d)) next.delete(d); else next.add(d); return next; });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listGoldRateDaysPage(page, pageSize, day || undefined)
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
        setError("");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load rate history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, version, day]);

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
        <div className="hd">
          <h3>Rate History</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 170 }}>
              <DatePicker value={day} onChange={(v) => { setDay(v); setPage(1); }} placeholder="Filter by date…" max={new Date().toISOString().slice(0, 10)} />
            </div>
            {day && <button className="btn plain sm" onClick={() => { setDay(""); setPage(1); }}>Clear</button>}
          </div>
        </div>
        {error && <div className="notice" style={{ margin: "0 16px 14px" }}>{error}</div>}
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center tbl-cards">
            <thead>
              <tr><th>Date</th><th className="num">24K ₹/g</th><th className="num">22K ₹/g</th><th className="num">18K ₹/g</th><th>Published By</th></tr>
            </thead>
            <tbody>
              {loading && !(cards && rows.length > 0) ? (
                <tr><td colSpan={5} className="empty">Loading rate history…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="empty">{day ? "No rates were published on this date." : "No rates published yet."}</td></tr>
              ) : rows.map((r) => {
                // One row per day showing its newest rate; the day's changes sit behind it.
                const entries = r.entries && r.entries.length ? r.entries : [r];
                const expandable = entries.length > 1;
                const open = expandable && openDays.has(r.date);
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={expandable ? () => toggleDay(r.date) : undefined}
                      style={expandable ? { cursor: "pointer" } : undefined}
                      aria-expanded={expandable ? open : undefined}
                    >
                      <td data-label="Date">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {expandable && <Icon name="chevronDown" style={{ transform: open ? "rotate(180deg)" : "rotate(-90deg)", transition: "transform .15s" }} />}
                          {fmtDate(r.date)}
                          {expandable && <span className="chip">{entries.length} changes</span>}
                        </span>
                      </td>
                      <td className="num" data-label="24K ₹/g">{fmt(r.k24)}</td>
                      <td className="num" data-label="22K ₹/g">{fmt(r.k22)}</td>
                      <td className="num" data-label="18K ₹/g">{fmt(r.k18)}</td>
                      <td data-label="Published By"><PublishedBy r={r} /></td>
                    </tr>
                    {open && entries.map((e, i) => (
                      <tr key={e.id} style={{ background: "var(--bg-soft, #f6f6f8)" }}>
                        <td data-label="Time" style={{ paddingLeft: 36 }}>{timeOf(e.createdAt)}{i === 0 && <span className="chip" style={{ marginLeft: 6 }}>Latest</span>}</td>
                        <td className="num" data-label="24K ₹/g">{fmt(e.k24)}</td>
                        <td className="num" data-label="22K ₹/g">{fmt(e.k22)}</td>
                        <td className="num" data-label="18K ₹/g">{fmt(e.k18)}</td>
                        <td data-label="Published By"><PublishedBy r={e} /></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <ScrollSentinel enabled={cards && (page < totalPages)} onVisible={more} watch={rows.length} />
        <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
        </div>
      </div>
    </>
  );
}
