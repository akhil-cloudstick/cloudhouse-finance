import React, { useState } from "react";
import { View } from "react-native";
import { AccRow, ConfirmSheet, FabCorner, FlatHeader, GroupedFilter, Screen, SearchInput, ServerFlatList, emptyGroupedFilter, gfValues, toast, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { userMessage } from "@/common/services/apiErrors";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { SchemeSheet } from "@/modules/schemes/components/SchemeSheet";
import { SchemeStatementSheet } from "@/modules/schemes/components/SchemeStatementSheet";
import { useServerList } from "@/common/hooks/use-server-list";
import { useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { deleteScheme, listSchemesPage } from "@/modules/schemes/services/schemeService";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { useAuth } from "@/common/providers/AuthProvider";

// Schemes tab — prototype #header-schemes + #page-schemes. Search (scheme
// name / code) is the server `q` on GET /schemes; rows page in 10 at a time.
// Create / edit open the Scheme sheet; Download Statement opens the
// statement sheet (server-built PDF / xlsx).

const INTEREST_METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly", "Multiple interest"] as const;
const FILTER_SECTIONS: GFSection[] = [{ kind: "static", key: "method", label: "Interest method", options: INTEREST_METHODS.map((m) => ({ value: m, label: m })) }];

function serviceCharge(sc: Scheme) {
  if (!sc.serviceChargeType || sc.serviceChargeType === "None") return null;
  const v = sc.serviceChargeType === "Flat" ? `₹${(sc.serviceChargeValue ?? 0).toLocaleString("en-IN")}` : `${sc.serviceChargeValue ?? 0}%`;
  return `${v} · ${sc.serviceChargeMode === "AddedToPrincipal" ? "added to principal" : "withheld"}`;
}

export default function SchemesScreen() {
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("schemes:filters", emptyGroupedFilter());
  const methods = gfValues(fv, "method");
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
  const canDelete = can("Scheme_Management", "can_delete_scheme");
  // The statement needs the loan module and ledger export (same as web).
  const canStatement = can("Loan_Management", "can_view_loan_module") && can("Ledger_Export", "can_export_ledger");
  const showBranch = useShowBranch();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<Scheme | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => deleteScheme(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schemes"] });
      toast.success(`Scheme "${deleting?.name ?? ""}" deleted`);
      setDeleting(null);
    },
    onError: (e) => setDeleteError(userMessage(e, "Could not delete the scheme — try again.")),
  });

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
              <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 }}>
                <GroupedFilter title="Filter schemes" sections={FILTER_SECTIONS} value={fv} onChange={setFv} />
              </View>
              <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by name, code, LTV % or months" style={{ paddingTop: 0 }} />
            </>
          }
        renderItem={(sc, i) => {
          const charge = serviceCharge(sc);
          return (
            <AccRow
              defaultOpen={i === 0}
              name={sc.name}
              sub={sc.rateTiers && sc.rateTiers.length > 1 ? `Interest ${sc.rateTiers[0].rate}% → ${sc.rateTiers[sc.rateTiers.length - 1].rate}% p.a.` : `Interest ${sc.interestRate}% p.a.`}
              status={sc.isActive ? "Active" : "Inactive"}
              details={[
                { k: "LTV", v: `${sc.ltvPercent}%` },
                { k: "Duration", v: `${sc.durationMonths} month${sc.durationMonths === 1 ? "" : "s"}` },
                { k: "Code", v: sc.code || "—" },
                ...(showBranch ? [{ k: "Branch", v: sc.branch?.name || "—" }] : []),
                { k: "Penal rate", v: sc.penalRate != null ? `${sc.penalRate}% p.a.` : "—" },
                { k: "Conditions", v: sc.conditions || "—" },
                ...(sc.interestMethod ? [{ k: "Interest method", v: sc.interestMethod }] : []),
                ...(charge ? [{ k: "Service charge", v: charge }] : []),
              ]}
              actions={[
                ...(canStatement ? [{ label: "Download Statement", onPress: () => {
                    setStatementFor(sc);
                    setStatementOpen(true);
                  },
                }] : []),
                ...(canDelete ? [{ label: "Delete", danger: true, onPress: () => { setDeleteError(null); setDeleting(sc); } }] : []),
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

      <ConfirmSheet
        visible={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete Scheme"
        danger
        message={deleting ? `Permanently delete scheme "${deleting.name}"? This cannot be undone. It is refused while any loan or draft still uses it.` : ""}
        confirmLabel="Delete"
        loading={remove.isPending}
        error={deleteError}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
      <SchemeSheet visible={formOpen} onClose={() => setFormOpen(false)} scheme={editing} />
      <SchemeStatementSheet visible={statementOpen} onClose={() => setStatementOpen(false)} scheme={statementFor} />
    </Screen>
  );
}
