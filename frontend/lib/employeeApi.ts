import { apiFetch } from "@/lib/api";

/* Shape returned by the Go backend (backend/internal/employee/model.go). */
export type BackendEmployee = {
  id: number;
  code: string;
  name: string;
  role: string;
  branchId: number;
  branch: { id: number; name: string; code?: string };
  phone: string;
  loansProcessed: number;
  collections: number;
  followups: number;
  pending: number;
  createdAt: string;
};

/* Flattened view consumed by Employees.tsx / EmployeeModal.tsx — derives
 * `branchName` from the nested `branch` object for display. */
export type EmployeeView = {
  id: number;
  code: string;
  name: string;
  role: string;
  branchId: number;
  branchName: string;
  phone: string;
  loansProcessed: number;
  collections: number;
  followups: number;
  pending: number;
};

export type EmployeeFormInput = {
  name: string;
  role: string;
  branchId: number;
  phone: string;
  // Optional login credentials, set up right at creation time (see
  // backend/internal/employee/service.go's CreateInput — both left blank
  // means "no login access yet", set later via Update).
  username?: string;
  password?: string;
};

/* PUT /employees/:id also carries the performance counters — the backend
 * overwrites them unconditionally on update, so callers must round-trip the
 * employee's current counters (see EmployeeModal.tsx) rather than omit them,
 * or they'll be reset to zero. */
export type EmployeeUpdateInput = EmployeeFormInput & {
  loansProcessed: number;
  collections: number;
  followups: number;
  pending: number;
};

function toView(e: BackendEmployee): EmployeeView {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    role: e.role,
    branchId: e.branchId,
    branchName: e.branch?.name || "",
    phone: e.phone,
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
export const EMPLOYEES_PAGE_SIZE = 10;

export async function listEmployeesPage(page: number): Promise<{ items: EmployeeView[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    limit: String(EMPLOYEES_PAGE_SIZE),
    offset: String((page - 1) * EMPLOYEES_PAGE_SIZE),
  });
  const rec = await apiFetch<{ items: BackendEmployee[]; hasMore: boolean }>(`/employees?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
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
