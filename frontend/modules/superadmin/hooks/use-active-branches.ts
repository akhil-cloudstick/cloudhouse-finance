"use client";

import { useEffect, useState } from "react";
import { getBusinessOverview } from "@/modules/superadmin/services/superadminService";

/* A business's active branch count, for plansFor. `known` (already fetched
 * by the detail page) skips the request; null business (create) has none. */
export function useActiveBranches(businessId: number | null, known?: number): number | undefined {
  const [fetched, setFetched] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (businessId === null || known !== undefined) return;
    let live = true;
    getBusinessOverview(businessId)
      .then((o) => { if (live) setFetched(o.usage.branches); })
      .catch(() => {});
    return () => { live = false; };
  }, [businessId, known]);
  return known ?? fetched;
}
