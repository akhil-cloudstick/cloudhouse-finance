// Mirrors backend/internal/scheme's Scheme JSON shape.
export type ServiceChargeType = "None" | "Flat" | "Percent";
export type ServiceChargeMode = "WithheldFromPayout" | "AddedToPrincipal";

export type Scheme = {
  id: number;
  branchId: number;
  branch?: { id: number; name: string };
  code: string;
  name: string;
  interestRate: number;
  durationMonths: number;
  ltvPercent: number;
  interestMethod?: string;
  penalRate?: number;
  conditions?: string;
  isActive: boolean;
  // Optional charge applied to every loan opened under this scheme —
  // mirrors web schemeService.ts's BackendScheme fields.
  serviceChargeType?: ServiceChargeType;
  serviceChargeValue?: number;
  serviceChargeMode?: ServiceChargeMode;
  createdAt: string;
  updatedAt: string;
};
