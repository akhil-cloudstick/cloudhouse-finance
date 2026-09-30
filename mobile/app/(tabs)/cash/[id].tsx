import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { FlatHeader, Screen } from "../../../src/components/ui";
import { LedgerList } from "../../../src/components/staff/LedgerList";
import type { LedgerKind } from "../../../src/api/cash";

// One ledger screen for every drill-down: /cash/bank|customer|category|mode
// ?ref=<id or mode name>&label=<title>. See src/components/staff/LedgerList.tsx.
const SUBTITLE: Record<LedgerKind, string> = {
  bank: "Every transaction through this bank",
  customer: "Every transaction with this customer",
  category: "Every expense under this category",
  mode: "Every transaction in this mode",
};

export default function LedgerScreen() {
  const { id, ref, label } = useLocalSearchParams<{ id: LedgerKind; ref: string; label?: string }>();
  const [categoryName, setCategoryName] = useState<string>();
  return (
    <Screen header={<FlatHeader title={categoryName || label || "Ledger"} subtitle={SUBTITLE[id] ?? "Ledger"} back />}>
      <LedgerList kind={id} ledgerRef={String(ref)} onCategoryName={setCategoryName} />
    </Screen>
  );
}
