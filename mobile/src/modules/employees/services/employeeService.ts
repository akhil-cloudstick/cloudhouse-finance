import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Employee, type EmployeeInput } from "@/modules/employees/types/employee-types";

// No `q`/search query param on this endpoint today (branch-scoped only) —
// see plan's "Remaining modules" note; a search box would need a backend
// addition first.
export function listEmployees() {
  return apiRequest<Employee[]>("/employees");
}

// Page-scoped variant: passing `limit` flips the backend (employee/
// handler.go's List) into the {items, hasMore} envelope — used by the
// paginated mobile Employees list (10/page, one API call per page).
// `q` searches name / code / phone server-side.
export function listEmployeesPage(params: { q?: string; limit: number; offset: number }) {
  return apiRequest<{ items: Employee[]; hasMore: boolean; total?: number }>("/employees", { params });
}

export function getEmployee(id: number) {
  return apiRequest<Employee>(`/employees/${id}`);
}

export function createEmployee(input: EmployeeInput) {
  return apiRequest<Employee>("/employees", { method: "POST", body: input });
}

export function updateEmployee(id: number, input: EmployeeInput) {
  return apiRequest<Employee>(`/employees/${id}`, { method: "PUT", body: input });
}

export function deleteEmployee(id: number) {
  return apiRequest<void>(`/employees/${id}`, { method: "DELETE" });
}
