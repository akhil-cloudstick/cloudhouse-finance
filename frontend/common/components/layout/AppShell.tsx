"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DataProvider } from "@/common/providers/DataProvider";
import { useBranding } from "@/common/providers/BrandingProvider";
import { CustomersProvider } from "@/modules/customers/store/CustomersProvider";
import { SchemesProvider } from "@/modules/schemes/store/SchemesProvider";
import { LoansProvider } from "@/modules/loans/store/LoansProvider";
import { GoldRatesProvider } from "@/modules/gold-rates/store/GoldRatesProvider";
import { ModalProvider } from "@/common/components/ModalProvider";
import { ToastProvider, useToast } from "@/common/components/ToastProvider";
import { TooltipLayer } from "@/common/components/TooltipLayer";
import { FitTextObserver } from "@/common/components/ui/FitTextObserver";
import { Sidebar } from "@/common/components/layout/Sidebar";
import { Topbar } from "@/common/components/layout/Topbar";
import { useAppRoute } from "@/common/hooks/use-app-route";
import { navigate, parsePath } from "@/common/services/appRoutes";
import { activeBusinessSlug } from "@/common/services/tenantSession";
import { DashboardPage } from "@/modules/dashboard/pages/DashboardPage";
import { CustomersPage } from "@/modules/customers/pages/CustomersPage";
import { CustomerDetailPage } from "@/modules/customers/pages/CustomerDetailPage";
import { LoansPage } from "@/modules/loans/pages/LoansPage";
import { LoanDetailPage } from "@/modules/loans/pages/LoanDetailPage";
import { LoanRiskPage } from "@/modules/loans/pages/LoanRiskPage";
import { NewLoanPage } from "@/modules/loans/pages/NewLoanPage";
import { SchemesPage } from "@/modules/schemes/pages/SchemesPage";
import { GoldRatesPage } from "@/modules/gold-rates/pages/GoldRatesPage";
import { RequestsPage } from "@/modules/loans/pages/RequestsPage";
import { CashPage } from "@/modules/cash/pages/CashPage";
import { AuctionsPage } from "@/modules/loans/pages/AuctionsPage";
import { PacketsPage } from "@/modules/packets/pages/PacketsPage";
import { PacketDetailPage } from "@/modules/packets/pages/PacketDetailPage";
import { BankPledgePage } from "@/modules/loans/pages/BankPledgePage";
import { PersonalLoansPage } from "@/modules/personal-loans/pages/PersonalLoansPage";
import { PersonalLoanDetailPage } from "@/modules/personal-loans/pages/PersonalLoanDetailPage";
import { InvestmentsPage } from "@/modules/investments/pages/InvestmentsPage";
import { InvestmentDetailPage } from "@/modules/investments/pages/InvestmentDetailPage";
import { ReportsPage } from "@/modules/reports/pages/ReportsPage";
import { EmployeesPage } from "@/modules/employees/pages/EmployeesPage";
import { CalendarPage } from "@/modules/reminders/pages/CalendarPage";
import { BranchesPage } from "@/modules/branches/pages/BranchesPage";
import { BanksPage } from "@/modules/banks/pages/BanksPage";
import { PartyLedgerPage } from "@/modules/cash/pages/PartyLedgerPage";
import { syncFilterSection } from "@/common/hooks/use-persisted-state";
import { BranchLedgerPage } from "@/modules/branches/pages/BranchLedgerPage";
import { SettingsPage } from "@/modules/settings/pages/SettingsPage";
import { RolesPermissionsPage } from "@/modules/roles/pages/RolesPermissionsPage";
import { BillingPage } from "@/modules/billing/pages/BillingPage";
import { useAuth } from "@/common/providers/AuthProvider";
import { ModeLedgerPage } from "@/modules/cash/pages/ModeLedgerPage";
import { ROUTE_ALIASES } from "@/common/config/routes";
import { ROUTE_PERMISSIONS, baseRoute, routeAllowed, routeEntitled, setNavigationGuard } from "@/common/config/routePermissions";

/* Shown instead of NoAccess when the permission fetch itself failed (backend
 * down / network): the empty map is a failure, not a denial, so saying "no
 * access" would be wrong. */
function LoadFailed() {
  const { refetchPermissions } = useAuth();
  return (
    <div className="notice" style={{ maxWidth: 480, margin: "48px auto" }}>
      We couldn&apos;t load your permissions.
      <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={refetchPermissions}>Retry</button>
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

type ViewProps = { route: string; arg?: string };

/* Route-to-page-component switch, mirroring legacy/app.js's `routes` object
 * (legacy/app.js:83-100). Stage 2B is being delivered page by page — routes
 * not yet built fall through to Dashboard, matching legacy's `routes[route]
 * || renderDashboard` fallback. */
function View({ route, arg }: ViewProps) {
  const { can, permissionsLoaded, permissionsFailed } = useAuth();
  const { hasModule, singleBranch, loaded: brandingLoaded } = useBranding();

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
  // A multi-branch-only route (Branch Management, a branch ledger) on a
  // single-branch plan is treated the same as a module that is off.
  if (!routeEntitled(route, hasModule, singleBranch)) {
    return <ModuleUnavailable />;
  }

  switch (route) {
    case "customers":
      return <CustomersPage />;
    case "customer":
      return <CustomerDetailPage id={arg} />;
    case "loans":
      return <LoansPage />;
    case "loan":
      return <LoanDetailPage id={arg} />;
    case "newloan":
      return <NewLoanPage customerId={arg} />;
    case "schemes":
      return <SchemesPage />;
    case "goldrates":
      return <GoldRatesPage />;
    case "requests":
      return <RequestsPage />;
    case "loanrisk":
      return <LoanRiskPage />;
    case "personalloans":
      return <PersonalLoansPage />;
    case "personalloan":
      return <PersonalLoanDetailPage id={arg} />;
    case "investments":
      return <InvestmentsPage />;
    case "investment":
      return <InvestmentDetailPage id={arg} />;
    case "ledger":
      return <CashPage />;
    case "auctions":
      return <AuctionsPage />;
    case "packets":
      return <PacketsPage />;
    case "packet":
      return <PacketDetailPage code={arg} />;
    case "bankpledge":
      return <BankPledgePage focusLoanNumber={arg} />;
    case "reports":
      return <ReportsPage />;
    case "employees":
      return <EmployeesPage />;
    case "calendar":
      return <CalendarPage />;
    case "branches":
      return <BranchesPage />;
    case "banks":
      return <BanksPage />;
    case "ledger-bank":
      return <PartyLedgerPage kind="bank" id={arg} />;
    case "ledger-customer":
      return <PartyLedgerPage kind="customer" id={arg} />;
    case "ledger-branch":
      return <BranchLedgerPage id={arg} />;
    case "ledger-category":
      return <PartyLedgerPage kind="category" id={arg} />;    case "cash-ledger":
      return <ModeLedgerPage mode="Cash" />;
    case "upi-ledger":
      return <ModeLedgerPage mode="UPI" />;
    case "bank-transfer-ledger":
      return <ModeLedgerPage mode="Bank Transfer" />;
    case "cheque-ledger":
      return <ModeLedgerPage mode="Cheque" />;
    case "roles-permissions":
      return <RolesPermissionsPage />;
    case "billing":
      return <BillingPage />;
    case "settings":
      return <SettingsPage />;
    case "dashboard":
    default:
      return <DashboardPage />;
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

  // The navigation guard navigate() consults (common/config/routePermissions.ts):
  // a link, button or KPI card to a page this role can't open is refused
  // with a toast and the user stays put, rather than being taken to the
  // NoAccess screen View would render there.
  const { can, permissionsLoaded, selectedBranchId } = useAuth();
  const { hasModule, singleBranch } = useBranding();
  const toast = useToast();
  useEffect(() => {
    if (!permissionsLoaded || !brandingLoaded) return;
    setNavigationGuard((target) => {
      const r = baseRoute(target);
      if (routeAllowed(ROUTE_ALIASES[r] ?? r, can, hasModule, singleBranch)) return true;
      toast("You don't have permission to open this page.");
      return false;
    });
    return () => setNavigationGuard(null);
  }, [permissionsLoaded, brandingLoaded, can, hasModule, singleBranch, toast]);

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

  // On narrow screens the sidebar is an overlay: a click outside it closes it.
  // The burger is excluded — its own onClick toggles, so closing here too would
  // make it close and immediately reopen.
  useEffect(() => {
    if (!sidebarOpen) return;
    function onOutside(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("#side, #burger")) return;
      setSidebarOpen(false);
    }
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [sidebarOpen]);

  /* A focused <input type="number"> steps its value on every mouse-wheel tick,
   * so scrolling the page with the pointer over one silently changes an
   * amount. One document-level listener for every number field (modals
   * included) rather than an onWheel on each: blurring the focused field
   * stops the browser stepping it, and the wheel still scrolls the page. */
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number" && e.target === el) el.blur();
    }
    document.addEventListener("wheel", onWheel, { passive: true, capture: true });
    return () => document.removeEventListener("wheel", onWheel, true);
  }, []);

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
          {/* The global branch selection is part of the key: switching branch
            * remounts the page so every list/KPI refetches under the new
            * X-Branch-Id header. */}
          <View key={`${route}/${arg ?? ""}/${reloadSeq}/${selectedBranchId ?? "all"}`} route={route} arg={arg} />
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
