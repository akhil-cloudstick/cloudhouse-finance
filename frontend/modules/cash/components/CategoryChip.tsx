"use client";

import { expenseCategoryOf } from "@/common/hooks/use-expense-category-ids";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";

type CategoryChipProps = { text?: string; categoryIds: Record<string, number> };

export function CategoryChip({ text, categoryIds }: CategoryChipProps) {
  const category = expenseCategoryOf(text);
  const id = category ? categoryIds[category.toLowerCase()] : undefined;
  return id ? <LedgerRefLink kind="category" id={id} label={category!} /> : null;
}
