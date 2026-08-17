import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { createEmployee } from "../../../src/api/employees";
import { ROLES, Role } from "../../../src/types/employee";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";

export default function NewEmployeeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee: me } = useAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Cashier");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createEmployee({ name, role, branchId: me!.branchId, phone: phone || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer>
      <Card>
        <GoldTextInput label="Name" value={name} onChangeText={setName} />
        <GoldTextInput label="Phone (login identifier)" value={phone} onChangeText={setPhone} />
        <ChipSelect label="Role" options={ROLES} value={role} onChange={setRole} />
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton title="Save" onPress={() => create.mutate()} loading={create.isPending} disabled={!name} />
      </Card>
    </ScreenContainer>
  );
}
