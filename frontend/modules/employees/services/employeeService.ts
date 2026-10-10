import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { isSmallScreen } from "@/common/utils/responsive";
import type { BackendEmployee, EmployeeView, EmployeeFormInput, EmployeeUpdateInput } from "@/modules/employees/types/employee-types";

function toView(e: BackendEmployee): EmployeeView {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    role: e.role,
    branchId: e.branchId,
    branchName: e.branch?.name || "",
    phone: e.phone,
    username: e.username || "",
    loansProcessed: e.loansProcessed,
    collections: e.collections,
    followups: e.followups,
    pending: e.pending,
  };
}

export async function listEmployees(): Promise<EmployeeView[]> {
  const rec = await apiFetch<BackendEmployee[]>("/employees");
  return (rec || []).map(toView);
}

/* Page size for the paginated Employees table (Employees.tsx). */
export const EMPLOYEES_PAGE_SIZE = 12;

export async function listEmployeesPage(
  page: number,
  limit?: number
): Promise<{ items: EmployeeView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 8 : 12);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  const rec = await apiFetch<{ items: BackendEmployee[]; hasMore: boolean; total?: number }>(`/employees?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function getEmployee(id: number): Promise<EmployeeView> {
  const rec = await apiFetch<BackendEmployee>(`/employees/${id}`);
  return toView(rec);
}

export async function createEmployee(input: EmployeeFormInput): Promise<EmployeeView> {
  const rec = await apiFetch<BackendEmployee>("/employees", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function updateEmployee(id: number, input: EmployeeUpdateInput): Promise<EmployeeView> {
  const rec = await apiFetch<BackendEmployee>(`/employees/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function deleteEmployee(id: number): Promise<void> {
  await apiFetch<void>(`/employees/${id}`, { method: "DELETE" });
}
