// Mirrors backend/internal/customer/model.go's CustomerResponse — the only
// shape the API ever returns for a Customer (raw model fields like
// aadhaarEncrypted/digilockerRequestId are deliberately never exposed).
export type KYCStatusValue = "Pending" | "Verified" | "Failed" | "Name Mismatch";

export type Customer = {
  id: number;
  code: string;
  name: string;
  phone: string;
  dob?: string;
  address?: string;

  branchId: number;
  branch?: { id: number; name: string };

  photoUrl?: string;
  identityProofUrl?: string;
  addressProofUrl?: string;
  kycDocumentUrl?: string;

  pan?: string;
  aadhaarLast4?: string;

  nomineeName?: string;
  nomineeRelation?: string;
  nomineePhone?: string;

  kycStatus: KYCStatusValue;
  panStatus: KYCStatusValue;
  aadhaarStatus: KYCStatusValue;

  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};
