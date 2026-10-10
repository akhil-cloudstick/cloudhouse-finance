

/* Shape returned by the Go backend (backend/internal/scheme/model.go). A
 * scheme's tenure is a real field now — no more start/end date window. */
export type ServiceChargeType = "None" | "Flat" | "Percent";
export type ServiceChargeMode = "WithheldFromPayout" | "AddedToPrincipal";
export type BackendScheme = {
  id: number;
  code: string;
  name: string;
  interestRate: number;
  durationMonths: number;
  ltvPercent: number;
  interestMethod: string;
  penalRate: number;
  conditions: string;
  isActive: boolean;
  branchId: number;
  branch?: { id: number; name: string; code?: string };
  // Optional charge applied to every loan opened under this scheme — see
  // backend/internal/scheme/model.go's ServiceChargeType*/ServiceChargeMode*
  // constants. serviceChargeValue is a flat rupee amount when Type is
  // "Flat", or a percentage of principal when Type is "Percent"; ignored
  // when Type is "None".
  serviceChargeType?: ServiceChargeType;
  serviceChargeValue?: number;
  serviceChargeMode?: ServiceChargeMode;
};
/* Shape the Schemes UI renders — closer to how a scheme is described on
 * screen (a tenure in months rather than a start/end validity window). */
export type SchemeView = {
  id: string; // backend numeric id, stringified — used for update/delete/toggle
  code: string;
  name: string;
  rate: number;
  durationMonths: number;
  ltv: number;
  method: string;
  penal: number;
  cond: string;
  active: boolean;
  branchId: number;
  branchName: string;
  serviceChargeType: ServiceChargeType;
  serviceChargeValue: number;
  serviceChargeMode: ServiceChargeMode;
};
export type SchemeFormInput = {
  name: string;
  rate: number;
  durationMonths: number;
  ltv: number;
  method: string;
  penal: number;
  cond: string;
  active: boolean;
  branchId: number;
  serviceChargeType: ServiceChargeType;
  serviceChargeValue: number;
  serviceChargeMode: ServiceChargeMode;
};
export type SchemeStatementFilters = {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  loanIds?: number[]; // narrows to specific loans; omitted/empty = every loan in range
};
