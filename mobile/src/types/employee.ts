// Mirrors backend/internal/employee/model.go's JSON shape (and
// frontend/components/Employees.tsx's usage) — keep in sync when the
// backend struct changes.
export type Employee = {
  id: number;
  code: string;
  name: string;
  role: string;
  branchId: number;
  branch?: { id: number; name: string };
  phone?: string;
  username?: string;
  email?: string;
  loansProcessed: number;
  collections: number;
  followups: number;
  pending: number;
  createdAt: string;
  updatedAt: string;
};

// Kept in sync with ValidRoles in backend/internal/employee/service.go /
// main.go's staffRoles / frontend/components/modals/EmployeeModal.tsx.
export const ROLES = [
  "Administrator",
  "Management",
  "Branch Manager",
  "Loan Operator",
  "Cashier",
  "Accountant",
  "Collection Staff",
  "Auction Administrator",
  "Auditor",
] as const;

export type Role = (typeof ROLES)[number];
