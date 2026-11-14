import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { BtnRow2, Buffering, C, PrimaryButton, Sheet, Txt, WarningBanner, openPage } from "@/common/components/ui";
import { useCanOpen } from "@/common/config/routePermissions";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { listPersonalLoansForCustomer } from "@/modules/personal-loans/services/personalLoanService";
import type { Customer } from "@/modules/customers/types/customer-types";

// Permanent-delete confirmation that lists everything still in the way (web DeleteWithBlockersModalContent):
// open gold loans and personal loans as links (when the role may open them), re-checked on open and on Refresh,
// and re-checked right before deleting so a stale list can never let a blocked delete through.
type Blocker = { key: string; kind: string; ref: string; status?: string; path?: string };

type DeleteCustomerSheetProps = {
  visible: boolean;
  onClose: () => void;
  customer: Customer;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
};

export function DeleteCustomerSheet({ visible, onClose, customer: c, loading, error, onConfirm }: DeleteCustomerSheetProps) {
  const canOpen = useCanOpen();
  const canViewLoans = canOpen("/loans");
  const canViewPersonal = canOpen("/personal-loans");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (): Promise<Blocker[]> => {
    const [gold, personal] = await Promise.all([
      listLoansPage({ customerId: c.id, limit: 200, offset: 0 }).then((r) => r.items ?? []).catch(() => []),
      listPersonalLoansForCustomer(c.id).catch(() => []),
    ]);
    return [
      ...gold
        .filter((l) => l.status !== "Closed" && l.status !== "Rejected" && l.status !== "Auctioned")
        .map((l): Blocker => ({ key: `g${l.id}`, kind: "Gold loan", ref: l.loanNumber || String(l.id), status: l.status, path: canViewLoans ? `/loans/${l.id}` : undefined })),
      ...(personal ?? []).map((p): Blocker => ({ key: `p${p.id}`, kind: "Personal loan", ref: p.loanNumber, status: p.status, path: canViewPersonal ? `/personal-loans/${p.id}` : undefined })),
    ];
  }, [c.id, canViewLoans, canViewPersonal]);

  const q = useQuery({ queryKey: ["customer-delete-blockers", c.id], queryFn: load, enabled: visible, gcTime: 0, staleTime: 0, retry: false });
  useEffect(() => { if (visible) void q.refetch(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const blockers = q.data ?? [];
  const blocked = blockers.length > 0;

  async function confirm() {
    setChecking(true);
    try {
      const fresh = await load();
      if (fresh.length) { await q.refetch(); return; }
      onConfirm();
    } finally {
      setChecking(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Delete Customer Permanently" maxHeightPct={80}>
      <WarningBanner>{`This permanently deletes ${c.name} (${c.code}) and every record tied to them. This cannot be undone.`}</WarningBanner>
      {q.isError ? <Txt style={{ color: C.red, fontSize: 12.5, marginVertical: 8 }}>Could not check linked records.</Txt> : null}
      {q.isFetching && !q.data ? <Buffering block /> : null}
      {blocked ? (
        <View style={{ marginTop: 12 }}>
          <Txt style={{ color: C.red, fontWeight: "700", fontSize: 13, marginBottom: 4 }}>Linked records</Txt>
          <Txt style={{ color: C.red, fontSize: 12.5, marginBottom: 6 }}>Delete or close these first, then this can be deleted.</Txt>
          {blockers.map((b) => (
            <View key={b.key} style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 3 }}>
              <Txt style={{ color: C.red, fontSize: 13 }}>{b.kind} </Txt>
              {b.path ? (
                <Pressable onPress={() => { onClose(); openPage(b.path!); }} hitSlop={6}>
                  <Txt style={{ color: C.red, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" }}>{b.ref}</Txt>
                </Pressable>
              ) : (
                <Txt style={{ color: C.red, fontSize: 13, fontWeight: "700" }}>{b.ref}</Txt>
              )}
              {b.status ? <Txt style={{ color: C.red, fontSize: 13 }}> ({b.status})</Txt> : null}
            </View>
          ))}
        </View>
      ) : null}
      {!q.isFetching && !blocked && !q.isError ? <Txt style={{ marginTop: 10, fontSize: 12.5, color: C.muted }}>No linked records — safe to delete.</Txt> : null}
      {error ? <Txt style={{ color: C.red, fontSize: 12, fontWeight: "600", marginTop: 8 }}>{error}</Txt> : null}
      <View style={{ marginTop: 14 }}>
        <BtnRow2>
          <PrimaryButton label="Refresh" variant="outline" onPress={() => q.refetch()} disabled={loading || checking} />
          <PrimaryButton label="Delete Permanently" variant="danger" onPress={confirm} loading={loading || checking} disabled={q.isFetching || blocked} />
        </BtnRow2>
      </View>
    </Sheet>
  );
}
