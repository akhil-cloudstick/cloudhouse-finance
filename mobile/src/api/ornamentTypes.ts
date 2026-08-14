import { apiRequest } from "./client";
import { OrnamentType } from "../types/ornamentType";

export function listOrnamentTypes(q?: string) {
  return apiRequest<OrnamentType[]>("/ornament-types", { params: { q } });
}

// Find-or-create, dedupes by name.
export function createOrnamentType(name: string) {
  return apiRequest<OrnamentType>("/ornament-types", { method: "POST", body: { name } });
}
