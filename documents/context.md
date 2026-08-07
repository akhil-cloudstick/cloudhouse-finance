# Context

## Business context
Ambika Gold Finance is a gold-loan (pawnbroking) finance business. This
project is the **Gold Loan Management Web & Mobile Application**, built to
digitalize the complete gold loan business lifecycle:

Customer Registration & Verification → Gold Valuation → Scheme-Based Loan
Calculation → Loan Creation → Gold & Payment Tracking → Interest & Cash
Management → Due Reminders & Follow-Ups → Bank Re-Pledge → Loan Closure or
Auction → Final Settlement & Reporting.

The solution consists of two applications:
- **Admin & Staff Web Application** — the primary operational platform for
  administrators and branch staff.
- **Customer Android Mobile Application** — lets customers securely view
  their loans, pay interest online, request extensions/gold release,
  update KYC, download statements, and view live gold rates.

## Scope of modules
1. Dashboard & Business Overview
2. Customer Registration, KYC & Verification (PAN + Aadhaar)
3. Loan Scheme & Gold Valuation
4. Gold Loan Creation & Ornaments Management (incl. purity testing, jewellery images)
5. Loan Management & Customer Loan Details
6. Loan Approval Workflow (multi-level sanctioning)
7. Customer 360° Profile
8. Interest, Penal Interest & Payment Management
9. Gold Packet, Barcode/QR & Tracking
10. Locker Management
11. Cash-in-Hand & Expense Management
12. EMI/Interest Reminder Calendar & Communication (SMS/WhatsApp)
13. Loan Extension & Gold Release Management
14. Bank & Gold Re-Pledge Management
15. Auction Management
16. Customer Android Mobile Application
17. Admin & Staff Web Application
18. Reports & Employee Performance
19. User Roles, Security & Multi-Branch Management
20. Technology Stack & Integrations

This scope maps directly onto the domain modules described in
[architecture.md](architecture.md) (`internal/customer`, `internal/loan`,
`internal/auction`, etc.) and the tables in
[database_architecture.md](database_architecture.md).

## Domain terminology
- **KYC** — Know Your Customer; PAN and Aadhaar-based identity verification
  through an authorized, legally permitted provider, completed before
  applicable loan operations proceed. Status values: PAN Verified /
  Aadhaar-KYC Verified / Verification Pending / Verification Failed.
- **Scheme** — a loan plan defining interest rate, duration, LTV, interest
  calculation method, penal rate, and conditions; multiple active schemes
  can coexist.
- **LTV (Loan-to-Value)** — Gross Gold Value × Scheme LTV % = Eligible Loan
  Amount, where Gross Gold Value = Gold Weight × Applicable Gold Rate.
- **Karat (k24/k22/k18)** — gold purity grades; rates are set per gram per
  karat, with historical rate tracking.
- **Ornament / Purity Testing** — pledged items (chains, bangles, rings,
  etc.) recorded per loan with gross/net weight, tested purity, deductions,
  and images; multiple ornaments can belong to one loan.
- **Packet** — a uniquely identifiable group of pledged ornaments linked to
  a customer/loan, tracked via a generated Barcode/QR code through its
  lifecycle: Loan Created → Packet Generated → Locker Stored → Bank
  Pledged → Returned → Ready for Release → Released.
- **Locker** — per-branch secure storage (Locker/Vault ID, capacity,
  current allocation, check-in/check-out history).
- **Bank Re-Pledge** — the business re-pledges customer gold with an
  external bank to raise working capital; loans are flagged Not Pledged or
  Bank Pledged, with bank, amount, rate, and reference tracked.
- **Ledger** — per-loan transaction history (date, description,
  debit/credit, payment method, reference, running balance).
- **Penal Interest** — configurable additional interest automatically
  applied to overdue loans per business rules.
- **Requests/Approvals** — customer-initiated Loan Extension and Gold
  Release requests (submittable via the Android app), reviewed and
  approved/rejected by staff; Gold Release settlement = Principal +
  Interest + Penal Interest + Charges − Payments/Waivers.
- **Auction** — workflow for defaulted loans: Overdue → Default → Auction
  Eligible → Notice Issued → Auction Scheduled → Auctioned → Settled, with
  surplus/shortfall calculated and recorded after sale.
- **Multi-level Loan Approval** — sanction limits configured by role, e.g.
  Loan Operator → Branch Manager → Authorized Management → Final Sanction;
  loans above a configured amount cannot be single-employee sanctioned.

## User roles
Administrator, Management, Branch Manager, Loan Operator, Cashier,
Accountant, Collection Staff, Auction Administrator, Auditor, Customer.
Sensitive actions (gold rate changes, scheme edits, loan overrides, payment
reversals, waivers, closures, expenses, auction confirmation) are
restricted or routed through approval workflows. All critical activities
maintain an audit trail. The solution supports multiple branches with
centralized Head Office monitoring and consolidated reporting.

## Third-party integrations
- PAN Verification API
- Authorized Aadhaar/KYC Verification
- SMS & OTP Gateway
- Payment Gateway (for online interest payment)
- Push Notifications
- Email/SMTP Services
- Secure Cloud Document Storage

Final providers are to be selected based on business/technical/regulatory
requirements.

## Sequencing
Per [architecture.md](architecture.md): the Go + PostgreSQL/GORM backend is
built and verified end-to-end first, then the existing Next.js frontend is
wired to live endpoints (replacing any remaining mock data), then the
Android mobile app is built against the same API. See
[change_log.md](change_log.md) for status as this progresses.

## Project history note
The repository currently has a single initial commit
(`a729d6a Initial commit: gold app`); the frontend has since been
restructured into a Next.js app (see `frontend/legacy/` for the migrated
prototype). See [change_log.md](change_log.md) for details.
