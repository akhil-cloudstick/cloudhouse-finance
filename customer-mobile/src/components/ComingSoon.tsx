import React from "react";
import { ScreenContainer } from "./ScreenContainer";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";

// Placeholder for modules not yet wired to the customer API (My Loans,
// Payments, Documents, More, notifications) — each is a later batch per the
// plan. Never silently hides that a screen is a stub.
export function ComingSoon({ title }: { title: string }) {
  return (
    <ScreenContainer style={{ alignItems: "center", justifyContent: "center" }}>
      <ThemedText variant="h2" color={colors.goldDeep} style={{ marginBottom: 8 }}>
        {title}
      </ThemedText>
      <ThemedText variant="body" color={colors.muted} style={{ textAlign: "center" }}>
        This section is coming soon. We&apos;re building it out in the next update.
      </ThemedText>
    </ScreenContainer>
  );
}
