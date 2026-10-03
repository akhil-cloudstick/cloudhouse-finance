import React, { useState } from "react";
import { AccRow, FabCorner, FlatHeader, Screen, SearchInput, ServerFlatList } from "../../../src/components/ui";
import { SchemeSheet, SchemeStatementSheet } from "../../../src/components/staff/SchemeSheet";
import { useServerList } from "../../../src/hooks/useServerList";
import { useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { listSchemesPage } from "../../../src/api/schemes";
import type { Scheme } from "../../../src/types/scheme";
import { useAuth } from "../../../src/auth/AuthContext";

// Schemes tab — prototype #header-schemes + #page-schemes. Search (scheme
// name / code) is the server `q` on GET /schemes; rows page in 10 at a time.
// Create / edit open the Scheme sheet; Download Statement opens the
// statement sheet (server-built PDF / xlsx).

function serviceCharge(sc: Scheme) {
  if (!sc.serviceChargeType || sc.serviceChargeType === "None") return null;
  const v = sc.serviceChargeType === "Flat" ? `₹${(sc.serviceChargeValue ?? 0).toLocaleString("en-IN")}` : `${sc.serviceChargeValue ?? 0}%`;
  return `${v} · ${sc.serviceChargeMode === "AddedToPrincipal" ? "added to principal" : "withheld"}`;
}

export default function SchemesScreen() {
  const list = useServerList<Scheme>({ key: ["schemes", "list"], fetchPage: (p) => listSchemesPage(p) });
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
        header={<SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by scheme name or code" style={{ paddingTop: 12 }} />}
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

      <SchemeSheet visible={formOpen} onClose={() => setFormOpen(false)} scheme={editing} />
      <SchemeStatementSheet visible={statementOpen} onClose={() => setStatementOpen(false)} scheme={statementFor} />
    </Screen>
  );
}
