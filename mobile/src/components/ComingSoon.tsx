import React from "react";
import { ScreenContainer } from "./ScreenContainer";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";

// Placeholder for modules not yet wired to their real API — each is tracked
// in the plan's "Backend gaps"/full-parity scope and gets built out module by
// module. Never silently hides that a screen is a stub.
export function ComingSoon({ title }: { title: string }) {
  return (
    <ScreenContainer style={{ alignItems: "center", justifyContent: "center" }}>
      <ThemedText variant="h2" color={colors.brandDeep} style={{ marginBottom: 8 }}>
        {title}
      </ThemedText>
      <ThemedText variant="body" color={colors.muted} style={{ textAlign: "center" }}>
        This module is scaffolded but not yet wired to the backend API. It's next in line per the
        full-parity build plan.
      </ThemedText>
    </ScreenContainer>
  );
}
