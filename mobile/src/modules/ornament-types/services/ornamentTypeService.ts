import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { OrnamentType } from "@/modules/ornament-types/types/ornament-type-types";

export function listOrnamentTypes(q?: string) {
  return apiRequest<OrnamentType[]>("/ornament-types", { params: { q } });
}

// Find-or-create, dedupes by name.
export function createOrnamentType(name: string) {
  return apiRequest<OrnamentType>("/ornament-types", { method: "POST", body: { name } });
}
