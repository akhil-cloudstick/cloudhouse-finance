import React, { createContext } from "react";
import { StyleSheet } from "react-native";
import { C } from "./base";

export type AccDetail = { k: string; v: React.ReactNode; color?: string };
export type AccAction = { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean };

// ---- one-open-at-a-time accordion -----------------------------------------
// Rows inside an <AccGroup> share a single "open" slot: opening a row closes
// whichever was open before. ServerFlatList wraps every list in one, and
// gives each row its item key (AccRowKey) so the open row survives the list
// virtualising it off-screen and back.
type AccGroupState = { open: string | null | undefined; setOpen: (k: string | null) => void };
export const AccGroupContext = createContext<AccGroupState | null>(null);
export const AccRowKey = createContext<string | null>(null);

export const s = StyleSheet.create({
  row: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, marginBottom: 10, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  lid: { flexShrink: 0, maxWidth: 110 },
  lidTxt: { fontWeight: "700", fontSize: 12.5, color: C.brandDeep },
  main: { flex: 1, minWidth: 0 },
  name: { fontWeight: "700", fontSize: 13.5 },
  nameSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  right: { alignItems: "flex-end", flexShrink: 0 },
  amt: { fontWeight: "700", fontSize: 13.5 },
  chev: { flexShrink: 0 },
  body: { backgroundColor: C.brandFaint },
  detail: { paddingTop: 4, paddingHorizontal: 14, paddingBottom: 14, flexDirection: "row", flexWrap: "wrap", rowGap: 10 },
  detailCell: { width: "50%", paddingRight: 16 },
  k: { fontSize: 10.5, color: C.muted, fontWeight: "600" },
  v: { fontSize: 12.5, fontWeight: "700", marginTop: 2 },
  actions: { width: "100%", flexDirection: "row", gap: 8, marginTop: 4 },
  btn: { flex: 1, alignItems: "center", padding: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  btnPrimary: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  btnTxt: { fontSize: 11.5, fontWeight: "700", color: C.brandDeep },

  pkt: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10 },
  pktRow1: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  pktId: { fontWeight: "700", fontSize: 13, color: C.brandDeep },
  pktRow2: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  pktLoan: { fontSize: 12.5, fontWeight: "600" },
  pktSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  pktMeta: { textAlign: "right", fontSize: 11, color: C.muted },
  pktMetaB: { color: C.ink, fontWeight: "700", fontSize: 11 },

  custRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 18, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line },
  custName: { fontWeight: "700", fontSize: 13.5 },
  custSub: { fontSize: 11.5, color: C.muted, marginTop: 1 },

  reportLabel: { fontSize: 11, fontWeight: "700", color: C.muted, letterSpacing: 0.55, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 6 },
  reportRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 18, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line },
  reportTitle: { fontWeight: "700", fontSize: 13, flex: 1 },

  sli: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 14, paddingHorizontal: 2 },
  sliBorder: { borderTopWidth: 1, borderTopColor: C.line },
  sliIc: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sliTitle: { fontWeight: "700", fontSize: 13.5 },
  sliSub: { fontSize: 11, color: C.muted, marginTop: 1 },

  act: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  actBorder: { borderTopWidth: 1, borderTopColor: C.line },
  actAvatar: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  actAvatarTxt: { color: C.brandDeep, fontWeight: "700", fontSize: 12 },
  actTitle: { fontWeight: "600", fontSize: 13 },
  actSub: { fontSize: 11, color: C.muted },
  actAmt: { fontWeight: "700", fontSize: 13, textAlign: "right" },

  pledge: { flexDirection: "row", gap: 12, paddingVertical: 11 },
  pledgeDot: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pledgeTitle: { fontWeight: "700", fontSize: 12.5 },
  pledgeSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  pledgeDate: { fontSize: 10.5, color: C.muted, textAlign: "right", flexShrink: 0 },

  move: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10 },
  moveT: { fontSize: 12.5, fontWeight: "700" },
  moveS: { fontSize: 11, color: C.muted, marginTop: 1 },
  moveD: { fontSize: 10.5, color: C.muted, textAlign: "right" },

  repay: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  repayD: { fontSize: 12, color: C.muted },
  repayV: { fontSize: 13, fontWeight: "700", color: C.green },

  hit: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  hitTag: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: C.brandPale, flexShrink: 0 },
  hitTagTxt: { fontSize: 10, fontWeight: "700", color: C.brandDeep },
});
