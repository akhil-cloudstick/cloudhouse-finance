"use client";

import { useCallback } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { useBranding } from "@/product/providers/BrandingProvider";
import { ROUTE_ALIASES } from "@/product/config/routes";
import { baseRoute, routeAllowed } from "@/product/config/routePermissions";

/**
 * For drawing: whether a link, button or KPI card to `route` should be
 * offered at all ("loan", "loan/12", "ledger-bank"…). A link to a page the
 * role can't open is shown as plain text or left out, rather than offered
 * and then refused by navigate()'s guard.
 */
export function useCanOpenRoute(): (route: string) => boolean {
  const { can } = useAuth();
  const { hasModule, singleBranch } = useBranding();
  return useCallback(
    (route: string) => {
      const r = baseRoute(route);
      return routeAllowed(ROUTE_ALIASES[r] ?? r, can, hasModule, singleBranch);
    },
    [can, hasModule, singleBranch]
  );
}
