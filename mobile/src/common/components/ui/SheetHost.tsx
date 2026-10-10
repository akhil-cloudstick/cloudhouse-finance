import React, { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

// Why sheets aren't rendered in a native <Modal> any more
// -------------------------------------------------------
// Android draws this app edge-to-edge, and RN's Modal opens its own window
// whose bounds don't reliably match the screen under edge-to-edge — the
// bottom-anchored sheet ended up floating with a strip of the dimmed page
// still showing beneath it, and no amount of flex/inset/translucent-flag
// tweaking inside the modal could paint past that window's edge.
//
// So: BottomSheetModal renders nothing where it's used. It publishes its
// content into this module-level store, and SheetHost — mounted once as a
// SIBLING of <Slot/> in app/_layout.tsx, inside the app's own full-screen
// root view — renders it. The overlay is therefore laid out against the real
// screen, so `bottom: 0` really is the bottom edge.
//
// The store is deliberately outside React: a sheet re-publishing its content
// re-renders only SheetHost, never the screen that owns the sheet, so
// republishing on every render can't loop.

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
  // Keeps insertion order stable so a sheet opened on top of another
  // (e.g. a picker over a form sheet) stays on top as it re-renders.
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
