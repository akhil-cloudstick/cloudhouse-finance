import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { ThemedText } from "../../src/components/ThemedText";
import { BottomSheetModal, SheetScrollView } from "../../src/components/BottomSheetModal";
import { FilterSheetButton } from "../../src/components/FilterSheetButton";
import { colors, statusColors } from "../../src/theme/colors";
import { listLoanRequestsPage, getLoan } from "../../src/api/loans";
import {
  printReleaseAgreementPdf,
  printPartialReleaseReceiptPdf,
  RELEASE_AGREEMENT_LANGS,
  DOC_LANG_LABELS,
  type DocLang,
} from "../../src/utils/loanPrint";
import { ApiError } from "../../src/api/client";
import { LoanRequest } from "../../src/types/loan";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { ExpandableTable, type TableColumn } from "../../src/components/ExpandableTable";
import { ExtensionReviewPanel } from "../../src/components/loanRequests/ExtensionReviewPanel";
import { ReleaseReviewPanel } from "../../src/components/loanRequests/ReleaseReviewPanel";
import { useAuth } from "../../src/auth/AuthContext";
import { GoldButton } from "../../src/components/GoldButton";

const PAGE_SIZE = 10;

// "All" sends no status param at all — mirrors frontend/modules/loans/
// components/Requests.tsx's STATUS_OPTIONS.
const STATUS_FILTERS = ["All", "Pending", "Approved", "Rejected"] as const;

function toneForStatus(status: string): "green" | "red" | "amber" | "info" | "muted" {
  if (status === "Approved") return "green";
  if (status === "Rejected") return "red";
  if (status === "Pending") return "amber";
  return "muted";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusColors(toneForStatus(status));
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {status}
    </ThemedText>
  );
}

function TypePill({ type }: { type: "Extension" | "Release" }) {
  const tone = statusColors(type === "Extension" ? "info" : "amber");
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {type}
    </ThemedText>
  );
}

const REQUEST_COLUMNS: TableColumn<LoanRequest>[] = [
  // First four show on the row card (2×2); Request # stays in the expanded strip.
  { key: "loan", label: "Loan", render: (r) => r.loan?.loanNumber ?? `#${r.loanId}`, weight: 1 },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
  { key: "type", label: "Type", render: (r) => <TypePill type={r.type} />, weight: 0.9 },
  { key: "customer", label: "Customer", render: (r) => r.loan?.customer?.name ?? "—", weight: 1.2 },
  { key: "id", label: "Request", render: (r) => `#${r.id}`, weight: 0.7 },
];
const REQUEST_VISIBLE_COUNT = 4;

function requestExtraFields(
  r: LoanRequest,
  onDownload: (r: LoanRequest, lang: DocLang | "partial") => void,
  downloading: string | null
) {
  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Detail", value: r.detail || "—" },
    { label: "Date", value: r.requestedAt ? r.requestedAt.slice(0, 10) : "—" },
  ];
  // Lets an Approved release row's document be re-downloaded right from
  // this list, without navigating to Loan Detail first — mirrors web
  // frontend/modules/loans/components/Requests.tsx's downloadReleaseAgreement.
  if (r.type === "Release" && r.status === "Approved") {
    // Partial releases only have the backend's English receipt; full ones
    // get one button per FORM 7 language.
    const langs: (DocLang | "partial")[] = r.isPartial ? ["partial"] : RELEASE_AGREEMENT_LANGS;
    fields.push({
      label: "Document",
      value: (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {langs.map((lang) => (
            <GoldButton
              key={lang}
              title={downloading === `${r.id}-${lang}` ? "Preparing…" : lang === "partial" ? "Download" : DOC_LANG_LABELS[lang]}
              variant="outline"
              onPress={() => onDownload(r, lang)}
              disabled={downloading !== null}
              style={{ height: 32, paddingHorizontal: 12, alignSelf: "flex-start" }}
            />
          ))}
        </View>
      ),
    });
  }
  return fields;
}

/* Standalone "Loan Extensions & Gold Release" list — mirrors frontend/
 * modules/loans/components/Requests.tsx: every Extension/Release request
 * across every loan, filterable by status, reviewed (full checklist/
 * payment/approve-reject, not just a link out to the loan) from a sheet
 * raised right here — ExtensionReviewPanel/ReleaseReviewPanel are the same
 * components the loan detail screen's own Extension/Release cards use, so
 * there's exactly one implementation of that review logic either way. */
export default function RequestsScreen() {
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  // Holds just the id, not a snapshot of the row — `selected` below is
  // derived live from `requests` every render, so the sheet keeps showing
  // this request's CURRENT stage/checklist/status after a save invalidates
  // and refetches the list, instead of freezing on whatever it looked like
  // the moment it was tapped (which would make a multi-stage approval look
  // like nothing happened after each step).
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // "<requestId>-<lang>" of the document being fetched.
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["loanRequests", "list", statusFilter],
    queryFn: ({ pageParam = 0 }) =>
      listLoanRequestsPage({
        status: statusFilter === "All" ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const requests = data?.pages.flatMap((p) => p.items) ?? [];
  const selected = requests.find((r) => r.id === selectedId) ?? null;

  // Only fetched while a Release request's review sheet is actually open —
  // ReleaseReviewPanel needs the loan's live outstanding balance, which this
  // list's own rows don't carry. Extension review needs no such fetch.
  const loanForSelected = useQuery({
    queryKey: ["loan", "for-request-review", selected?.loanId],
    queryFn: () => getLoan(selected!.loanId),
    enabled: !!selected && selected.type === "Release",
  });

  async function downloadReleaseAgreement(r: LoanRequest, lang: DocLang | "partial") {
    if (downloading) return;
    setDownloading(`${r.id}-${lang}`);
    setSheetError(null);
    try {
      if (lang === "partial") await printPartialReleaseReceiptPdf(r.id);
      else await printReleaseAgreementPdf(r.loanId, r.loan?.loanNumber ?? String(r.loanId), lang);
    } catch (err) {
      setSheetError(err instanceof ApiError ? err.message : "Could not download the Release Agreement — try again.");
    } finally {
      setDownloading(null);
    }
  }

  function refreshAfterSave() {
    // Both this list's own pages and the loan detail screen's per-loan
    // ["loanRequests", loanId] query share the "loanRequests" prefix —
    // invalidateQueries matches by prefix, so this refreshes either place a
    // request might also be showing. ["loan", ...] covers the outstanding
    // balance shown inside ReleaseReviewPanel above.
    queryClient.invalidateQueries({ queryKey: ["loanRequests"] });
    queryClient.invalidateQueries({ queryKey: ["loan"] });
  }

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<LoanRequest>
          headerContent={
            <View style={{ marginTop: 28, marginBottom: 12 }}>
              <FilterSheetButton options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
              {/* Row downloads fail with no sheet open — show it here. */}
              {!selected && sheetError ? (
                <ThemedText variant="small" color={colors.red} style={{ marginTop: 8 }}>
                  {sheetError}
                </ThemedText>
              ) : null}
            </View>
          }
          columns={REQUEST_COLUMNS}
          visibleCount={REQUEST_VISIBLE_COUNT}
          data={requests}
          keyExtractor={(r) => String(r.id)}
          extraFields={(r) => requestExtraFields(r, downloadReleaseAgreement, downloading)}
          onViewDescription={(r) => setSelectedId(r.id)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load requests." : "No extension or release requests yet."}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>

      <BottomSheetModal
        visible={!!selected}
        onClose={() => {
          setSelectedId(null);
          setSheetError(null);
        }}
        maxHeightPct={90}
      >
        {selected ? (
          <SheetScrollView showsVerticalScrollIndicator={false}>
            <ThemedText variant="h3" color={colors.brandDeep} style={{ marginBottom: 4 }}>
              {selected.type === "Extension" ? "Review Extension" : "Review Release"} — {selected.loan?.loanNumber ?? `#${selected.loanId}`}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 14 }}>
              {selected.loan?.customer?.name ?? "Customer"}
              {!canDecide ? " · view only — you don't have permission to act on requests" : ""}
            </ThemedText>
            {sheetError ? (
              <ThemedText variant="small" color={colors.red} style={{ marginBottom: 10 }}>
                {sheetError}
              </ThemedText>
            ) : null}
            {selected.type === "Extension" ? (
              <ExtensionReviewPanel
                request={selected}
                onSaved={() => {
                  setSheetError(null);
                  refreshAfterSave();
                }}
                onError={setSheetError}
              />
            ) : loanForSelected.isLoading ? (
              <ThemedText color={colors.muted}>Loading loan financials…</ThemedText>
            ) : loanForSelected.data ? (
              <ReleaseReviewPanel
                request={selected}
                loan={loanForSelected.data}
                onSaved={() => {
                  setSheetError(null);
                  refreshAfterSave();
                  loanForSelected.refetch();
                }}
                onError={setSheetError}
              />
            ) : (
              <ThemedText color={colors.red}>Could not load this loan's financials.</ThemedText>
            )}
          </SheetScrollView>
        ) : null}
      </BottomSheetModal>
    </ScreenContainer>
  );
}
