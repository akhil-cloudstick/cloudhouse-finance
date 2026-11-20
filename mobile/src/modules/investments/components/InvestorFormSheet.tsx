import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, ConfirmSheet, Field, Input, PrimaryButton, Sheet, toast } from "@/common/components/ui";
import { FieldErr } from "@/common/components/ErrorText";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { useAuth } from "@/common/providers/AuthProvider";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { checkInvestorIdentity, createInvestor, getInvestorAadhaarFull, sameIdentityMatches, updateInvestor, type Investor, type SameIdentityMatch } from "@/modules/investments/services/investorService";
import { getCustomer, getCustomerAadhaarFull } from "@/modules/customers/services/customerService";
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
  // Set once the user confirms the person is an existing borrower: the form is then filled from that borrower.
  const [linkedCustomerId, setLinkedCustomerId] = useState<number | undefined>();
  const askedRef = useRef(new Set<string>());

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
    setLinkedCustomerId(undefined);
    askedRef.current.clear();
    if (investor) getInvestorAadhaarFull(investor.id).then((a) => { if (!cancelled) setAadhaar(a); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, investor?.id]);

  // Matches of a "same person?" answer: the save is held until the user confirms or backs out.
  const [dup, setDup] = useState<SameIdentityMatch[] | null>(null);
  // True when `dup` came back from a rejected Create (so "Yes" saves), false when it came from typing (so "Yes" only fills the form).
  const dupFromSave = useRef(false);
  // Fills the form with what the borrower already has on file; the rest is left for staff to complete.
  async function prefillFromBorrower(id: number) {
    try {
      const c = (await getCustomer(id)) as Investor;
      setLinkedCustomerId(id);
      setName(c.name || "");
      setPhone(c.phone || "");
      if (c.address) setAddress(c.address);
      if (c.pan) setPan(c.pan);
      if (c.bankAccountName) setBankName(c.bankAccountName);
      if (c.bankAccountNumber) setBankNo(c.bankAccountNumber);
      if (c.bankIfsc) setIfsc(c.bankIfsc);
      if (c.branchId && showBranch) setBranch({ id: c.branchId, name: c.branch?.name ?? `Branch ${c.branchId}` });
      getCustomerAadhaarFull(id).then((r) => { if (r.aadhaar) setAadhaar(r.aadhaar); }).catch(() => {});
      toast.success("Borrower details filled in", "Please complete the remaining fields.");
    } catch {
      toast.error("Could not load the borrower's details", "Try again.");
    }
  }

  // As soon as a complete phone number, PAN or Aadhaar is typed, ask whether it already belongs to a borrower,
  // so the "same person?" question comes up while filling the form and not only when Create is pressed.
  useEffect(() => {
    if (!visible || editing || linkedCustomerId) return;
    const p = phone.trim();
    const pn = pan.trim().toUpperCase();
    const a = aadhaar.trim();
    const phoneOk = /^\d{10}$/.test(p);
    const panOk = /^[A-Z]{5}\d{4}[A-Z]$/.test(pn);
    const aadhaarOk = /^\d{12}$/.test(a);
    if (!phoneOk && !panOk && !aadhaarOk) return;
    const key = `${phoneOk ? p : ""}|${panOk ? pn : ""}|${aadhaarOk ? a : ""}`;
    if (askedRef.current.has(key)) return;
    let live = true;
    const t = setTimeout(() => {
      checkInvestorIdentity({ phone: phoneOk ? p : "", pan: panOk ? pn : "", aadhaar: aadhaarOk ? a : "" })
        .then((matches) => {
          if (!live) return;
          askedRef.current.add(key);
          if (!matches.length) return;
          dupFromSave.current = false;
          setDup(matches);
        })
        .catch(() => { /* a convenience only — Create makes the same check on the server */ });
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [visible, editing, linkedCustomerId, phone, pan, aadhaar]);
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
      return investor ? updateInvestor(investor.id, body) : createInvestor(body, confirmSamePerson || !!linkedCustomerId, linkedCustomerId);
    },
    onSuccess: (i) => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      if (investor) qc.invalidateQueries({ queryKey: ["investor", String(investor.id)] });
      onSaved?.(i);
      onClose();
    },
    onError: (e) => {
      const matches = investor ? null : sameIdentityMatches(e);
      if (matches) { dupFromSave.current = true; return setDup(matches); }
      toast.error("Could not save investor", e instanceof ApiError ? e.message : "Try again.");
    },
  });

  const errs: Record<string, string> = {};
  if (name.trim().length < 3) errs.name = "Enter the investor's full name.";
  if (!/^\d{10}$/.test(phone.trim())) errs.phone = "Enter a valid 10-digit mobile number.";
  if (showBranch && !branch) errs.branch = "Select a branch.";
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase())) errs.pan = "Enter a valid PAN (e.g. ABCDE1234F).";
  if (!(editing && !aadhaar.trim()) && !/^\d{12}$/.test(aadhaar.trim())) errs.aadhaar = "Enter a valid 12-digit Aadhaar number.";
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
      <Field label="Bank account holder"><Input value={bankName} onChangeText={setBankName} /></Field>
      <Field label="Bank account number"><Input value={bankNo} onChangeText={setBankNo} keyboardType="number-pad" /></Field>
      <Field label="Bank IFSC"><Input value={ifsc} onChangeText={(t) => setIfsc(t.toUpperCase())} autoCapitalize="characters" maxLength={11} placeholder="e.g. SBIN0001234" /></Field>
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
        hideCancel
        loading={save.isPending}
        onConfirm={() => {
          const matches = dup;
          setDup(null);
          // An existing borrower: fill the form from them and let staff complete the rest before adding.
          const borrower = matches?.find((m) => m.source === "customer");
          if (borrower) void prefillFromBorrower(borrower.id);
          else if (dupFromSave.current) save.mutate(true);
        }}
      />
    </Sheet>
  );
}
