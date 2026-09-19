"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { listSwitchableBranches, type BranchView } from "@/product/pages/branches/services/branchService";

/* Step 6 of the multi-tenancy plan: Administrator and Management see every
 * branch of their business by default, and can narrow the view to one via
 * this control. Hidden entirely for every other role — a Cashier's scope is
 * a property of their employee record, not a choice, so there is nothing
 * here for them to switch.
 *
 * Renders nothing (not even a loading state) until it knows the caller is
 * cross-branch, so it never flashes for the vast majority of sign-ins. */
export function BranchSwitcher() {
  const { isCrossBranch, selectedBranchId, setSelectedBranch } = useAuth();
  const [branches, setBranches] = useState<BranchView[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isCrossBranch) return;
    let cancelled = false;
    listSwitchableBranches()
      .then((res) => {
        if (cancelled) return;
        // Trust the backend's own canSwitch over the frontend's role guess —
        // they should always agree, but if they ever don't, showing nothing
        // is the safe direction.
        setBranches(res.canSwitch ? res.branches : []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isCrossBranch]);

  if (!isCrossBranch) return null;
  // Fewer than two branches means there is nothing to switch between —
  // still show "All branches" as a label would be noise for a
  // one-branch business.
  if (error || !branches || branches.length < 2) return null;

  return (
    <label className="branch-switcher" title="Viewing scope — narrows every list and report to one branch">
      <select
        aria-label="Branch"
        value={selectedBranchId ?? ""}
        onChange={(e) => setSelectedBranch(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
