

/* Shape returned by the Go backend (backend/internal/employee/model.go). */
export type BackendEmployee = {
  id: number;
  code: string;
  name: string;
  role: string;
  branchId: number;
  branch: { id: number; name: string; code?: string };
  phone: string;
  username?: string;
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
  username: string;
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
