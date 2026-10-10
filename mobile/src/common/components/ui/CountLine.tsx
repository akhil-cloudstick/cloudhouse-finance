import React from "react";
import { Txt } from "./Txt";
import { s } from "./listKitStyles";

type CountLineProps = { children: React.ReactNode };

/** Muted count line ("312 customers") used above some lists. */
export function CountLine({ children }: CountLineProps) {
  return <Txt style={s.count}>{children}</Txt>;
}
