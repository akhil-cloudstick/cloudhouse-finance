import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockerListSheet } from "@/common/components/BlockerListSheet";
import { AccRow, Buffering, ConfirmSheet, EmptyText, FabMenu, FieldGrid, FlatHeader, Screen, SectionTitle, ServerFlatList, toast, type FabMenuAction } from "@/common/components/ui";
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

// Investor page — the investor's details, one grouped corner button (Edit / Add investment / Delete) and the
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

  // Investments still on file block the delete — listed here (tap to open one) instead of failing after the tap.
  const BLOCKER_PAGE = 15;
  const blockers = useInfiniteQuery({
    queryKey: ["investments", "blockers", id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listInvestmentsPage({ customerId: id, limit: BLOCKER_PAGE, offset: pageParam as number }).then((r) => ({ items: r.items ?? [], total: r.total ?? (r.items ?? []).length, hasMore: !!r.hasMore })),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * BLOCKER_PAGE : undefined),
    enabled: deleteOpen && id > 0,
  });
  const blockerItems = blockers.data?.pages.flatMap((p) => p.items) ?? [];
  const blockerTotal = blockers.data?.pages[0]?.total ?? blockerItems.length;

  const remove = useMutation({
    mutationFn: () => hardDeleteInvestor(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      toast.success("Investor deleted permanently");
      router.back();
    },
    onError: (e) => setDeleteError(e instanceof ApiError ? e.message : "Could not delete the investor — try again."),
  });

  // One grouped corner button (bottom-right) holding Edit / Add investment / Delete.
  const actions: FabMenuAction[] = [
    ...(canEdit ? [{ label: "Edit Investor", icon: "edit", onPress: () => setEditOpen(true) }] : []),
    ...(canCreate ? [{ label: "Add Investment", icon: "plus", onPress: () => setAddOpen(true) }] : []),
    ...(canDelete ? [{ label: "Delete Investor", icon: "alert", onPress: () => { setDeleteError(null); setDeleteOpen(true); } }] : []),
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
    <Screen
      header={<FlatHeader back title={inv ? inv.name : "Investor"} subtitle="Investor details" />}
      floating={inv && actions.length ? <FabMenu label="Investor actions" actions={actions} /> : undefined}
    >
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
          <BlockerListSheet
            visible={deleteOpen && blockerItems.length > 0}
            onClose={() => setDeleteOpen(false)}
            message={`${inv.name} still holds ${blockerTotal} investment${blockerTotal === 1 ? "" : "s"}.`}
            items={blockerItems.map((b) => ({ key: String(b.id), title: b.investmentNumber, status: b.status, onPress: () => { setDeleteOpen(false); router.push(`/investments/${b.id}` as never); } }))}
            total={blockerTotal}
            hasMore={!!blockers.hasNextPage}
            loadingMore={blockers.isFetchingNextPage}
            onLoadMore={() => blockers.fetchNextPage()}
          />
          <ConfirmSheet
            visible={deleteOpen && !blockerItems.length}
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
