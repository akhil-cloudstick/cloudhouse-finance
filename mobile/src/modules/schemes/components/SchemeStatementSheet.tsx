import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AccBtn, Buffering, BtnRow2, C, CheckItem, DateField, EmptyText, FieldRow, PrimaryButton, Sheet, StatusChip, Txt, toast } from "@/common/components/ui";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { downloadSchemeStatement, type StatementFilters } from "@/modules/schemes/utils/schemeStatement";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";

// ---------------------------------------------------------------------------
// Download Statement (prototype #scheme-statement-modal). The file itself is
// built by the backend (GET /schemes/:id/statement, src/modules/schemes/utils/schemeStatement.ts)
// from every loan in range — nothing is assembled on the phone. The optional
// loan picker below pages loans in range from the server 10 at a time.
// ---------------------------------------------------------------------------

const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;
const PAGE = 10;
type SchemeStatementSheetProps = { visible: boolean; onClose: () => void; scheme: Scheme | null };

export function SchemeStatementSheet({ visible, onClose, scheme }: SchemeStatementSheetProps) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFrom(firstOfMonth());
    setTo(todayISO());
    setSelected(new Set());
    setBusy(null);
  }, [visible, scheme?.id]);
  useEffect(() => setSelected(new Set()), [from, to]);

  const schemeId = scheme?.id ?? 0;
  const loans = useInfiniteQuery({
    queryKey: ["scheme-loans", schemeId, from, to],
    enabled: visible && !!scheme,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listLoansPage({ schemeId, from: from || undefined, to: to || undefined, limit: PAGE, offset: pageParam as number }),
    getNextPageParam: (last, all) => (last?.hasMore ? all.length * PAGE : undefined),
  });
  const rows = loans.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const total = loans.data?.pages[0]?.total;

  // The preview shows exactly what the download will contain: only the picked loans (all loaded when none picked).
  const shown = rows.filter((l) => selected.size === 0 || selected.has(l.id));
  const paymentCount = shown.reduce((n, l) => n + (l.payments?.length ?? 0), 0);
  const totalCollected = shown.reduce((n, l) => n + (l.payments ?? []).reduce((a, p) => a + p.amount, 0), 0);
  const totalOutstanding = shown.reduce((n, l) => n + (l.totalOutstandingBalance ?? 0), 0);

  const filters: StatementFilters = {
    from: from || undefined,
    to: to || undefined,
    loanIds: selected.size ? Array.from(selected) : undefined,
  };

  async function run(kind: "pdf" | "xlsx") {
    if (!scheme) return;
    setBusy(kind);
    try {
      await downloadSchemeStatement(scheme.id, kind, filters);
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", userMessage(e, "Could not download the statement — try again."));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allLoadedSelected = rows.length > 0 && rows.every((l) => selected.has(l.id));

  return (
    <Sheet visible={visible} onClose={onClose} title={`Download Statement — ${scheme?.name ?? ""}`} maxHeightPct={85}>
      <FieldRow>
        <DateField label="From date" value={from} onChange={setFrom} max={to || todayISO()} clearable />
        <DateField label="To date" value={to} onChange={setTo} min={from || undefined} max={todayISO()} clearable />
      </FieldRow>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Txt style={{ flex: 1, fontSize: 11.5, fontWeight: "600", color: C.muted }}>
          Loans {selected.size > 0 ? `(${selected.size} selected)` : `(all${total != null ? ` ${total}` : ""} in range)`}
        </Txt>
        {rows.length > 0 ? (
          <Pressable hitSlop={6} onPress={() => setSelected(allLoadedSelected ? new Set() : new Set(rows.map((l) => l.id)))}>
            <Txt style={{ fontSize: 11.5, fontWeight: "700", color: C.brandDeep }}>{allLoadedSelected ? "Clear all" : "Select all"}</Txt>
          </Pressable>
        ) : null}
      </View>
      {loans.isLoading ? (
        <Buffering block />
      ) : rows.length === 0 ? (
        <EmptyText>No loans opened under this scheme in that range.</EmptyText>
      ) : (
        <>
          {rows.map((l) => (
            <CheckItem
              key={l.id}
              checked={selected.has(l.id)}
              onPress={() => toggle(l.id)}
              title={`${l.loanNumber} — ${l.customer?.name ?? "—"}`}
              sub={inr(l.principalAmount)}
            />
          ))}
          {loans.hasNextPage ? (
            <AccBtn
              label={loans.isFetchingNextPage ? "Loading…" : "Load more"}
              disabled={loans.isFetchingNextPage}
              onPress={() => loans.fetchNextPage()}
              style={{ flex: 0, marginBottom: 12 }}
            />
          ) : null}
        </>
      )}

      {shown.length > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <Txt style={{ fontSize: 11.5, fontWeight: "600", color: C.muted, marginBottom: 6 }}>
            Preview — {shown.length} loan{shown.length === 1 ? "" : "s"} · {paymentCount} payment{paymentCount === 1 ? "" : "s"} in range
          </Txt>
          {shown.map((l) => (
            <View key={l.id} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
              <View style={{ flexDirection: "row", alignItems: "center", padding: 10, gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontSize: 13, fontWeight: "800" }}>{l.loanNumber}</Txt>
                  <Txt style={{ fontSize: 11.5, color: C.muted }}>{l.customer?.name ?? "—"} · Opened {dmy(l.openedDate)} · {inr(l.principalAmount)}</Txt>
                </View>
                <StatusChip label={l.status} />
              </View>
              {(l.payments ?? []).length === 0 ? (
                <Txt style={{ fontSize: 12, color: C.muted, paddingHorizontal: 10, paddingBottom: 8 }}>No payments in this range.</Txt>
              ) : (
                (l.payments ?? []).map((p) => (
                  <View key={p.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 10, paddingVertical: 7 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Txt style={{ fontSize: 12.5, fontWeight: "700" }}>{dmy(p.paidOn)} — {p.type}</Txt>
                      <Txt style={{ fontSize: 12.5, fontWeight: "800" }}>{inr(p.amount)}</Txt>
                    </View>
                    <Txt style={{ fontSize: 11, color: C.muted }}>
                      Interest {inr(p.interestApplied)} · Principal {inr(p.principalApplied)} · Balance {inr(p.runningBalance)}
                    </Txt>
                  </View>
                ))
              )}
            </View>
          ))}
          <Txt style={{ fontSize: 12.5, color: C.muted }}>
            Statement total <Txt style={{ fontWeight: "800", color: C.ink }}>{inr(totalCollected)}</Txt> collected · <Txt style={{ fontWeight: "800", color: C.ink }}>{inr(totalOutstanding)}</Txt> outstanding
          </Txt>
        </View>
      ) : null}

      <BtnRow2>
        <PrimaryButton label="Download Excel" variant="outline" onPress={() => run("xlsx")} loading={busy === "xlsx"} disabled={busy !== null} />
        <PrimaryButton label="Download PDF" onPress={() => run("pdf")} loading={busy === "pdf"} disabled={busy !== null} />
      </BtnRow2>
    </Sheet>
  );
}
