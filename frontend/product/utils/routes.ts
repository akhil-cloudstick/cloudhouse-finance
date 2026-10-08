/* Maps a detail/sub-page route to the list/section page it drills down
 * from — backs the Topbar breadcrumb's "current section" link (see
 * Topbar.tsx), so e.g. viewing a personal loan's details can jump back to
 * the Personal Loans list in one click instead of only via the sidebar or
 * browser back. A route with no entry here has nowhere "up" to go (it's
 * already a top-level section) and the crumb just re-links to itself. */
export const PARENT_ROUTE: Record<string, string> = {
  customer: "customers",
  loan: "loans",
  newloan: "loans",
  personalloan: "personalloans",
  investment: "investments",
  packet: "packets",
};

/* Ported from legacy/app.js's `titles` lookup, used for the header breadcrumb. */
export const TITLES: Record<string, string> = {
  dashboard: "Dashboard", customers: "Customers & KYC", customer: "Customer 360°",
  loans: "Loans", loan: "Loan Details", newloan: "New Gold Loan", schemes: "Loan Schemes",
  personalloans: "Personal Loans", personalloan: "Personal Loan Details",
  investments: "Investments", investment: "Investment Details",
  goldrates: "Gold Rates", packets: "Packets & Lockers", packet: "Packet Detail", ledger: "Ledger",
  calendar: "Reminder Calendar", requests: "Extensions & Release", bankpledge: "Bank Re-Pledge",
  auctions: "Auctions", reports: "Reports", employees: "Employees",
  branches: "Branch Management",
  "roles-permissions": "Roles & Permissions",
  billing: "Billing",
  settings: "Settings",
  "ledger-bank": "Ledger", "ledger-customer": "Ledger", "ledger-branch": "Branch Ledger", "ledger-category": "Ledger",
  "cash-ledger": "Ledger", "upi-ledger": "Ledger", "bank-transfer-ledger": "Ledger", "cheque-ledger": "Ledger",
};
