

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
  username?: string; // both blank means "no login access yet"
  password?: string;
};
// Backend overwrites the counters unconditionally on update; callers must round-trip the current values.
export type EmployeeUpdateInput = EmployeeFormInput & {
  loansProcessed: number;
  collections: number;
  followups: number;
  pending: number;
};
