import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { C, DateField, Field, FieldRow, Input, PIcon, PrimaryButton, SectionTitle, Sheet, Txt } from "@/common/components/ui";
import { UploadField } from "@/common/components/UploadField";
import { useAuth } from "@/common/providers/AuthProvider";
import { createCustomer, updateCustomer } from "@/modules/customers/services/customerService";
import { type CustomerInput, type Customer } from "@/modules/customers/types/customer-types";
import { ApiError } from "@/common/services/httpClient";
import { todayISO } from "@/common/utils/format";

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
}>;

const digits = (t: string) => t.replace(/\D/g, "");
// Go's zero time.Time ("0001-01-01…") means "no DOB on file".
const isoDate = (v?: string | null) => (v && !v.startsWith("0001") ? v.slice(0, 10) : "");

type CustomerFormSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Pass to edit; omit to register a new customer. */
  customer?: Customer | null;
  onSaved?: (c: Customer) => void;
};

export function CustomerFormSheet({
  visible,
  onClose,
  customer,
  onSaved,
}: CustomerFormSheetProps) {
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
  // Additional Information — same eight fields as the web
  // RegisterCustomerModal's collapsible section (fatherName … pinCode, dob).
  const [showMore, setShowMore] = useState(false);
  const [fatherName, setFatherName] = useState("");
  const [age, setAge] = useState("");
  const [district, setDistrict] = useState("");
  const [taluk, setTaluk] = useState("");
  const [village, setVillage] = useState("");
  const [place, setPlace] = useState("");
  const [pinCode, setPinCode] = useState("");
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
    setFatherName(x.fatherName ?? "");
    setAge(x.age ? String(x.age) : "");
    setDistrict(x.district ?? "");
    setTaluk(x.taluk ?? "");
    setVillage(x.village ?? "");
    setPlace(x.place ?? "");
    setPinCode(x.pinCode ?? "");
    setShowMore(!!(x.fatherName || x.age || x.district || x.taluk || x.village || x.place || x.pinCode));
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
        fatherName: fatherName.trim() || undefined,
        age: +age > 0 ? +age : undefined,
        district: district.trim() || undefined,
        taluk: taluk.trim() || undefined,
        village: village.trim() || undefined,
        place: place.trim() || undefined,
        pinCode: pinCode.trim() || undefined,
      };
      if (customer) {
        const x = customer as Customer & CustomerExtras;
        return updateCustomer(customer.id, {
          ...body,
          customerType: x.customerType || undefined,
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
      <DateField label="Date of Birth" value={dob} onChange={setDob} max={todayISO()} clearable />
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

      <Pressable style={st.moreToggle} onPress={() => setShowMore((v) => !v)} accessibilityRole="button">
        <View style={showMore ? { transform: [{ rotate: "180deg" }] } : null}>
          <PIcon name="chevdown" color={C.brandDeep} />
        </View>
        <Txt style={st.moreTxt}>Additional Information</Txt>
      </Pressable>
      {showMore ? (
        <>
          <Field label="Father's Name">
            <Input placeholder="e.g. Ravi Varma" value={fatherName} onChangeText={setFatherName} />
          </Field>
          <FieldRow>
            <Field label="Age">
              <Input placeholder="e.g. 35" keyboardType="number-pad" maxLength={3} value={age} onChangeText={(t) => setAge(digits(t))} />
            </Field>
            <Field label="District">
              <Input placeholder="e.g. Thrissur" value={district} onChangeText={setDistrict} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Taluk">
              <Input placeholder="e.g. Kozhikode" value={taluk} onChangeText={setTaluk} />
            </Field>
            <Field label="Village">
              <Input placeholder="e.g. Feroke" value={village} onChangeText={setVillage} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Place">
              <Input placeholder="e.g. Feroke" value={place} onChangeText={setPlace} />
            </Field>
            <Field label="Pin Code">
              <Input placeholder="6-digit pin code" keyboardType="number-pad" maxLength={6} value={pinCode} onChangeText={(t) => setPinCode(digits(t))} />
            </Field>
          </FieldRow>
        </>
      ) : null}

      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label={editing ? "Save Changes" : "Register Customer"} onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} />
    </Sheet>
  );
}

const st = {
  moreToggle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 10, marginTop: 4, marginBottom: 6 },
  moreTxt: { fontSize: 13, fontWeight: "700" as const, color: C.brandDeep },
};
