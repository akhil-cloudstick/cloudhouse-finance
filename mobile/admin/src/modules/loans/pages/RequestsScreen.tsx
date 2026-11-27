import { usePersistedState } from "@/common/hooks/use-persisted-state";
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AccRow,
  Buffering,
  C,
  GroupedFilter,
  emptyGroupedFilter,
  gfDate,
  gfValues,
  groupedFilterCount,
  type GFSection,
  type GroupedFilterValue,
  FlatHeader,
  Screen,
  SearchFilterRow,
  ServerFlatList,
  Sheet,
  SheetListItem,
  Txt,
} from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listLoanRequestsPage, getLoan } from "@/modules/loans/services/loanService";
import {
  printReleaseAgreementPdf,
  printPartialReleaseReceiptPdf,
  RELEASE_AGREEMENT_LANGS,
  DOC_LANG_LABELS,
  type DocLang,
} from "@/modules/loans/utils/loanPrint";
import { ApiError } from "@/common/services/httpClient";
import { dmy, todayISO } from "@/common/utils/format";
import { invalidateLoan } from "@/common/components/loanSheetKit";
import type { LoanRequest } from "@/modules/loans/types/loan-types";
import { useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import { ExtensionReviewPanel } from "@/modules/loans/components/ExtensionReviewPanel";
import { ReleaseReviewPanel } from "@/modules/loans/components/ReleaseReviewPanel";
import { useAuth } from "@/common/providers/AuthProvider";

// Requests (loan extensions, gold release) — prototype #header-requests +
// #page-requests + #request-filter-modal. Every request across every loan,
// searched (`q`) and filtered (`status`, `type`) server-side; "Review
// Request" raises the same review panels the loan detail screen uses.

// Status and type each take any number of ticked values; none ticked means no restriction.
const STATUSES = ["Pending", "Approved", "Rejected"] as const;
const TYPES = ["Extension", "Release"] as const;
type Filters = { status?: string; type?: string; from?: string; to?: string };
const FILTER_SECTIONS: GFSection[] = [
  { kind: "static", key: "status", label: "Status", options: STATUSES.map((v) => ({ value: v, label: v })) },
  { kind: "static", key: "type", label: "Type", options: TYPES.map((v) => ({ value: v, label: v })) },
  { kind: "date", key: "date", label: "Requested date" },
];

export default function RequestsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const params = useLocalSearchParams<{ requestId?: string; loanId?: string }>();

  const [fv, setFv] = usePersistedState<GroupedFilterValue>("requests:filters", emptyGroupedFilter());
  const status = gfValues(fv, "status");
  const type = gfValues(fv, "type");
  const { from, to } = gfDate(fv, "date");
  // Holds just the id — the sheet derives the request live from the list (or
  // the deep-link lookup) so it always shows the CURRENT stage after a save.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [downloadFor, setDownloadFor] = useState<LoanRequest | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const filters: Filters = { status: status.length ? status.join(",") : undefined, type: type.length ? type.map((t) => t.toLowerCase()).join(",") : undefined, from: from || undefined, to: to || undefined };
  const list = useServerList<LoanRequest, Filters>({ key: ["loanRequests", "list"], filters, fetchPage: (p) => listLoanRequestsPage(p) });

  // ?requestId=<id> (dashboard "Needs attention") opens that request's review.
  const deepId = params.requestId ? Number(params.requestId) : null;
  const deepLoanId = params.loanId ? Number(params.loanId) : undefined;
  useEffect(() => {
    if (deepId) setSelectedId(deepId);
  }, [deepId]);
  // There is no GET /loans/requests/:id — page through (server-side, 50 at a
  // time) until the request turns up, narrowed by loanId when provided.
  // Also used when the opened request drops out of the (status-filtered) list after an approve/reject,
  // so the open sheet keeps showing it (fresh from the server, or the last copy seen meanwhile).
  const fromList = selectedId != null ? (list.items.find((r) => r.id === selectedId) ?? null) : null;
  // Snapshot of the request as it was when opened (fallback until the fresh copy arrives).
  const [lastSeen, setLastSeen] = useState<LoanRequest | null>(null);
  const lookupLoanId = deepLoanId ?? (lastSeen && lastSeen.id === selectedId ? lastSeen.loanId : undefined);
  const deep = useQuery({
    queryKey: ["loanRequests", "deep", selectedId, lookupLoanId],
    enabled: selectedId != null && !fromList,
    queryFn: async () => {
      for (let offset = 0; offset < 1000; offset += 50) {
        const page = await listLoanRequestsPage({ loanId: lookupLoanId, limit: 50, offset });
        const hit = (page.items ?? []).find((r) => r.id === selectedId);
        if (hit) return hit;
        if (!page.hasMore) break;
      }
      return null;
    },
  });

  const selected = fromList ?? (selectedId != null && deep.data?.id === selectedId ? deep.data : null) ?? (selectedId != null && lastSeen?.id === selectedId ? lastSeen : null);

  // Release review needs the loan's live outstanding balance.
  const loanForSelected = useQuery({
    queryKey: ["loan", "for-request-review", selected?.loanId],
    queryFn: () => getLoan(selected!.loanId),
    enabled: !!selected,
  });

  useResetOnBlur(() => {
    setSelectedId(null);
    setSheetError(null);
    setDownloadFor(null);
  });

  function closeReview() {
    setSelectedId(null);
    setSheetError(null);
    if (params.requestId) router.setParams({ requestId: undefined, loanId: undefined } as never);
  }

  async function download(r: LoanRequest, lang: DocLang) {
    if (downloading) return;
    setDownloading(`${r.id}-${lang}`);
    setListError(null);
    try {
      if (r.isPartial) await printPartialReleaseReceiptPdf(r.id, lang);
      else await printReleaseAgreementPdf(r.loanId, r.loan?.loanNumber ?? String(r.loanId), lang);
      setDownloadFor(null);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Could not download the Release Agreement — try again.");
    } finally {
      setDownloading(null);
    }
  }

  function refreshAfterSave() {
    qc.invalidateQueries({ queryKey: ["loanRequests"] });
    qc.invalidateQueries({ queryKey: ["loan"] });
    if (selected) invalidateLoan(qc, selected.loanId);
  }

  const count = groupedFilterCount(fv);

  return (
    <Screen header={<FlatHeader title="Extension & Release" subtitle="Loan extensions & gold release" />}>
      <ServerFlatList stickyHeader
        list={list}
        items={list.items}
        keyOf={(r) => String(r.id)}
        emptyText={list.search || count ? "No requests match your search." : "No extension or release requests yet."}
        header={
          <>
            <SearchFilterRow
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search loan no, customer, phone"
              style={{ paddingTop: 12, paddingBottom: 14 }}
              filter={<GroupedFilter title="Filter requests" sections={FILTER_SECTIONS} value={fv} onChange={setFv} />}
            />
            {listError ? <Txt style={{ fontSize: 12, color: C.red, paddingHorizontal: 18, marginBottom: 10 }}>{listError}</Txt> : null}
          </>
        }
        renderItem={(r, i) => {
          const approvedRelease = r.type === "Release" && r.status === "Approved";
          const details =
            r.type === "Extension"
              ? [
                  { k: "Requested", v: r.requestedExtensionMonths ? `+${r.requestedExtensionMonths} month${r.requestedExtensionMonths === 1 ? "" : "s"}` : r.detail || "—" },
                  { k: "Date", v: dmy(r.requestedAt) },
                ]
              : approvedRelease
                ? [
                    { k: "Type", v: r.isPartial ? "Partial release" : "Full release" },
                    { k: "Document", v: `${r.isPartial ? "Receipt" : "Agreement"} (${RELEASE_AGREEMENT_LANGS.map((l) => l.toUpperCase()).join(" / ")})` },
                  ]
                : [
                    { k: "Type", v: r.isPartial ? "Partial release" : "Full release" },
                    { k: "Date", v: dmy(r.requestedAt) },
                  ];
          const paymentOverdue = !!r.paymentDueDate && r.status === "Pending" && !r.paymentRecorded && r.paymentDueDate.slice(0, 10) < todayISO();
          return (
            <AccRow
              // iPad and bigger: the same columns as the web Extension & Release table.
              cells={[
                { h: "Type", v: r.type, chip: true, tone: "info", sub: r.type === "Release" && r.isPartial ? "Partial" : undefined, flex: 0.9 },
                { h: "Loan", v: r.loan?.loanNumber ?? `#${r.loanId}`, flex: 0.9 },
                { h: "Customer", v: r.loan?.customer?.name ?? "—", flex: 1.3 },
                { h: "Detail", v: r.detail || "—", flex: 1.6 },
                { h: "Date", v: dmy(r.requestedAt) },
                { h: "Status", v: paymentOverdue ? "Payment Overdue" : r.status, chip: true, tone: paymentOverdue ? "overdue" : undefined },
              ]}
              defaultOpen={i === 0}
              id={r.loan?.loanNumber ?? `#${r.loanId}`}
              name={r.type}
              sub={r.loan?.customer?.name ?? "—"}
              status={paymentOverdue ? "Payment Overdue" : r.status}
              statusTone={paymentOverdue ? "overdue" : undefined}
              details={details}
              actions={
                approvedRelease
                  ? [
                      {
                        label: downloading?.startsWith(`${r.id}-`) ? "Preparing…" : "Download",
                        primary: true,
                        disabled: downloading !== null,
                        onPress: () => setDownloadFor(r),
                      },
                      { label: "View", onPress: () => { setLastSeen(r); setSelectedId(r.id); } },
                    ]
                  : [{ label: "Review Request", primary: true, onPress: () => { setLastSeen(r); setSelectedId(r.id); } }]
              }
            />
          );
        }}
      />

      <Sheet visible={!!downloadFor} onClose={() => setDownloadFor(null)} title={downloadFor?.isPartial ? "Partial Release Receipt" : "Release Agreement"} maxHeightPct={50}>
        {downloadFor
          ? RELEASE_AGREEMENT_LANGS.map((lang, i) => (
              <SheetListItem
                key={lang}
                first={i === 0}
                icon="doc"
                title={DOC_LANG_LABELS[lang]}
                sub={`${downloadFor.loan?.loanNumber ?? `#${downloadFor.loanId}`} · ${downloadFor.isPartial ? "partial release receipt" : "release agreement"}`}
                right={downloading === `${downloadFor.id}-${lang}` ? <Buffering style={{ paddingVertical: 0 }} /> : undefined}
                onPress={() => download(downloadFor, lang)}
              />
            ))
          : null}
        {listError ? <Txt style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{listError}</Txt> : null}
      </Sheet>

      <Sheet
        visible={selectedId != null}
        onClose={closeReview}
        title={selected ? `Review ${selected.type} — ${selected.loan?.loanNumber ?? `#${selected.loanId}`}` : "Review Request"}
        maxHeightPct={90}
      >
        {!selected ? (
          deep.isLoading || deep.isFetching ? (
            <Buffering block />
          ) : (
            <Txt style={{ fontSize: 12.5, color: C.muted, paddingVertical: 20 }}>This request could not be found.</Txt>
          )
        ) : (
          <>
            <Txt style={{ fontSize: 12, color: C.muted, marginTop: 8, marginBottom: 12 }}>
              {selected.loan?.customer?.name ?? "Customer"}
              {!canDecide ? " · view only — you don't have permission to act on requests" : ""}
            </Txt>
            {sheetError ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{sheetError}</Txt> : null}
            {selected.type === "Extension" ? (
              <ExtensionReviewPanel
                request={selected}
                loan={loanForSelected.data}
                onSaved={() => {
                  setSheetError(null);
                  refreshAfterSave();
                }}
                onError={setSheetError}
              />
            ) : loanForSelected.isLoading ? (
              <Buffering block />
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
              <Txt style={{ fontSize: 12.5, color: C.red }}>Could not load this loan&apos;s financials.</Txt>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
