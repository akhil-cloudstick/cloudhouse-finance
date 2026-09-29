"use client";

/* Small pill-chip linking a ledger row's referenced entity (loan, customer,
 * bank) to that entity's own ledger view — the "click a reference, land on
 * its ledger" drill-down pattern from scratch/ledger-drilldown-mockup.html.
 * Navigation is a plain hash-route anchor (this app's existing convention —
 * see app/app/page.tsx's switch on `route`), not a router push, matching
 * every other in-app link (e.g. PartyLedger.tsx's own "← Back" anchor). */
export function LedgerRefLink({
  kind,
  id,
  label,
}: {
  kind: "loan" | "customer" | "bank" | "category";
  id: number | string;
  label: string;
}) {
  const href =
    kind === "loan" ? `#loan/${id}`
    : kind === "customer" ? `#ledger-customer/${id}`
    : kind === "category" ? `#party-category/${id}`
    : `#ledger-bank/${id}`;
  return (
    <a href={href} className={`ledger-ref-chip ledger-ref-chip-${kind}`} onClick={(e) => e.stopPropagation()}>
      {label}
    </a>
  );
}
