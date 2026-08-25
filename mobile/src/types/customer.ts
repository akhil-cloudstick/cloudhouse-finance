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
