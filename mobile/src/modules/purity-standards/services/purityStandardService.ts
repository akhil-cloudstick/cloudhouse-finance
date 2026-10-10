import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { PurityStandard } from "@/modules/purity-standards/types/purity-standard-types";

export function listPurityStandards(q?: string) {
  return apiRequest<PurityStandard[]>("/purity-standards", { params: { q } });
}

// Find-or-create — backend/internal/puritystandard's POST dedupes by the
// given karat/finenessPercent/label rather than always inserting a new row.
export function createPurityStandard(input: { karat?: number; finenessPercent?: number; label: string }) {
  return apiRequest<PurityStandard>("/purity-standards", { method: "POST", body: input });
}
