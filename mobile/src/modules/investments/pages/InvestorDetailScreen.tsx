import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccRow, Buffering, ConfirmSheet, EmptyText, FieldGrid, FlatHeader, Screen, SectionTitle, ServerFlatList, toast } from "@/common/components/ui";
import { ActionGroup, type GroupAction } from "@/common/components/ActionGroup";
import { useServerList } from "@/common/hooks/use-server-list";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { loadErrorText } from "@/common/services/apiErrors";
import { InvestorFormSheet } from "@/modules/investments/components/InvestorFormSheet";
import { CreateInvestmentSheet } from "@/modules/investments/pages/InvestmentsScreen";
import { listInvestmentsPage } from "@/modules/investments/services/investmentService";
import { getInvestor, hardDeleteInvestor } from "@/modules/investments/services/investorService";
import type { Investment } from "@/modules/investments/types/investment-types";
import { dmy, inr } from "@/common/utils/format";

// Investor page — the investor's details, one grouped action bar (Edit / Add investment / Delete) and the
// investments they hold.
export default function InvestorDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam) || 0;
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canCreate = can("Investment_Management", "can_create_investment");
  const canEdit = can("Investment_Management", "can_update_investment");
  const canDelete = can("Investment_Management", "can_delete_investment");
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const investor = useQuery({ queryKey: ["investor", String(id)], queryFn: () => getInvestor(id), enabled: id > 0 });
  const inv = investor.data;
  const list = useServerList<Investment, { customerId: number }>({
    key: ["investments", "byInvestor", id],
    filters: { customerId: id },
    fetchPage: (p) => listInvestmentsPage({ ...p, customerId: id }),
    enabled: id > 0,
  });

  const remove = useMutation({
    mutationFn: () => hardDeleteInvestor(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      toast.success("Investor deleted permanently");
      router.back();
    },
    onError: (e) => setDeleteError(e instanceof ApiError ? e.message : "Could not delete the investor — try again."),
  });

  const actions: GroupAction[] = [
    ...(canEdit ? [{ key: "edit", label: "Edit investor", icon: "edit" as const, onPress: () => setEditOpen(true) }] : []),
    ...(canCreate ? [{ key: "add", label: "Add investment", icon: "plus" as const, onPress: () => setAddOpen(true) }] : []),
    ...(canDelete ? [{ key: "delete", label: "Delete", icon: "alert" as const, danger: true, onPress: () => { setDeleteError(null); setDeleteOpen(true); } }] : []),
  ];

  const header = inv ? (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <FieldGrid
        style={{ marginBottom: 14 }}
        items={[
          { k: "Code", v: inv.code },
          { k: "Phone", v: inv.phone || "—" },
          { k: "Branch", v: inv.branch?.name || "—" },
          { k: "PAN", v: inv.pan || "—" },
          { k: "Aadhaar", v: inv.aadhaarLast4 ? `XXXX XXXX ${inv.aadhaarLast4}` : "—" },
          { k: "Address", v: inv.address || "—" },
          { k: "Bank holder", v: inv.bankAccountName || "—" },
          { k: "Bank account", v: inv.bankAccountNumber || "—" },
          { k: "IFSC", v: inv.bankIfsc || "—" },
        ]}
      />
      <ActionGroup actions={actions} style={{ marginBottom: 6 }} />
      <SectionTitle flush style={{ marginTop: 8 }}>Investments</SectionTitle>
    </View>
  ) : null;

  let body: React.ReactNode;
  if (investor.isLoading) body = <Buffering block />;
  else if (investor.isError || !inv) body = <EmptyText>{loadErrorText(investor.error) ?? "This investor no longer exists."}</EmptyText>;
  else
    body = (
      <ServerFlatList
        list={list}
        items={list.items}
        gutter={16}
        header={header}
        emptyText="No investments yet."
        keyOf={(i) => String(i.id)}
        renderItem={(i) => (
          <AccRow
            id={i.investmentNumber}
            name={i.plan?.name ?? "—"}
            amount={inr(i.principalAmount)}
            status={i.status}
            details={[
              { k: "Start", v: dmy(i.startDate) },
              { k: "Maturity", v: dmy(i.maturityDate) },
            ]}
            actions={[{ label: "View", primary: true, onPress: () => router.push(`/investments/${i.id}` as never) }]}
          />
        )}
      />
    );

  return (
    <Screen header={<FlatHeader back title={inv ? inv.name : "Investor"} subtitle="Investor details" />}>
      {body}
      {inv ? (
        <>
          <InvestorFormSheet visible={editOpen} onClose={() => setEditOpen(false)} investor={inv} />
          <CreateInvestmentSheet
            visible={addOpen}
            presetCustomer={inv}
            onClose={() => setAddOpen(false)}
            onCreated={(created) => {
              setAddOpen(false);
              router.push(`/investments/${created.id}` as never);
            }}
          />
          <ConfirmSheet
            visible={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete Investor Permanently"
            danger
            message={`Permanently delete ${inv.name}? This cannot be undone. It is refused while any investment is still on file — close and delete those first.`}
            confirmLabel="Delete Permanently"
            loading={remove.isPending}
            error={deleteError}
            onConfirm={() => remove.mutate()}
          />
        </>
      ) : null}
    </Screen>
  );
}
