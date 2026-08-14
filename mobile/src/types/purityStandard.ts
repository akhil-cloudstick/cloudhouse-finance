// Mirrors backend/internal/puritystandard's response shape.
export type PurityStandard = {
  id: number;
  karat?: number;
  finenessPercent?: number;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
