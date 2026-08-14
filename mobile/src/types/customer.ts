// Mirrors backend/internal/customer/model.go's ToResponse() JSON shape
// (only the subset the mobile list/detail screens need so far).
export type Customer = {
  id: number;
  code: string;
  name: string;
  phone: string;
  address: string;
  branchId: number;
  branch?: { id: number; name: string };
  kycStatus: string;
  panStatus: string;
  aadhaarStatus: string;
};
