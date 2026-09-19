"use client";

import { useEffect, useState } from "react";
import { DataProvider } from "@/product/providers/DataProvider";
import { useBranding } from "@/product/providers/BrandingProvider";
import { CustomersProvider } from "@/product/pages/customers/store/CustomersProvider";
import { SchemesProvider } from "@/product/pages/schemes/store/SchemesProvider";
import { LoansProvider } from "@/product/pages/loans/store/LoansProvider";
import { GoldRatesProvider } from "@/product/pages/gold-rates/store/GoldRatesProvider";
import { ModalProvider } from "@/product/components/Modal";
import { ToastProvider } from "@/product/components/Toast";
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
import { Settings } from "@/product/pages/settings/components/Settings";
import { RolesPermissions } from "@/product/pages/roles/components/RolesPermissions";
import { Billing } from "@/product/pages/billing/components/Billing";
import { useAuth } from "@/product/providers/auth-context";

/* Every route the router can reach, mapped to the permission that
 * gates it — the same module/key pairs Sidebar.tsx filters its nav on (see
 * that file's NAV array). module: null means always reachable (Dashboard).
 * This is what actually enforces access to a page: the nav filter only
 * stops a user from *finding* a page, this stops them *reaching* it by
 * typed/bookmarked URL — including detail routes (a customer/loan/packet
 * id), which need the same permission as their list page (§11). */
const ROUTE_PERMISSIONS: Record<string, { module: string | null; key?: string; tenantModule?: string }> = {
  dashboard: { module: null },
  customers: { module: "Customer_Management", key: "can_view_customer" },
  customer: { module: "Customer_Management", key: "can_view_customer" },
  loans: { module: "Loan_Management", key: "can_view_loan" },
  loan: { module: "Loan_Management", key: "can_view_loan" },
  newloan: { module: "Loan_Management", key: "can_create_loan" },
  schemes: { module: "Scheme_Management", key: "can_view_scheme" },
  goldrates: { module: "Gold_Rate_Management", key: "can_view_gold_rate" },
  requests: { module: "Loan_Management", key: "can_view_loan" },
  loanrisk: { module: "Loan_Management", key: "can_view_loan" },
  personalloans: { module: "Personal_Loan_Management", key: "can_view_personal_loan", tenantModule: "personal_loans" },
  personalloan: { module: "Personal_Loan_Management", key: "can_view_personal_loan" },
  investments: { module: "Investment_Management", key: "can_view_investment", tenantModule: "investments" },
  investment: { module: "Investment_Management", key: "can_view_investment" },
  cash: { module: "Cash_Management", key: "can_view_cash" },
  auctions: { module: "Loan_Management", key: "can_view_loan" },
  packets: { module: "Packet_Management", key: "can_view_packet" },
  packet: { module: "Packet_Management", key: "can_view_packet" },
  bankpledge: { module: "Bank_Pledge_Management", key: "can_view_bank_pledge" },
  reports: { module: "Report_Management", key: "can_view_report" },
  employees: { module: "Employee_Management", key: "can_view_employee" },
  calendar: { module: "Reminder_Management", key: "can_view_reminder" },
  branches: { module: "Branch_Management", key: "can_view_branch", tenantModule: "branches" },
  banks: { module: "Bank_Management", key: "can_view_bank" },
  // Drill-down-only routes off the Cash & Expenses page — reuse can_view_cash
  // (viewing a party's ledger is a drill-down of data the user can already
  // see there, not a new resource) rather than a new permission.
  "party-bank": { module: "Cash_Management", key: "can_view_cash" },
  "party-customer": { module: "Cash_Management", key: "can_view_cash" },
  "roles-permissions": { module: "Role_Management", key: "can_view_role_and_permission" },
  billing: { module: "Billing", key: "can_manage_billing" },
  settings: { module: "Settings_Management", key: "can_view_setting", tenantModule: "settings" },
};

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
  const { can, permissionsLoaded } = useAuth();
  const { hasModule, loaded: brandingLoaded } = useBranding();

  // Wait for the permission map before deciding anything (§11) — evaluating
  // an empty map mid-fetch would deny everyone for a moment. The module
  // grants need the same treatment for the same reason: an unloaded
  // branding state reports every optional module as off, which would flash
  // "no access" on a page the business actually has.
  if (!permissionsLoaded || !brandingLoaded) return null;

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
      return <NewLoan />;
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
    case "cash":
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
    case "party-bank":
      return <PartyLedger kind="bank" id={arg} />;
    case "party-customer":
      return <PartyLedger kind="customer" id={arg} />;
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
  const { loaded: brandingLoaded } = useBranding();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Bumped whenever the sidebar's own page is clicked again (see
  // Sidebar.tsx's onNavigateSameRoute) — the URL doesn't change in that
  // case, so nothing else here would otherwise re-render the page.
  // Folded into View's key below, forcing React to unmount and remount it
  // (a real "start fresh" reload of that page's own state), same as a
  // genuine route change already does.
  const [reloadSeq, setReloadSeq] = useState(0);

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
    window.scrollTo(0, 0);
  }, [route, arg]);

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
        <main className="page" id="view">
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
                </ModalProvider>
              </ToastProvider>
            </GoldRatesProvider>
          </LoansProvider>
        </SchemesProvider>
      </CustomersProvider>
    </DataProvider>
  );
}
