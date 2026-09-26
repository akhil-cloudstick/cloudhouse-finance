import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, DateField, Field, FieldRow, Input, PrimaryButton, SectionTitle, Sheet, Txt } from "../ui";
import { UploadField } from "./UploadField";
import { useAuth } from "../../auth/AuthContext";
import { createCustomer, updateCustomer, type CustomerInput } from "../../api/customers";
import { ApiError } from "../../api/client";
import { todayISO } from "../../lib/format";
import type { Customer } from "../../types/customer";

// Register / Edit Customer (prototype #register-customer-modal) — one sheet
// for both. Same field set, validation and payload as the old
// customers/new.tsx + customers/edit/[id].tsx routes (and the web
// RegisterCustomerModal / EditCustomerModal):
// - name required, mobile exactly 10 digits, digits-only mobile/Aadhaar/nominee mobile;
// - PAN upper-cased; DOB can't be in the future;
// - the four documents upload on pick (UploadField) so only URLs are sent;
// - edit: Aadhaar starts blank — leaving it blank keeps the on-file number
//   (the backend only re-encrypts when non-empty); document URLs start at the
//   customer's existing values so an untouched one is kept, not wiped.

/** Extra (personal-loan / investor) fields the backend returns with
 * `omitempty`; the PUT is a full replace, so edit re-sends them unchanged. */
type CustomerExtras = Partial<{
  customerType: string;
  fatherName: string;
  district: string;
  taluk: string;
  village: string;
  place: string;
  pinCode: string;
  age: number;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  notes: string;
}>;

const digits = (t: string) => t.replace(/\D/g, "");
// Go's zero time.Time ("0001-01-01…") means "no DOB on file".
const isoDate = (v?: string | null) => (v && !v.startsWith("0001") ? v.slice(0, 10) : "");

export function CustomerFormSheet({
  visible,
  onClose,
  customer,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  /** Pass to edit; omit to register a new customer. */
  customer?: Customer | null;
  onSaved?: (c: Customer) => void;
}) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const editing = !!customer;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [identityProofUrl, setIdentityProofUrl] = useState("");
  const [addressProofUrl, setAddressProofUrl] = useState("");
  const [kycDocumentUrl, setKycDocumentUrl] = useState("");
  const [nomineeName, setNomineeName] = useState("");
  const [nomineeRelation, setNomineeRelation] = useState("");
  const [nomineePhone, setNomineePhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Seed (edit) or clear (register) every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const c = customer;
    const x = (c ?? {}) as CustomerExtras;
    setName(c?.name ?? "");
    setPhone(c?.phone ?? "");
    setDob(isoDate(c?.dob));
    setAddress(c?.address ?? "");
    setPan(c?.pan ?? "");
    setAadhaar("");
    setPhotoUrl(c?.photoUrl ?? "");
    setIdentityProofUrl(c?.identityProofUrl ?? "");
    setAddressProofUrl(c?.addressProofUrl ?? "");
    setKycDocumentUrl(c?.kycDocumentUrl ?? "");
    setNomineeName(c?.nomineeName ?? "");
    setNomineeRelation(c?.nomineeRelation ?? "");
    setNomineePhone(c?.nomineePhone ?? "");
    setNotes(x.notes ?? "");
    setError(null);
  }, [visible, customer]);

  const phoneOk = /^\d{10}$/.test(phone.trim());
  const aadhaarOk = !aadhaar || /^\d{12}$/.test(aadhaar);
  const canSave = !!name.trim() && phoneOk && aadhaarOk;

  const save = useMutation({
    mutationFn: () => {
      const body: CustomerInput = {
        name: name.trim(),
        phone: phone.trim(),
        dob: dob.trim() || undefined,
        address: address.trim() || undefined,
        branchId: customer ? customer.branchId : employee!.branchId,
        pan: pan.trim().toUpperCase() || undefined,
        aadhaar: aadhaar.trim() || undefined,
        nomineeName: nomineeName.trim() || undefined,
        nomineeRelation: nomineeRelation.trim() || undefined,
        nomineePhone: nomineePhone.trim() || undefined,
        photoUrl: photoUrl || undefined,
        identityProofUrl: identityProofUrl || undefined,
        addressProofUrl: addressProofUrl || undefined,
        kycDocumentUrl: kycDocumentUrl || undefined,
        notes: notes.trim() || undefined,
      };
      if (customer) {
        const x = customer as Customer & CustomerExtras;
        return updateCustomer(customer.id, {
          ...body,
          customerType: x.customerType || undefined,
          fatherName: x.fatherName || undefined,
          district: x.district || undefined,
          taluk: x.taluk || undefined,
          village: x.village || undefined,
          place: x.place || undefined,
          pinCode: x.pinCode || undefined,
          age: x.age ?? undefined,
          bankAccountName: x.bankAccountName || undefined,
          bankAccountNumber: x.bankAccountNumber || undefined,
          bankIfsc: x.bankIfsc || undefined,
        });
      }
      return createCustomer(body);
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      if (customer) qc.invalidateQueries({ queryKey: ["customer", String(customer.id)] });
      onSaved?.(c);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : editing ? "Could not update customer." : "Could not register customer."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Customer" : "Register Customer"} maxHeightPct={88}>
      <Field label="Full Name *">
        <Input placeholder="Customer's full name" value={name} onChangeText={setName} />
      </Field>
      <Field label="Mobile Number *">
        <Input placeholder="10-digit mobile number" keyboardType="number-pad" maxLength={10} value={phone} onChangeText={(t) => setPhone(digits(t))} />
      </Field>
      <DateField label="Date of Birth" value={dob} onChange={setDob} placeholder="Select date of birth" max={todayISO()} clearable />
      <Field label="Address">
        <Input placeholder="Full address" value={address} onChangeText={setAddress} />
      </Field>
      <FieldRow>
        <Field label="PAN Number">
          <Input placeholder="ABCDE1234F" autoCapitalize="characters" maxLength={10} value={pan} onChangeText={setPan} />
        </Field>
        <Field label="Aadhaar Number">
          <Input
            placeholder={editing && customer?.aadhaarLast4 ? `Blank keeps ••${customer.aadhaarLast4}` : "XXXX XXXX XXXX"}
            keyboardType="number-pad"
            maxLength={12}
            value={aadhaar}
            onChangeText={(t) => setAadhaar(digits(t))}
          />
        </Field>
      </FieldRow>
      {!aadhaarOk ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>Aadhaar must be 12 digits.</Txt> : null}

      <SectionTitle flush style={{ marginTop: 16 }}>
        {editing ? "Documents" : "Documents (optional)"}
      </SectionTitle>
      <UploadField label="Customer Photograph" value={photoUrl} onChange={setPhotoUrl} allowPdf={false} emptyText="Tap to add photo" />
      <UploadField label="Identity Proof" value={identityProofUrl} onChange={setIdentityProofUrl} />
      <UploadField label="Address Proof" value={addressProofUrl} onChange={setAddressProofUrl} />
      <UploadField label="Supporting KYC Document" value={kycDocumentUrl} onChange={setKycDocumentUrl} />

      <SectionTitle flush style={{ marginTop: 16 }}>
        Nominee Information (optional)
      </SectionTitle>
      <Field label="Nominee Name">
        <Input placeholder="Full name" value={nomineeName} onChangeText={setNomineeName} />
      </Field>
      <FieldRow>
        <Field label="Relation">
          <Input placeholder="e.g. Spouse, Son" value={nomineeRelation} onChangeText={setNomineeRelation} />
        </Field>
        <Field label="Nominee Mobile">
          <Input placeholder="10-digit number" keyboardType="number-pad" maxLength={10} value={nomineePhone} onChangeText={(t) => setNomineePhone(digits(t))} />
        </Field>
      </FieldRow>

      <Field label="Additional Information (optional)">
        <Input placeholder="Any other notes about this customer" value={notes} onChangeText={setNotes} />
      </Field>

      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label={editing ? "Save Changes" : "Register Customer"} onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} />
    </Sheet>
  );
}
