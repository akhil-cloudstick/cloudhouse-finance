"use client";

import { useGoldRates } from "@/lib/GoldRatesProvider";
import { useModal } from "@/components/Modal";
import { RateModalContent } from "@/components/modals/RateModal";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";

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
  const { latest, history } = useGoldRates();
  const { openModal } = useModal();

  return (
    <>
      <div className="page-h">
        <div><h1>Gold Rates</h1><p>Daily published rates by purity · full history maintained for audit</p></div>
        <div className="sp"></div>
        <button className="btn" onClick={() => openModal(<RateModalContent />)}>
          <Icon name="coin" /> Set Today&apos;s Rate
        </button>
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
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th className="num">24K ₹/g</th><th className="num">22K ₹/g (comp.)</th><th className="num">18K ₹/g (comp.)</th><th>Published By</th></tr>
            </thead>
            <tbody>
              {history.map((r) => (
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
      </div>
    </>
  );
}
