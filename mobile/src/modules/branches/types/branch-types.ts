// Mirrors backend/internal/branch/model.go's Branch JSON tags exactly.
export type Branch = {
  id: number;
  name: string;
  code: string;
  address: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BranchInput = {
  name: string;
  code?: string;
  address: string;
  phone?: string;
  isActive?: boolean;
};
