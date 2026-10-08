"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DataProvider } from "@/product/providers/DataProvider";
import { useBranding } from "@/product/providers/BrandingProvider";
import { CustomersProvider } from "@/product/pages/customers/store/CustomersProvider";
import { SchemesProvider } from "@/product/pages/schemes/store/SchemesProvider";
import { LoansProvider } from "@/product/pages/loans/store/LoansProvider";
import { GoldRatesProvider } from "@/product/pages/gold-rates/store/GoldRatesProvider";
import { ModalProvider } from "@/product/components/Modal";
import { ToastProvider } from "@/product/components/Toast";
import { TooltipLayer } from "@/product/components/Tooltip";
import { FitTextObserver } from "@/product/components/ui/FitTextObserver";
import { Sidebar } from "@/product/layout/Sidebar";
import { Topbar } from "@/product/layout/Topbar";
import { useAppRoute } from "@/product/hooks/useAppRoute";
import { navigate, parsePath } from "@/product/services/appRoutes";
import { activeBusinessSlug } from "@/product/services/tenantSession";
import { Dashboard } from "@/product/pages/dashboard/Dashboard";
import { Customers } from "@/product/pages/customers/components/Customers";
import { CustomerDetail } from "@/product/pages/customers/components/CustomerDetail";
import { Loans } from "@/product/pages/loans/components/Loans";
import { LoanDetail } from "@/product/pages/loans/components/LoanDetail";
import { LoanRisk } from "@/product/pages/loans/components/LoanRisk";
import { NewLoan } from "@/product/pages/loans/components/NewLoan";
import { Schemes } from "@/product/pages/schemes/components/Schemes";
import { GoldRates } from "@/product/pages/gold-rates/components/GoldRates";
import { Requests } from "@/product/pages/loans/components/Requests";
import { Cash } from "@/product/pages/cash/components/Cash";
import { Auctions } from "@/product/pages/loans/components/Auctions";
import { Packets } from "@/product/pages/packets/components/Packets";
import { PacketDetail } from "@/product/pages/packets/components/PacketDetail";
import { BankPledge } from "@/product/pages/loans/components/BankPledge";
import { PersonalLoans } from "@/product/pages/personal-loans/components/PersonalLoans";
import { PersonalLoanDetail } from "@/product/pages/personal-loans/components/PersonalLoanDetail";
import { Investments } from "@/product/pages/investments/components/Investments";
import { InvestmentDetail } from "@/product/pages/investments/components/InvestmentDetail";
import { Reports } from "@/product/pages/reports/components/Reports";
import { Employees } from "@/product/pages/employees/components/Employees";
import { Calendar } from "@/product/pages/reminders/components/Calendar";
import { Branches } from "@/product/pages/branches/components/Branches";
import { Banks } from "@/product/pages/banks/components/Banks";
import { PartyLedger } from "@/product/pages/cash/components/PartyLedger";
import { syncFilterSection } from "@/product/hooks/usePersistedState";
import { BranchLedger } from "@/product/pages/branches/components/BranchLedger";
import { Settings } from "@/product/pages/settings/components/Settings";
import { RolesPermissions } from "@/product/pages/roles/components/RolesPermissions";
import { Billing } from "@/product/pages/billing/components/Billing";
import { useAuth } from "@/product/providers/auth-context";
import { ModeLedgerPage } from "@/product/pages/cash/components/ModeLedgerPage";
import { ROUTE_ALIASES } from "@/product/config/routes";
import { ROUTE_PERMISSIONS, baseRoute, routeAllowed, setNavigationGuard } from "@/product/config/routePermissions";
import { useToast } from "@/product/components/Toast";

/* Shown instead of NoAccess when the permission fetch itself failed (backend
 * down / network): the empty map is a failure, not a denial, so saying "no
 * access" would be wrong. */
function LoadFailed() {
  return (
    <div className="notice" style={{ maxWidth: 480, margin: "48px auto" }}>
      Something went wrong. Please try again.
    </div>
  );
}

function NoAccess() {
  return (
    <div className="notice" style={{ maxWidth: 480, margin: "48px auto" }}>
      You do not have access to this page. Ask your administrator to grant the permission for it.
    </div>
  );
}

/* Deliberately worded differently from NoAccess. That one is answerable by
 * the business's own administrator (grant the permission); this one is not —
 * the feature is not part of what this business has, and no amount of
 * permission-granting inside the business will reveal it. Telling someone to
 * ask their administrator for something their administrator cannot give is
 * how a support call gets bounced around. */
function ModuleUnavailable() {
  return (
    <div className="notice" style={{ maxWidth: 480, margin: "48px auto" }}>
      This feature is not enabled for your business. Contact your service provider if you need it.
    </div>
  );
}

/* Route-to-page-component switch, mirroring legacy/app.js's `routes` object
 * (legacy/app.js:83-100). Stage 2B is being delivered page by page — routes
 * not yet built fall through to Dashboard, matching legacy's `routes[route]
 * || renderDashboard` fallback. */
function View({ route, arg }: { route: string; arg?: string }) {
  const { can, permissionsLoaded, permissionsFailed } = useAuth();
  const { hasModule, loaded: brandingLoaded } = useBranding();

  // Wait for the permission map before deciding anything (§11) — evaluating
  // an empty map mid-fetch would deny everyone for a moment. The module
  // grants need the same treatment for the same reason: an unloaded
  // branding state reports every optional module as off, which would flash
  // "no access" on a page the business actually has.
  if (!permissionsLoaded || !brandingLoaded) return null;
  if (permissionsFailed) return <LoadFailed />;

  const gate = ROUTE_PERMISSIONS[route];
  if (gate && gate.module !== null && !can(gate.module, gate.key!)) {
    return <NoAccess />;
  }
  // The optional-module gate. Separate from the permission above: this is
  // the business's entitlement, not the role's rights. Still only what is
  // DRAWN — platform.RequireTenantModule refuses the API calls server-side.
  if (gate?.tenantModule && !hasModule(gate.tenantModule)) {
    return <ModuleUnavailable />;
  }

  switch (route) {
    case "customers":
      return <Customers />;
    case "customer":
      return <CustomerDetail id={arg} />;
    case "loans":
      return <Loans />;
    case "loan":
      return <LoanDetail id={arg} />;
    case "newloan":
      return <NewLoan customerId={arg} />;
    case "schemes":
      return <Schemes />;
    case "goldrates":
      return <GoldRates />;
    case "requests":
      return <Requests />;
    case "loanrisk":
      return <LoanRisk />;
    case "personalloans":
      return <PersonalLoans />;
    case "personalloan":
      return <PersonalLoanDetail id={arg} />;
    case "investments":
      return <Investments />;
    case "investment":
      return <InvestmentDetail id={arg} />;
    case "ledger":
      return <Cash />;
    case "auctions":
      return <Auctions />;
    case "packets":
      return <Packets />;
    case "packet":
      return <PacketDetail code={arg} />;
    case "bankpledge":
      return <BankPledge focusLoanNumber={arg} />;
    case "reports":
      return <Reports />;
    case "employees":
      return <Employees />;
    case "calendar":
      return <Calendar />;
    case "branches":
      return <Branches />;
    case "banks":
      return <Banks />;
    case "ledger-bank":
      return <PartyLedger kind="bank" id={arg} />;
    case "ledger-customer":
      return <PartyLedger kind="customer" id={arg} />;
    case "ledger-branch":
      return <BranchLedger id={arg} />;
    case "ledger-category":
      return <PartyLedger kind="category" id={arg} />;    case "cash-ledger":
      return <ModeLedgerPage mode="Cash" />;
    case "upi-ledger":
      return <ModeLedgerPage mode="UPI" />;
    case "bank-transfer-ledger":
      return <ModeLedgerPage mode="Bank Transfer" />;
    case "cheque-ledger":
      return <ModeLedgerPage mode="Cheque" />;
    case "roles-permissions":
      return <RolesPermissions />;
    case "billing":
      return <Billing />;
    case "settings":
      return <Settings />;
    case "dashboard":
    default:
      return <Dashboard />;
  }
}

function AppShellInner() {
  const { route, arg } = useAppRoute();
  // Runs during render on purpose: it must clear a section's remembered
  // filters BEFORE the page below mounts and reads them (idempotent).
  if (typeof window !== "undefined") syncFilterSection(route);
  const { loaded: brandingLoaded } = useBranding();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Bumped whenever the sidebar's own page is clicked again (see
  // Sidebar.tsx's onNavigateSameRoute) — the URL doesn't change in that
  // case, so nothing else here would otherwise re-render the page.
  // Folded into View's key below, forcing React to unmount and remount it
  // (a real "start fresh" reload of that page's own state), same as a
  // genuine route change already does.
  const [reloadSeq, setReloadSeq] = useState(0);

  // The navigation guard navigate() consults (config/routePermissions.ts):
  // a link, button or KPI card to a page this role can't open is refused
  // with a toast and the user stays put, rather than being taken to the
  // NoAccess screen View would render there.
  const { can, permissionsLoaded } = useAuth();
  const { hasModule } = useBranding();
  const toast = useToast();
  useEffect(() => {
    if (!permissionsLoaded || !brandingLoaded) return;
    setNavigationGuard((target) => {
      const r = baseRoute(target);
      if (routeAllowed(ROUTE_ALIASES[r] ?? r, can, hasModule)) return true;
      toast("You don't have permission to open this page.");
      return false;
    });
    return () => setNavigationGuard(null);
  }, [permissionsLoaded, brandingLoaded, can, hasModule, toast]);

  /* In-app links navigate WITHOUT a full page load.
   *
   * Every route link in the console is a plain <a href="/ctfi/loan/GL-1001">,
   * and that is deliberate: it middle-clicks into a new tab, it copies as a
   * real link, and it still works if this handler never runs. What it must
   * not do is make the browser re-download the app shell and re-fetch every
   * provider on each click, which is what an unintercepted anchor does and
   * what the old "#hash" links never did.
   *
   * So: one listener on the document, converting an ordinary left-click on a
   * same-origin route link into a pushState move. Everything a user might
   * mean OTHER than "go there in this tab" is left to the browser —
   * modifier-clicks and middle-clicks (open elsewhere), target="_blank",
   * download links, and any href outside this app. Intercepting those is the
   * classic way a hand-rolled router breaks ctrl-click.
   */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/")) return; // "#", mailto:, external
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;

      const { slug, route: r, arg: nextArg, page } = parsePath(href);
      // A standalone page (/ctfi/login, /ctfi/reset) is a real document, not
      // a console route — let the browser load it.
      if (page) return;
      // A link into a DIFFERENT business must also be a full load: the
      // session, branding and every provider are per business, and
      // pushState would keep this one's in memory.
      if (slug && slug !== activeBusinessSlug()) return;

      e.preventDefault();
      navigate(r, nextArg, slug);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [route, arg]);

  // .page (not the window) is the only scroller since .shell became a fixed
  // 100vh box (see app.css's .main comment), and it isn't remounted on
  // navigation — only View is keyed — so its scrollTop survived route
  // changes: leaving a scrolled-down Dashboard painted the next page with
  // its header scrolled out of view until the content height clamped it
  // back. Layout effect so the reset lands before paint, not a frame after.
  const pageRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = pageRef.current;
    if (el) {
      el.scrollTop = 0;
      /* Fade the whole page in as one unit on every route change. Pages
       * paint in pieces (the header row, then whatever settles a beat later
       * as data and layout land), which read as the page header flashing in
       * on top of the content and then snapping to size. Starting at opacity
       * 0 here, before the first paint, means none of that staggering is
       * ever visible; the Web Animations API needs no wrapper element, so
       * .page's own flex layout is untouched. */
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      }
    }
    window.scrollTo(0, 0);
  }, [route, arg, reloadSeq]);

  // Sidebar and Topbar used to render immediately with the PLATFORM DEFAULT
  // identity (CloudHouse's name/logo/colours) for every business, briefly
  // and on every reload, until BrandingProvider's fetch resolved and swapped
  // them for the real tenant — visible, unacceptable "shows another
  // business's identity, even for a second" behaviour on a product where a
  // signed-in operator's business is meant to be the ONLY one they ever see.
  // `View` already gated its own content on this same flag; the chrome
  // around it did not. A neutral, brand-less loading screen (no name, no
  // logo, no tenant colour) is the correct wait state — never the wrong
  // tenant's, even momentarily.
  if (!brandingLoaded) {
    return (
      <div className="shell-loading" aria-busy="true" aria-label="Loading">
        <div className="shell-loading-spinner" />
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar route={route} open={sidebarOpen} onNavigateSameRoute={() => setReloadSeq((n) => n + 1)} />
      <div className="main">
        <Topbar route={route} arg={arg} onBurger={() => setSidebarOpen((v) => !v)} />
        <main className="page" id="view" ref={pageRef}>
          <View key={`${route}/${arg ?? ""}/${reloadSeq}`} route={route} arg={arg} />
        </main>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <DataProvider>
      <CustomersProvider>
        <SchemesProvider>
          <LoansProvider>
            <GoldRatesProvider>
              <ToastProvider>
                <ModalProvider>
                  <AppShellInner />
                  <FitTextObserver />
                  <TooltipLayer />
                </ModalProvider>
              </ToastProvider>
            </GoldRatesProvider>
          </LoansProvider>
        </SchemesProvider>
      </CustomersProvider>
    </DataProvider>
  );
}
