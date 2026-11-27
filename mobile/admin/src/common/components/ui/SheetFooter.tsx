import React, { useContext, useEffect } from "react";
import { SlotContext } from "./Sheet";

type SheetFooterProps = { children: React.ReactNode };

/** Renders its children in the enclosing Sheet's sticky footer (or inline
 * when not inside a Sheet). */
export function SheetFooter({ children }: SheetFooterProps) {
  const slot = useContext(SlotContext);
  useEffect(() => {
    slot?.set(children);
  });
  useEffect(() => () => slot?.set(null), [slot]);
  return slot ? null : <>{children}</>;
}
