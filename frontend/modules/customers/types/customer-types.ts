import type { BranchView } from "@/modules/branches/types/branch-types";
import { type BackendLoan, type LoanView, type BackendAuctionRecord, type AuctionRecordView } from "@/modules/loans/types/loan-types";

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
  // Personal-loan specific: set only via the Personal Loan "+ Add new customer" flow. Absent for gold-loan customers.
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  customerType?: "Borrower" | "Investor"; // set only for customerType "Investor"
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  createdAt: string;
  updatedAt: string;
};
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
// `aadhaar` is the plaintext number, sent once at submit; the backend encrypts it and never returns it.
export type CustomerFormInput = {
  name: string;
  phone: string;
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
// message/matchedName are Setu's raw values, shown as-is rather than just a status chip.
export type PanVerificationResult = {
  customer: CustomerView;
  message: string;
  matchedName: string;
  traceId: string;
};
// A redirect flow: startAadhaarVerify opens a login URL the customer completes on their own device; the
// caller then polls checkAadhaarVerify until status flips to "authenticated".
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
