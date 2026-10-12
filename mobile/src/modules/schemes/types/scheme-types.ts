// Mirrors backend/internal/scheme's Scheme JSON shape.
export type ServiceChargeType = "None" | "Flat" | "Percent";
export type ServiceChargeMode = "WithheldFromPayout" | "AddedToPrincipal";

// One step of a "Multiple interest" ladder: the rate applies while interest has
// been unpaid for up to `days` days. The last step has days 0 (thereafter).
export type RateTier = { days: number; rate: number };

export type Scheme = {
  id: number;
  branchId: number;
  branch?: { id: number; name: string };
  code: string;
  name: string;
  interestRate: number;
  rateTiers?: RateTier[] | null;
  minimumDays?: number;
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

export type SchemeInput = {
  name: string;
  branchId: number;
  interestRate: number;
  rateTiers?: RateTier[];
  minimumDays?: number;
  durationMonths: number;
  ltvPercent: number;
  interestMethod?: string;
  penalRate?: number;
  conditions?: string;
  isActive?: boolean;
  serviceChargeType?: ServiceChargeType;
  serviceChargeValue?: number;
  serviceChargeMode?: ServiceChargeMode;
};
