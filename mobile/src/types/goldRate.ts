// Mirrors backend/internal/goldrate/model.go's JSON shape.
export type GoldRate = {
  id: number;
  date: string;
  k24: number;
  setBy: string;
  createdAt: string;
};
