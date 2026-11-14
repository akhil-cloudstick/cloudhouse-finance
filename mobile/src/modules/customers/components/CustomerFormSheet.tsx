import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { AsyncSelect, C, DateField, Field, FieldRow, Input, PIcon, PrimaryButton, SectionTitle, Sheet, Txt } from "@/common/components/ui";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { UploadField } from "@/common/components/UploadField";
import { useAuth } from "@/common/providers/AuthProvider";
import { createCustomer, updateCustomer } from "@/modules/customers/services/customerService";
import { type CustomerInput, type Customer } from "@/modules/customers/types/customer-types";
import { ApiError } from "@/common/services/httpClient";
import { todayISO } from "@/common/utils/format";

// Same checks as web common/utils/kyc.ts.
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const stripDigits = (v: string) => v.replace(/\d/g, "");
// Live PAN check, per keystroke: names the first character out of order (5 letters, 4 digits, 1 letter).
function panLiveError(value: string): string {
  const v = value.toUpperCase();
  for (let i = 0; i < v.length && i < 10; i++) {
    const wantLetter = i < 5 || i === 9;
    if (!(wantLetter ? /[A-Z]/.test(v[i]) : /\d/.test(v[i]))) return "Format: ABCDE1234F";
  }
  return "";
}

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
// Whole years since the DOB (blank when there is none).
const ageOf = (dob: string) => {
  if (!dob) return "";
  const b = new Date(+dob.slice(0, 4), +dob.slice(5, 7) - 1, +dob.slice(8, 10));
  const t = new Date();
  const a = t.getFullYear() - b.getFullYear() - (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate()) ? 1 : 0);
  return a > 0 ? String(a) : "";
};
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
  // Same rule as the web form: the Branch picker is for cross-branch roles on a multi-branch plan, and is
  // required there (the app has no global branch selector).
  const showBranch = useShowBranch();
  const [branch, setBranch] = useState<{ id: number; name: string } | null>(null);

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
    setBranch(c?.branchId ? { id: c.branchId, name: c.branch?.name ?? "" } : null);
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
    setAge(ageOf(isoDate(c?.dob)) || (x.age ? String(x.age) : ""));
    setDistrict(x.district ?? "");
    setTaluk(x.taluk ?? "");
    setVillage(x.village ?? "");
    setPlace(x.place ?? "");
    setPinCode(x.pinCode ?? "");
    setShowMore(!!(x.age || x.fatherName || x.district || x.taluk || x.village || x.place || x.pinCode));
    setError(null);
  }, [visible, customer]);

  const phoneOk = /^\d{10}$/.test(phone.trim());
  const aadhaarOk = !aadhaar || /^\d{12}$/.test(aadhaar);
  const panOk = !pan.trim() || PAN_RE.test(pan.trim().toUpperCase());
  const panLive = panLiveError(pan);
  const nameOk = name.trim().length >= 3;
  // A server message about one field is shown under that field, not at the bottom of the sheet.
  const serverPanErr = error && /\bpan\b/i.test(error) ? error : null;
  const serverAadhaarErr = !serverPanErr && error && /aadhaar/i.test(error) ? error : null;
  const serverPhoneErr = !serverPanErr && !serverAadhaarErr && error && /^(?!.*nominee).*(phone|mobile)/i.test(error) ? error : null;
  const bottomError = serverPanErr || serverAadhaarErr || serverPhoneErr ? null : error;
  const canSave = nameOk && phoneOk && aadhaarOk && panOk && (!showBranch || !!branch);

  const save = useMutation({
    mutationFn: () => {
      const body: CustomerInput = {
        name: name.trim(),
        phone: phone.trim(),
        dob: dob.trim() || undefined,
        address: address.trim() || undefined,
        branchId: branch?.id ?? (customer ? customer.branchId : employee!.branchId),
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
      <SectionTitle flush>Personal Details</SectionTitle>
      <Field label="Full Name *">
        <Input placeholder="Customer's full name" value={name} onChangeText={(t) => setName(stripDigits(t))} />
        {name.length > 0 && !nameOk ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 4 }}>Please enter the customer&apos;s full name (at least 3 characters).</Txt> : null}
      </Field>
      <Field label="Mobile Number *">
        <Input placeholder="10-digit mobile number" keyboardType="number-pad" maxLength={10} value={phone} onChangeText={(t) => { setPhone(digits(t)); setError(null); }} />
        {serverPhoneErr ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{serverPhoneErr}</Txt> : null}
      </Field>
      {showBranch ? (
        <AsyncSelect<{ id: number; name: string; code?: string }>
          label="Branch *"
          placeholder="Select branch…"
          queryKey={["branches", "register-customer"]}
          fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={branch?.name ?? ""}
          onSelect={(b) => setBranch({ id: b.id, name: b.name })}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name, sub: b.code })}
        />
      ) : null}
      <DateField label="Date of Birth" value={dob} onChange={(v) => { setDob(v); setAge(ageOf(v)); }} max={todayISO()} clearable />
      <Field label="Age">
        <Input placeholder="Auto from date of birth" editable={false} value={ageOf(dob) || age} />
      </Field>
      <Field label="Address">
        <Input placeholder="Full address" value={address} onChangeText={setAddress} />
      </Field>
      <FieldRow>
        <Field label="PAN Number">
          <Input placeholder="ABCDE1234F" autoCapitalize="characters" maxLength={10} value={pan} onChangeText={(t) => { setPan(t.toUpperCase().replace(/[^A-Z0-9]/g, "")); setError(null); }} />
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
      {panLive ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>{panLive}</Txt> : !panOk ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>Please enter a valid PAN (e.g. ABCDE1234F).</Txt> : null}
      {serverPanErr ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>{serverPanErr}</Txt> : null}
      {!aadhaarOk ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>Aadhaar must be 12 digits.</Txt> : null}
      {serverAadhaarErr ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>{serverAadhaarErr}</Txt> : null}

      <SectionTitle flush style={{ marginTop: 16 }}>
        Documents
      </SectionTitle>
      <UploadField label="Customer Photograph" value={photoUrl} onChange={setPhotoUrl} allowPdf={false} emptyText="Tap to add photo" />
      <UploadField label="Identity Proof" value={identityProofUrl} onChange={setIdentityProofUrl} />
      <UploadField label="Address Proof" value={addressProofUrl} onChange={setAddressProofUrl} />
      <UploadField label="Supporting KYC Document" value={kycDocumentUrl} onChange={setKycDocumentUrl} />

      <SectionTitle flush style={{ marginTop: 16 }}>
        Nominee (optional)
      </SectionTitle>
      <Field label="Nominee Name">
        <Input placeholder="Full name" value={nomineeName} onChangeText={(t) => setNomineeName(stripDigits(t))} />
      </Field>
      <FieldRow>
        <Field label="Relation">
          <Input placeholder="e.g. Spouse, Son" value={nomineeRelation} onChangeText={(t) => setNomineeRelation(stripDigits(t))} />
        </Field>
        <Field label="Nominee Mobile Number">
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
          <Field label="Guardian Name">
            <Input placeholder="e.g. Ravi Varma" value={fatherName} onChangeText={(t) => setFatherName(stripDigits(t))} />
          </Field>
          <FieldRow>
            <Field label="District">
              <Input placeholder="e.g. Thrissur" value={district} onChangeText={setDistrict} />
            </Field>
            <Field label="Taluk">
              <Input placeholder="e.g. Kozhikode" value={taluk} onChangeText={setTaluk} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Village">
              <Input placeholder="e.g. Feroke" value={village} onChangeText={setVillage} />
            </Field>
            <Field label="Place">
              <Input placeholder="e.g. Feroke" value={place} onChangeText={setPlace} />
            </Field>
          </FieldRow>
          <Field label="Pin Code">
            <Input placeholder="6-digit pin code" keyboardType="number-pad" maxLength={6} value={pinCode} onChangeText={(t) => setPinCode(digits(t))} />
          </Field>
        </>
      ) : null}

      {bottomError ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{bottomError}</Txt> : null}
      <PrimaryButton label={editing ? "Save Changes" : "Register Customer"} onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} />
    </Sheet>
  );
}

const st = {
  moreToggle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 10, marginTop: 4, marginBottom: 6 },
  moreTxt: { fontSize: 13, fontWeight: "700" as const, color: C.brandDeep },
};
