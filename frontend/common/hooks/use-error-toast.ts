"use client";

import { useEffect } from "react";
import { useToast } from "@/common/components/ToastProvider";

/* Load failures (offline, backend down) surface as a toast instead of a line of
 * red text pushed into the page layout. Fires once each time `error` turns on. */
export function useErrorToast(error: unknown, message = "Something went wrong. Please try again later.") {
  const toast = useToast();
  useEffect(() => {
    if (error) toast(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!error]);
}
