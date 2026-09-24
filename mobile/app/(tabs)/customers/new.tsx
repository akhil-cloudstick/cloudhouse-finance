import React, { useState } from "react";
import { View, KeyboardAvoidingView, Platform } from "react-native";
import { GutterScrollView } from "../../../src/components/Gutter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { GoldDatePicker } from "../../../src/components/GoldDatePicker";
import { DocumentField } from "../../../src/components/DocumentField";
import { colors } from "../../../src/theme/colors";
import { createCustomer } from "../../../src/api/customers";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";

// Mirrors frontend/components/modals/RegisterCustomerModal.tsx's full field
// set: name/phone/dob/branch/address/PAN/Aadhaar/nominee AND the four
// document uploads (photo/identity-proof/address-proof/kyc-document). Those
// used to be omitted here for want of a picker; they're collected now via
// DocumentField, which uploads each pick straight away and hands this screen
// a "/uploads/..." URL. Wrapped in a ScrollView, same overflow-safety
// reasoning as schemes/new.tsx.
export default function NewCustomerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();

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

  const create = useMutation({
    mutationFn: () =>
      createCustomer({
        name: name.trim(),
        phone: phone.trim(),
        dob: dob.trim() || undefined,
        address: address.trim() || undefined,
        branchId: employee!.branchId,
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
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not register customer."),
  });

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
        {/* Without this the keyboard covers the lower half of the form — the
          fields below it (Aadhaar, the whole nominee block, and the Register
          button) can't be reached or even seen while typing. `padding`
          behaves correctly on both platforms here because the app draws
          edge-to-edge; `contentContainerStyle.flexGrow` keeps the card
          top-aligned when the form is shorter than the screen. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <GutterScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ flexGrow: 1 }}
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
          {/* `max` = today: a customer can't be born in the future, and it
              also makes the calendar open on the current month rather than
              somewhere unreachable. Tap the month/year title to jump years —
              a DOB is otherwise a very long way back one month at a time. */}
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
            placeholder="12-digit Aadhaar"
          />

          {/* Same four documents the web modal collects, same order. Each
              uploads on pick, so by submit time these are just URLs. */}
          <ThemedText variant="label" color={colors.muted} style={{ marginTop: 6, marginBottom: 8 }}>
            Documents (optional)
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
              title="Register Customer"
              onPress={() => create.mutate()}
              loading={create.isPending}
              disabled={!name.trim() || !/^\d{10}$/.test(phone.trim())}
            />
          </View>
          </Card>
        </GutterScrollView>
      </KeyboardAvoidingView>
      </View>
    </ScreenContainer>  );
}
