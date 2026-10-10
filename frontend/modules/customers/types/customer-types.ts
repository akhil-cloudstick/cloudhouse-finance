import type { BranchView } from "@/modules/branches/types/branch-types";
import { type BackendLoan, type LoanView, type BackendAuctionRecord, type AuctionRecordView } from "@/modules/loans/types/loan-types";

/* Shape returned by the Go backend (backend/internal/customer/model.go's
 * CustomerResponse — deliberately never the raw DB model, so there is no
 * Aadhaar ciphertext field to accidentally type in here). */
export type BackendCustomer = {
  id: number;
  code: string;
  name: string;
  phone: string;
  dob: string; // RFC3339
  address: string;
  branchId: number;
  branch: BranchView;
  photoUrl: string;
  identityProofUrl: string;
  addressProofUrl: string;
  kycDocumentUrl: string;
  pan: string;
  aadhaarLast4: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineePhone: string;
  kycStatus: string;
  panStatus: string;
  aadhaarStatus: string;
  // Personal-loan specific / optional (backend/internal/customer/model.go) —
  // only ever set via the inline "+ Add new customer" flow in the Personal
  // Loan creation picker (CreateCustomerModal.tsx). Absent/undefined for
  // every gold-loan customer.
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  // Investor-only / optional (backend/internal/customer/model.go) — set
  // only for customerType "Investor" (internal/investment). Absent/blank
  // for every ordinary Borrower customer.
  customerType?: "Borrower" | "Investor";
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  createdAt: string;
  updatedAt: string;
};
/* UI-facing shape — `id` is the stringified backend numeric id (matches the
 * convention already established by SchemeView), plus a flattened
 * `branchName` for display convenience. */
export type CustomerView = {
  id: string;
  code: string;
  name: string;
  phone: string;
  dob: string; // "YYYY-MM-DD", or "" if unset
  address: string;
  branchId: number;
  branchName: string;
  photoUrl: string;
  identityProofUrl: string;
  addressProofUrl: string;
  kycDocumentUrl: string;
  pan: string;
  aadhaarLast4: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineePhone: string;
  kycStatus: string;
  panStatus: string;
  aadhaarStatus: string;
  // Personal-loan specific / optional — see BackendCustomer's own comment.
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  customerType?: "Borrower" | "Investor";
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
};
/* What RegisterCustomerModal.tsx collects. `aadhaar` is the plaintext
 * number, sent once at submit time — the backend encrypts it immediately
 * and never returns it in any response. */
export type CustomerFormInput = {
  name: string;
  phone: string;
  // Optional — RegisterCustomerModal.tsx no longer collects DOB at
  // registration time (not used anywhere on the customer). EditCustomerModal
  // still shows/edits it for a customer that already has one on file.
  dob?: string; // "YYYY-MM-DD"
  address: string;
  branchId: number;
  photoUrl: string;
  identityProofUrl: string;
  addressProofUrl: string;
  kycDocumentUrl: string;
  pan: string;
  aadhaar: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineePhone: string;
  // Personal-loan specific / optional — collected only by
  // CreateCustomerModal.tsx (frontend/modules/personal-loans/components).
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  // Investor-only / optional — collected only by CreateInvestorModal.tsx
  // (frontend/modules/investments/components).
  customerType?: "Borrower" | "Investor";
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
};
/* Result of a live Setu PAN-verify call (POST /customers/:id/verify-pan —
 * see backend/internal/customer/handler.go's VerifyPAN). `customer` carries
 * the updated panStatus/kycStatus; `message`/`matchedName` are the raw
 * values Setu returned, shown as-is so staff see what Setu actually said
 * rather than just a status chip. */
export type PanVerificationResult = {
  customer: CustomerView;
  message: string;
  matchedName: string;
  traceId: string;
};
/* DigiLocker Aadhaar verification is a redirect flow, not a single call —
 * see backend/internal/customer/handler.go's StartAadhaarVerify/
 * CheckAadhaarVerify. startAadhaarVerify opens a login URL the CUSTOMER
 * (not staff) completes on their own device via Aadhaar + OTP; the caller
 * then polls checkAadhaarVerify until status flips to "authenticated". */
export type AadhaarVerificationStart = {
  id: string;
  url: string;
  status: string;
  validUpto: string;
};
export type AadhaarVerificationCheck = {
  status: string; // "unauthenticated" | "authenticated"
  customer?: CustomerView;
  matchedName?: string;
  dob?: string;
  failureReasons?: string[];
};
/* Customer 360° profile — one consolidated view of every loan (with its
 * ornaments/payments/bank pledges) and every auction case for a customer,
 * backed by GET /api/v1/customers/:id/profile360 (see
 * backend/internal/loan/service.go's GetCustomer360 — lives in the loan
 * package to avoid a customer<->loan import cycle, but mounted under
 * /customers). Replaces CustomerDetail.tsx's old client-side filter over
 * the shared useLoans() list, which only ever showed a bare loan table —
 * no ornament/payment/bank-pledge/auction history. */
export type Customer360View = {
  customer: CustomerView;
  loans: LoanView[];
  auctionHistory: AuctionRecordView[];
  totalDisbursed: number;
  totalOutstanding: number;
  totalPaid: number;
  activeLoanCount: number;
  closedLoanCount: number;
};
export type BackendCustomer360 = {
  customer: BackendCustomer;
  loans: BackendLoan[];
  auctionHistory: BackendAuctionRecord[] | null;
  totalDisbursed: number;
  totalOutstanding: number;
  totalPaid: number;
  activeLoanCount: number;
  closedLoanCount: number;
};
