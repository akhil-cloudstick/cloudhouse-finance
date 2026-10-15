
import { StyleSheet } from "react-native";
import { C } from "./base";
import { ZERO_SPLIT, isBalanced, splitTotal } from "@/common/utils/paymentSplit";
import type { SplitAmounts } from "@/modules/investments/types/investment-types";
import { dmy } from "@/common/utils/format";

// ---- Date field (input look, opens a themed month calendar) ---------------
// Shown as DD-MM-YYYY; the value itself stays YYYY-MM-DD.
export function isoToPretty(v?: string | null) {
  return v ? dmy(v) : "";
}

export function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---- payment split (.payment-mode-chips + .payment-split-grid) -------------
// Uses the same SplitAmounts shape the payment APIs take (PaymentBreakdown.tsx).
export type { SplitAmounts };
export { ZERO_SPLIT, isBalanced, splitTotal };

export const s = StyleSheet.create({
  field: { marginBottom: 12 },
  label: { fontSize: 11.5, fontWeight: "600", color: C.muted, marginBottom: 6 },
  fieldRow: { flexDirection: "row", gap: 10 },
  input: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 14.5,
    backgroundColor: C.card,
    color: C.ink,
  },
  inputFocus: { borderColor: C.brand },
  inputDisabled: { color: C.muted },
  dateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },

  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  calTitle: { fontWeight: "700", fontSize: 14 },
  calTitleBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.brandFaint },
  yearGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8, paddingBottom: 6 },
  yearCell: { width: "23%", height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.line },
  yearCellSel: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  yearTxt: { fontSize: 13, fontWeight: "700", color: C.ink },
  calNav: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center" },

  ddBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 7, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: C.card },
  ddValue: { fontSize: 13.5, flex: 1, color: C.ink },
  ddLabel: { fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  comboChev: { position: "absolute", right: 0, top: 0, bottom: 0, width: 38, alignItems: "center", justifyContent: "center" },
  ddItem: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 },
  ddItemSel: { backgroundColor: C.brandPale },
  ddItemTxt: { fontSize: 12.5, fontWeight: "600" },

  btn: { width: "100%", padding: 15, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: C.brandDeep, minHeight: 50 },
  btnOutline: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  btnReject: { backgroundColor: C.card, borderWidth: 1, borderColor: C.redBg },
  btnTxt: { fontWeight: "700", fontSize: 14.5 },
  btnRow2: { flexDirection: "row", gap: 10 },

  result: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  resultK: { fontSize: 12, fontWeight: "600", opacity: 0.85 },
  resultV: { fontSize: 19, fontWeight: "800" },

  warn: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: C.redBg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 13, marginBottom: 14 },
  warnTxt: { flex: 1, color: C.red, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  notice: { backgroundColor: C.amberBg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 13, marginBottom: 14 },
  noticeTxt: { color: C.amber, fontSize: 12, fontWeight: "600", lineHeight: 17 },

  goldCb: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderColor: C.line, borderRadius: 13, marginBottom: 8, backgroundColor: C.card },
  confirm: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderWidth: 1.5, borderColor: C.line, borderRadius: 13, marginBottom: 14, backgroundColor: C.card },
  cbChecked: { borderColor: C.brandDeep, backgroundColor: C.brandFaint },
  cbBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  cbBoxChecked: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  cbTitle: { fontWeight: "700", fontSize: 13 },
  confirmTitle: { fontWeight: "700", fontSize: 12.5 },
  cbSub: { fontSize: 11, color: C.muted, marginTop: 1 },

  orn: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 13, marginBottom: 10, backgroundColor: C.brandFaint },
  ornHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  ornTitle: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep },
  ornRemove: { fontSize: 11, fontWeight: "700", color: C.red },
  dashed: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, borderWidth: 1.5, borderStyle: "dashed", borderColor: C.brand, borderRadius: 12, marginBottom: 14 },
  dashedTxt: { color: C.brandDeep, fontSize: 12.5, fontWeight: "700" },
  upload: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.line, borderRadius: 12, padding: 16, alignItems: "center" },

  pmChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  pmChip: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: C.brandFaint },
  pmChipActive: { backgroundColor: C.brandDeep },
  pmChipTxt: { fontSize: 11, fontWeight: "700", color: C.brandDeep },
  splitGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  splitTotal: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, marginBottom: 12 },
  splitTotalTxt: { fontSize: 11.5, fontWeight: "700", color: C.muted },
});
