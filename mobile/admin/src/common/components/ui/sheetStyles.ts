import { StyleSheet } from "react-native";
import { C } from "./base";

// Shared by Sheet.tsx and ModalHead.tsx. Kept in its own file because ModalHead importing Sheet
// (which renders ModalHead) was a require cycle. Sheet.tsx re-exports this as `s`.
export const s = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  headTitle: { fontWeight: "700", fontSize: 15, flexShrink: 1 },
  cancel: { fontSize: 13, fontWeight: "700", color: C.brandDeep },
  // .modal-body
  body: { paddingTop: 6, paddingHorizontal: 16, paddingBottom: 28 },
  footer: {
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.card,
    gap: 8,
  },
  backdrop: { backgroundColor: "rgba(10,8,20,0.48)" },
  overlayCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  floatingCard: {
    width: "100%",
    maxHeight: "76%",
    backgroundColor: C.card,
    borderRadius: 22,
    overflow: "hidden",
    boxShadow: "0px 24px 60px rgba(0,0,0,0.35)",
  },
  topInset: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden" },
  topCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    maxHeight: "78%",
    backgroundColor: C.card,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
    boxShadow: "0px 18px 40px rgba(0,0,0,0.3)",
  },
});
