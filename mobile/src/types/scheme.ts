// Mirrors backend/internal/scheme's Scheme JSON shape.
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
  createdAt: string;
  updatedAt: string;
};
