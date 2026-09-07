"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCustomers } from "@/modules/customers/store/CustomersProvider";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { fmt } from "@/common/utils/format";
import { TITLES, PARENT_ROUTE } from "@/common/utils/routes";
import { useModal } from "@/common/components/Modal";
import { RateModalContent } from "@/common/components/modals/RateModal";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { loginPath } from "@/common/services/tenantSession";
import GlobalSearch from "./GlobalSearch";
import { BranchSwitcher } from "./BranchSwitcher";

/* Ported from legacy/app.html's <header class="top"> + app.js's
 * `refreshRateChip()` / breadcrumb logic in `router()`. */
export function Topbar({ route, arg, onBurger }: { route: string; arg?: string; onBurger: () => void }) {
  const { latest, isTodaySet } = useGoldRates();
  const { customers } = useCustomers();
  const { openModal } = useModal();
  const { employee, logout } = useAuth();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);

  function handleLogout(e: React.MouseEvent) {
    e.preventDefault();
    // Resolve the link before logout: it clears the remembered business, and
    // a signed-out user should land back on their own organisation.s sign-in
    // page rather than a bare form asking for a business code.
    const back = loginPath();
    logout();
    router.replace(back);
  }

  const crumb =
    route === "customer"
      ? customers.find((c) => c.id === arg)?.name || TITLES.customer
      : TITLES[route] || "Dashboard";
  // The crumb links back to the section it drills down from (e.g. a
  // personal loan's detail page links to the Personal Loans list) — routes
  // with no parent (top-level sections) just re-link to themselves.
  const crumbHref = "#" + (PARENT_ROUTE[route] || route || "dashboard");

  return (
    <header className={`top${searchOpen ? " search-open" : ""}`}>
      <button className="burger" id="burger" aria-label="Menu" onClick={onBurger}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span className="crumb" id="crumb">
        <a href="#dashboard" style={{ color: "inherit", textDecoration: "none" }}>Ambika Gold Finance</a>
        &nbsp;/&nbsp;
        <a href={crumbHref} style={{ color: "inherit", textDecoration: "none" }}><b>{crumb}</b></a>
      </span>
      <GlobalSearch isOpen={searchOpen} onToggle={setSearchOpen} />
      <a
        className={`rate-chip${searchOpen ? " rate-chip-shrunk" : ""}`}
        id="rateChip"
        href="#goldrates"
        title="22K is computed from the published 24K rate, not separately published"
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <span className="dot"></span>
        <span className="rate-full">
          22K (comp.) <b>{fmt(latest.k22)}/g</b> · 24K <b>{fmt(latest.k24)}/g</b>
        </span>
        <span className="rate-compact">
          24K <b>{fmt(latest.k24)}/g</b>
        </span>
        {!isTodaySet && (
          <button
            type="button"
            title="Today's gold rate has not been set"
            aria-label="Today's gold rate has not been set"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openModal(<RateModalContent />); }}
            style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 6, padding: 0 }}
          >
            <Icon name="warning" />
          </button>
        )}
      </a>
      <span className="user">
        <span className="av">{employee?.name ? employee.name.charAt(0).toUpperCase() : "—"}</span>
        <span className="nm">
          {employee?.name || "Not signed in"}
          <small>{employee?.role || "No user session"}</small>
        </span>
      </span>
      <a className="logout" href={loginPath()} onClick={handleLogout}>Sign out</a>
    </header>
  );
}
