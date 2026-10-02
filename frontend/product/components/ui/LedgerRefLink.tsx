"use client";

import { navigate, routeHref } from "@/product/services/appRoutes";
import { expenseCategoryOf } from "@/product/hooks/useExpenseCategoryIds";

/* Category-ledger chip for an approved expense's ledger row ("Expense —
 * Rent"); renders nothing for any other row or an unknown category. */
export function CategoryChip({ text, categoryIds }: { text?: string; categoryIds: Record<string, number> }) {
  const category = expenseCategoryOf(text);
  const id = category ? categoryIds[category.toLowerCase()] : undefined;
  return id ? <LedgerRefLink kind="category" id={id} label={category!} /> : null;
}

/* Small pill-chip linking a ledger row's referenced entity (loan, customer,
 * bank) to that entity's own ledger view — the "click a reference, land on
 * its ledger" drill-down pattern from scratch/ledger-drilldown-mockup.html.
 * It is a real route link (routeHref), so it copies and middle-clicks like
 * every other in-app link. The click is stopped from reaching the row's own
 * onClick, which also keeps it from AppShell's document-level link
 * interceptor — so a plain left-click navigates here itself, with the same
 * modifier-key rules that interceptor uses. */
export function LedgerRefLink({
  kind,
  id,
  label,
}: {
  kind: "loan" | "personalloan" | "investment" | "customer" | "bank" | "category";
  id: number | string;
  label: string;
}) {
  const route =
    kind === "loan" ? "loan"
    : kind === "personalloan" ? "personalloan"
    : kind === "investment" ? "investment"
    : kind === "customer" ? "ledger-customer"
    : kind === "category" ? "ledger-category"
    : "ledger-bank";
  return (
    <a
      href={routeHref(route, id)}
      className={`ledger-ref-chip ledger-ref-chip-${kind}`}
      onClick={(e) => {
        e.stopPropagation();
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(route, id);
      }}
    >
      {label}
    </a>
  );
}
