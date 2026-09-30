"use client";

import { navigate, routeHref } from "@/product/services/appRoutes";

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
  kind: "loan" | "customer" | "bank" | "category";
  id: number | string;
  label: string;
}) {
  const route =
    kind === "loan" ? "loan"
    : kind === "customer" ? "ledger-customer"
    : kind === "category" ? "party-category"
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
