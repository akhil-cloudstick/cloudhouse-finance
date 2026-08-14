import { apiRequest } from "./client";
import { Customer } from "../types/customer";

// `q` (server-side search) mirrors backend/internal/customer/handler.go's
// List — never fetch all customers and filter with .includes() on-device.
export function listCustomers(q?: string) {
  return apiRequest<Customer[]>("/customers", { params: { q, limit: 50 } });
}

export function getCustomer(id: number) {
  return apiRequest<Customer>(`/customers/${id}`);
}
