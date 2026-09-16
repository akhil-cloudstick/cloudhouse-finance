/* Pledge-agreement (indemnity bond) language catalogue — the actual document
 * is now rendered entirely server-side (backend/internal/loan/
 * indemnitybond.go, via loanService.ts's downloadIndemnityBondPDF/
 * previewIndemnityBondPDF), so this file only keeps the shared language type
 * and picker helper every bond-language dropdown (NewLoan.tsx's print
 * toggle, LoanDetail.tsx's eSign modal) still needs. The old client-side
 * printIndemnityBond() HTML/window.print() builder that used to live here
 * was already dead code by the time of this cleanup — nothing called it —
 * and has been removed along with its now-unused IndemnityBondParty/
 * IndemnityBondOrnament types. */
export type BondLang = "en" | "ml" | "gu";

/* Shared label set — the same options wherever a bond-language picker
 * appears (NewLoan.tsx's print toggle, LoanDetail.tsx's eSign modal).
 *
 * This is the full catalogue, mirroring tenant.KnownLanguages. It is NOT
 * what a picker should render: which of these a business may actually issue
 * is a per-business grant, so pickers call bondLangOptionsFor() below. */
export const BOND_LANG_OPTIONS: { value: BondLang; label: string; native: string }[] = [
  { value: "en", label: "English", native: "Indemnity Bond" },
  { value: "ml", label: "Malayalam", native: "ആഭരണ പണയ കരാർ" },
  { value: "gu", label: "Gujarati", native: "ગીરો કરાર" },
];

/* bondLangOptionsFor narrows the catalogue to what this business has been
 * granted. English is always present — tenant.Tenant.HasLanguage guarantees
 * it server-side, and a picker with nothing in it would be worse than a
 * picker with one option.
 *
 * Only what is OFFERED. The server independently refuses a language a
 * business does not hold (loan.Service.StartIndemnityBondSign), so a crafted
 * request gains nothing.
 *
 * All three templates exist server-side (backend/templates/), so a granted
 * language always renders in that language rather than silently falling back
 * to English. Note the Gujarati one is a DIFFERENT DOCUMENT, not a third
 * translation: English and Malayalam are the Kerala promissory-pledge letter,
 * Gujarati is the Gujarat branch's formal deed — see backend/templates/
 * gujarati-bond.html's own doc comment. */
export function bondLangOptionsFor(languages: string[]): typeof BOND_LANG_OPTIONS {
  const allowed = new Set(languages.length ? languages : ["en"]);
  allowed.add("en");
  return BOND_LANG_OPTIONS.filter((o) => allowed.has(o.value));
}
