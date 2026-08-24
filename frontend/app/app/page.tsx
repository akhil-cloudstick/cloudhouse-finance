"use client";

import { useEffect, useState } from "react";
import { DataProvider } from "@/common/DataProvider";
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
import { NewLoan } from "@/modules/loans/components/NewLoan";
import { Schemes } from "@/modules/schemes/components/Schemes";
import { GoldRates } from "@/modules/gold-rates/components/GoldRates";
import { Requests } from "@/modules/loans/components/Requests";
import { Cash } from "@/modules/cash/components/Cash";
import { Auctions } from "@/modules/loans/components/Auctions";
import { Packets } from "@/modules/packets/components/Packets";
import { PacketDetail } from "@/modules/packets/components/PacketDetail";
import { BankPledge } from "@/modules/loans/components/BankPledge";
import { Reports } from "@/modules/reports/components/Reports";
import { Employees } from "@/modules/employees/components/Employees";
import { Calendar } from "@/modules/reminders/components/Calendar";
import { Branches } from "@/modules/branches/components/Branches";
import { Settings } from "@/modules/settings/components/Settings";
import { RolesPermissions } from "@/modules/roles/components/RolesPermissions";
import { useAuth } from "@/common/auth-context";

/* Every route the hash router can reach, mapped to the permission that
 * gates it — the same module/key pairs Sidebar.tsx filters its nav on (see
 * that file's NAV array). module: null means always reachable (Dashboard).
 * This is what actually enforces access to a page: the nav filter only
 * stops a user from *finding* a page, this stops them *reaching* it by
 * typed/bookmarked hash — including detail routes (a customer/loan/packet
 * id), which need the same permission as their list page (§11). */
const ROUTE_PERMISSIONS: Record<string, { module: string | null; key?: string }> = {
  dashboard: { module: null },
  customers: { module: "Customer_Management", key: "can_view_customer" },
  customer: { module: "Customer_Management", key: "can_view_customer" },
  loans: { module: "Loan_Management", key: "can_view_loan" },
  loan: { module: "Loan_Management", key: "can_view_loan" },
  newloan: { module: "Loan_Management", key: "can_change_loan" },
  schemes: { module: "Scheme_Management", key: "can_view_scheme" },
  goldrates: { module: "Gold_Rate_Management", key: "can_view_gold_rate" },
  requests: { module: "Loan_Management", key: "can_view_loan" },
  cash: { module: "Cash_Management", key: "can_view_cash" },
  auctions: { module: "Loan_Management", key: "can_view_loan" },
  packets: { module: "Packet_Management", key: "can_view_packet" },
  packet: { module: "Packet_Management", key: "can_view_packet" },
  bankpledge: { module: "Bank_Pledge_Management", key: "can_view_bank_pledge" },
  reports: { module: "Report_Management", key: "can_view_report" },
  employees: { module: "Employee_Management", key: "can_view_employee" },
  calendar: { module: "Reminder_Management", key: "can_view_reminder" },
  branches: { module: "Branch_Management", key: "can_view_branch" },
  "roles-permissions": { module: "Role_Management", key: "can_view_role_and_permission" },
  settings: { module: "Settings_Management", key: "can_view_setting" },
};

function NoAccess() {
  return (
    <div className="notice" style={{ maxWidth: 480, margin: "48px auto" }}>
      You do not have access to this page. Ask your administrator to grant the permission for it.
    </div>
  );
}

/* Route-to-page-component switch, mirroring legacy/app.js's `routes` object
 * (legacy/app.js:83-100). Stage 2B is being delivered page by page — routes
 * not yet built fall through to Dashboard, matching legacy's `routes[route]
 * || renderDashboard` fallback. */
function View({ route, arg }: { route: string; arg?: string }) {
  const { can, permissionsLoaded } = useAuth();

  // Wait for the permission map before deciding anything (§11) — evaluating
  // an empty map mid-fetch would deny everyone for a moment.
  if (!permissionsLoaded) return null;

  const gate = ROUTE_PERMISSIONS[route];
  if (gate && gate.module !== null && !can(gate.module, gate.key!)) {
    return <NoAccess />;
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

  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo(0, 0);
  }, [route, arg]);

  return (
    <div className="shell">
      <Sidebar route={route} open={sidebarOpen} />
      <div className="main">
        <Topbar route={route} arg={arg} onBurger={() => setSidebarOpen((v) => !v)} />
        <main className="page" id="view">
          <View route={route} arg={arg} />
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
