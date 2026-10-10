import { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccGroup, AccRow, BtnRow2, C, Field, Input, PrimaryButton, Sheet, Txt, WarningBanner } from "@/common/components/ui";
import { ApiError } from "@/common/services/httpClient";
import { createBank, deleteBank, listBanks, updateBank } from "@/modules/banks/services/bankService";
import { useAuth } from "@/common/providers/AuthProvider";
import { useCanOpen } from "@/common/config/routePermissions";
import { openLedger } from "@/common/components/LedgerList";
import type { Bank } from "@/modules/banks/types/bank-types";

// Add to Bank Pledge (prototype #add-bank-pledge-modal) and Add Bank
// (#add-bank-modal). Add to Bank Pledge shares BankPledgeForm with the loan
// detail's own Bank Pledge sheet (BankPledgeSheet.tsx) — same fields, same
// payload, previously duplicated across both.

const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);
// Banks directory — list every bank with Edit/Delete, plus Add. One sheet
// switching between list / form / delete-confirm views rather than stacked
// sheets. Delete is a real hard delete; the backend refuses while the bank
// still has linked transactions or pledges, and that message is shown as-is.
type BanksView = { kind: "list" } | { kind: "form"; bank?: Bank } | { kind: "delete"; bank: Bank };
type BanksSheetProps = { visible: boolean; onClose: () => void };

export function BanksSheet({ visible, onClose }: BanksSheetProps) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canCreate = can("Bank_Management", "can_create_bank");
  const canUpdate = can("Bank_Management", "can_update_bank");
  const canDelete = can("Bank_Management", "can_delete_bank");
  // A bank's ledger is a Cash drill-down (web: /ledger-bank/:id).
  const canLedger = useCanOpen()("/cash");

  const [view, setView] = useState<BanksView>({ kind: "list" });
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setView({ kind: "list" });
  }, [visible]);

  const banks = useQuery({ queryKey: ["banks-all"], queryFn: () => listBanks(), enabled: visible });

  const refreshBanks = () => {
    qc.invalidateQueries({ queryKey: ["banks"] });
    qc.invalidateQueries({ queryKey: ["banks-all"] });
  };

  const openForm = (bank?: Bank) => {
    setName(bank?.name || "");
    setBranch(bank?.branch || "");
    setIfsc(bank?.ifsc || "");
    setAccountNo(bank?.accountNo || "");
    setPhone(bank?.phone || "");
    setError(null);
    setView({ kind: "form", bank });
  };

  const save = useMutation({
    mutationFn: (bank?: Bank) => {
      const input = {
        name: name.trim(),
        branch: branch.trim() || undefined,
        ifsc: ifsc.trim() || undefined,
        accountNo: accountNo.trim() || undefined,
        phone: phone.trim() || undefined,
      };
      return bank ? updateBank(bank.id, input) : createBank(input);
    },
    onSuccess: () => {
      refreshBanks();
      setView({ kind: "list" });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  const remove = useMutation({
    mutationFn: (bank: Bank) => deleteBank(bank.id),
    onSuccess: () => {
      refreshBanks();
      setView({ kind: "list" });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not delete the bank."),
  });

  if (view.kind === "form") {
    const editing = view.bank;
    return (
      <Sheet visible={visible} onClose={() => setView({ kind: "list" })} title={editing ? `Edit ${editing.name}` : "Add Bank"} maxHeightPct={80}>
        <Field label="Bank name *">
          <Input value={name} onChangeText={setName} placeholder="e.g. HDFC Bank" />
        </Field>
        <Field label="Branch">
          <Input value={branch} onChangeText={setBranch} placeholder="Bank branch" />
        </Field>
        <Field label="IFSC code">
          <Input value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase())} autoCapitalize="characters" placeholder="e.g. HDFC0001234" />
        </Field>
        <Field label="Account number">
          <Input value={accountNo} onChangeText={setAccountNo} placeholder="Branch account number" keyboardType="number-pad" />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChangeText={setPhone} placeholder="Bank contact number" keyboardType="phone-pad" />
        </Field>
        {errText(error)}
        <BtnRow2>
          <PrimaryButton label="Back" variant="outline" onPress={() => setView({ kind: "list" })} disabled={save.isPending} />
          <PrimaryButton label={editing ? "Save" : "Add Bank"} onPress={() => save.mutate(editing)} loading={save.isPending} disabled={name.trim().length < 2} />
        </BtnRow2>
      </Sheet>
    );
  }

  if (view.kind === "delete") {
    const bank = view.bank;
    return (
      <Sheet visible={visible} onClose={() => setView({ kind: "list" })} title="Delete Bank" maxHeightPct={55}>
        <View style={{ marginTop: 10 }}>
          <WarningBanner>{`Permanently delete "${bank.name}"? This can't be undone. If it's still linked to any transactions or pledges, deletion will be blocked.`}</WarningBanner>
        </View>
        {errText(error)}
        <BtnRow2>
          <PrimaryButton label="Back" variant="outline" onPress={() => setView({ kind: "list" })} disabled={remove.isPending} />
          <PrimaryButton label="Delete" variant="danger" onPress={() => remove.mutate(bank)} loading={remove.isPending} />
        </BtnRow2>
      </Sheet>
    );
  }

  const list = banks.data || [];
  return (
    <Sheet visible={visible} onClose={onClose} title="Banks" maxHeightPct={88}>
      {banks.isLoading ? (
        <Txt style={{ fontSize: 13, color: C.muted, marginTop: 12 }}>Loading banks…</Txt>
      ) : banks.isError ? (
        <Txt style={{ fontSize: 13, color: C.red, marginTop: 12 }}>Could not load banks.</Txt>
      ) : list.length === 0 ? (
        <Txt style={{ fontSize: 13, color: C.muted, marginTop: 12 }}>No banks yet.</Txt>
      ) : (
        <AccGroup>
          {list.map((b) => (
            <AccRow
              key={b.id}
              name={b.name}
              sub={b.branch || b.ifsc || undefined}
              details={[
                { k: "IFSC", v: b.ifsc || "—" },
                { k: "Account no", v: b.accountNo || "—" },
                { k: "Phone", v: b.phone || "—" },
              ]}
              actions={[
                ...(canLedger ? [{ label: "Ledger", onPress: () => { onClose(); openLedger("bank", b.id, b.name); } }] : []),
                ...(canUpdate ? [{ label: "Edit", onPress: () => openForm(b) }] : []),
                ...(canDelete ? [{ label: "Delete", danger: true, onPress: () => { setError(null); setView({ kind: "delete", bank: b }); } }] : []),
              ]}
            />
          ))}
        </AccGroup>
      )}
      {canCreate ? <PrimaryButton label="Add Bank" onPress={() => openForm()} /> : null}
    </Sheet>
  );
}
