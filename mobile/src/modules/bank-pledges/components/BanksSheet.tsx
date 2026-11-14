import { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccGroup, AccRow, AsyncSelect, BtnRow2, C, Field, Input, PrimaryButton, Sheet, Txt, WarningBanner } from "@/common/components/ui";
import { ApiError } from "@/common/services/httpClient";
import { createBank, deleteBank, listBanks, mergeBanks, updateBank } from "@/modules/banks/services/bankService";
import { useAuth } from "@/common/providers/AuthProvider";
import { useCanOpen } from "@/common/config/routePermissions";
import { openLedger } from "@/common/components/LedgerList";
import type { Bank } from "@/modules/banks/types/bank-types";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { balanceColor, fmtBalance } from "@/modules/banks/utils/bankBalance";

// Add to Bank Pledge (prototype #add-bank-pledge-modal) and Add Bank
// (#add-bank-modal). Add to Bank Pledge shares BankPledgeForm with the loan
// detail's own Bank Pledge sheet (BankPledgeSheet.tsx) — same fields, same
// payload, previously duplicated across both.

const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);
// Banks directory — list every bank with Edit/Delete, plus Add. One sheet
// switching between list / form / delete-confirm views rather than stacked
// sheets. Delete is a real hard delete; the backend refuses while the bank
// still has linked transactions or pledges, and that message is shown as-is.
type BanksView = { kind: "list" } | { kind: "form"; bank?: Bank } | { kind: "delete"; bank: Bank } | { kind: "merge"; bank: Bank };
// editBank opens the sheet straight on that bank's edit form (Bank Management's per-row Edit).
type BanksSheetProps = { visible: boolean; onClose: () => void; editBank?: Bank | null };

export function BanksSheet({ visible, onClose, editBank }: BanksSheetProps) {
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
  const [fe, setFe] = useState<Record<string, string>>({});
  const [branchPick, setBranchPick] = useState<{ id: number; name: string } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Bank | null>(null);
  const showBranch = useShowBranch();
  const fieldErr = (k: string) => (fe[k] ? <Txt style={{ fontSize: 12, color: C.red, marginTop: 4 }}>{fe[k]}</Txt> : null);


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
    setFe({});
    setBranchPick(bank?.branchId ? { id: bank.branchId, name: bank.branchName || `Branch #${bank.branchId}` } : null);
    setView({ kind: "form", bank });
  };

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (editBank) openForm(editBank);
      else setView({ kind: "list" });
    }
  }, [visible, editBank]);

  const save = useMutation({
    mutationFn: async (bank?: Bank) => {
      let branchId = branchPick?.id;
      // A single-branch business hides the picker: its one branch is used.
      if (!branchId && !showBranch) branchId = (await listBranchesPage({ active: true, limit: 1, offset: 0 })).items?.[0]?.id;
      const input = {
        branchId,
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

  const submit = (bank?: Bank) => {
    const errors: Record<string, string> = {};
    if (name.trim().length < 2) errors.name = "Please enter a bank name (at least 2 characters).";
    if (phone.trim() && !/^\d{10}$/.test(phone.trim())) errors.phone = "Phone number must be exactly 10 digits.";
    if (showBranch && !branchPick) errors.branchId = "Please select the business branch this account belongs to.";
    setFe(errors);
    if (Object.keys(errors).length) return;
    setError(null);
    save.mutate(bank);
  };

  const merge = useMutation({
    mutationFn: ({ source, target }: { source: Bank; target: Bank }) => mergeBanks(source.id, target.id),
    onSuccess: () => {
      refreshBanks();
      setView({ kind: "list" });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not merge the banks."),
  });

  const remove = useMutation({
    mutationFn: (bank: Bank) => deleteBank(bank.id),
    onSuccess: () => {
      refreshBanks();
      setView({ kind: "list" });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not delete the bank.");
      setBlocked(true);
    },
  });

  if (view.kind === "form") {
    const editing = view.bank;
    return (
      <Sheet visible={visible} onClose={() => setView({ kind: "list" })} title={editing ? `Edit ${editing.name}` : "Add Bank"} maxHeightPct={80}>
        {showBranch ? (
          <View>
            <AsyncSelect<{ id: number; name: string; code?: string }>
              label="Business branch *"
              placeholder="Search branch"
              queryKey={["branches", "bank-form"]}
              fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
              selectedLabel={branchPick?.name}
              onSelect={(b) => setBranchPick({ id: b.id, name: b.name })}
              keyOf={(b) => b.id}
              renderItem={(b) => ({ title: b.name, sub: b.code })}
            />
            {fieldErr("branchId")}
          </View>
        ) : null}
        <Field label="Bank name *">
          <Input value={name} onChangeText={setName} placeholder="e.g. HDFC Bank" maxLength={120} />
          {fieldErr("name")}
        </Field>
        <Field label="Branch">
          <Input value={branch} onChangeText={setBranch} placeholder="e.g. Koratty" maxLength={120} />
        </Field>
        <Field label="IFSC code">
          <Input value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={20} autoCapitalize="characters" placeholder="e.g. HDFC0001234" />
        </Field>
        <Field label="Account number">
          <Input value={accountNo} onChangeText={(t) => setAccountNo(t.replace(/\D/g, ""))} maxLength={18} placeholder="Branch account number" keyboardType="number-pad" />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))} maxLength={10} placeholder="10-digit phone" keyboardType="number-pad" />
          {fieldErr("phone")}
        </Field>
        {errText(error)}
        <BtnRow2>
          <PrimaryButton label="Back" variant="outline" onPress={() => setView({ kind: "list" })} disabled={save.isPending} />
          <PrimaryButton label={editing ? "Save" : "Add Bank"} onPress={() => submit(editing)} loading={save.isPending} />
        </BtnRow2>
      </Sheet>
    );
  }

  if (view.kind === "delete") {
    const bank = view.bank;
    return (
      <Sheet visible={visible} onClose={() => setView({ kind: "list" })} title="Delete Bank" maxHeightPct={55}>
        <View style={{ marginTop: 10 }}>
          <WarningBanner>Delete bank permanently?</WarningBanner>
        </View>
        {errText(error)}
        {blocked ? <PrimaryButton label="Merge it into another bank instead" variant="outline" onPress={() => { setError(null); setMergeTarget(null); setView({ kind: "merge", bank }); }} /> : null}
        <BtnRow2>
          <PrimaryButton label="Back" variant="outline" onPress={() => setView({ kind: "list" })} disabled={remove.isPending} />
          <PrimaryButton label="Delete" variant="danger" onPress={() => remove.mutate(bank)} loading={remove.isPending} />
        </BtnRow2>
      </Sheet>
    );
  }

  const list = banks.data || [];

  if (view.kind === "merge") {
    const source = view.bank;
    return (
      <Sheet visible={visible} onClose={() => setView({ kind: "list" })} title="Merge Duplicate Bank" maxHeightPct={70}>
        <View style={{ marginTop: 10 }}>
          <WarningBanner>{`Merging deletes "${source.name}" permanently. Can't be undone.`}</WarningBanner>
        </View>
        <AsyncSelect<Bank>
          label={`Merge "${source.name}" into`}
          placeholder="Select the bank to keep"
          queryKey={["banks", "merge-target", source.id]}
          fetcher={async (q) => ((await listBanks(q || undefined)) || []).filter((b) => b.id !== source.id)}
          selectedLabel={mergeTarget?.name}
          onSelect={setMergeTarget}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name, sub: b.branch })}
        />
        {errText(error)}
        <BtnRow2>
          <PrimaryButton label="Back" variant="outline" onPress={() => setView({ kind: "list" })} disabled={merge.isPending} />
          <PrimaryButton label="Merge & Delete" variant="danger" onPress={() => mergeTarget && merge.mutate({ source, target: mergeTarget })} loading={merge.isPending} disabled={!mergeTarget} />
        </BtnRow2>
      </Sheet>
    );
  }

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
              sub={b.branch || b.ifsc || "—"}
              amount={fmtBalance(b.balance ?? 0)}
              amountColor={balanceColor(b.balance ?? 0)}
              details={[
                { k: "IFSC", v: b.ifsc || "—" },
                { k: "Account no", v: b.accountNo || "—" },
                { k: "Phone", v: b.phone || "—" },
              ]}
              actions={[
                ...(canLedger ? [{ label: "Ledger", onPress: () => { onClose(); openLedger("bank", b.id, b.name); } }] : []),
                ...(canUpdate ? [{ label: "Edit", onPress: () => openForm(b) }] : []),
                ...(canDelete ? [{ label: "Delete", danger: true, onPress: () => { setError(null); setBlocked(false); setView({ kind: "delete", bank: b }); } }] : []),
              ]}
            />
          ))}
        </AccGroup>
      )}
      {canCreate ? <PrimaryButton label="Add Bank" onPress={() => openForm()} /> : null}
    </Sheet>
  );
}
