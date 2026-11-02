"use client";

import { useEffect, useState } from "react";
import { getPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";
import { getInvestment } from "@/modules/investments/services/investmentService";
import { getCustomerByRef, isNumericCustomerRef } from "@/modules/customers/services/customerService";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { fmt } from "@/common/utils/format";
import { TITLES, PARENT_ROUTE } from "@/common/utils/routes";
import { useModal } from "@/common/components/ModalProvider";
import { RateModalContent } from "@/common/components/modals/RateModalContent";
import { useAuth } from "@/common/providers/AuthProvider";
import { Icon } from "@/common/components/Icon";
import { useBranding } from "@/common/providers/BrandingProvider";
import GlobalSearch from "./GlobalSearch";
import { AccountMenu } from "./AccountMenu";
import { DesktopUpdatePopup } from "./DesktopUpdatePopup";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";

type TopbarProps = { route: string; arg?: string; onBurger: () => void };

/* Ported from legacy/app.html's <header class="top"> + app.js's
 * `refreshRateChip()` / breadcrumb logic in `router()`. */
export function Topbar({ route, arg, onBurger }: TopbarProps) {
  const { latest, isTodaySet } = useGoldRates();
  // A customer page's crumb shows that customer's code (CUST-04).
  const [customerCode, setCustomerCode] = useState("");
  useEffect(() => {
    if (route !== "customer" || !arg) { setCustomerCode(""); return; }
    let cancelled = false;
    getCustomerByRef(arg).then((c) => { if (!cancelled) setCustomerCode(c.code); }).catch(() => { if (!cancelled) setCustomerCode(""); });
    return () => { cancelled = true; };
  }, [route, arg]);
  // Personal loan / investment crumbs show their number (PL-00003, INV-00003); an id link looks it up.
  const [refNumber, setRefNumber] = useState("");
  useEffect(() => {
    if ((route !== "personalloan" && route !== "investment") || !arg || !/^\d+$/.test(arg)) { setRefNumber(""); return; }
    let cancelled = false;
    const lookup = route === "personalloan"
      ? getPersonalLoan(Number(arg)).then((l) => l.loanNumber)
      : getInvestment(Number(arg)).then((i) => i.investmentNumber);
    lookup.then((n) => { if (!cancelled) setRefNumber(n || ""); }).catch(() => { if (!cancelled) setRefNumber(""); });
    return () => { cancelled = true; };
  }, [route, arg]);
  const { openModal } = useModal();
  const { can } = useAuth();
  const canPublishRate = can("Gold_Rate_Management", "can_create_gold_rate");
  const canOpen = useCanOpenRoute();
  // Was the hardcoded platform BRAND.name for every business — Sidebar.tsx
  // already gets this right via the same hook, this was the one place that
  // didn't.
  const { name: businessName } = useBranding();
  const [searchOpen, setSearchOpen] = useState(false);

  const crumb =
    route === "customer"
      ? customerCode || (arg && !isNumericCustomerRef(arg) ? arg : "") || TITLES.customer
      // A loan's or packet's crumb is its number (LN-00070, PKT-00012), the same one in the URL.
      : (route === "loan" || route === "packet") && arg
        ? arg
        : (route === "personalloan" || route === "investment") && arg
          ? (/^\d+$/.test(arg) ? refNumber : arg) || TITLES[route]
          : TITLES[route] || "Dashboard";
  // The crumb links back to the section it drills down from (e.g. a
  // personal loan's detail page links to the Personal Loans list) — routes
  // with no parent (top-level sections) just re-link to themselves.
  // (It was a "#route" link, which this path router never followed.) No
  // link when the role can't open the parent — e.g. New Loan for a
  // create-only role, whose parent is the Loans list.
  // The trail reads like a normal path: Shop / Parent page / Current page.
  // Top-level routes have no parent, so they show just Shop / Page.
  const parentRoute = PARENT_ROUTE[route];
  const parentHref = parentRoute && canOpen(parentRoute) ? routeHref(parentRoute) : undefined;
  const linkStyle = { color: "inherit", textDecoration: "none" } as const;

  return (
    <header className={`top${searchOpen ? " search-open" : ""}`}>
      <button className="burger" id="burger" aria-label="Menu" onClick={onBurger}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span className="crumb" id="crumb">
        <span className="crumb-org">
          <a href={routeHref("dashboard")} style={linkStyle}>{businessName}</a>
          &nbsp;/&nbsp;
        </span>
        {parentRoute && (
          <>
            <a href={parentHref} style={linkStyle}>{route === "loan" ? "Loan" : TITLES[parentRoute] || parentRoute}</a>
            &nbsp;/&nbsp;
          </>
        )}
        <b>{crumb}</b>
      </span>
      <GlobalSearch isOpen={searchOpen} onToggle={setSearchOpen} />
      <a
        className={`rate-chip${searchOpen ? " rate-chip-shrunk" : ""}`}
        id="rateChip"
        href={canOpen("goldrates") ? routeHref("goldrates") : undefined}
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
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (canPublishRate) openModal(<RateModalContent />); }}
            style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 6, padding: 0 }}
          >
            <Icon name="warning" />
          </button>
        )}
      </a>
      <AccountMenu />
      <DesktopUpdatePopup />
    </header>
  );
}
