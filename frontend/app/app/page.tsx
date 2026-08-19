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

/* Route-to-page-component switch, mirroring legacy/app.js's `routes` object
 * (legacy/app.js:83-100). Stage 2B is being delivered page by page — routes
 * not yet built fall through to Dashboard, matching legacy's `routes[route]
 * || renderDashboard` fallback. */
function View({ route, arg }: { route: string; arg?: string }) {
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
