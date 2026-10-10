
import { StyleSheet } from "react-native";
import { C } from "./base";

// ---- .status-chip ---------------------------------------------------------
export type ChipTone = "active" | "overdue" | "due" | "closed" | "info";

export const TONES: Record<ChipTone, { fg: string; bg: string }> = {
  active: { fg: C.green, bg: C.greenBg },
  overdue: { fg: C.red, bg: C.redBg },
  due: { fg: C.amber, bg: C.amberBg },
  closed: { fg: C.muted, bg: C.brandFaint },
  info: { fg: C.blue, bg: C.blueBg },
};

/** Maps any backend status string onto the prototype's four chip styles. */
export function toneFor(status?: string | null): ChipTone {
  const x = (status ?? "").toLowerCase();
  if (!x) return "closed";
  if (/(overdue|default|reject|auction eligible|full|void|missed|fail|loss|expired|cash out)/.test(x)) return "overdue";
  if (/(pending|due|draft|renewed|bank pledged|await|at risk|partial|request|scheduled|notice)/.test(x)) return "due";
  if (/(closed|released|matured|inactive|retired|withdrawn|settled|surplus|returned|cancel)/.test(x)) return "closed";
  if (/(active|approved|disbursed|stored|done|paid|verified|safe|cash in|complete|generated|success|conducted)/.test(x)) return "active";
  return "closed";
}

export const s = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  chipTxt: { fontSize: 10, fontWeight: "700" },
  kyc: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignSelf: "flex-start" },
  kycTxt: { fontSize: 10, fontWeight: "700" },
  remPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, flexShrink: 0 },
  remPillTxt: { fontSize: 10, fontWeight: "700" },

  fchipRow: { flexDirection: "row", gap: 7, marginBottom: 10 },
  fchip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: C.brandFaint },
  fchipActive: { backgroundColor: C.brandDeep },
  fchipTxt: { fontSize: 11.5, fontWeight: "600", color: C.brandDeep },
  fchipTxtActive: { color: "#fff" },

  toggle: { flexDirection: "row", backgroundColor: C.brandFaint, borderRadius: 11, padding: 3 },
  toggleItem: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  toggleItemActive: { backgroundColor: C.brandDeep },
  toggleTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  toggleTxtActive: { color: "#fff" },

  pillTabs: { backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line },
  pillTabsSheet: { paddingBottom: 12 },
  pillTabsInner: { flexDirection: "row", gap: 6, paddingVertical: 10, paddingHorizontal: 18 },
  pillTab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  pillTabActive: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  pillTabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  pillTabTxtActive: { color: "#fff" },
  segTrack: { flexDirection: "row", marginVertical: 10, marginHorizontal: 18, padding: 3, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  segThumb: { position: "absolute", top: 3, bottom: 3, left: 3, borderRadius: 999, backgroundColor: C.brandDeep },
  segItem: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 6 },

  subRow: { flexDirection: "row", gap: 6, paddingTop: 2, paddingBottom: 12 },
  subTab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.brandFaint },
  subTabActive: { backgroundColor: C.brandDeep },
  subTabTxt: { fontSize: 11.5, fontWeight: "700", color: C.brandDeep },
  subTabTxtActive: { color: "#fff" },

  grmTabs: { flexDirection: "row", gap: 6, paddingTop: 12, paddingHorizontal: 16 },
  grmTab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, backgroundColor: C.brandFaint },
  grmTabActive: { backgroundColor: C.brandDeep },
  grmTabTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },

  fdTrigger: { marginTop: 12, marginHorizontal: 18, marginBottom: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fdPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: C.brandFaint, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999 },
  fdPillTxt: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep },
  fdCount: { backgroundColor: C.brandDeep, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  fdCountTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  fdSummary: { fontSize: 11.5, color: C.muted, fontWeight: "600" },
});
