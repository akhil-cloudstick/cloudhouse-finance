

/* Shape returned by the Go backend (backend/internal/puritystandard/model.go).
 * Suggestion-only reference data — see that package's doc comment — nothing
 * FKs into it; PurityPicker.tsx uses it purely to power the karat/fineness%
 * typeahead. */
export type BackendPurityStandard = {
  id: number;
  karat: number | null;
  finenessPercent: number | null;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
