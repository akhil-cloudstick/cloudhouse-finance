import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccBtn, C, EmptyText, Sheet, Txt } from "@/common/components/ui";
import { deleteDraft, listDrafts } from "@/modules/loans/services/loanService";
import type { LoanDraft } from "@/modules/loans/types/loan-types";

type LoanDraftsSheetProps = { visible: boolean; onClose: () => void; onOpen: (draft: LoanDraft) => void };

/** The employee's saved half-entered loans (web's "Saved drafts"). Opening one resumes it in the New Loan sheet. */
export function LoanDraftsSheet({ visible, onClose, onOpen }: LoanDraftsSheetProps) {
  const qc = useQueryClient();
  const drafts = useQuery({ queryKey: ["loan-drafts"], queryFn: listDrafts, enabled: visible });
  const discard = useMutation({
    mutationFn: (id: number) => deleteDraft(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loan-drafts"] }),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Draft loans" maxHeightPct={70}>
      {drafts.isLoading ? <EmptyText>Loading drafts…</EmptyText> : null}
      {!drafts.isLoading && !(drafts.data?.length ?? 0) ? <EmptyText>No saved drafts.</EmptyText> : null}
      {(drafts.data ?? []).map((d) => (
        <View key={d.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Txt style={{ fontSize: 13, fontWeight: "600" }}>
            {d.customer?.name ?? "No customer yet"} · {d.ornaments.length} ornament{d.ornaments.length === 1 ? "" : "s"}
          </Txt>
          <Txt style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{[d.scheme?.name, d.branch?.name].filter(Boolean).join(" · ") || `Saved ${d.updatedAt.slice(0, 10)}`}</Txt>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AccBtn
              label="Open"
              onPress={() => {
                onClose();
                onOpen(d);
              }}
            />
            <AccBtn label="Discard" onPress={() => discard.mutate(d.id)} />
          </View>
        </View>
      ))}
    </Sheet>
  );
}
