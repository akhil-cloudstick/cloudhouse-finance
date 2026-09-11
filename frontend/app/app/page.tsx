"use client";

import { useEffect, useState } from "react";
import { DataProvider } from "@/common/DataProvider";
import { useBranding } from "@/common/BrandingProvider";
import { CustomersProvider } from "@/modules/customers/store/CustomersProvider";
import { SchemesProvider } from "@/modules/schemes/store/SchemesProvider";
import { LoansProvider } from "@/modules/loans/store/LoansProvider";
import { GoldRatesProvider } from "@/modules/gold-rates/store/GoldRatesProvider";
import { ModalProvider } from "@/common/components/Modal";
import { ToastProvider } from "@/common/components/Toast";
import { Sidebar } from "@/common/components/layout/Sidebar";
import { Topbar } from "@/common/components/layout/Topbar";
import { useHashRoute } from "@/hooks/useHashRoute";
import { Dashboard } from "@/components/Dashboard";
import { Customers } from "@/modules/customers/components/Customers";
import { CustomerDetail } from "@/modules/customers/components/CustomerDetail";
import { Loans } from "@/modules/loans/components/Loans";
import { LoanDetail } from "@/modules/loans/components/LoanDetail";
import { LoanRisk } from "@/modules/loans/components/LoanRisk";
import { NewLoan } from "@/modules/loans/components/NewLoan";
import { Schemes } from "@/modules/schemes/components/Schemes";
import { GoldRates } from "@/modules/gold-rates/components/GoldRates";
import { Requests } from "@/modules/loans/components/Requests";
import { Cash } from "@/modules/cash/components/Cash";
import { Auctions } from "@/modules/loans/components/Auctions";
import { Packets } from "@/modules/packets/components/Packets";
import { PacketDetail } from "@/modules/packets/components/PacketDetail";
import { BankPledge } from "@/modules/loans/components/BankPledge";
import { PersonalLoans } from "@/modules/personal-loans/components/PersonalLoans";
import { PersonalLoanDetail } from "@/modules/personal-loans/components/PersonalLoanDetail";
import { Investments } from "@/modules/investments/components/Investments";
import { InvestmentDetail } from "@/modules/investments/components/InvestmentDetail";
import { Reports } from "@/modules/reports/components/Reports";
import { Employees } from "@/modules/employees/components/Employees";
import { Calendar } from "@/modules/reminders/components/Calendar";
import { Branches } from "@/modules/branches/components/Branches";
import { Settings } from "@/modules/settings/components/Settings";
import { RolesPermissions } from "@/modules/roles/components/RolesPermissions";
import { Billing } from "@/modules/billing/components/Billing";
import { useAuth } from "@/common/auth-context";

/* Every route the hash router can reach, mapped to the permission that
 * gates it — the same module/key pairs Sidebar.tsx filters its nav on (see
 * that file's NAV array). module: null means always reachable (Dashboard).
 * This is what actually enforces access to a page: the nav filter only
 * stops a user from *finding* a page, this stops them *reaching* it by
 * typed/bookmarked hash — including detail routes (a customer/loan/packet
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
  personalloans: { module: "Personal_Loan_Management", key: "can_view_personal_loan" },
  personalloan: { module: "Personal_Loan_Management", key: "can_view_personal_loan" },
  investments: { module: "Investment_Management", key: "can_view_investment" },
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
      return <BankPledge />;
    case "reports":
      return <Reports />;
    case "employees":
      return <Employees />;
    case "calendar":
      return <Calendar />;
    case "branches":
      return <Branches />;
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

function AppShell() {
  const { route, arg } = useHashRoute();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Bumped whenever the sidebar's own page is clicked again (see
  // Sidebar.tsx's onNavigateSameRoute) — location.hash doesn't change in
  // that case, so nothing else here would otherwise re-render the page.
  // Folded into View's key below, forcing React to unmount and remount it
  // (a real "start fresh" reload of that page's own state), same as a
  // genuine route change already does.
  const [reloadSeq, setReloadSeq] = useState(0);

  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo(0, 0);
  }, [route, arg]);

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

export default function AppPage() {
  return (
    <DataProvider>
      <CustomersProvider>
        <SchemesProvider>
          <LoansProvider>
            <GoldRatesProvider>
              <ToastProvider>
                <ModalProvider>
                  <AppShell />
                </ModalProvider>
              </ToastProvider>
            </GoldRatesProvider>
          </LoansProvider>
        </SchemesProvider>
      </CustomersProvider>
    </DataProvider>
  );
}
