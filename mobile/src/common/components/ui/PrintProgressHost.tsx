import React, { useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";

// Overlay while a backend PDF renders (headless Chrome, a few seconds) so staff don't tap Print twice.
// Reference-counted so overlapping jobs keep it up until the last finishes.

let jobs = 0;
let label = "Preparing document…";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getActive = () => jobs > 0;

// Hidden as soon as the PDF downloads, before the OS print dialog opens, so it isn't left behind it.
export async function withPrintProgress<T>(job: () => Promise<T>, text = "Preparing document…"): Promise<T> {
  label = text;
  jobs++;
  emit();
  try {
    return await job();
  } finally {
    jobs = Math.max(0, jobs - 1);
    emit();
  }
}

export function PrintProgressHost() {
  const active = useSyncExternalStore(subscribe, getActive, getActive);
  if (!active) return null;
  return (
    <View style={styles.backdrop} accessibilityRole="progressbar" accessibilityLabel={label} pointerEvents="auto">
      <View style={styles.card}>
        <ActivityIndicator size="small" color={C.brand} />
        <Txt style={styles.text}>{label}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(43,16,19,0.35)",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },
  text: { fontSize: 14.5, fontWeight: "600", color: C.ink },
});
