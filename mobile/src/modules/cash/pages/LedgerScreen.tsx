import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { FlatHeader, Screen } from "@/common/components/ui";
import { LedgerList } from "@/common/components/LedgerList";
import type { LedgerKind } from "@/modules/cash/types/cash-types";

// One ledger screen for every drill-down: /cash/bank|customer|category|mode
// ?ref=<id or mode name>&label=<title>. See src/common/components/LedgerList.tsx.
const SUBTITLE: Record<LedgerKind, string> = {
  bank: "Every transaction through this bank",
  customer: "Every transaction with this customer",
  category: "Every expense under this category",
  mode: "Every transaction in this mode",
};

export default function LedgerScreen() {
  const { id, ref, label, focusDate, focusAmount } = useLocalSearchParams<{ id: LedgerKind; ref: string; label?: string; focusDate?: string; focusAmount?: string }>();
  // Opened from a row of another ledger: that transaction is scrolled to and highlighted here.
  const focus = focusDate && focusAmount && Number.isFinite(Number(focusAmount)) ? { date: String(focusDate), amount: Number(focusAmount) } : undefined;
  const [categoryName, setCategoryName] = useState<string>();
  return (
    <Screen header={<FlatHeader title={categoryName || label || "Ledger"} subtitle={SUBTITLE[id] ?? "Ledger"} back />}>
      <LedgerList kind={id} ledgerRef={String(ref)} onCategoryName={setCategoryName} focus={focus} />
    </Screen>
  );
}
