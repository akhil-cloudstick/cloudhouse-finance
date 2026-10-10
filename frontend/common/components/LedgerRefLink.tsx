"use client";

import { navigate, routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";

type LedgerRefLinkProps = {
  kind: "loan" | "personalloan" | "investment" | "customer" | "bank" | "category";
  id: number | string;
  label: string;
};

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
}: LedgerRefLinkProps) {
  const canOpen = useCanOpenRoute();
  const route =
    kind === "loan" ? "loan"
    : kind === "personalloan" ? "personalloan"
    : kind === "investment" ? "investment"
    : kind === "customer" ? "ledger-customer"
    : kind === "category" ? "ledger-category"
    : "ledger-bank";
  // A chip to a page this role can't open is just its label, not a link.
  if (!canOpen(route)) return <span className={`ledger-ref-chip ledger-ref-chip-${kind}`}>{label}</span>;
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
