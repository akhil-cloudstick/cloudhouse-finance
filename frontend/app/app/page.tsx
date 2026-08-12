"use client";

import { useEffect, useState } from "react";
import { DataProvider } from "@/lib/DataProvider";
import { CustomersProvider } from "@/lib/CustomersProvider";
import { SchemesProvider } from "@/lib/SchemesProvider";
import { LoansProvider } from "@/lib/LoansProvider";
import { GoldRatesProvider } from "@/lib/GoldRatesProvider";
import { ModalProvider } from "@/components/Modal";
import { ToastProvider } from "@/components/Toast";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { useHashRoute } from "@/hooks/useHashRoute";
import { Dashboard } from "@/components/Dashboard";
import { Customers } from "@/components/Customers";
import { CustomerDetail } from "@/components/CustomerDetail";
import { Loans } from "@/components/Loans";
import { LoanDetail } from "@/components/LoanDetail";
import { NewLoan } from "@/components/NewLoan";
import { Schemes } from "@/components/Schemes";
import { GoldRates } from "@/components/GoldRates";
import { Requests } from "@/components/Requests";
import { Cash } from "@/components/Cash";
import { Auctions } from "@/components/Auctions";
import { Packets } from "@/components/Packets";
import { PacketDetail } from "@/components/PacketDetail";
import { BankPledge } from "@/components/BankPledge";
import { Reports } from "@/components/Reports";
import { Employees } from "@/components/Employees";
import { Calendar } from "@/components/Calendar";
import { Branches } from "@/components/Branches";
import { Settings } from "@/components/Settings";

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
