import React, { useState } from "react";
import { AccBtn, AccRow, CheckItem, FabCorner, FiltersBar, FlatHeader, Screen, SearchInput, ServerFlatList, Sheet } from "@/common/components/ui";
import { SchemeSheet } from "@/modules/schemes/components/SchemeSheet";
import { SchemeStatementSheet } from "@/modules/schemes/components/SchemeStatementSheet";
import { useServerList } from "@/common/hooks/use-server-list";
import { useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { listSchemesPage } from "@/modules/schemes/services/schemeService";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { useAuth } from "@/common/providers/AuthProvider";

// Schemes tab — prototype #header-schemes + #page-schemes. Search (scheme
// name / code) is the server `q` on GET /schemes; rows page in 10 at a time.
// Create / edit open the Scheme sheet; Download Statement opens the
// statement sheet (server-built PDF / xlsx).

const INTEREST_METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly"] as const;

function serviceCharge(sc: Scheme) {
  if (!sc.serviceChargeType || sc.serviceChargeType === "None") return null;
  const v = sc.serviceChargeType === "Flat" ? `₹${(sc.serviceChargeValue ?? 0).toLocaleString("en-IN")}` : `${sc.serviceChargeValue ?? 0}%`;
  return `${v} · ${sc.serviceChargeMode === "AddedToPrincipal" ? "added to principal" : "withheld"}`;
}

export default function SchemesScreen() {
  const [methods, setMethods] = usePersistedState<string[]>("schemes:methods", []);
  const [filterOpen, setFilterOpen] = useState(false);
  const list = useServerList<Scheme, { method?: string[] }>({
    key: ["schemes", "list"],
    persistKey: "schemes",
    filters: { method: methods },
    fetchPage: (p) => listSchemesPage(p),
  });
  const [editing, setEditing] = useState<Scheme | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statementFor, setStatementFor] = useState<Scheme | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const { can } = useAuth();
  const canCreate = can("Scheme_Management", "can_create_scheme");
  const canUpdate = can("Scheme_Management", "can_update_scheme");

  useResetOnBlur(() => {
    setFormOpen(false);
    setStatementOpen(false);
  });

  return (
    <Screen
      header={<FlatHeader title="Schemes" subtitle="Interest, LTV & scheme rules" />}
      floating={
        canCreate ? (
          <FabCorner
            label="New scheme"
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(sc) => String(sc.id)}
        emptyText={list.search ? "No schemes match your search." : "No schemes yet."}
        header={
            <>
              <FiltersBar count={methods.length} summary={methods.length ? methods.join(", ") : "All interest methods"} onPress={() => setFilterOpen(true)} style={{ paddingTop: 12 }} />
              <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by name, code, LTV % or months" style={{ paddingTop: 0 }} />
            </>
          }
        renderItem={(sc, i) => {
          const charge = serviceCharge(sc);
          return (
            <AccRow
              defaultOpen={i === 0}
              name={sc.name}
              sub={`Interest ${sc.interestRate}% p.a.`}
              status={sc.isActive ? "Active" : "Inactive"}
              details={[
                { k: "LTV", v: `${sc.ltvPercent}%` },
                { k: "Duration", v: `${sc.durationMonths} month${sc.durationMonths === 1 ? "" : "s"}` },
                { k: "Code", v: sc.code || "—" },
                { k: "Branch", v: sc.branch?.name || "—" },
                { k: "Penal rate", v: sc.penalRate != null ? `${sc.penalRate}% /mo` : "—" },
                { k: "Conditions", v: sc.conditions || "—" },
                ...(sc.interestMethod ? [{ k: "Interest method", v: sc.interestMethod }] : []),
                ...(charge ? [{ k: "Service charge", v: charge }] : []),
              ]}
              actions={[
                { label: "Download Statement", onPress: () => {
                    setStatementFor(sc);
                    setStatementOpen(true);
                  },
                },
                ...(canUpdate
                  ? [
                      {
                        label: "Edit Scheme",
                        primary: true,
                        onPress: () => {
                          setEditing(sc);
                          setFormOpen(true);
                        },
                      },
                    ]
                  : []),
              ]}
            />
          );
        }}
      />

      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Schemes" maxHeightPct={70}>
        {INTEREST_METHODS.map((m) => (
          <CheckItem key={m} checked={methods.includes(m)} title={m} onPress={() => setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))} />
        ))}
        {methods.length ? <AccBtn label="Reset all" onPress={() => setMethods([])} /> : null}
      </Sheet>
      <SchemeSheet visible={formOpen} onClose={() => setFormOpen(false)} scheme={editing} />
      <SchemeStatementSheet visible={statementOpen} onClose={() => setStatementOpen(false)} scheme={statementFor} />
    </Screen>
  );
}
