
import { StyleSheet } from "react-native";
import { C } from "@/common/components/ui";
import type { CalendarEvent } from "@/modules/reminders/types/reminder-types";

export function reminderKind(t: CalendarEvent["type"]): "overdue" | "due" | "ptp" {
  if (t === "Overdue") return "overdue";
  if (t === "PromiseToPay" || t === "FollowUp" || t === "Custom") return "ptp";
  return "due";
}
export function reminderLabel(t: CalendarEvent["type"]) {
  switch (t) {
    case "Overdue":
      return "Overdue";
    case "LoanDue":
      return "Loan due";
    case "InterestDue":
      return "Interest due";
    case "PromiseToPay":
      return "Promise to pay";
    case "FollowUp":
      return "Follow-up";
    default:
      return "Custom";
  }
}

export const s = StyleSheet.create({
  rateNow: { flexDirection: "row", backgroundColor: C.brandFaint, borderRadius: 12, paddingVertical: 10, marginBottom: 14 },
  rateNowK: { fontSize: 10, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  rateNowV: { fontSize: 14, fontWeight: "800", marginTop: 2 },
  histRow: { paddingVertical: 16 },
  modeHint: { fontSize: 11, color: C.muted, marginTop: -4, marginBottom: 12, lineHeight: 15 },
  modalFooter: { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card },
  karatRow: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, marginBottom: 10 },
  karatLbl: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep, marginBottom: 8 },
  searchHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  searchBox: { flex: 1, justifyContent: "center" },
  searchInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingVertical: 11, paddingLeft: 13, paddingRight: 42, fontSize: 14, color: C.ink },
  searchIc: { position: "absolute", right: 12 },
  cancel: { fontSize: 13, fontWeight: "700", color: C.brandDeep },
  remItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  remBorder: { borderTopWidth: 1, borderTopColor: C.line },
  remTitle: { fontWeight: "700", fontSize: 12.5 },
  remSub: { fontSize: 11, color: C.muted },
});
