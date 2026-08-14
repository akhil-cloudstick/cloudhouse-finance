import { apiRequest } from "./client";
import { Loan } from "../types/loan";

// q/status/branchId/customerId mirror backend/internal/loan/handler.go's
// LoanFilter — all server-side, per the plan's "no client-side filtering" rule.
export function listLoans(params?: { q?: string; status?: string; branchId?: number }) {
  return apiRequest<Loan[]>("/loans", { params });
}

export function getLoan(id: number) {
  return apiRequest<Loan>(`/loans/${id}`);
}
