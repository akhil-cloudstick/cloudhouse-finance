import React from "react";
import { Txt } from "./Txt";
import { styles } from "./base";

type EmptyTextProps = { children: React.ReactNode };

/** .local-search-empty */
export function EmptyText({ children }: EmptyTextProps) {
  return <Txt style={styles.empty}>{children}</Txt>;
}
