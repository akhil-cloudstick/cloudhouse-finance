"use client";

import { useData } from "@/lib/DataProvider";
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

/* Ported from legacy/app.js's `renderGoldRates()` / `rateTile()`. */
export function GoldRates() {
  const { db } = useData();
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
        <RateTile k="24K · 999" r={db.rates.k24} />
        <RateTile k="22K · 916" r={db.rates.k22} />
        <RateTile k="18K · 750" r={db.rates.k18} />
      </div>
      <div className="card">
        <div className="hd"><h3>Rate History</h3></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th className="num">24K ₹/g</th><th className="num">22K ₹/g</th><th className="num">18K ₹/g</th><th>Published By</th></tr>
            </thead>
            <tbody>
              {db.rateHistory.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td className="num">{fmt(r.k24)}</td>
                  <td className="num">{fmt(r.k22)}</td>
                  <td className="num">{fmt(r.k18)}</td>
                  <td>{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
