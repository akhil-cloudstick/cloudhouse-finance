import React, { useEffect, useState } from "react";
import { View, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "../../../../src/components/ScreenContainer";
import { Card } from "../../../../src/components/Card";
import { ThemedText } from "../../../../src/components/ThemedText";
import { GoldTextInput } from "../../../../src/components/GoldTextInput";
import { GoldButton } from "../../../../src/components/GoldButton";
import { GoldDatePicker } from "../../../../src/components/GoldDatePicker";
import { DocumentField } from "../../../../src/components/DocumentField";
import { colors } from "../../../../src/theme/colors";
import { getCustomer, updateCustomer } from "../../../../src/api/customers";
import { ApiError } from "../../../../src/api/client";

// Edit counterpart to customers/new.tsx, wired to the PUT /customers/:id
// update (src/api/customers.ts's updateCustomer). Same field set/order as
// the create screen and the web's EditCustomerModal — pre-filled from the
// loaded customer. Aadhaar is left blank on open (the backend never returns
// the plaintext number) and left blank on save keeps the on-file Aadhaar
// untouched; the four DocumentField values start at the customer's existing
// URLs and only change when the staff member replaces/removes one.
export default function EditCustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = Number(id);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => getCustomer(customerId),
    enabled: !!id,
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [nomineeName, setNomineeName] = useState("");
  const [nomineeRelation, setNomineeRelation] = useState("");
  const [nomineePhone, setNomineePhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [identityProofUrl, setIdentityProofUrl] = useState("");
  const [addressProofUrl, setAddressProofUrl] = useState("");
  const [kycDocumentUrl, setKycDocumentUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Populate the form once the customer loads — mirrors new.tsx's fields
  // exactly, just seeded rather than starting blank.
  useEffect(() => {
    if (!data) return;
    setName(data.name || "");
    setPhone(data.phone || "");
    setDob(data.dob ? data.dob.slice(0, 10) : "");
    setAddress(data.address || "");
    setPan(data.pan || "");
    setNomineeName(data.nomineeName || "");
    setNomineeRelation(data.nomineeRelation || "");
    setNomineePhone(data.nomineePhone || "");
    setPhotoUrl(data.photoUrl || "");
    setIdentityProofUrl(data.identityProofUrl || "");
    setAddressProofUrl(data.addressProofUrl || "");
    setKycDocumentUrl(data.kycDocumentUrl || "");
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateCustomer(customerId, {
        name: name.trim(),
        phone: phone.trim(),
        dob: dob.trim() || undefined,
        address: address.trim() || undefined,
        branchId: data!.branchId,
        pan: pan.trim().toUpperCase() || undefined,
        aadhaar: aadhaar.trim() || undefined,
        nomineeName: nomineeName.trim() || undefined,
        nomineeRelation: nomineeRelation.trim() || undefined,
        nomineePhone: nomineePhone.trim() || undefined,
        photoUrl: photoUrl || undefined,
        identityProofUrl: identityProofUrl || undefined,
        addressProofUrl: addressProofUrl || undefined,
        kycDocumentUrl: kycDocumentUrl || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not update customer."),
  });

  if (isLoading || !data) {
    return (
      <ScreenContainer>
        <ThemedText color={colors.muted}>{isError ? "Could not load this customer." : "Loading…"}</ThemedText>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        >
          <Card>
            <GoldTextInput label="Full Name *" value={name} onChangeText={setName} placeholder="e.g. Anil Varma" />
            <GoldTextInput
              label="Mobile Number *"
              keyboardType="numeric"
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/\D/g, ""))}
              placeholder="10-digit mobile"
            />
            <GoldDatePicker
              label="Date of Birth"
              value={dob}
              onChange={setDob}
              placeholder="Select date of birth…"
              max={new Date().toISOString().slice(0, 10)}
            />
            <GoldTextInput label="Address" value={address} onChangeText={setAddress} placeholder="House / street, town, district" />
            <GoldTextInput label="PAN Number" value={pan} onChangeText={setPan} placeholder="ABCDE1234F" autoCapitalize="characters" />
            <GoldTextInput
              label="Aadhaar Number"
              keyboardType="numeric"
              value={aadhaar}
              onChangeText={(t) => setAadhaar(t.replace(/\D/g, ""))}
              placeholder={data.aadhaarLast4 ? `Leave blank to keep ••••${data.aadhaarLast4}` : "12-digit Aadhaar"}
            />

            <ThemedText variant="label" color={colors.muted} style={{ marginTop: 6, marginBottom: 8 }}>
              Documents
            </ThemedText>
            <DocumentField
              label="Customer Photograph"
              hint="A clear head-and-shoulders photo"
              value={photoUrl}
              onChange={setPhotoUrl}
              allowPdf={false}
            />
            <DocumentField
              label="Identity Proof"
              hint="PAN, passport, voter ID — image or PDF"
              value={identityProofUrl}
              onChange={setIdentityProofUrl}
            />
            <DocumentField
              label="Address Proof"
              hint="Utility bill, ration card — image or PDF"
              value={addressProofUrl}
              onChange={setAddressProofUrl}
            />
            <DocumentField
              label="Supporting KYC Document"
              hint="Any additional document"
              value={kycDocumentUrl}
              onChange={setKycDocumentUrl}
            />

            <ThemedText variant="label" color={colors.muted} style={{ marginTop: 6, marginBottom: 4 }}>
              Nominee Information (optional)
            </ThemedText>
            <GoldTextInput label="Nominee Name" value={nomineeName} onChangeText={setNomineeName} />
            <GoldTextInput label="Relation" value={nomineeRelation} onChangeText={setNomineeRelation} />
            <GoldTextInput
              label="Nominee Mobile Number"
              keyboardType="numeric"
              value={nomineePhone}
              onChangeText={(t) => setNomineePhone(t.replace(/\D/g, ""))}
            />

            {error ? (
              <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                {error}
              </ThemedText>
            ) : null}

            <View style={{ marginTop: 4 }}>
              <GoldButton
                title="Save Changes"
                onPress={() => save.mutate()}
                loading={save.isPending}
                disabled={!name.trim() || !/^\d{10}$/.test(phone.trim())}
              />
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
