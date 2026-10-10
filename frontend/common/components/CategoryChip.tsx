"use client";

import { expenseCategoryOf } from "@/common/hooks/use-expense-category-ids";
import { LedgerRefLink } from "./LedgerRefLink";

type CategoryChipProps = { text?: string; categoryIds: Record<string, number> };

/* Category-ledger chip for an approved expense's ledger row ("Expense —
 * Rent"); renders nothing for any other row or an unknown category. */
export function CategoryChip({ text, categoryIds }: CategoryChipProps) {
  const category = expenseCategoryOf(text);
  const id = category ? categoryIds[category.toLowerCase()] : undefined;
  return id ? <LedgerRefLink kind="category" id={id} label={category!} /> : null;
}
