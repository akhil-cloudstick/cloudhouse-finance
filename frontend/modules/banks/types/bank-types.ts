

/* Shape returned by the Go backend (backend/internal/bank/model.go). */
export type BackendBank = {
  id: number;
  name: string;
  // The business branch this account belongs to (mandatory) — GET /banks is
  // scoped by it via the X-Branch-Id header.
  branchId: number;
  branchName: string;
  // The BANK's own branch (free text, e.g. "Koratty") — not a business branch.
  branch: string;
  ifsc: string;
  accountNo: string;
  phone: string;
  // Current net balance of this account (money in less money out).
  balance: number;
  createdAt: string;
  updatedAt: string;
};
/* Full "Add Bank" form submission — name + the descriptive fields. Same
 * find-or-create endpoint as createBank(); note branch/ifsc/phone are only
 * persisted when a NEW bank is created (an existing name-match is returned
 * as-is, per the backend's FindOrCreate semantics). Used by both the
 * bank-picker's inline "add new" flow and the Bank Management admin page's
 * "Add Bank" form — a name collision there just reuses the existing row,
 * which is a reasonable admin outcome too (see backend Service.Update's own
 * doc comment for why RENAMING instead rejects a collision outright). */
export type BankFormInput = { name: string; branchId: number; branch: string; ifsc: string; accountNo: string; phone: string };
