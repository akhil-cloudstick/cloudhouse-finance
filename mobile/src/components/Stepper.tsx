import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";

export type StepState = "done" | "current" | "upcoming";

export type Step = { key: string; label: string; state: StepState; caption?: string };

// Vertical progress stepper — a numbered rail down the left, one row per
// stage. Used by the packet lifecycle (app/(tabs)/packets/[id].tsx) to show
// where a packet is rather than offering every stage as an equal choice.
//
// Purely presentational: the caller decides which stage is current and what
// the next legal move is. Steps are not pressable, because in a lifecycle
// like this you don't jump to a stage, you advance to the next one.
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <View>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const done = step.state === "done";
        const current = step.state === "current";
        return (
          <View key={step.key} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]}
              >
                {done ? (
                  <Icon name="check" size={13} color={colors.card} strokeWidth={2.6} />
                ) : (
                  <ThemedText variant="small" color={current ? colors.card : colors.muted}>
                    {i + 1}
                  </ThemedText>
                )}
              </View>
              {/* The connector stops at the last dot so the rail doesn't
                  trail off past the end of the lifecycle. */}
              {!isLast ? <View style={[styles.line, done && styles.lineDone]} /> : null}
            </View>

            <View style={[styles.body, isLast && styles.bodyLast]}>
              <ThemedText
                variant={current ? "label" : "body"}
                color={current ? colors.goldDeep : done ? colors.ink : colors.muted}
              >
                {step.label}
              </ThemedText>
              {step.caption ? (
                <ThemedText variant="small" color={colors.muted}>
                  {step.caption}
                </ThemedText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DOT = 24;

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  rail: { alignItems: "center", width: DOT },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: colors.gold, borderColor: colors.gold },
  dotCurrent: { backgroundColor: colors.goldDeep, borderColor: colors.goldDeep },
  line: { flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 2 },
  lineDone: { backgroundColor: colors.gold },
  body: { flex: 1, paddingBottom: 18, paddingTop: 2 },
  bodyLast: { paddingBottom: 0 },
});
