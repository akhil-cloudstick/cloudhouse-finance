import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, Field, Input, PrimaryButton, Sheet, Txt } from "@/common/components/ui";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { useAuth } from "@/common/providers/AuthProvider";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { createInvestor, getInvestorAadhaarFull, updateInvestor, type Investor } from "@/modules/investments/services/investorService";
import { ApiError } from "@/common/services/httpClient";

const digits = (t: string) => t.replace(/\D/g, "");

type InvestorFormSheetProps = { visible: boolean; onClose: () => void; investor?: Investor | null; onSaved?: (i: Investor) => void };

// Add / Edit Investor — same fields and validation as web's CreateInvestorModalContent.
export function InvestorFormSheet({ visible, onClose, investor, onSaved }: InvestorFormSheetProps) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const editing = !!investor;
  const showBranch = useShowBranch() && !editing;
  const [branch, setBranch] = useState<{ id: number; name: string } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankNo, setBankNo] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(investor?.name ?? "");
    setPhone(investor?.phone ?? "");
    setAddress(investor?.address ?? "");
    setPan(investor?.pan ?? "");
    setAadhaar("");
    setBankName(investor?.bankAccountName ?? "");
    setBankNo(investor?.bankAccountNumber ?? "");
    setIfsc(investor?.bankIfsc ?? "");
    setBranch(null);
    setError(null);
    if (investor) getInvestorAadhaarFull(investor.id).then(setAadhaar).catch(() => {});
  }, [visible, investor]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        branchId: investor ? investor.branchId : branch?.id ?? employee!.branchId,
        pan: pan.trim().toUpperCase(),
        aadhaar: aadhaar.trim(),
        bankAccountName: bankName.trim(),
        bankAccountNumber: bankNo.trim(),
        bankIfsc: ifsc.trim().toUpperCase(),
      };
      return investor ? updateInvestor(investor.id, body) : createInvestor(body);
    },
    onSuccess: (i) => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      if (investor) qc.invalidateQueries({ queryKey: ["investor", String(investor.id)] });
      onSaved?.(i);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save the investor — try again."),
  });

  function validate(): string | null {
    if (name.trim().length < 3) return "Please enter the investor's full name.";
    if (!/^\d{10}$/.test(phone.trim())) return "Please enter a valid 10-digit mobile number.";
    if (showBranch && !branch) return "Please select a branch.";
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase())) return "Please enter a valid PAN (e.g. ABCDE1234F).";
    if (!(editing && !aadhaar.trim()) && !/^\d{12}$/.test(aadhaar.trim())) return "Please enter a valid 12-digit Aadhaar number.";
    if (!bankName.trim()) return "Please enter the bank account holder's name.";
    if (!bankNo.trim()) return "Please enter the bank account number.";
    if (!ifsc.trim()) return "Please enter the bank IFSC code.";
    return null;
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Investor" : "New Investor"} maxHeightPct={90}>
      <Field label="Full Name *"><Input value={name} onChangeText={setName} placeholder="Investor's full name" /></Field>
      <Field label="Mobile Number *"><Input value={phone} onChangeText={(t) => setPhone(digits(t))} keyboardType="number-pad" maxLength={10} placeholder="10-digit mobile number" /></Field>
      {showBranch ? (
        <AsyncSelect<{ id: number; name: string; code?: string }>
          label="Branch *"
          placeholder="Select branch…"
          queryKey={["branches", "investor-form"]}
          fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={branch?.name ?? ""}
          onSelect={(b) => setBranch({ id: b.id, name: b.name })}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name, sub: b.code })}
        />
      ) : null}
      <Field label="Address"><Input value={address} onChangeText={setAddress} placeholder="Address" /></Field>
      <Field label="PAN *"><Input value={pan} onChangeText={(t) => setPan(t.toUpperCase())} autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" /></Field>
      <Field label="Aadhaar *"><Input value={aadhaar} onChangeText={(t) => setAadhaar(digits(t))} keyboardType="number-pad" maxLength={12} placeholder={editing ? "Leave blank to keep on file" : "12-digit Aadhaar"} /></Field>
      <Field label="Bank account holder *"><Input value={bankName} onChangeText={setBankName} /></Field>
      <Field label="Bank account number *"><Input value={bankNo} onChangeText={setBankNo} keyboardType="number-pad" /></Field>
      <Field label="Bank IFSC *"><Input value={ifsc} onChangeText={(t) => setIfsc(t.toUpperCase())} autoCapitalize="characters" maxLength={11} placeholder="e.g. SBIN0001234" /></Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label={editing ? "Save Changes" : "Create Investor"}
        loading={save.isPending}
        onPress={() => {
          const v = validate();
          if (v) return setError(v);
          setError(null);
          save.mutate();
        }}
      />
    </Sheet>
  );
}
