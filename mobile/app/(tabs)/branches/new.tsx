import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { createBranch } from "../../../src/api/branches";
import { ApiError } from "../../../src/api/client";

export default function NewBranchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createBranch({ name, code: code || undefined, address, phone: phone || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <Card>
        <GoldTextInput label="Name" value={name} onChangeText={setName} />
        <GoldTextInput label="Code" value={code} onChangeText={setCode} />
        <GoldTextInput label="Address" value={address} onChangeText={setAddress} />
        <GoldTextInput label="Phone" value={phone} onChangeText={setPhone} />
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton
          title="Save"
          onPress={() => create.mutate()}
          loading={create.isPending}
          disabled={!name || !address}
        />
      </Card>
      </View>
    </ScreenContainer>  );
}
