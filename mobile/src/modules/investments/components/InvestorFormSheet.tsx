import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, ConfirmSheet, Field, Input, PrimaryButton, Sheet, toast } from "@/common/components/ui";
import { FieldErr } from "@/common/components/ErrorText";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { useAuth } from "@/common/providers/AuthProvider";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { createInvestor, getInvestorAadhaarFull, sameIdentityMatches, updateInvestor, type Investor, type SameIdentityMatch } from "@/modules/investments/services/investorService";
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
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setName(investor?.name ?? "");
    setPhone(investor?.phone ?? "");
    setAddress(investor?.address ?? "");
    setPan(investor?.pan ?? "");
    setAadhaar("");
    setBankName(investor?.bankAccountName ?? "");
    setBankNo(investor?.bankAccountNumber ?? "");
    setIfsc(investor?.bankIfsc ?? "");
    setBranch(null);
    setTried(false);
    if (investor) getInvestorAadhaarFull(investor.id).then((a) => { if (!cancelled) setAadhaar(a); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, investor?.id]);

  // Matches of a "same person?" answer: the save is held until the user confirms or backs out.
  const [dup, setDup] = useState<SameIdentityMatch[] | null>(null);
  const save = useMutation({
    mutationFn: (confirmSamePerson?: boolean) => {
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
      return investor ? updateInvestor(investor.id, body) : createInvestor(body, confirmSamePerson);
    },
    onSuccess: (i) => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      if (investor) qc.invalidateQueries({ queryKey: ["investor", String(investor.id)] });
      onSaved?.(i);
      onClose();
    },
    onError: (e) => {
      const matches = investor ? null : sameIdentityMatches(e);
      if (matches) return setDup(matches);
      toast.error("Could not save investor", e instanceof ApiError ? e.message : "Try again.");
    },
  });

  const errs: Record<string, string> = {};
  if (name.trim().length < 3) errs.name = "Enter the investor's full name.";
  if (!/^\d{10}$/.test(phone.trim())) errs.phone = "Enter a valid 10-digit mobile number.";
  if (showBranch && !branch) errs.branch = "Select a branch.";
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase())) errs.pan = "Enter a valid PAN (e.g. ABCDE1234F).";
  if (!(editing && !aadhaar.trim()) && !/^\d{12}$/.test(aadhaar.trim())) errs.aadhaar = "Enter a valid 12-digit Aadhaar number.";
  if (!bankName.trim()) errs.bankName = "Enter the bank account holder's name.";
  if (!bankNo.trim()) errs.bankNo = "Enter the bank account number.";
  if (!ifsc.trim()) errs.ifsc = "Enter the bank IFSC code.";
  const fe = (k: string) => (tried ? errs[k] : undefined);

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Investor" : "New Investor"} maxHeightPct={90}>
      <Field label="Full Name *"><Input value={name} onChangeText={setName} placeholder="Investor's full name" /></Field>
      <FieldErr m={fe("name")} />
      <Field label="Mobile Number *"><Input value={phone} onChangeText={(t) => setPhone(digits(t))} keyboardType="number-pad" maxLength={10} placeholder="10-digit mobile number" /></Field>
      <FieldErr m={fe("phone")} />
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
      <FieldErr m={fe("branch")} />
      <Field label="Address"><Input value={address} onChangeText={setAddress} placeholder="Address" /></Field>
      <Field label="PAN *"><Input value={pan} onChangeText={(t) => setPan(t.toUpperCase())} autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" /></Field>
      <FieldErr m={fe("pan")} />
      <Field label="Aadhaar *"><Input value={aadhaar} onChangeText={(t) => setAadhaar(digits(t))} keyboardType="number-pad" maxLength={12} placeholder={editing ? "Leave blank to keep on file" : "12-digit Aadhaar"} /></Field>
      <FieldErr m={fe("aadhaar")} />
      <Field label="Bank account holder *"><Input value={bankName} onChangeText={setBankName} /></Field>
      <FieldErr m={fe("bankName")} />
      <Field label="Bank account number *"><Input value={bankNo} onChangeText={setBankNo} keyboardType="number-pad" /></Field>
      <FieldErr m={fe("bankNo")} />
      <Field label="Bank IFSC *"><Input value={ifsc} onChangeText={(t) => setIfsc(t.toUpperCase())} autoCapitalize="characters" maxLength={11} placeholder="e.g. SBIN0001234" /></Field>
      <FieldErr m={fe("ifsc")} />
      <PrimaryButton
        label={editing ? "Save Changes" : "Create Investor"}
        loading={save.isPending}
        onPress={() => {
          if (Object.keys(errs).length) return setTried(true);
          save.mutate(false);
        }}
      />
      <ConfirmSheet
        visible={!!dup}
        onClose={() => setDup(null)}
        title="Same person?"
        message={
          dup
            ? `This ${[...new Set(dup.flatMap((m) => m.fields))].join(" / ").toLowerCase()} is already on file for the borrower ${dup.map((m) => `${m.name} (${m.code})`).join(", ")}.

Is ${name.trim()} the same person?`
            : ""
        }
        confirmLabel="Yes"
        cancelLabel="No"
        loading={save.isPending}
        onConfirm={() => {
          setDup(null);
          save.mutate(true);
        }}
      />
    </Sheet>
  );
}
