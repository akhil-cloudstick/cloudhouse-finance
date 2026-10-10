// Mirrors backend/internal/customer/model.go's CustomerResponse JSON shape
// (customer/model.go:85-114) — the API-safe view, every field the backend
// ever returns (AadhaarEncrypted has no json tag there at all, so it's
// correctly absent here too).
export type Customer = {
  id: number;
  code: string;
  name: string;
  phone: string;
  dob: string;
  address: string;
  branchId: number;
  branch?: { id: number; name: string };

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

  createdAt: string;
  updatedAt: string;
};

// Mirrors backend/internal/customer/handler.go's customerRequest body shape
// exactly (name/phone required; dob/address optional; branchId required).
//
// The document fields carry "/uploads/..." URLs, not file bytes: the mobile
// register screen uploads each pick immediately via src/common/services/uploadService.ts and
// only sends the resulting URLs here — the same two-step the web modal does
// in save() (uploadFile ×4, then createCustomer).
export type CustomerInput = {
  name: string;
  phone: string;
  dob?: string;
  address?: string;
  branchId: number;
  pan?: string;
  aadhaar?: string;
  nomineeName?: string;
  nomineeRelation?: string;
  nomineePhone?: string;
  photoUrl?: string;
  identityProofUrl?: string;
  addressProofUrl?: string;
  kycDocumentUrl?: string;
  // Personal-loan / investor-only fields (customerRequest in handler.go).
  // The mobile form never edits them, but the PUT is a full replace, so the
  // edit sheet re-sends whatever the customer already has on file.
  customerType?: string;
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
};
