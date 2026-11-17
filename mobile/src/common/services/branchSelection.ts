// The branch switcher's selection — mobile counterpart of web's branchSelection.ts.
//
// Session-scoped on purpose, like web: a branch selection is a lens on the current sign-in, not a durable
// preference, so it lives in memory only and every fresh sign-in starts at "All branches". The backend reads
// it from the X-Branch-Id header and narrows every list to that branch (platform.SelectedBranchHeader).

/** The header name the backend reads — mirrors platform.SelectedBranchHeader. */
export const SELECTED_BRANCH_HEADER = "X-Branch-Id";

let selected: number | null = null;

export function getSelectedBranchId(): number | null {
  return selected;
}

export function setSelectedBranchId(id: number | null): void {
  selected = id && id > 0 ? id : null;
}

/** The header to merge into every authenticated request — empty when nothing is selected. */
export function branchHeader(): Record<string, string> {
  return selected ? { [SELECTED_BRANCH_HEADER]: String(selected) } : {};
}
