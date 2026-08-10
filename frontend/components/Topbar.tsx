"use client";

import { useCustomers } from "@/lib/CustomersProvider";
import { useGoldRates } from "@/lib/GoldRatesProvider";
import { fmt } from "@/lib/format";
import { TITLES } from "@/lib/routes";
import { useModal } from "@/components/Modal";
import { RateModalContent } from "@/components/modals/RateModal";
import { Icon } from "@/lib/icons";
import GlobalSearch from "./GlobalSearch";

/* Ported from legacy/app.html's <header class="top"> + app.js's
 * `refreshRateChip()` / breadcrumb logic in `router()`. */
export function Topbar({ route, arg, onBurger }: { route: string; arg?: string; onBurger: () => void }) {
  const { latest, isTodaySet } = useGoldRates();
  const { customers } = useCustomers();
  const { openModal } = useModal();

  const crumb =
    route === "customer"
      ? customers.find((c) => c.id === arg)?.name || TITLES.customer
      : TITLES[route] || "Dashboard";

  return (
    <header className="top">
      <button className="burger" id="burger" aria-label="Menu" onClick={onBurger}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span className="crumb" id="crumb">
        Ambika Gold Finance &nbsp;/&nbsp; <b>{crumb}</b>
      </span>
      <GlobalSearch />
      <span className="rate-chip" id="rateChip">
        <span className="dot"></span> 22K <b>{fmt(latest.k22)}/g</b> · 24K <b>{fmt(latest.k24)}/g</b>
        {!isTodaySet && (
          <button
            type="button"
            title="Today's gold rate has not been set"
            aria-label="Today's gold rate has not been set"
            onClick={() => openModal(<RateModalContent />)}
            style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 6, padding: 0 }}
          >
            <Icon name="warning" />
          </button>
        )}
      </span>
      <span className="user">
        <span className="av">—</span>
        <span className="nm">
          Not signed in
          <small>No user session</small>
        </span>
      </span>
      <a className="logout" href="/">Sign out</a>
    </header>
  );
}
