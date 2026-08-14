import { apiRequest } from "./client";
import { Employee } from "../types/employee";

// No `q`/search query param on this endpoint today (branch-scoped only) —
// see plan's "Remaining modules" note; a search box would need a backend
// addition first.
export function listEmployees() {
  return apiRequest<Employee[]>("/employees");
}

export function getEmployee(id: number) {
  return apiRequest<Employee>(`/employees/${id}`);
}

export type EmployeeInput = {
  name: string;
  role: string;
  branchId: number;
  phone?: string;
  username?: string;
  password?: string;
};

export function createEmployee(input: EmployeeInput) {
  return apiRequest<Employee>("/employees", { method: "POST", body: input });
}

export function updateEmployee(id: number, input: EmployeeInput) {
  return apiRequest<Employee>(`/employees/${id}`, { method: "PUT", body: input });
}

export function deleteEmployee(id: number) {
  return apiRequest<void>(`/employees/${id}`, { method: "DELETE" });
}
