import React, { useMemo, useState } from "react";
import { AccGroupContext } from "./rowContext";

type AccGroupProps = { children: React.ReactNode };

export function AccGroup({ children }: AccGroupProps) {
  // undefined = nothing touched yet, so rows marked defaultOpen are open.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <AccGroupContext.Provider value={value}>{children}</AccGroupContext.Provider>;
}
