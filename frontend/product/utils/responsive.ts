"use client";

import { useEffect, useState } from "react";

/**
 * Checks whether the current viewport is a "small" screen.
 * Big screen corresponds to 1920x1080 and larger monitors (innerWidth >= 1560 AND innerHeight > 850).
 * Small screen corresponds to laptops (e.g. 1280x832, 1366x768, 1440x900) or browser height <= 850px.
 */
export function isSmallScreen(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 1560 || window.innerHeight <= 850;
}

export function useIsSmallScreen(): boolean {
  const [small, setSmall] = useState(false);

  useEffect(() => {
    function check() {
      setSmall(isSmallScreen());
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return small;
}

export function useResponsivePageSize(bigSize: number, smallSize: number): number {
  const small = useIsSmallScreen();
  return small ? smallSize : bigSize;
}

/* Helper functions for API calls and default service fallbacks */
export function getLoansPageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getCustomersPageSize(): number {
  return isSmallScreen() ? 7 : 9;
}

export function getCustomerSubtablePageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getRequestsPageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getBankPledgePageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getGoldRatesPageSize(): number {
  return isSmallScreen() ? 6 : 10;
}

export function getEmployeesPageSize(): number {
  return isSmallScreen() ? 8 : 12;
}

export function getCashPageSize(): number {
  return 7;
}

export function getPacketsPageSize(): number {
  return isSmallScreen() ? 8 : 12;
}

export function getReportsPageSize(): number {
  return isSmallScreen() ? 7 : 12;
}
