"use client";

import { useData } from "@/lib/DataProvider";
import { fmt } from "@/lib/format";
import { TITLES } from "@/lib/routes";
import GlobalSearch from "./GlobalSearch";

/* Ported from legacy/app.html's <header class="top"> + app.js's
 * `refreshRateChip()` / breadcrumb logic in `router()`. */
export function Topbar({ route, onBurger }: { route: string; onBurger: () => void }) {
  const { db } = useData();

  return (
    <header className="top">
      <button className="burger" id="burger" aria-label="Menu" onClick={onBurger}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span className="crumb" id="crumb">
        Ambika Gold Finance &nbsp;/&nbsp; <b>{TITLES[route] || "Dashboard"}</b>
      </span>
      <GlobalSearch />
      <span className="rate-chip" id="rateChip">
        <span className="dot"></span> 22K <b>{fmt(db.rates.k22)}/g</b> · 24K <b>{fmt(db.rates.k24)}/g</b>
      </span>
      <span className="user">
        <span className="av">RM</span>
        <span className="nm">
          Rajesh Menon
          <small>Owner · Administrator</small>
        </span>
      </span>
      <a className="logout" href="/">Sign out</a>
    </header>
  );
}
