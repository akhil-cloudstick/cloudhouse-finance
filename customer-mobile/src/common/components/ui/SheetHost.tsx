import React, { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

// Ported from mobile/src/components/sheetHost.tsx — see that file's doc
// comment for why sheets aren't rendered in a native <Modal> (Android
// edge-to-edge breaks a Modal's own window bounds). BottomSheetModal
// publishes its content here; SheetHost is mounted once as a sibling of
// <Slot/> in app/_layout.tsx.

type Entry = { id: string; node: React.ReactNode };

let entries: Entry[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export const sheetStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot() {
    return entries;
  },
  set(id: string, node: React.ReactNode) {
    const existing = entries.findIndex((e) => e.id === id);
    if (existing >= 0) {
      entries = entries.map((e, i) => (i === existing ? { id, node } : e));
    } else {
      entries = [...entries, { id, node }];
    }
    emit();
  },
  remove(id: string) {
    if (!entries.some((e) => e.id === id)) return;
    entries = entries.filter((e) => e.id !== id);
    emit();
  },
};

let counter = 0;
export function nextSheetId() {
  counter += 1;
  return `sheet-${counter}`;
}

export function SheetHost() {
  const open = useSyncExternalStore(sheetStore.subscribe, sheetStore.getSnapshot, sheetStore.getSnapshot);
  if (!open.length) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 99999, elevation: 99999 }]} collapsable={false} pointerEvents="box-none">
      {open.map((entry) => (
        <View key={entry.id} style={StyleSheet.absoluteFill} pointerEvents="box-none" collapsable={false}>
          {entry.node}
        </View>
      ))}
    </View>
  );
}
