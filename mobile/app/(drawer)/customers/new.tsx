import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { createCustomer } from "../../../src/api/customers";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";

// Mirrors frontend/components/modals/RegisterCustomerModal.tsx's field set
// (name/phone/dob/branch/address/PAN/Aadhaar/nominee) minus the file-upload
// fields (photo/identity-proof/address-proof/kyc-document) — those are
// deferred to a later KYC step on mobile too, see src/api/customers.ts's
// createCustomer comment. Wrapped in a ScrollView, same overflow-safety
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
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not register customer."),
  });

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Card>
          <GoldTextInput label="Full Name *" value={name} onChangeText={setName} placeholder="e.g. Anil Varma" />
          <GoldTextInput
            label="Mobile Number *"
            keyboardType="numeric"
            value={phone}
            onChangeText={(t) => setPhone(t.replace(/\D/g, ""))}
            placeholder="10-digit mobile"
          />
          <GoldTextInput label="Date of Birth (YYYY-MM-DD)" value={dob} onChangeText={setDob} placeholder="e.g. 1990-05-14" />
          <GoldTextInput label="Address" value={address} onChangeText={setAddress} placeholder="House / street, town, district" />
          <GoldTextInput label="PAN Number" value={pan} onChangeText={setPan} placeholder="ABCDE1234F" autoCapitalize="characters" />
          <GoldTextInput
            label="Aadhaar Number"
            keyboardType="numeric"
            value={aadhaar}
            onChangeText={(t) => setAadhaar(t.replace(/\D/g, ""))}
            placeholder="12-digit Aadhaar"
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
      </ScrollView>
    </ScreenContainer>
  );
}
