import React, { useMemo, useState } from "react";
import { ScrollView, RefreshControl, View, Pressable, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { GoldDatePicker } from "../../../src/components/GoldDatePicker";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { BottomSheetModal } from "../../../src/components/BottomSheetModal";
import { colors } from "../../../src/theme/colors";
import { getScheme, toggleSchemeActive, updateScheme, type SchemeInput } from "../../../src/api/schemes";
import { listLoansPage } from "../../../src/api/loans";
import { downloadSchemeStatement, previewSchemeStatementPdf } from "../../../src/utils/schemeStatement";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ApiError } from "../../../src/api/client";

// Mirrors new.tsx's own METHODS list (frontend/components/modals/
// SchemeModal.tsx's fixed options, ported as a ChipSelect there too).
const METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly"] as const;

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SchemeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const schemeId = Number(id);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["scheme", id],
    queryFn: () => getScheme(schemeId),
    enabled: !!id,
  });

  useRefetchOnFocus(refetch);

  const toggle = useMutation({
    mutationFn: () => toggleSchemeActive(schemeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheme", id] });
      queryClient.invalidateQueries({ queryKey: ["schemes"] });
    },
  });

  // Edit — updateScheme() was already implemented in src/api/schemes.ts and
  // called from nowhere; this screen only ever toggled active/inactive.
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editInterestRate, setEditInterestRate] = useState("");
  const [editDurationMonths, setEditDurationMonths] = useState("");
  const [editLtvPercent, setEditLtvPercent] = useState("");
  const [editMethod, setEditMethod] = useState<(typeof METHODS)[number]>(METHODS[0]);
  const [editPenalRate, setEditPenalRate] = useState("");
  const [editConditions, setEditConditions] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit() {
    if (!data) return;
    setEditName(data.name);
    setEditInterestRate(String(data.interestRate));
    setEditDurationMonths(String(data.durationMonths));
    setEditLtvPercent(String(data.ltvPercent));
    setEditMethod((METHODS as readonly string[]).includes(data.interestMethod ?? "") ? (data.interestMethod as (typeof METHODS)[number]) : METHODS[0]);
    setEditPenalRate(data.penalRate != null ? String(data.penalRate) : "");
    setEditConditions(data.conditions ?? "");
    setEditError(null);
    setEditOpen(true);
  }

  const saveEdit = useMutation({
    mutationFn: () => {
      const input: SchemeInput = {
        name: editName,
        branchId: data!.branchId,
        interestRate: Number(editInterestRate),
        durationMonths: Number(editDurationMonths),
        ltvPercent: Number(editLtvPercent),
        interestMethod: editMethod,
        penalRate: editPenalRate ? Number(editPenalRate) : undefined,
        conditions: editConditions.trim() || undefined,
        isActive: data!.isActive,
      };
      return updateScheme(schemeId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheme", id] });
      queryClient.invalidateQueries({ queryKey: ["schemes"] });
      setEditOpen(false);
    },
    onError: (err) => setEditError(err instanceof ApiError ? err.message : "Could not save."),
  });

  // Download Statement — a bottom sheet with the same date-range + loan
  // filters as the web Schemes page's SchemeStatementModal, downloading
  // from the same GET /schemes/:id/statement endpoint (see
  // src/utils/schemeStatement.ts) rather than re-building PDF/xlsx on-device.
  const [statementOpen, setStatementOpen] = useState(false);
  const [stmtFrom, setStmtFrom] = useState(firstOfMonth());
  const [stmtTo, setStmtTo] = useState(today());
  const [selectedLoanIds, setSelectedLoanIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | null>(null);

  const loansQuery = useQuery({
    queryKey: ["scheme-loans", schemeId, stmtFrom, stmtTo],
    queryFn: () => listLoansPage({ schemeId, from: stmtFrom, to: stmtTo, limit: 50, offset: 0 }),
    enabled: statementOpen,
  });
  const loans = loansQuery.data?.items ?? [];
  const totalCollected = useMemo(
    () => loans.reduce((sum, l) => sum + (l.payments ?? []).reduce((s, p) => s + p.amount, 0), 0),
    [loans]
  );

  function toggleLoan(id: number) {
    setSelectedLoanIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const currentFilters = {
    from: stmtFrom,
    to: stmtTo,
    loanIds: selectedLoanIds.size ? Array.from(selectedLoanIds) : undefined,
  };

  async function handleDownload(format: "pdf" | "xlsx") {
    setDownloading(format);
    try {
      await downloadSchemeStatement(schemeId, format, currentFilters);
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not download statement.");
    } finally {
      setDownloading(null);
    }
  }

  // Opens the PDF straight in the native print-preview dialog — no share
  // target to pick first, just the document itself (see
  // schemeStatement.ts's previewSchemeStatementPdf doc comment). PDF only,
  // same as the web modal's own preview.
  const [previewing, setPreviewing] = useState(false);
  async function handlePreview() {
    setPreviewing(true);
    try {
      await previewSchemeStatementPdf(schemeId, currentFilters);
    } catch (e) {
      Alert.alert("Preview failed", e instanceof Error ? e.message : "Could not open a preview.");
    } finally {
      setPreviewing(false);
    }
  }

  const allLoanIdsSelected = loans.length > 0 && loans.every((l) => selectedLoanIds.has(l.id));
  function toggleSelectAll() {
    setSelectedLoanIds(allLoanIdsSelected ? new Set() : new Set(loans.map((l) => l.id)));
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : isError || !data ? (
          <ThemedText color={colors.red}>Could not load this scheme.</ThemedText>
        ) : (
          <>
            <Card>
              <ThemedText variant="h2" color={colors.goldDeep}>
                {data.name}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
                {data.code}
              </ThemedText>
              <ThemedText variant="body" style={{ marginTop: 12 }}>
                Interest {data.interestRate}% · {data.durationMonths} months · LTV {data.ltvPercent}%
              </ThemedText>
              {data.conditions ? (
                <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
                  {data.conditions}
                </ThemedText>
              ) : null}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <GoldButton title="Edit" variant="outline" onPress={openEdit} />
                </View>
                <View style={{ flex: 1 }}>
                  <GoldButton
                    title={data.isActive ? "Deactivate" : "Activate"}
                    variant="outline"
                    onPress={() => toggle.mutate()}
                    loading={toggle.isPending}
                  />
                </View>
              </View>
              <GoldButton
                title="Download Statement"
                variant="outline"
                onPress={() => setStatementOpen(true)}
                style={{ marginTop: 8 }}
              />
            </Card>
          </>
        )}
      </ScrollView>
      </View>

      <BottomSheetModal visible={statementOpen} onClose={() => setStatementOpen(false)}>
        <ThemedText variant="h3" style={{ marginBottom: 12 }}>
          Download Statement
        </ThemedText>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <GoldDatePicker label="From" value={stmtFrom} onChange={setStmtFrom} max={stmtTo} />
          </View>
          <View style={{ flex: 1 }}>
            <GoldDatePicker label="To" value={stmtTo} onChange={setStmtTo} min={stmtFrom} max={today()} />
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, marginBottom: 4 }}>
          <ThemedText variant="small" color={colors.muted} style={{ flex: 1 }}>
            Loans {selectedLoanIds.size > 0 ? `(${selectedLoanIds.size} selected)` : "(all loans in range)"}
          </ThemedText>
          {loans.length > 0 ? (
            <Pressable onPress={toggleSelectAll} hitSlop={6}>
              <ThemedText variant="label" color={colors.goldDeep}>
                {allLoanIdsSelected ? "Clear all" : "Select all"}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
        {loansQuery.isLoading ? (
          <ThemedText color={colors.muted}>Loading loans…</ThemedText>
        ) : loans.length === 0 ? (
          <ThemedText color={colors.muted}>No loans opened under this scheme in that range.</ThemedText>
        ) : (
          <ScrollView style={{ maxHeight: 220 }}>
            {loans.map((l) => (
              <Pressable
                key={l.id}
                onPress={() => toggleLoan(l.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                }}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    borderWidth: 1.5,
                    borderColor: colors.goldDeep,
                    marginRight: 10,
                    backgroundColor: selectedLoanIds.has(l.id) ? colors.goldDeep : "transparent",
                  }}
                />
                <ThemedText style={{ flex: 1 }}>
                  {l.loanNumber} — {l.customer?.name ?? "—"}
                </ThemedText>
                <ThemedText color={colors.muted}>₹{l.principalAmount.toLocaleString("en-IN")}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {loans.length > 0 ? (
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: 10 }}>
            {loans.length} loan{loans.length === 1 ? "" : "s"} · ₹{totalCollected.toLocaleString("en-IN")} collected in range
          </ThemedText>
        ) : null}

        <GoldButton
          title={previewing ? "Opening…" : "Preview PDF"}
          variant="outline"
          onPress={handlePreview}
          disabled={previewing || downloading !== null}
          style={{ marginTop: 16 }}
        />
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <GoldButton
              title={downloading === "xlsx" ? "Preparing…" : "Excel"}
              variant="outline"
              onPress={() => handleDownload("xlsx")}
              disabled={downloading !== null || previewing}
            />
          </View>
          <View style={{ flex: 1 }}>
            <GoldButton
              title={downloading === "pdf" ? "Preparing…" : "PDF"}
              onPress={() => handleDownload("pdf")}
              disabled={downloading !== null || previewing}
            />
          </View>
        </View>
      </BottomSheetModal>

      <BottomSheetModal visible={editOpen} onClose={() => setEditOpen(false)}>
        <ThemedText variant="h3" style={{ marginBottom: 12 }}>
          Edit Scheme
        </ThemedText>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
          <GoldTextInput label="Name" value={editName} onChangeText={setEditName} />
          <GoldTextInput label="Interest rate (% p.a.)" keyboardType="numeric" value={editInterestRate} onChangeText={setEditInterestRate} />
          <GoldTextInput label="Duration (months)" keyboardType="numeric" value={editDurationMonths} onChangeText={setEditDurationMonths} />
          <GoldTextInput label="LTV (%)" keyboardType="numeric" value={editLtvPercent} onChangeText={setEditLtvPercent} />
          <ChipSelect label="Interest calculation method" options={METHODS} value={editMethod} onChange={setEditMethod} />
          <GoldTextInput label="Penal charges (% / month)" keyboardType="numeric" value={editPenalRate} onChangeText={setEditPenalRate} />
          <GoldTextInput label="Applicable conditions" value={editConditions} onChangeText={setEditConditions} />
          {editError ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {editError}
            </ThemedText>
          ) : null}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <GoldButton title="Cancel" variant="outline" onPress={() => setEditOpen(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <GoldButton
              title="Save"
              onPress={() => saveEdit.mutate()}
              loading={saveEdit.isPending}
              disabled={!editName || !editInterestRate || !editDurationMonths || !editLtvPercent}
            />
          </View>
        </View>
      </BottomSheetModal>
    </ScreenContainer>  );
}
