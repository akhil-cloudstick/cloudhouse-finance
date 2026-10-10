import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { AccBtn, Buffering, BtnRow2, C, CheckItem, DateField, EmptyText, Field, FieldRow, Input, PrimaryButton, ResultBox, Sheet, Txt, toast } from "@/common/components/ui";
import { useDebouncedValue } from "@/common/hooks/use-debounced-value";
import { calculateSchemeEligibility } from "@/modules/schemes/services/schemeService";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { downloadSchemeStatement, previewSchemeStatementPdf, type StatementFilters } from "@/modules/schemes/utils/schemeStatement";
import { inr, todayISO } from "@/common/utils/format";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { num } from "./SchemeSheet";

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
  const [goldWeight, setGoldWeight] = useState("");
  const [goldRate, setGoldRate] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"pdf" | "xlsx" | "preview" | null>(null);
  const [eligible, setEligible] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFrom(firstOfMonth());
    setTo(todayISO());
    setGoldWeight("");
    setGoldRate("");
    setSelected(new Set());
    setBusy(null);
    setEligible(null);
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

  // Eligibility for the entered weight × rate (the old scheme screen's
  // calculator, now folded into this sheet like the prototype).
  const w = Number(useDebouncedValue(goldWeight));
  const r = Number(useDebouncedValue(goldRate));
  const calc = useMutation({
    mutationFn: () => calculateSchemeEligibility(schemeId, w, r),
    onSuccess: (res) => setEligible(res.eligibleAmount),
    onError: () => setEligible(null),
  });
  useEffect(() => {
    if (visible && scheme && w > 0 && r > 0) calc.mutate();
    else setEligible(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, r, visible, scheme?.id]);

  const filters: StatementFilters = {
    from: from || undefined,
    to: to || undefined,
    loanIds: selected.size ? Array.from(selected) : undefined,
    goldWeight: Number(goldWeight) || undefined,
    goldRate: Number(goldRate) || undefined,
  };

  async function run(kind: "pdf" | "xlsx" | "preview") {
    if (!scheme) return;
    setBusy(kind);
    try {
      if (kind === "preview") await previewSchemeStatementPdf(scheme.id, filters);
      else await downloadSchemeStatement(scheme.id, kind, filters);
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error(kind === "preview" ? "Preview failed" : "Download failed", userMessage(e, "Could not download the statement — try again."));
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
    <Sheet visible={visible} onClose={onClose} title={`Download Statement — ${scheme?.name ?? ""}`} maxHeightPct={70}>
      <FieldRow>
        <DateField label="From date" value={from} onChange={setFrom} max={to || todayISO()} clearable />
        <DateField label="To date" value={to} onChange={setTo} min={from || undefined} max={todayISO()} clearable />
      </FieldRow>
      <FieldRow>
        <Field label="Gold weight (g)">
          <Input placeholder="Optional — filter by weight" keyboardType="decimal-pad" value={goldWeight} onChangeText={(t) => setGoldWeight(num(t))} />
        </Field>
        <Field label="Gold rate (₹/g)">
          <Input placeholder="Optional — filter by rate" keyboardType="decimal-pad" value={goldRate} onChangeText={(t) => setGoldRate(num(t))} />
        </Field>
      </FieldRow>
      {calc.isPending ? <Buffering style={{ paddingVertical: 8 }} /> : eligible != null ? <ResultBox k="Eligible amount" v={inr(eligible)} /> : null}

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

      <PrimaryButton label="Preview PDF" variant="outline" onPress={() => run("preview")} loading={busy === "preview"} disabled={busy !== null} style={{ marginTop: 8, marginBottom: 10 }} />
      <BtnRow2>
        <PrimaryButton label="Export .xlsx" variant="outline" onPress={() => run("xlsx")} loading={busy === "xlsx"} disabled={busy !== null} />
        <PrimaryButton label="Download PDF" onPress={() => run("pdf")} loading={busy === "pdf"} disabled={busy !== null} />
      </BtnRow2>
    </Sheet>
  );
}
